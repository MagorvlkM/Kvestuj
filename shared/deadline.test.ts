import { describe, expect, test } from 'vitest'
import { AWAKE_BUDGET, awakeDeadline, awakeRemaining } from './deadline'
import { HOUR, zonedTimeToUtc } from './time'

const VIE = 'Europe/Vienna'
const t = (y: number, m: number, d: number, h: number, mi: number) => zonedTimeToUtc(y, m, d, h, mi, VIE)

describe('awakeDeadline', () => {
  test('20:00 → next day 20:00', () => expect(awakeDeadline(t(2026, 11, 17, 20, 0), VIE)).toBe(t(2026, 11, 18, 20, 0)))
  test('10:00 → same day 22:00', () => expect(awakeDeadline(t(2026, 11, 17, 10, 0), VIE)).toBe(t(2026, 11, 17, 22, 0)))
  test('21:59 → next day 21:59', () => expect(awakeDeadline(t(2026, 11, 17, 21, 59), VIE)).toBe(t(2026, 11, 18, 21, 59)))
  test('DST end night keeps 12 awake hours', () => expect(awakeDeadline(t(2026, 10, 24, 18, 0), VIE)).toBe(t(2026, 10, 25, 18, 0)))
  test('DST start night keeps 12 awake hours', () => expect(awakeDeadline(t(2027, 3, 27, 18, 0), VIE)).toBe(t(2027, 3, 28, 18, 0)))

  test('start at 23:00 begins consuming at next 10:00', () =>
    expect(awakeDeadline(t(2026, 11, 17, 23, 0), VIE)).toBe(t(2026, 11, 18, 22, 0)))
  test('start at 03:00 begins consuming at 10:00 the same day', () =>
    expect(awakeDeadline(t(2026, 11, 17, 3, 0), VIE)).toBe(t(2026, 11, 17, 22, 0)))
  test('start exactly at 22:00 is quiet', () =>
    expect(awakeDeadline(t(2026, 11, 17, 22, 0), VIE)).toBe(t(2026, 11, 18, 22, 0)))
  test('budget ending exactly at 22:00 stays at 22:00', () =>
    expect(awakeDeadline(t(2026, 11, 17, 18, 0), VIE, 4 * HOUR)).toBe(t(2026, 11, 17, 22, 0)))
  test('budget <= 0 returns dropAt', () => {
    expect(awakeDeadline(t(2026, 11, 17, 18, 0), VIE, 0)).toBe(t(2026, 11, 17, 18, 0))
    expect(awakeDeadline(t(2026, 11, 17, 23, 0), VIE, -HOUR)).toBe(t(2026, 11, 17, 23, 0))
  })
  test('multi-day budget spans several nights', () =>
    expect(awakeDeadline(t(2026, 11, 17, 10, 0), VIE, 30 * HOUR)).toBe(t(2026, 11, 19, 16, 0)))
  test('non-European zone (New York, DST end 2026-11-01)', () => {
    const NY = 'America/New_York'
    const n = (y: number, m: number, d: number, h: number, mi: number) => zonedTimeToUtc(y, m, d, h, mi, NY)
    expect(awakeDeadline(n(2026, 10, 31, 18, 0), NY)).toBe(n(2026, 11, 1, 18, 0))
  })
  test('round trip: awake time between drop and deadline is exactly the budget', () => {
    const days: [number, number, number][] = [[2026, 11, 17], [2026, 10, 24], [2026, 10, 25], [2027, 3, 27], [2027, 3, 28]]
    for (const [y, m, d] of days) {
      for (const [h, mi] of [[10, 0], [10, 1], [13, 37], [18, 0], [21, 59]]) {
        const drop = t(y, m, d, h, mi)
        expect(awakeRemaining(drop, awakeDeadline(drop, VIE), VIE)).toBe(AWAKE_BUDGET)
      }
    }
  })
})

describe('awakeRemaining', () => {
  test('remaining skips the night', () =>
    expect(awakeRemaining(t(2026, 11, 17, 21, 0), t(2026, 11, 18, 20, 0), VIE)).toBe(11 * HOUR))
  test('frozen during the night', () => {
    const deadline = t(2026, 11, 18, 20, 0)
    const at22 = awakeRemaining(t(2026, 11, 17, 22, 0), deadline, VIE)
    expect(at22).toBe(10 * HOUR)
    expect(awakeRemaining(t(2026, 11, 18, 2, 30), deadline, VIE)).toBe(at22)
    expect(awakeRemaining(t(2026, 11, 18, 10, 0), deadline, VIE)).toBe(at22)
  })
  test('0 at or after the deadline', () => {
    const deadline = t(2026, 11, 18, 20, 0)
    expect(awakeRemaining(deadline, deadline, VIE)).toBe(0)
    expect(awakeRemaining(t(2026, 11, 19, 12, 0), deadline, VIE)).toBe(0)
  })
  test('same-day window', () =>
    expect(awakeRemaining(t(2026, 11, 17, 12, 0), t(2026, 11, 17, 15, 30), VIE)).toBe(3.5 * HOUR))
})
