import { HOUR, localParts, zonedTimeToUtc } from './time'

export const QUIET_START = 22 // local hour the awake window closes
export const QUIET_END = 10 // local hour the awake window opens
export const AWAKE_BUDGET = 12 * HOUR

type Day = { y: number; m: number; d: number }

/** Calendar day after `day`; Date.UTC normalises month/year overflow (never add DAY ms: DST days are 23/25 h). */
function nextDay({ y, m, d }: Day): Day {
  const n = new Date(Date.UTC(y, m - 1, d + 1))
  return { y: n.getUTCFullYear(), m: n.getUTCMonth() + 1, d: n.getUTCDate() }
}

const at = (day: Day, hour: number, tz: string) => zonedTimeToUtc(day.y, day.m, day.d, hour, 0, tz)

/**
 * Instant by which `budget` ms of awake time (local [QUIET_END, QUIET_START) each day)
 * has elapsed since `dropAt`. A drop in quiet hours starts consuming at the next 10:00.
 * If the budget ends exactly at 22:00 the deadline is that 22:00.
 */
export function awakeDeadline(dropAt: number, tz: string, budget: number = AWAKE_BUDGET): number {
  if (budget <= 0) return dropAt
  const p = localParts(dropAt, tz)
  let day: Day = { y: p.y, m: p.m, d: p.d }
  let cursor = dropAt
  if (p.h >= QUIET_START) {
    day = nextDay(day)
    cursor = at(day, QUIET_END, tz)
  } else if (p.h < QUIET_END) {
    cursor = at(day, QUIET_END, tz)
  }
  let left = budget
  for (;;) {
    const windowEnd = at(day, QUIET_START, tz)
    const avail = windowEnd - cursor
    if (left <= avail) return cursor + left
    left -= avail
    day = nextDay(day)
    cursor = at(day, QUIET_END, tz)
  }
}

/** Awake ms in [now, deadlineAt). 0 once the deadline has passed; constant through the night. */
export function awakeRemaining(now: number, deadlineAt: number, tz: string): number {
  if (now >= deadlineAt) return 0
  const p = localParts(now, tz)
  const last = localParts(deadlineAt, tz)
  const lastDayUtc = Date.UTC(last.y, last.m - 1, last.d)
  let day: Day = { y: p.y, m: p.m, d: p.d }
  let total = 0
  while (Date.UTC(day.y, day.m - 1, day.d) <= lastDayUtc) {
    const from = Math.max(now, at(day, QUIET_END, tz))
    const to = Math.min(deadlineAt, at(day, QUIET_START, tz))
    if (to > from) total += to - from
    day = nextDay(day)
  }
  return total
}
