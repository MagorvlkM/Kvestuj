import { describe, expect, test } from 'vitest'
import { awakeDeadline } from './deadline'
import { planWeek, weekKey, type Rng } from './drops'
import { DAY, localParts, startOfLocalWeek, zonedTimeToUtc } from './time'

const VIE = 'Europe/Vienna'
const NYC = 'America/New_York'
const t = (y: number, m: number, d: number, h: number, mi: number) => zonedTimeToUtc(y, m, d, h, mi, VIE)
const MON_VIE = t(2026, 11, 16, 0, 0)

// mulberry32: small seeded PRNG in [0,1)
function seeded(s: number): Rng {
  let a = s >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let x = a
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

describe('planWeek (brief)', () => {
  test('two drops, in window, ≥24h apart, same week', () => {
    for (let s = 0; s < 500; s++) {
      const r = seeded(s)
      const d = planWeek(MON_VIE, VIE, MON_VIE, r)
      expect(d).toHaveLength(2)
      d.forEach((x) => {
        const p = localParts(x, VIE)
        expect(p.h >= 10 && p.h < 22).toBe(true)
        expect(weekKey(x, VIE)).toBe(weekKey(MON_VIE, VIE))
      })
      expect(d[1] - d[0]).toBeGreaterThanOrEqual(DAY)
    }
  })
  test('join on Sunday 20:00 → at most one drop, after join', () => {
    const nb = t(2026, 11, 22, 20, 0)
    const d = planWeek(MON_VIE, VIE, nb, seeded(1))
    expect(d.length).toBeLessThanOrEqual(1)
    d.forEach((x) => expect(x).toBeGreaterThanOrEqual(nb))
  })
  test('join Sunday 22:30 → none', () => expect(planWeek(MON_VIE, VIE, t(2026, 11, 22, 22, 30), seeded(1))).toEqual([]))
  test('DST week windows stay 10–22 local', () => {
    const d = planWeek(startOfLocalWeek(t(2026, 10, 25, 12, 0), VIE), VIE, 0, seeded(3))
    d.forEach((x) => {
      const h = localParts(x, VIE).h
      expect(h >= 10 && h < 22).toBe(true)
    })
  })
  test('same seed → same plan (pure)', () =>
    expect(planWeek(MON_VIE, VIE, MON_VIE, seeded(9))).toEqual(planWeek(MON_VIE, VIE, MON_VIE, seeded(9))))
})

describe('planWeek (rulings)', () => {
  const weeks = {
    'DST end': startOfLocalWeek(t(2026, 10, 25, 12, 0), VIE),
    'DST start': startOfLocalWeek(t(2027, 3, 28, 12, 0), VIE),
  }
  for (const [name, ws] of Object.entries(weeks)) {
    test(`${name} week: no two quests open at once, whole-minute, in window, in week`, () => {
      const key = weekKey(ws, VIE)
      let both = 0
      for (let s = 0; s < 1000; s++) {
        const d = planWeek(ws, VIE, ws, seeded(s))
        expect(d.length).toBeGreaterThanOrEqual(1)
        if (d.length === 2) {
          both++
          expect(d[0]).toBeLessThan(d[1])
          expect(d[1]).toBeGreaterThanOrEqual(awakeDeadline(d[0], VIE))
          expect(d[1] - d[0]).toBeGreaterThanOrEqual(DAY)
        }
        for (const x of d) {
          expect(x % 60_000).toBe(0)
          const p = localParts(x, VIE)
          expect(p.h >= 10 && p.h < 22).toBe(true)
          expect(weekKey(x, VIE)).toBe(key)
          expect(x).toBeGreaterThanOrEqual(ws)
        }
      }
      expect(both).toBe(1000)
    })
  }

  test('both orders occur: first pick is sometimes the later drop', () => {
    let early = 0
    let late = 0
    for (let s = 0; s < 500; s++) {
      const d = planWeek(MON_VIE, VIE, MON_VIE, seeded(s))
      if (localParts(d[0], VIE).weekday <= 3) early++
      if (localParts(d[1], VIE).weekday >= 5) late++
    }
    expect(early).toBeGreaterThan(50)
    expect(late).toBeGreaterThan(50)
  })

  test('first draw late in the week still yields an earlier partner', () => {
    const seq = [0.95, 0.0]
    let i = 0
    const d = planWeek(MON_VIE, VIE, MON_VIE, () => seq[i++])
    expect(d).toHaveLength(2)
    expect(localParts(d[1], VIE).weekday).toBeGreaterThanOrEqual(6)
    expect(localParts(d[0], VIE).weekday).toBe(1)
    expect(d[0]).toBe(t(2026, 11, 16, 10, 0))
  })

  test('notBefore mid-window → no drop before the next whole minute', () => {
    const nb = t(2026, 11, 18, 15, 30) + 20_000 // Wed 15:30:20
    const cutoff = t(2026, 11, 18, 15, 31)
    for (let s = 0; s < 500; s++) {
      for (const x of planWeek(MON_VIE, VIE, nb, seeded(s))) {
        expect(x).toBeGreaterThanOrEqual(nb)
        expect(x).toBeGreaterThanOrEqual(cutoff)
        expect(x % 60_000).toBe(0)
      }
    }
    // rng = 0 picks the very first candidate: Wed 15:31
    expect(planWeek(MON_VIE, VIE, nb, () => 0)[0]).toBe(cutoff)
  })

  test('rng just below 1 picks the last candidate (Sun 21:59)', () => {
    const d = planWeek(MON_VIE, VIE, MON_VIE, () => 0.9999999)
    expect(d[d.length - 1]).toBe(t(2026, 11, 22, 21, 59))
  })

  test('non-European zone: two in-window drops', () => {
    const ws = startOfLocalWeek(t(2026, 11, 18, 12, 0), NYC)
    for (let s = 0; s < 200; s++) {
      const d = planWeek(ws, NYC, ws, seeded(s))
      expect(d).toHaveLength(2)
      d.forEach((x) => {
        const p = localParts(x, NYC)
        expect(p.h >= 10 && p.h < 22).toBe(true)
        expect(x).toBeGreaterThanOrEqual(ws)
        expect(x).toBeLessThan(ws + 8 * DAY)
      })
      expect(d[1]).toBeGreaterThanOrEqual(awakeDeadline(d[0], NYC))
      expect(d[1] - d[0]).toBeGreaterThanOrEqual(DAY)
    }
  })
})

describe('weekKey', () => {
  test('ISO week-year edges', () => {
    expect(weekKey(t(2026, 12, 31, 12, 0), VIE)).toBe('2026-W53')
    expect(weekKey(t(2027, 1, 3, 12, 0), VIE)).toBe('2026-W53')
    expect(weekKey(t(2027, 1, 4, 12, 0), VIE)).toBe('2027-W01')
    expect(weekKey(MON_VIE, VIE)).toBe('2026-W47')
  })
  test('uses the local date, not the UTC date', () => {
    // Sun 23:30 Vienna = Sun 22:30Z; Mon 00:30 Vienna = Sun 23:30Z (UTC date is still Sunday)
    const sun = t(2026, 11, 22, 23, 30)
    const mon = t(2026, 11, 23, 0, 30)
    expect(new Date(mon).getUTCDay()).toBe(0)
    expect(weekKey(sun, VIE)).toBe('2026-W47')
    expect(weekKey(mon, VIE)).toBe('2026-W48')
  })
})
