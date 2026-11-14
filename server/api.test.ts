import { describe, expect, it } from 'vitest'
import { hashSecret } from '../shared/codes'
import { planWeek, weekKey } from '../shared/drops'
import { DAY, HOUR, startOfLocalWeek } from '../shared/time'
import type { ApiResults, Member } from '../shared/types'
import { handle } from './api'
import { MemoryStore } from './memoryStore'
import {
  ADA,
  asg,
  BO,
  config,
  data,
  DEADLINE0,
  fakePorts,
  mem,
  pst,
  RECOVERY,
  refusal,
  seeded,
  T0,
  tok,
  TZ,
  world,
} from './api/testkit'

const joinArgs = (over: Record<string, unknown> = {}) => ({ secret: config.groupSecret, name: 'Cyril', tz: TZ, ...over })

describe('join', () => {
  it('join wrong secret refused', () => {
    const w = world()
    expect(refusal(w.anon('join', joinArgs({ secret: 'nope' })))).toBe("This invite link isn't valid")
    expect(w.store.members()).toHaveLength(2)
  })

  it('11th join refused', () => {
    const ten = Array.from({ length: 10 }, (_, i) => mem(`m${i}`, `Member ${i}`))
    const w = world({ members: ten })
    expect(refusal(w.anon('join', joinArgs()))).toBe('The group is full (10 of 10)')
    expect(w.store.members()).toHaveLength(10)
  })

  it('duplicate name different case refused', () => {
    const w = world()
    expect(refusal(w.anon('join', joinArgs({ name: 'ada' })))).toBe('That name is taken')
    expect(refusal(w.anon('join', joinArgs({ name: '  ADA ' })))).toBe('That name is taken')
  })

  it('refuses a name that is empty or longer than 24 characters', () => {
    const w = world()
    for (const name of ['', '   ', 'x'.repeat(25), 42]) {
      expect(refusal(w.anon('join', joinArgs({ name })))).toBe('Pick a name of 1 to 24 characters')
    }
  })

  it('normalises the name: trims and collapses inner whitespace', () => {
    const w = world()
    const r = data<ApiResults['join']>(w.anon('join', joinArgs({ name: '  Cyril \t  Novák ' })))
    expect(r.member.name).toBe('Cyril Novák')
  })

  it('refuses a bad time zone and a malformed recovery code', () => {
    const w = world()
    expect(refusal(w.anon('join', joinArgs({ tz: 'Mars/Olympus' })))).toBe('Pick a valid time zone')
    expect(refusal(w.anon('join', joinArgs({ recoveryCode: 'KVS-0000-0000' })))).toBe("That recovery code isn't valid")
    expect(w.store.members()).toHaveLength(2)
  })

  it('creates the member and returns token, code and channels without secrets', () => {
    const w = world()
    const r = data<ApiResults['join']>(w.anon('join', joinArgs()))
    const stored = w.store.members().find((m) => m.name === 'Cyril')!
    expect(stored.tokenHash).toBe(hashSecret(r.token))
    expect(stored.recoveryHash).toBe(hashSecret(r.recoveryCode))
    expect(r.recoveryCode).toMatch(/^KVS-[2-9A-Z]{4}-[2-9A-Z]{4}$/)
    expect(r.member).toEqual({ id: stored.id, name: 'Cyril', tz: TZ, joinedAt: T0 + HOUR })
    expect(r.questChannel).toBe(stored.questChannel)
    expect(r.groupChannel).toBe(config.groupChannel)
    expect(JSON.stringify(r.member)).not.toMatch(/tokenHash|recoveryHash|questChannel/)
    expect(data(handle({ op: 'me', token: r.token }, w.store, w.ports)).member.id).toBe(stored.id)
  })

  it('join plans current week drops', () => {
    const w = world()
    const now = T0 + HOUR
    const expected = planWeek(startOfLocalWeek(now, TZ), TZ, now, seeded(7))
    expect(expected.length).toBeGreaterThan(0)
    const r = data<ApiResults['join']>(w.anon('join', joinArgs()))
    const planned = w.store.assignments({ memberId: r.member.id })
    expect(planned.map((a) => a.dropAt).sort()).toEqual(expected)
    for (const a of planned) {
      expect(a).toMatchObject({ questId: null, deadlineAt: null, status: 'scheduled', remindedAt: null, weekKey: weekKey(a.dropAt, TZ) })
    }
  })

  it('join with a messy client code stores the canonical code and recover accepts it', () => {
    const w = world()
    const r = data<ApiResults['join']>(w.anon('join', joinArgs({ recoveryCode: 'kvs 7q4m 28xd' })))
    expect(r.recoveryCode).toBe('KVS-7Q4M-28XD')
    for (const code of ['KVS-7Q4M-28XD', '7q4m28xd']) {
      expect(data(w.anon('recover', { secret: config.groupSecret, name: 'cyril', code })).member.id).toBe(r.member.id)
    }
  })
})

describe('recover', () => {
  const args = (over: Record<string, unknown> = {}) => ({ secret: config.groupSecret, name: 'Ada', code: RECOVERY, ...over })

  it('recover wrong code refused', () => {
    const w = world()
    expect(refusal(w.anon('recover', args({ code: 'KVS-2345-678A' })))).toBe("Name or recovery code doesn't match")
    expect(refusal(w.anon('recover', args({ code: 'garbage' })))).toBe("Name or recovery code doesn't match")
    expect(refusal(w.anon('recover', args({ name: 'Nobody' })))).toBe("Name or recovery code doesn't match")
    expect(refusal(w.anon('recover', args({ secret: 'nope' })))).toBe("This invite link isn't valid")
  })

  it('recover rotates token', () => {
    const w = world()
    const r = data<ApiResults['recover']>(w.anon('recover', args({ name: ' ada ' })))
    expect(r.member).toEqual({ id: ADA.id, name: 'Ada', tz: TZ, joinedAt: ADA.joinedAt })
    expect(r.questChannel).toBe(ADA.questChannel)
    expect(r.groupChannel).toBe(config.groupChannel)
    expect(r.token).not.toBe(tok('m1'))
    const old = w.ada('me')
    expect(old).toEqual({ ok: false, error: 'Please rejoin with your recovery code', code: 'auth' })
    expect(data(handle({ op: 'me', token: r.token }, w.store, w.ports)).member.id).toBe('m1')
  })
})

describe('auth and errors', () => {
  const authed = ['me', 'feed', 'post', 'reroll', 'createUpload', 'finalizePost', 'react', 'comment', 'group', 'recap', 'setTz']

  it('any authed op with a bad or missing token is refused with code auth', () => {
    const w = world()
    for (const op of authed) {
      for (const token of ['bad', undefined, 42]) {
        expect(handle({ op, token } as never, w.store, w.ports)).toEqual({
          ok: false,
          error: 'Please rejoin with your recovery code',
          code: 'auth',
        })
      }
    }
  })

  it('unknown op returns the generic sentence', () => {
    const w = world()
    expect(w.ada('dropTables')).toEqual({ ok: false, error: 'Something went wrong. Please try again.' })
    expect(w.anon('__proto__')).toEqual({ ok: false, error: 'Something went wrong. Please try again.' })
  })

  it('a store that throws gives the generic message; the stack goes only to ports.log', () => {
    const store = new MemoryStore({ config, members: [ADA] })
    store.posts = () => {
      throw new Error('sheet exploded')
    }
    const ports = fakePorts(T0)
    const res = handle({ op: 'feed', token: tok('m1') }, store, ports)
    expect(res).toEqual({ ok: false, error: 'Something went wrong. Please try again.' })
    expect(JSON.stringify(res)).not.toContain('exploded')
    expect(ports.logs.join('\n')).toContain('sheet exploded')
    expect(ports.logs.join('\n')).toMatch(/at /) // a stack trace
  })

  it('mutating ops go through lock; read ops do not', () => {
    const w = world({ assignments: [asg('a1', 'm1')], posts: [pst('p2', 'b1', 'm2', { createdAt: T0 - HOUR })] })
    const before = w.ports.lockCalls
    for (const op of ['me', 'feed', 'group']) data(w.ada(op))
    data(w.ada('post', { postId: 'p2' }))
    expect(w.ports.lockCalls).toBe(before)
    data(w.ada('react', { postId: 'p2', emoji: '🔥' }))
    data(w.ada('comment', { postId: 'p2', text: 'hi' }))
    data(w.ada('setTz', { tz: TZ }))
    data(w.ada('reroll'))
    data(w.ada('createUpload', { assignmentId: 'a1', kind: 'photo', mime: 'image/jpeg', size: 1000, hasStill: false }))
    w.ada('finalizePost', { assignmentId: 'a1', fileId: 'missing', caption: '', capturedAt: null })
    data(w.anon('recover', { secret: config.groupSecret, name: 'Bo', code: RECOVERY }))
    data(w.anon('join', joinArgs()))
    expect(w.ports.lockCalls).toBe(before + 8)
  })
})

describe('me', () => {
  it('shows the open quest with reroll availability', () => {
    const w = world({ assignments: [asg('a0', 'm1', { dropAt: T0 - 3 * DAY, deadlineAt: T0 - 2 * DAY, status: 'done', questId: 'q2' }), asg('a1', 'm1')] })
    const r = data<ApiResults['me']>(w.ada('me'))
    expect(r.member).toEqual({ id: 'm1', name: 'Ada', tz: TZ, joinedAt: ADA.joinedAt })
    expect(r.questChannel).toBe(ADA.questChannel)
    expect(r.groupChannel).toBe(config.groupChannel)
    expect(r.open).toEqual({ assignmentId: 'a1', questText: 'QTEXT-one', difficulty: 'easy', dropAt: T0, deadlineAt: DEADLINE0, rerollAvailable: true })
    expect(r.late).toBeNull()
  })

  it('reroll is unavailable once used in the assignment week', () => {
    const w = world({ assignments: [asg('a1', 'm1')], rerollUses: [{ memberId: 'm1', weekKey: asg('x', 'm1').weekKey }] })
    expect(data<ApiResults['me']>(w.ada('me')).open!.rerollAvailable).toBe(false)
  })

  it('late is the most recent dropped quest when it was missed', () => {
    const missed = asg('a1', 'm1', { dropAt: T0 - DAY, deadlineAt: T0 - 12 * HOUR, status: 'missed', questId: 'q3' })
    const future = asg('a2', 'm1', { dropAt: T0 + 2 * DAY, deadlineAt: null, status: 'scheduled', questId: null })
    const w = world({ assignments: [missed, future] })
    const r = data<ApiResults['me']>(w.ada('me'))
    expect(r.open).toBeNull()
    expect(r.late).toEqual({ assignmentId: 'a1', questText: 'QTEXT-three', dropAt: T0 - DAY, deadlineAt: T0 - 12 * HOUR })
  })

  it('no late quest when the most recent dropped one is done', () => {
    const w = world({
      assignments: [
        asg('a1', 'm1', { dropAt: T0 - 3 * DAY, deadlineAt: T0 - 2 * DAY, status: 'missed' }),
        asg('a2', 'm1', { dropAt: T0 - DAY, deadlineAt: T0 - 12 * HOUR, status: 'done' }),
      ],
    })
    expect(data<ApiResults['me']>(w.ada('me')).late).toBeNull()
  })

  it('history lists done and missed quests newest first with their posts; monthDone counts this month', () => {
    const w = world({
      assignments: [
        asg('a1', 'm1', { dropAt: T0 - 20 * DAY, deadlineAt: T0 - 20 * DAY + 12 * HOUR, status: 'done', questId: 'q2' }),
        asg('a2', 'm1', { dropAt: T0 - 10 * DAY, deadlineAt: T0 - 10 * DAY + 12 * HOUR, status: 'missed', questId: 'q3' }),
        asg('a3', 'm1', { dropAt: T0 - 2 * DAY, deadlineAt: T0 - 2 * DAY + 12 * HOUR, status: 'done', questId: 'q4' }),
        asg('a4', 'm1', { dropAt: T0 + DAY, deadlineAt: null, status: 'scheduled', questId: null }),
        asg('b1', 'm2', { status: 'done' }),
      ],
      posts: [
        pst('p1', 'a1', 'm1', { createdAt: T0 - 20 * DAY + HOUR }), // 27 Oct: last month
        pst('p3', 'a3', 'm1', { createdAt: T0 - 2 * DAY + HOUR }),
      ],
    })
    const r = data<ApiResults['me']>(w.ada('me'))
    expect(r.history.map((h) => [h.assignmentId, h.status, h.questText, h.post?.id ?? null])).toEqual([
      ['a3', 'done', 'QTEXT-four', 'p3'],
      ['a2', 'missed', 'QTEXT-three', null],
      ['a1', 'done', 'QTEXT-two', 'p1'],
    ])
    expect(r.history[0]).toMatchObject({ dropAt: T0 - 2 * DAY, deadlineAt: T0 - 2 * DAY + 12 * HOUR })
    expect(r.monthDone).toBe(1)
  })
})

describe('reroll', () => {
  it('gives a new quest, records the use and keeps dropAt and deadlineAt', () => {
    const w = world({ assignments: [asg('a1', 'm1'), asg('a0', 'm1', { dropAt: T0 - 5 * DAY, status: 'done', questId: 'q2' })] })
    const r = data<ApiResults['reroll']>(w.ada('reroll'))
    const a = w.store.assignments().find((x) => x.id === 'a1')!
    expect(a.questId).not.toBe('q1')
    expect(a.questId).not.toBe('q2') // seen before
    expect(a).toMatchObject({ dropAt: T0, deadlineAt: DEADLINE0, status: 'open' })
    expect(r.open).toMatchObject({ assignmentId: 'a1', dropAt: T0, deadlineAt: DEADLINE0, rerollAvailable: false })
    expect(r.open.questText).toBe(w.store.quests().find((q) => q.id === a.questId)!.text)
    expect(w.store.rerollUses()).toEqual([{ memberId: 'm1', weekKey: a.weekKey }])
  })

  it('reroll second time in week refused', () => {
    const w = world({ assignments: [asg('a1', 'm1')] })
    data(w.ada('reroll'))
    const questId = w.store.assignments()[0].questId
    expect(refusal(w.ada('reroll'))).toBe("You've used this week's reroll")
    expect(w.store.assignments()[0].questId).toBe(questId)
  })

  it('refuses without an open quest (or once its deadline has passed)', () => {
    expect(refusal(world().ada('reroll'))).toBe('You have no open quest to reroll')
    const w = world({ assignments: [asg('a1', 'm1')], now: DEADLINE0 + 1 })
    expect(refusal(w.ada('reroll'))).toBe('You have no open quest to reroll')
  })
})

describe('group', () => {
  it('lists members sorted by name (cs) with status facts', () => {
    const ch = mem('m3', 'Čeněk')
    const cyril = mem('m4', 'Cyril')
    const w = world({
      members: [BO, ch, ADA, cyril],
      assignments: [
        asg('a1', 'm1'),
        asg('b0', 'm2', { status: 'missed', deadlineAt: T0 - 5 * DAY }),
        asg('b1', 'm2', { status: 'missed', deadlineAt: T0 - 2 * DAY }),
        asg('b2', 'm2', { status: 'done', deadlineAt: T0 - DAY }),
        asg('c1', 'm3', { status: 'open', deadlineAt: T0 }), // past deadline: not open any more
      ],
      posts: [pst('p1', 'b2', 'm2', { createdAt: T0 - DAY - HOUR }), pst('p0', 'b9', 'm2', { createdAt: T0 - 9 * DAY })],
    })
    const r = data<ApiResults['group']>(w.ada('group'))
    expect(r.members.map((m) => m.name)).toEqual(['Ada', 'Bo', 'Cyril', 'Čeněk'])
    expect(r.members[0]).toEqual({ id: 'm1', name: 'Ada', tz: TZ, joinedAt: ADA.joinedAt, hasOpen: true, lastPostAt: null, lastMissedAt: null })
    expect(r.members[1]).toMatchObject({ hasOpen: false, lastPostAt: T0 - DAY - HOUR, lastMissedAt: T0 - 2 * DAY })
    expect(r.members[3]).toMatchObject({ hasOpen: false })
    expect(JSON.stringify(r)).not.toMatch(/tokenHash|recoveryHash|questChannel/)
  })
})

describe('recap', () => {
  it('refuses an unknown month', () => {
    expect(refusal(world().ada('recap', { month: '2026-10' }))).toBe('No recap for that month yet')
  })

  it('returns the recap with gallery and most-reacted posts', () => {
    const recapData = {
      month: '2026-10',
      counts: [],
      totalDone: 3,
      totalPosts: 3,
      mostReacted: { postId: 'p9', total: 2, byEmoji: { '🔥': 2 } },
      gallery: ['p1', 'p9', 'gone'],
    }
    const w = world({
      posts: [pst('p1', 'a1', 'm1', { createdAt: T0 - 20 * DAY }), pst('p9', 'b1', 'm2', { createdAt: T0 - 19 * DAY })],
      recaps: [{ month: '2026-10', json: JSON.stringify(recapData) }],
    })
    const r = data<ApiResults['recap']>(w.ada('recap', { month: '2026-10' }))
    expect(r.recap).toEqual(recapData)
    expect(r.posts.map((p) => p.id)).toEqual(['p1', 'p9'])
    expect(r.members.map((m) => m.id).sort()).toEqual(['m1', 'm2'])
  })
})

describe('setTz', () => {
  it('setTz invalid refused', () => {
    expect(refusal(world().ada('setTz', { tz: 'Nowhere/Land' }))).toBe('Pick a valid time zone')
  })

  it('updates the member zone and keeps planned drops as they are', () => {
    const planned = asg('a1', 'm1', { dropAt: T0 + 2 * DAY, deadlineAt: null, status: 'scheduled', questId: null })
    const w = world({ assignments: [planned] })
    const r = data<ApiResults['setTz']>(w.ada('setTz', { tz: 'America/New_York' }))
    expect(r.member.tz).toBe('America/New_York')
    expect(w.store.members().find((m: Member) => m.id === 'm1')!.tz).toBe('America/New_York')
    expect(w.store.assignments()).toEqual([planned])
  })
})
