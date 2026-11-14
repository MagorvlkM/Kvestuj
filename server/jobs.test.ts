import { describe, expect, it } from 'vitest'
import { awakeDeadline, awakeRemaining } from '../shared/deadline'
import { weekKey } from '../shared/drops'
import { DAY, HOUR, localParts, zonedTimeToUtc } from '../shared/time'
import type { Assignment, Quest } from '../shared/types'
import { MemoryStore } from './memoryStore'
import { dailyCleanup, monthlyRecap, tick } from './jobs'
import { asg, config, data, fakePorts, mem, pst, quests, seeded, T0, tok, TZ, world } from './api/testkit'
import type { FakePorts } from './api/testkit'
import { handle } from './api'

const MIN = 60_000
const VIENNA = 'Europe/Vienna'
const NY = 'America/New_York'

/** UTC ms of a Prague wall-clock time. */
const prague = (y: number, m: number, d: number, h: number, mi = 0) => zonedTimeToUtc(y, m, d, h, mi, TZ)

/** Runs `tick` every 15 minutes from `from` to `to` (inclusive), calling `each` before every tick. */
function run(store: MemoryStore, ports: FakePorts, from: number, to: number, each?: (now: number) => void) {
  for (let t = from; t <= to; t += 15 * MIN) {
    ports.clock.t = t
    each?.(t)
    tick(store, ports)
  }
}

const scheduled = (id: string, memberId: string, dropAt: number, over: Partial<Assignment> = {}): Assignment =>
  asg(id, memberId, { questId: null, dropAt, deadlineAt: null, status: 'scheduled', weekKey: weekKey(dropAt, TZ), ...over })

describe('tick: drop', () => {
  it('tick twice at same now drops once and notifies once', () => {
    const dropAt = T0 + 5 * MIN
    const w = world({ members: [{ ...mem('m1', 'Ada') }], assignments: [scheduled('a1', 'm1', dropAt)], now: dropAt + 3 * MIN })
    const first = tick(w.store, w.ports)
    expect(first).toEqual({ dropped: 1, reminded: 0, missed: 0, planned: 0 })
    const a = w.store.assignments()[0]
    expect(a.status).toBe('open')
    expect(a.questId).not.toBeNull()
    expect(w.ports.sent).toEqual([{ channel: 'kvestuj-q-m1', title: 'New quest', body: 'You have 12 hours. Open Kvestuj.' }])

    const second = tick(w.store, w.ports)
    expect(second).toEqual({ dropped: 0, reminded: 0, missed: 0, planned: 0 })
    expect(w.ports.sent).toHaveLength(1)
    expect(w.store.assignments()).toHaveLength(1)
    expect(w.store.assignments()[0]).toEqual(a)
  })

  it('drop sets 12 awake-hour deadline', () => {
    const dropAt = prague(2026, 11, 16, 15, 0)
    const w = world({ members: [mem('m1', 'Ada')], assignments: [scheduled('a1', 'm1', dropAt)], now: dropAt })
    tick(w.store, w.ports)
    const a = w.store.assignments()[0]
    // 15:00-22:00 = 7 h today, 5 h tomorrow from 10:00.
    expect(a.deadlineAt).toBe(prague(2026, 11, 17, 15, 0))
    expect(a.deadlineAt).toBe(awakeDeadline(dropAt, TZ))
  })

  it('does not drop an assignment that is not yet due', () => {
    const dropAt = T0 + HOUR
    const w = world({ members: [mem('m1', 'Ada')], assignments: [scheduled('a1', 'm1', dropAt)], now: dropAt - MIN })
    expect(tick(w.store, w.ports).dropped).toBe(0)
    expect(w.store.assignments()[0].status).toBe('scheduled')
    expect(w.ports.sent).toEqual([])
  })

  it('a drop processed after its deadline is opened silently and then missed', () => {
    const dropAt = prague(2026, 11, 16, 12, 0)
    const now = prague(2026, 11, 20, 12, 0)
    const w = world({
      members: [mem('m1', 'Ada')],
      assignments: [scheduled('a1', 'm1', dropAt), scheduled('a2', 'm1', now - HOUR, { weekKey: weekKey(now, TZ) })],
      now,
    })
    const r = tick(w.store, w.ports)
    expect(r.dropped).toBe(2)
    expect(r.missed).toBe(1)
    expect(w.store.assignments().find((a) => a.id === 'a1')!.status).toBe('missed')
    // only the still-live drop is announced
    expect(w.ports.sent.map((s) => s.title)).toEqual(['New quest'])
  })

  it('never repeats the previous quest and remembers rerolled-away quests (seenQuestIds)', () => {
    const bank: Quest[] = [
      { id: 'q1', text: 'QTEXT-one', difficulty: 'easy', enabled: true },
      { id: 'q2', text: 'QTEXT-two', difficulty: 'easy', enabled: true },
      { id: 'q3', text: 'QTEXT-three', difficulty: 'easy', enabled: true },
    ]
    const lastWeek = prague(2026, 11, 9, 12, 0)
    const dropAt = prague(2026, 11, 16, 12, 0)
    for (let seed = 1; seed <= 25; seed++) {
      const w = world({
        quests: bank,
        members: [mem('m1', 'Ada')],
        assignments: [
          // last week: shown q2, rerolled to q1 (the assignment now holds q1)
          asg('a0', 'm1', { questId: 'q1', dropAt: lastWeek, deadlineAt: awakeDeadline(lastWeek, TZ), status: 'done', weekKey: weekKey(lastWeek, TZ) }),
          scheduled('a1', 'm1', dropAt),
        ],
        rerollUses: [{ memberId: 'm1', weekKey: weekKey(lastWeek, TZ), questId: 'q2' }],
        now: dropAt,
      })
      w.ports.rng = seeded(seed)
      tick(w.store, w.ports)
      expect(w.store.assignments().find((a) => a.id === 'a1')!.questId).toBe('q3')
    }
  })

  it('a tick with zero enabled quests logs and keeps going for other members', () => {
    const now = prague(2026, 11, 16, 12, 0)
    const w = world({
      quests: [],
      members: [mem('m1', 'Ada'), mem('m2', 'Bo')],
      assignments: [
        scheduled('a1', 'm1', now - MIN),
        asg('a2', 'm2', { dropAt: now - 20 * HOUR, deadlineAt: now - HOUR, status: 'open', weekKey: weekKey(now, TZ) }),
      ],
      now,
    })
    const r = tick(w.store, w.ports)
    expect(r.dropped).toBe(0)
    expect(r.missed).toBe(1)
    expect(w.store.assignments().find((a) => a.id === 'a1')!.status).toBe('scheduled')
    expect(w.store.assignments().find((a) => a.id === 'a2')!.status).toBe('missed')
    expect(w.ports.logs.length).toBeGreaterThan(0)
    expect(w.ports.sent).toEqual([])
  })
})

describe('tick: reminder and missed', () => {
  const dropAt = prague(2026, 11, 16, 10, 0)
  const deadlineAt = prague(2026, 11, 16, 22, 0)
  const open = () =>
    world({
      members: [mem('m1', 'Ada')],
      assignments: [asg('a1', 'm1', { dropAt, deadlineAt })],
      now: prague(2026, 11, 16, 19, 45),
    })

  it('reminder sent once', () => {
    const w = open()
    expect(tick(w.store, w.ports).reminded).toBe(0) // 2 h 15 min left
    w.ports.clock.t = prague(2026, 11, 16, 20, 0) // exactly 2 h left
    expect(tick(w.store, w.ports).reminded).toBe(1)
    expect(w.ports.sent).toEqual([{ channel: 'kvestuj-q-m1', title: '2 hours left', body: 'Your quest is due soon. Open Kvestuj.' }])
    expect(w.store.assignments()[0].remindedAt).toBe(prague(2026, 11, 16, 20, 0))
    w.ports.clock.t = prague(2026, 11, 16, 20, 15)
    expect(tick(w.store, w.ports).reminded).toBe(0)
    w.ports.clock.t = prague(2026, 11, 16, 21, 45)
    expect(tick(w.store, w.ports).reminded).toBe(0)
    expect(w.ports.sent).toHaveLength(1)
  })

  it('missed after deadline', () => {
    const w = open()
    w.ports.clock.t = deadlineAt - MIN
    expect(tick(w.store, w.ports).missed).toBe(0)
    expect(w.store.assignments()[0].status).toBe('open')
    w.ports.clock.t = deadlineAt
    expect(tick(w.store, w.ports)).toMatchObject({ missed: 1, reminded: 0 })
    expect(w.store.assignments()[0].status).toBe('missed')
    expect(tick(w.store, w.ports).missed).toBe(0)
  })

  it('a done assignment is never reminded or marked missed', () => {
    const w = world({
      members: [mem('m1', 'Ada')],
      assignments: [asg('a1', 'm1', { dropAt, deadlineAt, status: 'done' })],
      now: deadlineAt + HOUR,
    })
    expect(tick(w.store, w.ports)).toMatchObject({ reminded: 0, missed: 0 })
  })

  it('no reminder at night: due at 22:05 goes out at 10:00 next morning, exactly once', () => {
    // dropped 12:00, deadline tomorrow 12:00: exactly 2 h of awake time are left from 22:00 on.
    const d = prague(2026, 11, 16, 12, 0)
    const dl = awakeDeadline(d, TZ)
    expect(dl).toBe(prague(2026, 11, 17, 12, 0))
    const w = world({ members: [mem('m1', 'Ada')], assignments: [asg('a1', 'm1', { dropAt: d, deadlineAt: dl })], now: prague(2026, 11, 16, 21, 45) })
    for (const t of [prague(2026, 11, 16, 21, 45), prague(2026, 11, 16, 22, 5), prague(2026, 11, 16, 22, 30), prague(2026, 11, 17, 3, 0), prague(2026, 11, 17, 9, 45)]) {
      w.ports.clock.t = t
      expect(tick(w.store, w.ports).reminded).toBe(0)
    }
    expect(w.ports.sent).toEqual([])
    w.ports.clock.t = prague(2026, 11, 17, 10, 0)
    expect(tick(w.store, w.ports).reminded).toBe(1)
    w.ports.clock.t = prague(2026, 11, 17, 10, 15)
    expect(tick(w.store, w.ports).reminded).toBe(0)
    expect(w.ports.sent).toHaveLength(1)
    expect(w.ports.sent[0].title).toBe('2 hours left')
  })
})

describe('tick: planning', () => {
  it('plans two drops per week, each 10:00-22:00 local, and does not replan', () => {
    const now = prague(2026, 11, 16, 0, 5)
    const w = world({ members: [mem('m1', 'Ada'), mem('m2', 'Bo')], now })
    const r = tick(w.store, w.ports)
    expect(r.planned).toBe(4)
    for (const id of ['m1', 'm2']) {
      const mine = w.store.assignments({ memberId: id })
      expect(mine).toHaveLength(2)
      for (const a of mine) {
        expect(a).toMatchObject({ status: 'scheduled', questId: null, deadlineAt: null, remindedAt: null, weekKey: weekKey(now, TZ) })
        expect(a.id).toMatch(/^a_/)
        expect(a.dropAt).toBeGreaterThanOrEqual(now)
        const h = localParts(a.dropAt, TZ).h
        expect(h).toBeGreaterThanOrEqual(10)
        expect(h).toBeLessThan(22)
      }
    }
    expect(tick(w.store, w.ports).planned).toBe(0)
    expect(w.store.assignments()).toHaveLength(4)
  })

  it("never opens two quests at once across weeks: next week's first drop is after last week's deadline", () => {
    // Sunday 21:00 drop: deadline Monday 21:00 (1 h + 11 h).
    const sun = prague(2026, 11, 15, 21, 0)
    const dl = awakeDeadline(sun, TZ)
    expect(dl).toBe(prague(2026, 11, 16, 21, 0))
    for (let seed = 1; seed <= 20; seed++) {
      const now = prague(2026, 11, 16, 0, 15)
      const w = world({
        members: [mem('m1', 'Ada')],
        assignments: [asg('a0', 'm1', { dropAt: sun, deadlineAt: dl, status: 'open', weekKey: weekKey(sun, TZ) })],
        now,
      })
      w.ports.rng = seeded(seed)
      tick(w.store, w.ports)
      const planned = w.store.assignments().filter((a) => a.status === 'scheduled')
      expect(planned.length).toBeGreaterThan(0)
      for (const a of planned) expect(a.dropAt).toBeGreaterThanOrEqual(dl)
    }
  })

  it('uses the awake deadline of a scheduled last assignment (deadlineAt null)', () => {
    // the member's last assignment is still scheduled (drop pending); the new week must not start before its deadline
    const sun = prague(2026, 11, 15, 21, 0)
    const now = prague(2026, 11, 16, 0, 15)
    const w = world({
      members: [mem('m1', 'Ada')],
      assignments: [scheduled('a0', 'm1', sun, { weekKey: weekKey(sun, TZ) })],
      now,
    })
    tick(w.store, w.ports)
    // the stale drop is still pending (it waits for 10:00); the new plan must come after its deadline
    const planned = w.store.assignments().filter((a) => a.id !== 'a0')
    expect(planned.length).toBeGreaterThan(0)
    for (const a of planned) expect(a.dropAt).toBeGreaterThanOrEqual(prague(2026, 11, 16, 21, 0))
  })
})

describe('tick: time zones', () => {
  it('planned drops keep UTC after setTz mid-week; next week uses new tz', () => {
    const ada = mem('m1', 'Ada', { tz: VIENNA })
    const store = new MemoryStore({ config, quests, members: [ada] })
    const mon = zonedTimeToUtc(2026, 11, 16, 0, 0, VIENNA)
    const ports = fakePorts(mon, 3)
    const changeAt = zonedTimeToUtc(2026, 11, 17, 0, 0, VIENNA)
    let planned: { id: string; dropAt: number; weekKey: string }[] = []
    let changed = false

    // Monday 00:00 Vienna through the start of the next New York week (Mon 2026-11-23 00:00 New York + 1 h)
    const nextWeekStart = zonedTimeToUtc(2026, 11, 23, 0, 0, NY)
    run(store, ports, mon, nextWeekStart + HOUR, (now) => {
      if (now === mon + 15 * MIN) {
        planned = store.assignments().map(({ id, dropAt, weekKey }) => ({ id, dropAt, weekKey }))
        expect(planned).toHaveLength(2)
      }
      if (!changed && now >= changeAt) {
        changed = true
        data(handle({ op: 'setTz', token: tok('m1'), tz: NY }, store, ports))
      }
    })

    const all = store.assignments()
    // week 1: the planned drops keep their UTC instants and weekKey
    for (const p of planned) {
      const a = all.find((x) => x.id === p.id)!
      expect(a.dropAt).toBe(p.dropAt)
      expect(a.weekKey).toBe(p.weekKey)
    }
    // the drops after the change get their deadline in the new zone, the ones before in the old zone
    const after = planned.filter((p) => p.dropAt >= changeAt)
    const before = planned.filter((p) => p.dropAt < changeAt)
    expect(after.length).toBeGreaterThan(0)
    for (const p of after) expect(all.find((x) => x.id === p.id)!.deadlineAt).toBe(awakeDeadline(p.dropAt, NY))
    for (const p of before) expect(all.find((x) => x.id === p.id)!.deadlineAt).toBe(awakeDeadline(p.dropAt, VIENNA))

    // week 2 is planned in New York wall-clock time
    const week2 = all.filter((a) => !planned.some((p) => p.id === a.id))
    expect(week2).toHaveLength(2)
    for (const a of week2) {
      expect(a.weekKey).toBe(weekKey(nextWeekStart, NY))
      expect(a.dropAt).toBeGreaterThanOrEqual(nextWeekStart)
      const h = localParts(a.dropAt, NY).h
      expect(h).toBeGreaterThanOrEqual(10)
      expect(h).toBeLessThan(22)
    }
  })
})

describe('tick: quiet hours and zone changes', () => {
  const V = VIENNA

  it('a drop that lands in the new zone\'s night waits for 10:00, then drops once with one alert', () => {
    // NY member planned a drop for Sunday 21:00 New York = Monday 03:00 Vienna, then moved to Vienna.
    const dropAt = zonedTimeToUtc(2026, 11, 22, 21, 0, NY)
    expect(localParts(dropAt, V)).toMatchObject({ d: 23, h: 3 })
    const store = new MemoryStore({
      config,
      quests,
      members: [mem('m1', 'Ada', { tz: V })],
      assignments: [scheduled('a0', 'm1', dropAt, { weekKey: weekKey(dropAt, NY) })],
    })
    const ports = fakePorts(dropAt)
    const at = (h: number, mi = 0) => zonedTimeToUtc(2026, 11, 23, h, mi, V)
    for (const t of [at(3, 0), at(3, 15), at(6, 0), at(9, 45)]) {
      ports.clock.t = t
      expect(tick(store, ports).dropped).toBe(0)
    }
    expect(store.assignments().find((a) => a.id === 'a0')!.status).toBe('scheduled')
    expect(ports.sent).toEqual([])

    ports.clock.t = at(10, 0)
    expect(tick(store, ports).dropped).toBe(1)
    const a = store.assignments().find((x) => x.id === 'a0')!
    expect(a.status).toBe('open')
    expect(a.dropAt).toBe(dropAt)
    expect(a.deadlineAt).toBe(awakeDeadline(dropAt, V))
    expect(ports.sent.map((s) => s.title)).toEqual(['New quest'])
    ports.clock.t = at(10, 15)
    expect(tick(store, ports).dropped).toBe(0)
    expect(ports.sent).toHaveLength(1)
  })

  it('a 21:58 drop picked up by the 22:05 tick still drops; past the 30-minute grace it waits for 10:00', () => {
    const dropAt = prague(2026, 11, 16, 21, 58)
    const w = world({ members: [mem('m1', 'Ada')], assignments: [scheduled('a1', 'm1', dropAt)], now: prague(2026, 11, 16, 22, 5) })
    expect(tick(w.store, w.ports).dropped).toBe(1)
    expect(w.ports.sent.map((s) => s.title)).toEqual(['New quest'])

    const w2 = world({ members: [mem('m1', 'Ada')], assignments: [scheduled('a1', 'm1', dropAt)], now: prague(2026, 11, 16, 22, 40) })
    expect(tick(w2.store, w2.ports).dropped).toBe(0)
    w2.ports.clock.t = prague(2026, 11, 17, 10, 0)
    expect(tick(w2.store, w2.ports).dropped).toBe(1)
  })

  it('an eastward zone change across Sunday/Monday never leaves three drops in one local week', () => {
    const mon = zonedTimeToUtc(2026, 11, 16, 12, 0, NY)
    const sun21 = zonedTimeToUtc(2026, 11, 22, 21, 0, NY) // = Monday 03:00 Vienna, in Vienna week 2026-W48
    const store = new MemoryStore({
      config,
      quests,
      members: [mem('m1', 'Ada', { tz: V })], // already switched from New York
      assignments: [
        asg('x1', 'm1', { dropAt: mon, deadlineAt: mon + 10 * HOUR, status: 'done', weekKey: weekKey(mon, NY) }),
        scheduled('x2', 'm1', sun21, { weekKey: weekKey(sun21, NY) }),
      ],
    })
    const start = zonedTimeToUtc(2026, 11, 22, 20, 0, NY)
    const ports = fakePorts(start, 3)
    run(store, ports, start, start + 8 * DAY)

    const weekStart = zonedTimeToUtc(2026, 11, 23, 0, 0, V)
    const weekEnd = zonedTimeToUtc(2026, 11, 30, 0, 0, V)
    const all = store.assignments()
    expect(all.filter((a) => a.dropAt >= weekStart && a.dropAt < weekEnd)).toHaveLength(2)
    expect(weekKey(weekStart, V)).toBe('2026-W48')
    // never two quests open at once: each drop is at/after the previous one's deadline
    const byDrop = [...all].sort((a, b) => a.dropAt - b.dropAt)
    for (let i = 1; i < byDrop.length; i++) {
      expect(byDrop[i].dropAt).toBeGreaterThanOrEqual(byDrop[i - 1].deadlineAt ?? awakeDeadline(byDrop[i - 1].dropAt, V))
    }
  })

  it('a DST week (2026-10-25, Vienna): exactly 2 drops, each with exactly 12 awake hours, all in 10:00-22:00', () => {
    const mon = zonedTimeToUtc(2026, 10, 19, 0, 0, V)
    const sunEnd = zonedTimeToUtc(2026, 10, 26, 0, 0, V)
    for (let seed = 1; seed <= 4; seed++) {
      const store = new MemoryStore({ config, quests, members: [mem('m1', 'Ada', { tz: V })] })
      const ports = fakePorts(mon, seed)
      run(store, ports, mon, sunEnd - 15 * MIN)
      const all = store.assignments()
      expect(all).toHaveLength(2)
      for (const a of all) {
        const h = localParts(a.dropAt, V).h
        expect(h).toBeGreaterThanOrEqual(10)
        expect(h).toBeLessThanOrEqual(21)
        expect(a.deadlineAt).not.toBeNull()
        expect(awakeRemaining(a.dropAt, a.deadlineAt!, V)).toBe(12 * HOUR)
        const d = localParts(a.deadlineAt!, V)
        const minutes = d.h * 60 + d.mi
        expect(minutes).toBeGreaterThanOrEqual(10 * 60)
        expect(minutes).toBeLessThanOrEqual(22 * 60)
      }
      expect(ports.sent.filter((s) => s.title === 'New quest')).toHaveLength(2)
    }
  })
})

describe('simulated week', () => {
  it('one member, tick every 15 minutes: 2 drops, each notified once, at most one reminder, 12 awake hours', () => {
    const mon = zonedTimeToUtc(2026, 11, 16, 0, 0, VIENNA)
    const store = new MemoryStore({ config, quests, members: [mem('m1', 'Ada', { tz: VIENNA })] })
    const ports = fakePorts(mon, 11)
    run(store, ports, mon, mon + 7 * DAY - 15 * MIN)

    const all = store.assignments()
    expect(all).toHaveLength(2)
    expect(all[0].questId).not.toBe(all[1].questId)
    for (const a of all) {
      expect(a.dropAt).toBeGreaterThanOrEqual(mon)
      expect(a.questId).not.toBeNull()
      expect(a.deadlineAt).toBe(awakeDeadline(a.dropAt, VIENNA))
    }
    expect(ports.sent.filter((s) => s.title === 'New quest')).toHaveLength(2)
    const reminders = ports.sent.filter((s) => s.title === '2 hours left')
    expect(reminders.length).toBeLessThanOrEqual(2)
    expect(all.filter((a) => a.remindedAt !== null)).toHaveLength(reminders.length)
    // every reminder went out in the member's awake hours
    for (const a of all) if (a.remindedAt !== null) expect(localParts(a.remindedAt, VIENNA).h).toBeGreaterThanOrEqual(10)
    for (const a of all) if (a.remindedAt !== null) expect(localParts(a.remindedAt, VIENNA).h).toBeLessThan(22)
    // a second run of the same ticks changes nothing
    const snapshot = JSON.stringify(store.assignments())
    const sent = ports.sent.length
    run(store, ports, mon, mon + 7 * DAY - 15 * MIN)
    expect(JSON.stringify(store.assignments())).toBe(snapshot)
    expect(ports.sent.length).toBe(sent)
  })

  it('notification bodies never contain quest text', () => {
    const mon = zonedTimeToUtc(2026, 11, 16, 0, 0, TZ)
    const store = new MemoryStore({ config, quests, members: [mem('m1', 'Ada'), mem('m2', 'Bo', { tz: NY })] })
    const ports = fakePorts(mon, 5)
    run(store, ports, mon, mon + 8 * DAY)
    expect(ports.sent.length).toBeGreaterThanOrEqual(4)
    for (const s of ports.sent) {
      const text = `${s.title} ${s.body}`
      for (const q of quests) expect(text).not.toContain(q.text)
      expect(text).not.toContain('QTEXT')
    }
  })
})

describe('tick: locking', () => {
  it('runs inside the script lock', () => {
    const w = world()
    tick(w.store, w.ports)
    dailyCleanup(w.store, w.ports)
    monthlyRecap(w.store, w.ports)
    expect(w.ports.lockCalls).toBe(3)
  })
})

/** A file name like the ones createUpload gives Drive uploads: `a_` + 12 lowercase base32 characters. */
const upName = (tag: string, suffix: string) => `a_${tag.repeat(12)}-${suffix}`

describe('dailyCleanup', () => {
  const now = prague(2026, 11, 14, 4, 0)

  it('cleanup trashes 183-day-old video, keeps photo, keeps still', () => {
    const old = now - 183 * DAY
    const w = world({
      now,
      assignments: [asg('a1', 'm1'), asg('a2', 'm1'), asg('a3', 'm1'), asg('a4', 'm1')],
      posts: [
        pst('p1', 'a1', 'm1', { kind: 'video', fileId: 'vid-old', stillFileId: 'still-old', createdAt: old, durationS: 30 }),
        pst('p2', 'a2', 'm1', { kind: 'photo', fileId: 'photo-old', createdAt: old }),
        pst('p3', 'a3', 'm1', { kind: 'video', fileId: 'vid-new', stillFileId: 'still-new', createdAt: now - 100 * DAY, durationS: 10 }),
        pst('p4', 'a4', 'm1', { kind: 'video', fileId: 'vid-edge', stillFileId: 'still-edge', createdAt: now - 182 * DAY, durationS: 10 }),
      ],
    })
    const r = dailyCleanup(w.store, w.ports)
    expect(r.expired).toBe(1)
    expect(w.ports.trashed).toEqual(['vid-old'])
    const p1 = w.store.posts().find((p) => p.id === 'p1')!
    expect(p1.expired).toBe(true)
    expect(p1.stillFileId).toBe('still-old')
    expect(p1.caption).toBe('caption p1')
    expect(w.store.posts().find((p) => p.id === 'p2')!.expired).toBe(false)
    expect(w.store.posts().find((p) => p.id === 'p3')!.expired).toBe(false)
    expect(w.store.posts().find((p) => p.id === 'p4')!.expired).toBe(false)

    // idempotent
    expect(dailyCleanup(w.store, w.ports).expired).toBe(0)
    expect(w.ports.trashed).toEqual(['vid-old'])
  })

  it('marks the video expired even when trash throws', () => {
    const w = world({
      now,
      assignments: [asg('a1', 'm1')],
      posts: [pst('p1', 'a1', 'm1', { kind: 'video', fileId: 'gone', createdAt: now - 200 * DAY, durationS: 5 })],
    })
    w.ports.drive.trash = () => {
      throw new Error('File not found')
    }
    expect(dailyCleanup(w.store, w.ports).expired).toBe(1)
    expect(w.store.posts()[0].expired).toBe(true)
    expect(w.ports.logs.join('\n')).toContain('gone')
  })

  it('trashes orphan uploads older than 48 h, keeps younger ones, referenced files and stills', () => {
    const w = world({
      now,
      assignments: [asg('a1', 'm1'), asg('a2', 'm1')],
      posts: [
        pst('p1', 'a1', 'm1', { kind: 'photo', fileId: 'f-photo', createdAt: now - 60 * DAY }),
        pst('p2', 'a2', 'm1', { kind: 'video', fileId: 'f-video', stillFileId: 'f-still', createdAt: now - 60 * DAY, durationS: 9 }),
      ],
    })
    w.ports.folder = [
      { id: 'orphan-49h', name: upName('a', 'main.jpg'), createdAt: now - 49 * HOUR },
      { id: 'orphan-47h', name: upName('b', 'main.jpg'), createdAt: now - 47 * HOUR },
      { id: 'f-photo', name: upName('c', 'main.jpg'), createdAt: now - 60 * DAY },
      { id: 'f-video', name: upName('d', 'main.mp4'), createdAt: now - 60 * DAY },
      { id: 'f-still', name: upName('d', 'still.jpg'), createdAt: now - 60 * DAY },
    ]
    const r = dailyCleanup(w.store, w.ports)
    expect(r).toEqual({ expired: 0, orphans: 1 })
    expect(w.ports.trashed).toEqual(['orphan-49h'])
    expect(dailyCleanup(w.store, w.ports).orphans).toBe(0) // gone from the folder now
  })

  it('only trashes files named like an upload: an old unreferenced notes.txt is kept', () => {
    const w = world({ now })
    w.ports.folder = [
      { id: 'notes', name: 'notes.txt', createdAt: now - 400 * DAY },
      { id: 'near-miss', name: 'a_abcdefghijkl-main', createdAt: now - 400 * DAY },
      { id: 'wrong-id', name: 'a_ABCDEFGHIJKL-main.jpg', createdAt: now - 400 * DAY },
      { id: 'upload', name: upName('g', 'main.mp4'), createdAt: now - 400 * DAY },
    ]
    expect(dailyCleanup(w.store, w.ports).orphans).toBe(1)
    expect(w.ports.trashed).toEqual(['upload'])
  })

  it('keeps going when trashing one orphan fails', () => {
    const w = world({ now })
    w.ports.folder = [
      { id: 'o1', name: upName('e', 'main.jpg'), createdAt: now - 100 * HOUR },
      { id: 'o2', name: upName('f', 'still.jpg'), createdAt: now - 100 * HOUR },
    ]
    const real = w.ports.drive.trash
    w.ports.drive.trash = (id) => {
      if (id === 'o1') throw new Error('boom')
      real(id)
    }
    expect(dailyCleanup(w.store, w.ports).orphans).toBe(1)
    expect(w.ports.trashed).toEqual(['o2'])
    expect(w.ports.logs.join('\n')).toContain('o1')
  })
})

describe('monthlyRecap', () => {
  const first = prague(2026, 11, 1, 6, 0)

  it('monthlyRecap idempotent on the 1st, nothing on the 2nd', () => {
    const w = world({
      now: first,
      assignments: [asg('a1', 'm1', { status: 'done', dropAt: prague(2026, 10, 20, 12), deadlineAt: prague(2026, 10, 21, 12) })],
    })
    expect(monthlyRecap(w.store, w.ports)).toEqual({ created: '2026-10' })
    const recaps = w.store.recaps()
    expect(recaps).toHaveLength(1)
    expect(recaps[0].month).toBe('2026-10')
    expect(JSON.parse(recaps[0].json)).toMatchObject({ month: '2026-10', totalDone: 1 })
    expect(w.ports.sent).toEqual([{ channel: config.groupChannel, title: 'Kvestuj', body: 'October recap is ready' }])

    w.ports.clock.t = first + 10 * HOUR
    expect(monthlyRecap(w.store, w.ports)).toEqual({ created: null })
    expect(w.store.recaps()).toHaveLength(1)
    expect(w.ports.sent).toHaveLength(1)

    // 2nd of the month: nothing, even though the recap for a missing month would be possible
    const w2 = world({ now: prague(2026, 11, 2, 6, 0) })
    expect(monthlyRecap(w2.store, w2.ports)).toEqual({ created: null })
    expect(w2.store.recaps()).toEqual([])
    expect(w2.ports.sent).toEqual([])
  })

  it('does nothing when no member existed in the previous month', () => {
    const w = world({ now: first, members: [mem('m1', 'Ada', { joinedAt: prague(2026, 11, 1, 1, 0) })] })
    expect(monthlyRecap(w.store, w.ports)).toEqual({ created: null })
    expect(w.store.recaps()).toEqual([])
    expect(w.ports.sent).toEqual([])
  })

  it("January 1st creates the previous December's recap", () => {
    const jan = prague(2027, 1, 1, 8, 0)
    const w = world({ now: jan })
    expect(monthlyRecap(w.store, w.ports)).toEqual({ created: '2026-12' })
    expect(w.store.recaps()[0].month).toBe('2026-12')
    expect(w.ports.sent[0].body).toBe('December recap is ready')
  })

  it('uses the group time zone for "the 1st"', () => {
    // 2026-10-31 23:30 UTC is already Nov 1 in Prague, still Oct 31 in New York
    const instant = Date.UTC(2026, 9, 31, 23, 30)
    const w = world({ now: instant })
    expect(monthlyRecap(w.store, w.ports)).toEqual({ created: '2026-10' })
  })
})
