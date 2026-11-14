import { awakeDeadline, QUIET_END, QUIET_START } from './deadline'
import { DAY, localParts, zonedTimeToUtc } from './time'

/** Random source returning a number in [0, 1). */
export type Rng = () => number

const MINUTE = 60_000

/** ISO week of the LOCAL date of `ms` in `tz`, as `YYYY-Www` (ISO week-year, so Jan 1 can be in W52/W53). */
export function weekKey(ms: number, tz: string): string {
  const p = localParts(ms, tz)
  // Work on the calendar date in UTC: no DST involved. The ISO week belongs to the year of its Thursday.
  const thursday = Date.UTC(p.y, p.m - 1, p.d) + (4 - p.weekday) * DAY
  const year = new Date(thursday).getUTCFullYear()
  const week = Math.floor((thursday - Date.UTC(year, 0, 1)) / DAY / 7) + 1
  return `${year}-W${String(week).padStart(2, '0')}`
}

/** `count` consecutive whole-minute candidates starting at `start`. */
type Segment = { start: number; count: number }

/** Candidate minutes of the 7 local days from `weekStart`, chronological, each ≥ `notBefore`. */
function candidateSegments(weekStart: number, tz: string, notBefore: number): Segment[] {
  const p = localParts(weekStart, tz)
  const firstMinute = Math.ceil(notBefore / MINUTE) * MINUTE
  const segments: Segment[] = []
  for (let i = 0; i < 7; i++) {
    // Date.UTC normalises day overflow; never step by +DAY ms (DST days are 23/25 h).
    const day = new Date(Date.UTC(p.y, p.m - 1, p.d + i))
    const y = day.getUTCFullYear()
    const m = day.getUTCMonth() + 1
    const d = day.getUTCDate()
    const start = zonedTimeToUtc(y, m, d, QUIET_END, 0, tz)
    const end = zonedTimeToUtc(y, m, d, QUIET_START, 0, tz)
    const first = Math.max(start, firstMinute)
    if (first < end) segments.push({ start: first, count: Math.ceil((end - first) / MINUTE) })
  }
  return segments
}

/** Time of the candidate at global index `index` (0 ≤ index < total). */
function timeAt(segments: Segment[], index: number): number {
  for (const s of segments) {
    if (index < s.count) return s.start + index * MINUTE
    index -= s.count
  }
  throw new RangeError('candidate index out of range')
}

/** Number of candidates strictly before `x` (= global index of the first candidate ≥ x). */
function countBefore(segments: Segment[], x: number): number {
  let n = 0
  for (const s of segments) {
    const k = Math.ceil((x - s.start) / MINUTE)
    n += Math.min(s.count, Math.max(0, k))
  }
  return n
}

const pick = (rng: Rng, n: number) => Math.min(n - 1, Math.floor(rng() * n))

/**
 * 0–2 drop times (UTC ms, ascending) for the local week starting at `weekStart`.
 * Each is a whole minute in a 10:00–22:00 local window, ≥ `notBefore`. The two never overlap:
 * the later one is ≥ 24 h after, and at/after the awake deadline of, the earlier one.
 * The first drop is uniform over all candidates; the second is uniform over those compatible with it
 * (before or after), so the result is pure for a given rng sequence.
 */
export function planWeek(weekStart: number, tz: string, notBefore: number, rng: Rng): number[] {
  const segments = candidateSegments(weekStart, tz, notBefore)
  const total = segments.reduce((n, s) => n + s.count, 0)
  if (total === 0) return []

  const ia = pick(rng, total)
  const a = timeAt(segments, ia)

  // Candidates after a: everything ≥ max(a + 24 h, a's deadline).
  const afterFrom = countBefore(segments, Math.max(a + DAY, awakeDeadline(a, tz)))
  const nAfter = total - afterFrom

  // Candidates before a: b with b + 24 h ≤ a and deadline(b) ≤ a. Monotone in b, so binary-search
  // the number of leading candidates that qualify.
  let lo = 0
  let hi = ia
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const b = timeAt(segments, mid)
    if (b + DAY <= a && awakeDeadline(b, tz) <= a) lo = mid + 1
    else hi = mid
  }
  const nBefore = lo

  const n = nBefore + nAfter
  if (n === 0) return [a]
  const r = pick(rng, n)
  const b = timeAt(segments, r < nBefore ? r : afterFrom + (r - nBefore))
  return a < b ? [a, b] : [b, a]
}
