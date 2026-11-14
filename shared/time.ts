export const HOUR = 3_600_000
export const DAY = 86_400_000

export type LocalParts = { y: number; m: number; d: number; h: number; mi: number; weekday: number }

// One formatter per zone: constructing Intl.DateTimeFormat is slow in Apps Script
// and these helpers run thousands of times per request.
const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    })
    formatters.set(tz, f)
  }
  return f
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }

/** Wall-clock parts of a UTC instant in `tz`. weekday: 1=Mon … 7=Sun; m: 1–12. */
export function localParts(ms: number, tz: string): LocalParts {
  const out: Record<string, string> = {}
  for (const p of formatterFor(tz).formatToParts(ms)) out[p.type] = p.value
  return {
    y: Number(out.year),
    m: Number(out.month),
    d: Number(out.day),
    h: Number(out.hour) % 24, // defensive: some engines emit "24" at midnight
    mi: Number(out.minute),
    weekday: WEEKDAYS[out.weekday],
  }
}

/** Offset of `tz` from UTC at instant `ms`, in ms (local wall clock read as UTC, minus ms). */
function offsetAt(ms: number, tz: string): number {
  const p = localParts(ms, tz)
  // Floor to the minute: formatted parts carry no seconds.
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Math.floor(ms / 60_000) * 60_000
}

/**
 * UTC ms of the wall-clock time y-m-d h:mi in `tz` (m is 1–12).
 *
 * DST edge cases are resolved deterministically:
 *  - Local time occurs twice (fall back): the EARLIER instant (pre-change offset) wins.
 *  - Local time does not exist (spring-forward gap): it is interpreted with the
 *    pre-change offset, which lands after the gap (02:30 becomes 03:30 local).
 */
export function zonedTimeToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, h, mi)
  // Offsets in force a day before/after bracket any transition near the target.
  const before = offsetAt(guess - DAY, tz)
  const after = offsetAt(guess + DAY, tz)
  const candidates = before === after ? [guess - before] : [guess - before, guess - after].sort((a, b) => a - b)
  for (const c of candidates) {
    if (offsetAt(c, tz) === guess - c) return c
  }
  return guess - before // gap: no candidate round-trips
}

/** Monday 00:00 local (UTC ms) of the week containing `ms`. DST-safe: steps by calendar day. */
export function startOfLocalWeek(ms: number, tz: string): number {
  const p = localParts(ms, tz)
  // Date.UTC normalises day <= 0 into the previous month.
  const monday = new Date(Date.UTC(p.y, p.m - 1, p.d - (p.weekday - 1)))
  return zonedTimeToUtc(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), 0, 0, tz)
}

/** True when `tz` is a time zone this runtime's Intl understands (IANA names such as Europe/Prague). */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.trim() === '') return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}
