import { describe, expect, test } from 'vitest'
import { buildFeed, isLate, isRecordedEarlier } from './feed'
import { DAY, HOUR } from './time'
import type { Assignment, Post, Recap } from './types'

const TZ = 'Europe/Vienna'
const T0 = Date.UTC(2026, 10, 10, 8, 0) // 2026-11-10T08:00Z

function assignment(o: Partial<Assignment> = {}): Assignment {
  return {
    id: 'a1',
    memberId: 'me',
    questId: 'q1',
    dropAt: T0,
    deadlineAt: T0 + 12 * HOUR,
    status: 'open',
    remindedAt: null,
    weekKey: '2026-W46',
    ...o,
  }
}

function post(o: Partial<Post> = {}): Post {
  return {
    id: 'p1',
    assignmentId: 'a-other',
    memberId: 'other',
    kind: 'photo',
    fileId: 'f',
    stillFileId: 's',
    caption: '',
    capturedAt: null,
    createdAt: T0 + HOUR,
    late: false,
    recordedEarlier: false,
    expired: false,
    durationS: null,
    ...o,
  }
}

const viewerOpen = (open: Assignment | null) => ({ memberId: 'me', open })

function lockedOf(items: ReturnType<typeof buildFeed>, id: string): boolean {
  const it = items.find((i) => i.kind === 'post' && i.post.id === id)
  if (!it || it.kind !== 'post') throw new Error('post not in feed: ' + id)
  return it.locked
}

describe('lock rule', () => {
  const open = assignment()
  const newer = post({ id: 'n', createdAt: open.dropAt + HOUR })

  test('locks newer post while viewer quest open', () => {
    const feed = buildFeed([newer], [open], [], viewerOpen(open), open.dropAt + 2 * HOUR, TZ)
    expect(lockedOf(feed, 'n')).toBe(true)
  })

  test('own post never locked', () => {
    const own = post({ id: 'o', memberId: 'me', assignmentId: 'a-old', createdAt: open.dropAt + HOUR })
    const feed = buildFeed([own], [open], [], viewerOpen(open), open.dropAt + 2 * HOUR, TZ)
    expect(lockedOf(feed, 'o')).toBe(false)
  })

  test('unlocks after viewer posts', () => {
    const mine = post({ id: 'm', memberId: 'me', assignmentId: open.id, createdAt: open.dropAt + HOUR })
    const feed = buildFeed([newer, mine], [open], [], viewerOpen(open), open.dropAt + 2 * HOUR, TZ)
    expect(lockedOf(feed, 'n')).toBe(false)
  })

  test('unlocks after deadline', () => {
    const feed = buildFeed([newer], [open], [], viewerOpen(open), open.deadlineAt!, TZ)
    expect(lockedOf(feed, 'n')).toBe(false)
    const before = buildFeed([newer], [open], [], viewerOpen(open), open.deadlineAt! - 1, TZ)
    expect(lockedOf(before, 'n')).toBe(true)
  })

  test('posts created at or before the open dropAt are not locked (strictly newer only)', () => {
    const atDrop = post({ id: 'at', createdAt: open.dropAt })
    const older = post({ id: 'old', createdAt: open.dropAt - 1 })
    const after = post({ id: 'new', createdAt: open.dropAt + 1 })
    const feed = buildFeed([atDrop, older, after], [open], [], viewerOpen(open), open.dropAt + HOUR, TZ)
    expect(lockedOf(feed, 'at')).toBe(false)
    expect(lockedOf(feed, 'old')).toBe(false)
    expect(lockedOf(feed, 'new')).toBe(true)
  })

  test('nothing locked when the viewer has no open quest', () => {
    const feed = buildFeed([newer], [], [], viewerOpen(null), T0 + 2 * HOUR, TZ)
    expect(lockedOf(feed, 'n')).toBe(false)
  })
})

describe('missed lines', () => {
  const missed = assignment({ id: 'am', memberId: 'zed', status: 'missed', deadlineAt: T0 + 5 * HOUR })

  test('missed line shown at its deadline', () => {
    const feed = buildFeed([], [missed], [], viewerOpen(null), T0 + DAY, TZ)
    expect(feed).toEqual([{ kind: 'missed', memberId: 'zed', assignmentId: 'am', at: missed.deadlineAt }])
  })

  test('missed line hidden when a late post exists', () => {
    const late = post({ id: 'late', assignmentId: 'am', memberId: 'zed', createdAt: missed.deadlineAt! + HOUR, late: true })
    const feed = buildFeed([late], [missed], [], viewerOpen(null), T0 + DAY, TZ)
    expect(feed.map((i) => i.kind)).toEqual(['post'])
  })

  test('missed item disappears when its assignment becomes done (late post)', () => {
    const done = { ...missed, status: 'done' as const }
    const late = post({ id: 'late', assignmentId: 'am', memberId: 'zed', createdAt: missed.deadlineAt! + HOUR })
    const feed = buildFeed([late], [done], [], viewerOpen(null), T0 + DAY, TZ)
    expect(feed.some((i) => i.kind === 'missed')).toBe(false)
  })

  test('missed assignments without a deadline are skipped', () => {
    const noDeadline = assignment({ id: 'nd', status: 'missed', deadlineAt: null })
    expect(buildFeed([], [noDeadline], [], viewerOpen(null), T0, TZ)).toEqual([])
  })

  test('non-missed assignments produce no missed item', () => {
    const others = (['scheduled', 'open', 'done'] as const).map((status, i) => assignment({ id: 'x' + i, status }))
    expect(buildFeed([], others, [], viewerOpen(null), T0, TZ)).toEqual([])
  })
})

describe('recap items and ordering', () => {
  test('recap item at equals 1st 00:00 Vienna of the following month', () => {
    const recap: Recap = { month: '2026-11', json: '{}' }
    const feed = buildFeed([], [], [recap], viewerOpen(null), T0, TZ)
    expect(feed).toEqual([{ kind: 'recap', recap, at: Date.UTC(2026, 10, 30, 23, 0) }])
  })

  test('recap for December rolls over the year', () => {
    const recap: Recap = { month: '2026-12', json: '{}' }
    const feed = buildFeed([], [], [recap], viewerOpen(null), T0, TZ)
    expect(feed[0].at).toBe(Date.UTC(2026, 11, 31, 23, 0)) // 2027-01-01 00:00 Vienna
  })

  test('newest first across all three kinds', () => {
    const recap: Recap = { month: '2026-10', json: '{}' } // at = 2026-10-31T23:00Z
    const p1 = post({ id: 'p1', createdAt: Date.UTC(2026, 10, 2) })
    const p2 = post({ id: 'p2', createdAt: Date.UTC(2026, 9, 20) })
    const missed = assignment({ id: 'am', status: 'missed', deadlineAt: Date.UTC(2026, 10, 1) })
    const feed = buildFeed([p2, p1], [missed], [recap], viewerOpen(null), T0, TZ)
    expect(feed.map((i) => i.kind)).toEqual(['post', 'missed', 'recap', 'post'])
    expect(feed.map((i) => i.at)).toEqual([...feed.map((i) => i.at)].sort((a, b) => b - a))
    expect(feed[0].kind === 'post' && feed[0].post.id).toBe('p1')
    expect(feed[3].kind === 'post' && feed[3].post.id).toBe('p2')
  })

  test('ties break by kind (recap > post > missed) then id descending', () => {
    const at = Date.UTC(2026, 10, 30, 23, 0)
    const recap: Recap = { month: '2026-11', json: '{}' }
    const pa = post({ id: 'pa', createdAt: at })
    const pb = post({ id: 'pb', createdAt: at })
    const m1 = assignment({ id: 'm1', status: 'missed', deadlineAt: at })
    const m2 = assignment({ id: 'm2', status: 'missed', deadlineAt: at })
    const feed = buildFeed([pa, pb], [m1, m2], [recap], viewerOpen(null), T0 + 60 * DAY, TZ)
    const ids = feed.map((i) => (i.kind === 'post' ? i.post.id : i.kind === 'missed' ? i.assignmentId : i.recap.month))
    expect(ids).toEqual(['2026-11', 'pb', 'pa', 'm2', 'm1'])
  })

  test('returns all items (no pagination)', () => {
    const posts = Array.from({ length: 120 }, (_, i) => post({ id: 'p' + i, createdAt: T0 + i }))
    expect(buildFeed(posts, [], [], viewerOpen(null), T0 + DAY, TZ)).toHaveLength(120)
  })
})

describe('labels', () => {
  const a = assignment()

  test('late post labelled late', () => {
    expect(isLate(a.deadlineAt! + 1, a)).toBe(true)
    expect(isLate(a.deadlineAt!, a)).toBe(false)
  })

  test('isLate is false when the assignment has no deadline', () => {
    expect(isLate(T0 + 99 * DAY, assignment({ deadlineAt: null }))).toBe(false)
  })

  test('recordedEarlier false without date', () => {
    expect(isRecordedEarlier(null, T0)).toBe(false)
  })

  test('recordedEarlier true 1 min before drop', () => {
    expect(isRecordedEarlier(T0 - 60_000, T0)).toBe(true)
    expect(isRecordedEarlier(T0, T0)).toBe(false)
  })
})
