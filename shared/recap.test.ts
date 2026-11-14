import { describe, expect, test } from 'vitest'
import { computeRecap } from './recap'
import { HOUR } from './time'
import type { Assignment, Member, Post, Reaction } from './types'

const TZ = 'Europe/Vienna'
const NOV = Date.UTC(2026, 10, 10, 12, 0)

function member(id: string, name: string, joinedAt = Date.UTC(2026, 0, 1)): Member {
  return { id, name, tz: TZ, tokenHash: '', recoveryHash: '', joinedAt, questChannel: '' }
}

function post(o: Partial<Post> = {}): Post {
  return {
    id: 'p1',
    assignmentId: 'a1',
    memberId: 'anna',
    kind: 'photo',
    fileId: 'f',
    stillFileId: 's',
    caption: '',
    capturedAt: null,
    createdAt: NOV,
    late: false,
    recordedEarlier: false,
    expired: false,
    durationS: null,
    ...o,
  }
}

function assignment(o: Partial<Assignment> = {}): Assignment {
  return {
    id: 'a1',
    memberId: 'anna',
    questId: 'q',
    dropAt: NOV - 12 * HOUR,
    deadlineAt: NOV,
    status: 'done',
    remindedAt: null,
    weekKey: '2026-W46',
    ...o,
  }
}

const react = (postId: string, memberId: string, emoji = '🔥'): Reaction => ({ postId, memberId, emoji })

const members = [member('z', 'Zdeněk'), member('anna', 'Anna')]

describe('counts', () => {
  test('recap counts alphabetical not by count', () => {
    const assignments = [
      assignment({ id: 'a1', memberId: 'z' }),
      assignment({ id: 'a2', memberId: 'anna' }),
      assignment({ id: 'a3', memberId: 'anna' }),
      assignment({ id: 'a4', memberId: 'anna' }),
    ]
    const r = computeRecap('2026-11', TZ, members, [], [], assignments)
    expect(r.counts.map((c) => c.name)).toEqual(['Anna', 'Zdeněk'])
    expect(r.counts.map((c) => c.done)).toEqual([3, 1])
    expect(r.totalDone).toBe(4)
    expect(r.month).toBe('2026-11')
  })

  test('sorts with Czech collation (Č after C, before D)', () => {
    const ms = [member('d', 'David'), member('c2', 'Čeněk'), member('c', 'Cyril')]
    const r = computeRecap('2026-11', TZ, ms, [], [], [])
    expect(r.counts.map((c) => c.name)).toEqual(['Cyril', 'Čeněk', 'David'])
  })

  test('total counts done and missed, not scheduled or open', () => {
    const assignments = [
      assignment({ id: 'a1', status: 'done' }),
      assignment({ id: 'a2', status: 'missed' }),
      assignment({ id: 'a3', status: 'open' }),
      assignment({ id: 'a4', status: 'scheduled' }),
    ]
    const r = computeRecap('2026-11', TZ, [member('anna', 'Anna')], [], [], assignments)
    expect(r.counts).toEqual([{ memberId: 'anna', name: 'Anna', done: 1, total: 2 }])
  })

  test('assignments with null deadline are ignored', () => {
    const r = computeRecap('2026-11', TZ, [member('anna', 'Anna')], [], [], [assignment({ deadlineAt: null })])
    expect(r.counts[0]).toMatchObject({ done: 0, total: 0 })
  })

  test('assignment belongs to the month of its deadline, not its drop', () => {
    // dropped 30 Nov evening, due 1 Dec: counts in December only
    const a = assignment({
      dropAt: Date.UTC(2026, 10, 30, 20, 0),
      deadlineAt: Date.UTC(2026, 11, 1, 8, 0),
    })
    const nov = computeRecap('2026-11', TZ, [member('anna', 'Anna')], [], [], [a])
    const dec = computeRecap('2026-12', TZ, [member('anna', 'Anna')], [], [], [a])
    expect(nov.counts[0]).toMatchObject({ done: 0, total: 0 })
    expect(dec.counts[0]).toMatchObject({ done: 1, total: 1 })
  })

  test('excludes members who joined after the month ended', () => {
    const ms = [member('anna', 'Anna'), member('new', 'Boris', Date.UTC(2026, 11, 1, 0, 0))]
    const r = computeRecap('2026-11', TZ, ms, [], [], [])
    expect(r.counts.map((c) => c.memberId)).toEqual(['anna'])
  })

  test('member joining exactly at month end (Vienna) is excluded, one ms earlier included', () => {
    const end = Date.UTC(2026, 10, 30, 23, 0)
    const ms = [member('a', 'Anna', end - 1), member('b', 'Boris', end)]
    const r = computeRecap('2026-11', TZ, ms, [], [], [])
    expect(r.counts.map((c) => c.memberId)).toEqual(['a'])
  })
})

describe('group time zone month boundary', () => {
  const lateNov = Date.UTC(2026, 10, 30, 23, 30) // 2026-12-01 00:30 in Vienna

  test('recap uses group tz month boundary', () => {
    const p = post({ id: 'edge', createdAt: lateNov })
    const dec = computeRecap('2026-12', TZ, members, [p], [], [])
    const nov = computeRecap('2026-11', TZ, members, [p], [], [])
    expect(dec.totalPosts).toBe(1)
    expect(dec.gallery).toEqual(['edge'])
    expect(nov.totalPosts).toBe(0)
    expect(nov.gallery).toEqual([])

    const a = assignment({ memberId: 'anna', deadlineAt: lateNov })
    const decA = computeRecap('2026-12', TZ, members, [], [], [a])
    const novA = computeRecap('2026-11', TZ, members, [], [], [a])
    expect(decA.counts.find((c) => c.memberId === 'anna')).toMatchObject({ done: 1, total: 1 })
    expect(novA.counts.find((c) => c.memberId === 'anna')).toMatchObject({ done: 0, total: 0 })
  })

  test('month bounds are half-open', () => {
    const start = Date.UTC(2026, 10, 30, 23, 0) // 2026-12-01 00:00 Vienna
    const first = post({ id: 'first', createdAt: start })
    const last = post({ id: 'last', createdAt: start - 1 })
    const dec = computeRecap('2026-12', TZ, members, [first, last], [], [])
    const nov = computeRecap('2026-11', TZ, members, [first, last], [], [])
    expect(dec.gallery).toEqual(['first'])
    expect(nov.gallery).toEqual(['last'])
  })
})

describe('mostReacted and gallery', () => {
  test('mostReacted null with no reactions', () => {
    const r = computeRecap('2026-11', TZ, members, [post()], [], [])
    expect(r.mostReacted).toBeNull()
  })

  test('mostReacted null when there are no posts', () => {
    expect(computeRecap('2026-11', TZ, members, [], [], []).mostReacted).toBeNull()
  })

  test('mostReacted reports total and byEmoji', () => {
    const posts = [post({ id: 'a' }), post({ id: 'b' })]
    const reactions = [
      react('a', 'm1'),
      react('b', 'm1', '🔥'),
      react('b', 'm2', '🔥'),
      react('b', 'm3', '😂'),
    ]
    const r = computeRecap('2026-11', TZ, members, posts, reactions, [])
    expect(r.mostReacted).toEqual({ postId: 'b', total: 3, byEmoji: { '🔥': 2, '😂': 1 } })
  })

  test('mostReacted ignores reactions on posts outside the month', () => {
    const inMonth = post({ id: 'in' })
    const out = post({ id: 'out', createdAt: Date.UTC(2026, 9, 1) })
    const reactions = [react('out', 'm1'), react('out', 'm2'), react('in', 'm1')]
    const r = computeRecap('2026-11', TZ, members, [inMonth, out], reactions, [])
    expect(r.mostReacted).toMatchObject({ postId: 'in', total: 1 })
  })

  test('mostReacted tie -> earlier createdAt, then smaller id', () => {
    const early = post({ id: 'z-early', createdAt: NOV })
    const late = post({ id: 'a-late', createdAt: NOV + HOUR })
    const reactions = [react('z-early', 'm1'), react('a-late', 'm1')]
    expect(computeRecap('2026-11', TZ, members, [late, early], reactions, []).mostReacted?.postId).toBe('z-early')

    const same1 = post({ id: 'b', createdAt: NOV })
    const same2 = post({ id: 'a', createdAt: NOV })
    const rs = [react('a', 'm1'), react('b', 'm1')]
    expect(computeRecap('2026-11', TZ, members, [same1, same2], rs, []).mostReacted?.postId).toBe('a')
  })

  test('gallery orders by reactions, ties newer first then id, capped at 12', () => {
    const posts = Array.from({ length: 15 }, (_, i) => post({ id: 'p' + String(i).padStart(2, '0'), createdAt: NOV + i * HOUR }))
    // p03 gets 2 reactions, p01 gets 1; rest 0
    const reactions = [react('p03', 'm1'), react('p03', 'm2'), react('p01', 'm1')]
    const r = computeRecap('2026-11', TZ, members, posts, reactions, [])
    expect(r.gallery).toHaveLength(12)
    expect(r.gallery.slice(0, 2)).toEqual(['p03', 'p01'])
    // zero-reaction posts: newest first (p14, p13, ...)
    expect(r.gallery.slice(2, 5)).toEqual(['p14', 'p13', 'p12'])
    expect(r.totalPosts).toBe(15)
  })

  test('gallery equal createdAt and reactions -> id order', () => {
    const posts = [post({ id: 'b' }), post({ id: 'a' })]
    expect(computeRecap('2026-11', TZ, members, posts, [], []).gallery).toEqual(['a', 'b'])
  })
})
