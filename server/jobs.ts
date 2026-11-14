// Scheduled jobs (Apps Script time triggers): tick every 15 minutes, dailyCleanup and monthlyRecap daily.
// Pure functions over Store + Ports. Each job runs entirely inside ports.lock and is idempotent:
// running it twice at the same `now` changes nothing the second time.
import { newId } from '../shared/codes'
import { awakeDeadline, awakeRemaining, QUIET_END, QUIET_START } from '../shared/deadline'
import { planWeek, weekKey } from '../shared/drops'
import { pickQuest, seenQuestIds } from '../shared/quests'
import { computeRecap, monthBounds } from '../shared/recap'
import { DAY, HOUR, localParts, startOfLocalWeek } from '../shared/time'
import type { Assignment } from '../shared/types'
import type { Ports } from './ports'
import type { Store } from './store'

const DROPS_PER_WEEK = 2
const DROP_GRACE = 30 * 60_000 // a drop made at 21:58 is still announced by the 22:05 tick
const REMINDER_AT = 2 * HOUR
const VIDEO_TTL = 182 * DAY
const ORPHAN_AGE = 48 * HOUR
/** File names createUpload gives Drive uploads: `<assignmentId>-main.<ext>` and `<assignmentId>-still.jpg`. Nothing else is ever trashed as an orphan. */
const UPLOAD_NAME = /^a_[a-z2-7]{12}-(main\.[A-Za-z0-9]+|still\.jpg)$/

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** True when `ms` is inside the member's awake window (local [10:00, 22:00)). */
function awakeNow(ms: number, tz: string): boolean {
  const h = localParts(ms, tz).h
  return h >= QUIET_END && h < QUIET_START
}

/** Step 1: every member without an assignment in their current local week gets that week planned. */
function planWeeks(store: Store, ports: Ports, now: number): number {
  let planned = 0
  for (const m of store.members()) {
    const wk = weekKey(now, m.tz)
    const mine = store.assignments({ memberId: m.id })
    if (mine.some((a) => a.weekKey === wk)) continue

    // After a time-zone change the old zone's leftover drops can fall in this local week: count them (any
    // weekKey) so the week never holds more than two. The next Monday is computed from local dates, not +7*DAY.
    const weekStart = startOfLocalWeek(now, m.tz)
    const weekEnd = startOfLocalWeek(weekStart + 7 * DAY + 12 * HOUR, m.tz)
    const need = DROPS_PER_WEEK - mine.filter((a) => a.dropAt >= weekStart && a.dropAt < weekEnd).length
    if (need <= 0) continue

    let notBefore = now
    const last = mine.reduce<Assignment | null>((best, a) => (best === null || a.dropAt > best.dropAt ? a : best), null)
    if (last) {
      // R3: never two open quests at once, across weeks and DST.
      notBefore = Math.max(now, last.dropAt + DAY, last.deadlineAt ?? awakeDeadline(last.dropAt, m.tz))
    }
    for (const dropAt of planWeek(weekStart, m.tz, notBefore, ports.rng).slice(0, need)) {
      store.putAssignment({
        id: newId('a'),
        memberId: m.id,
        questId: null,
        dropAt,
        deadlineAt: null,
        status: 'scheduled',
        remindedAt: null,
        weekKey: wk,
      })
      planned++
    }
  }
  return planned
}

/** Step 2: scheduled assignments that are due become open with a quest and a deadline. */
function dropDue(store: Store, ports: Ports, now: number): number {
  let dropped = 0
  const due = store
    .assignments({ status: 'scheduled' })
    .filter((a) => a.dropAt <= now)
    .sort((a, b) => a.dropAt - b.dropAt)
  for (const a of due) {
    const member = store.members().find((m) => m.id === a.memberId)
    if (!member) continue
    // Quiet hours: a drop whose planned time now falls in the member's night (after a time-zone change) waits
    // for 10:00; one planned inside the awake window that is only slightly late still goes out.
    if (!awakeNow(now, member.tz) && !(awakeNow(a.dropAt, member.tz) && now - a.dropAt <= DROP_GRACE)) continue
    try {
      const all = store.assignments()
      const seen = seenQuestIds(member.id, all, store.rerollUses())
      const latest = all
        .filter((x) => x.memberId === member.id && x.questId !== null)
        .reduce<Assignment | null>((best, x) => (best === null || x.dropAt > best.dropAt ? x : best), null)
      const quest = pickQuest(store.quests(), seen, ports.rng, latest?.questId ?? undefined)
      const deadlineAt = awakeDeadline(a.dropAt, member.tz)
      store.putAssignment({ ...a, questId: quest.id, deadlineAt, status: 'open' })
      dropped++
      // A drop processed after its deadline (long outage) is opened silently and missed in step 4.
      if (now < deadlineAt) ports.ntfy.send(member.questChannel, 'New quest', 'You have 12 hours. Open Kvestuj.')
    } catch (e) {
      ports.log(`tick: could not drop ${a.id} for ${member.id}: ${errText(e)}`)
    }
  }
  return dropped
}

/** Step 3: "2 hours left", once, only in the member's awake hours. */
function remind(store: Store, ports: Ports, now: number): number {
  let reminded = 0
  for (const a of store.assignments({ status: 'open' })) {
    if (a.remindedAt !== null || a.deadlineAt === null || now >= a.deadlineAt) continue
    const member = store.members().find((m) => m.id === a.memberId)
    if (!member) continue
    if (awakeRemaining(now, a.deadlineAt, member.tz) > REMINDER_AT) continue
    if (!awakeNow(now, member.tz)) continue // R16: a reminder that comes due at night waits for 10:00
    ports.ntfy.send(member.questChannel, '2 hours left', 'Your quest is due soon. Open Kvestuj.')
    store.putAssignment({ ...a, remindedAt: now })
    reminded++
  }
  return reminded
}

/** Step 4: open assignments past their deadline are missed. */
function markMissed(store: Store, now: number): number {
  let missed = 0
  for (const a of store.assignments({ status: 'open' })) {
    if (a.deadlineAt === null || now < a.deadlineAt) continue
    store.putAssignment({ ...a, status: 'missed' })
    missed++
  }
  return missed
}

export function tick(store: Store, ports: Ports): { dropped: number; reminded: number; missed: number; planned: number } {
  return ports.lock(() => {
    const now = ports.now()
    const planned = planWeeks(store, ports, now)
    const dropped = dropDue(store, ports, now)
    const reminded = remind(store, ports, now)
    const missed = markMissed(store, now)
    return { dropped, reminded, missed, planned }
  })
}

/** Expires videos older than 182 days and trashes orphan uploads (files in the folder no post references) older than 48 h. */
export function dailyCleanup(store: Store, ports: Ports): { expired: number; orphans: number } {
  return ports.lock(() => {
    const now = ports.now()
    let expired = 0
    for (const p of store.posts()) {
      if (p.kind !== 'video' || p.expired || p.createdAt >= now - VIDEO_TTL) continue
      try {
        ports.drive.trash(p.fileId)
      } catch (e) {
        ports.log(`cleanup: could not trash video ${p.fileId} of post ${p.id}: ${errText(e)}`) // already gone
      }
      store.putPost({ ...p, expired: true })
      expired++
    }

    let orphans = 0
    try {
      const referenced = new Set<string>()
      for (const p of store.posts()) {
        if (p.fileId) referenced.add(p.fileId)
        if (p.stillFileId) referenced.add(p.stillFileId)
      }
      for (const f of ports.drive.listFolder()) {
        if (!UPLOAD_NAME.test(f.name) || referenced.has(f.id) || f.createdAt >= now - ORPHAN_AGE) continue
        try {
          ports.drive.trash(f.id)
          orphans++
        } catch (e) {
          ports.log(`cleanup: could not trash orphan ${f.id}: ${errText(e)}`)
        }
      }
    } catch (e) {
      ports.log(`cleanup: could not list the folder: ${errText(e)}`)
    }
    return { expired, orphans }
  })
}

/** On the 1st (group time zone): creates the previous month's recap once and tells the group. */
export function monthlyRecap(store: Store, ports: Ports): { created: string | null } {
  return ports.lock(() => {
    const config = store.getConfig()
    const today = localParts(ports.now(), config.groupTz)
    if (today.d !== 1) return { created: null }

    const y = today.m === 1 ? today.y - 1 : today.y
    const m = today.m === 1 ? 12 : today.m - 1
    const prev = `${y}-${String(m).padStart(2, '0')}`
    if (store.recaps().some((r) => r.month === prev)) return { created: null }

    const members = store.members()
    const { end } = monthBounds(prev, config.groupTz)
    if (!members.some((mem) => mem.joinedAt < end)) return { created: null }

    const data = computeRecap(prev, config.groupTz, members, store.posts(), store.reactions(), store.assignments())
    store.putRecap({ month: prev, json: JSON.stringify(data) })
    ports.ntfy.send(config.groupChannel, 'Kvestuj', `${MONTHS[m - 1]} recap is ready`)
    return { created: prev }
  })
}
