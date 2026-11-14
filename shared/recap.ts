import { zonedTimeToUtc } from './time'
import type { Assignment, Member, Post, Reaction } from './types'

export type RecapData = {
  month: string
  counts: { memberId: string; name: string; done: number; total: number }[]
  totalDone: number
  totalPosts: number
  mostReacted: { postId: string; total: number; byEmoji: Record<string, number> } | null
  gallery: string[]
}

const GALLERY_SIZE = 12

/** Half-open UTC bounds [start, end) of calendar month 'YYYY-MM' in `groupTz`. */
export function monthBounds(month: string, groupTz: string): { start: number; end: number } {
  const [y, m] = month.split('-').map(Number)
  const ny = m === 12 ? y + 1 : y
  const nm = m === 12 ? 1 : m + 1
  return { start: zonedTimeToUtc(y, m, 1, 0, 0, groupTz), end: zonedTimeToUtc(ny, nm, 1, 0, 0, groupTz) }
}

/**
 * Summary of one calendar month in the group time zone.
 * Assignments count in the month of their deadline; posts in the month of their createdAt.
 */
export function computeRecap(
  month: string,
  groupTz: string,
  members: Member[],
  posts: Post[],
  reactions: Reaction[],
  assignments: Assignment[],
): RecapData {
  const { start, end } = monthBounds(month, groupTz)
  const inMonth = (t: number) => t >= start && t < end

  const tally = new Map<string, { done: number; total: number }>()
  for (const a of assignments) {
    if (a.deadlineAt === null || !inMonth(a.deadlineAt)) continue
    if (a.status !== 'done' && a.status !== 'missed') continue
    const t = tally.get(a.memberId) ?? { done: 0, total: 0 }
    t.total++
    if (a.status === 'done') t.done++
    tally.set(a.memberId, t)
  }

  const counts = members
    .filter((m) => m.joinedAt < end)
    .map((m) => ({ memberId: m.id, name: m.name, done: tally.get(m.id)?.done ?? 0, total: tally.get(m.id)?.total ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name, 'cs'))

  const monthPosts = posts.filter((p) => inMonth(p.createdAt))

  const byPost = new Map<string, Record<string, number>>()
  for (const r of reactions) {
    const e = byPost.get(r.postId) ?? {}
    e[r.emoji] = (e[r.emoji] ?? 0) + 1
    byPost.set(r.postId, e)
  }
  const totalOf = (id: string) => Object.values(byPost.get(id) ?? {}).reduce((s, n) => s + n, 0)

  const ranked = monthPosts.map((p) => ({ p, total: totalOf(p.id) }))

  // Most reacted: more reactions, then earlier post, then smaller id.
  const best = [...ranked]
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total || a.p.createdAt - b.p.createdAt || cmp(a.p.id, b.p.id))[0]

  // Gallery: more reactions, then newer post, then smaller id.
  const gallery = [...ranked]
    .sort((a, b) => b.total - a.total || b.p.createdAt - a.p.createdAt || cmp(a.p.id, b.p.id))
    .slice(0, GALLERY_SIZE)
    .map((r) => r.p.id)

  return {
    month,
    counts,
    totalDone: counts.reduce((s, c) => s + c.done, 0),
    totalPosts: monthPosts.length,
    mostReacted: best ? { postId: best.p.id, total: best.total, byEmoji: { ...byPost.get(best.p.id) } } : null,
    gallery,
  }
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
