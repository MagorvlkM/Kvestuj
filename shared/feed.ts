import { monthBounds } from './recap'
import type { Assignment, Post, Recap } from './types'

export type FeedItem =
  | { kind: 'post'; post: Post; locked: boolean; at: number }
  | { kind: 'missed'; memberId: string; assignmentId: string; at: number }
  | { kind: 'recap'; recap: Recap; at: number }

export type FeedViewer = { memberId: string; open: Assignment | null }

const KIND_ORDER: Record<FeedItem['kind'], number> = { recap: 0, post: 1, missed: 2 }

function itemId(i: FeedItem): string {
  return i.kind === 'post' ? i.post.id : i.kind === 'missed' ? i.assignmentId : i.recap.month
}

/** A post is late when it arrives after the assignment's deadline. */
export function isLate(createdAt: number, a: Assignment): boolean {
  return a.deadlineAt !== null && createdAt > a.deadlineAt
}

/** The photo/video was captured before the drop (false when its capture date is unknown). */
export function isRecordedEarlier(capturedAt: number | null, dropAt: number): boolean {
  return capturedAt !== null && capturedAt < dropAt
}

/**
 * The full feed, newest first. Posts newer than the viewer's own still-open quest are locked
 * until they post for it (or its deadline passes). A null deadline never expires.
 */
export function buildFeed(
  posts: Post[],
  assignments: Assignment[],
  recaps: Recap[],
  viewer: FeedViewer,
  now: number,
  groupTz: string,
): FeedItem[] {
  const open = viewer.open
  const lockActive =
    open !== null &&
    (open.deadlineAt === null || now < open.deadlineAt) &&
    !posts.some((p) => p.assignmentId === open.id)
  const postedFor = new Set(posts.map((p) => p.assignmentId))

  const items: FeedItem[] = []
  for (const post of posts) {
    const locked = lockActive && post.createdAt > open!.dropAt && post.memberId !== viewer.memberId
    items.push({ kind: 'post', post, locked, at: post.createdAt })
  }
  for (const a of assignments) {
    if (a.status === 'missed' && a.deadlineAt !== null && !postedFor.has(a.id)) {
      items.push({ kind: 'missed', memberId: a.memberId, assignmentId: a.id, at: a.deadlineAt })
    }
  }
  for (const recap of recaps) {
    items.push({ kind: 'recap', recap, at: monthBounds(recap.month, groupTz).end })
  }

  return items.sort((a, b) => {
    if (a.at !== b.at) return b.at - a.at
    if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    const x = itemId(a)
    const y = itemId(b)
    return x < y ? 1 : x > y ? -1 : 0
  })
}
