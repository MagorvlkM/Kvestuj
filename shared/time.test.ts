import { expect, test } from 'vitest'
import { DAY, HOUR, localParts, startOfLocalWeek, zonedTimeToUtc } from './time'

test('localParts Prague summer', () => expect(localParts(Date.UTC(2026,6,1,8,0),'Europe/Prague')).toMatchObject({h:10,weekday:3}))
test('zonedTimeToUtc across DST start', () => expect(zonedTimeToUtc(2027,3,28,10,0,'Europe/Vienna')).toBe(Date.UTC(2027,2,28,8,0)))
test('zonedTimeToUtc across DST end', () => expect(zonedTimeToUtc(2026,10,25,10,0,'Europe/Vienna')).toBe(Date.UTC(2026,9,25,9,0)))
test('startOfLocalWeek', () => expect(startOfLocalWeek(Date.UTC(2026,10,14,21,0),'Europe/Vienna')).toBe(Date.UTC(2026,10,8,23,0)))

test('constants', () => {
  expect(HOUR).toBe(3_600_000)
  expect(DAY).toBe(86_400_000)
})

test('localParts returns all fields; Sunday is weekday 7', () => {
  // 2026-11-15 is a Sunday; 23:30 UTC is already Monday 00:30 in Vienna
  expect(localParts(Date.UTC(2026,10,15,12,5),'Europe/Vienna')).toEqual({y:2026,m:11,d:15,h:13,mi:5,weekday:7})
  expect(localParts(Date.UTC(2026,10,15,23,30),'Europe/Vienna')).toMatchObject({d:16,h:0,mi:30,weekday:1})
})

test('localParts midnight is hour 0, not 24', () => {
  expect(localParts(Date.UTC(2026,0,1,0,0),'UTC')).toMatchObject({y:2026,m:1,d:1,h:0})
})

test('zonedTimeToUtc in a non-European zone', () => {
  expect(zonedTimeToUtc(2026,7,1,9,0,'America/New_York')).toBe(Date.UTC(2026,6,1,13,0))
  expect(zonedTimeToUtc(2026,1,1,9,0,'Asia/Kolkata')).toBe(Date.UTC(2026,0,1,3,30))
})

test('zonedTimeToUtc round-trips through localParts', () => {
  for (const tz of ['Europe/Prague','America/New_York','Australia/Sydney','Asia/Kolkata']) {
    const ms = zonedTimeToUtc(2026,10,25,22,0,tz)
    expect(localParts(ms,tz)).toMatchObject({y:2026,m:10,d:25,h:22,mi:0})
  }
})

test('zonedTimeToUtc is deterministic for nonexistent local time (spring gap)', () => {
  // Vienna 2027-03-28 02:30 does not exist; documented: resolves to the later (post-gap) offset, i.e. 03:30 CEST
  expect(zonedTimeToUtc(2027,3,28,2,30,'Europe/Vienna')).toBe(Date.UTC(2027,2,28,1,30))
})

test('zonedTimeToUtc picks the first occurrence for repeated local time (fall back)', () => {
  // Vienna 2026-10-25 02:30 occurs twice; documented: the earlier one (CEST, UTC+2)
  expect(zonedTimeToUtc(2026,10,25,2,30,'Europe/Vienna')).toBe(Date.UTC(2026,9,25,0,30))
})

test('startOfLocalWeek on Monday 00:00 exactly returns itself', () => {
  const mon = Date.UTC(2026,10,8,23,0) // Mon 2026-11-09 00:00 Vienna
  expect(startOfLocalWeek(mon,'Europe/Vienna')).toBe(mon)
  expect(startOfLocalWeek(mon - 1,'Europe/Vienna')).toBe(mon - 7*DAY)
})

test('startOfLocalWeek across DST change is not 7x24h', () => {
  // Sunday 2026-10-25 (DST ends) -> Monday 2026-10-19 00:00 CEST = 2026-10-18 22:00 UTC
  expect(startOfLocalWeek(Date.UTC(2026,9,25,12,0),'Europe/Vienna')).toBe(Date.UTC(2026,9,18,22,0))
  // Monday after DST end starts at 00:00 CET = 23:00 UTC previous day
  expect(startOfLocalWeek(Date.UTC(2026,9,26,12,0),'Europe/Vienna')).toBe(Date.UTC(2026,9,25,23,0))
  // week is 169h long
  expect(Date.UTC(2026,9,25,23,0) - Date.UTC(2026,9,18,22,0)).toBe(7*DAY + HOUR)
})

test('startOfLocalWeek in a non-European zone', () => {
  // Wed 2026-07-01 12:00 UTC = Wed 08:00 New York -> Mon 2026-06-29 00:00 EDT = 04:00 UTC
  expect(startOfLocalWeek(Date.UTC(2026,6,1,12,0),'America/New_York')).toBe(Date.UTC(2026,5,29,4,0))
})
