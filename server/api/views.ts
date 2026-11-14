// Records → views (docs/api.md "Views"). Never leak tokenHash, recoveryHash or questChannel.
import { buildFeed } from '../../shared/feed'
import type { RecapData } from '../../shared/recap'
import type { Assignment, Emoji, Member, MemberView, Post, PostView, Quest } from '../../shared/types'
import { EMOJI } from '../../shared/types'
import type { Ctx } from './context'
import { newestFirst, UserError } from './context'

export const memberView = (m: Member): MemberView => ({ id: m.id, name: m.name, tz: m.tz, joinedAt: m.joinedAt })

export const memberViews = (ctx: Ctx): MemberView[] => ctx.store.members().map(memberView)

export const isEmoji = (e: unknown): e is Emoji => (EMOJI as readonly unknown[]).includes(e)

export function questTextOf(quests: Quest[], questId: string | null): string {
  return quests.find((q) => q.id === questId)?.text ?? ''
}

/** The member's open assignment (the latest drop when there are several), or null. */
export function openAssignment(mine: Assignment[]): Assignment | null {
  return mine.filter((a) => a.status === 'open').sort(newestFirst((a) => a.dropAt))[0] ?? null
}

export function reactionSummary(reactions: { memberId: string; emoji: string }[], viewerId: string) {
  const counts = Object.fromEntries(EMOJI.map((e) => [e, 0])) as Record<Emoji, number>
  const mine: Emoji[] = []
  for (const r of reactions) {
    if (!isEmoji(r.emoji)) continue
    counts[r.emoji]++
    if (r.memberId === viewerId) mine.push(r.emoji)
  }
  return { reactions: counts, mine: EMOJI.filter((e) => mine.includes(e)) }
}

/**
 * A PostView builder for `ctx.member`; reads quests, reactions and comments once
 * (and assignments, unless the caller already has them: each read is a Sheet range read).
 */
export function postViewer(ctx: Ctx, assignments: Assignment[] = ctx.store.assignments()): (p: Post) => PostView {
  const { store, member } = ctx
  const quests = store.quests()
  const questOf = new Map(assignments.map((a) => [a.id, a.questId]))
  const reactions = store.reactions()
  const commentCount = new Map<string, number>()
  for (const c of store.comments()) commentCount.set(c.postId, (commentCount.get(c.postId) ?? 0) + 1)

  return (p) => ({
    id: p.id,
    assignmentId: p.assignmentId,
    memberId: p.memberId,
    kind: p.kind,
    fileId: p.expired ? null : p.fileId,
    stillFileId: p.stillFileId || null,
    caption: p.caption,
    createdAt: p.createdAt,
    capturedAt: p.capturedAt,
    durationS: p.durationS,
    late: p.late,
    recordedEarlier: p.recordedEarlier,
    expired: p.expired,
    questText: questTextOf(quests, questOf.get(p.assignmentId) ?? null),
    ...reactionSummary(
      reactions.filter((r) => r.postId === p.id),
      member.id,
    ),
    commentCount: commentCount.get(p.id) ?? 0,
  })
}

/** Ids of the posts locked for `ctx.member` (buildFeed's rule). */
export function lockedPostIds(ctx: Ctx, posts: Post[]): Set<string> {
  const open = openAssignment(ctx.store.assignments({ memberId: ctx.member.id }))
  const items = buildFeed(posts, [], [], { memberId: ctx.member.id, open }, ctx.now, ctx.config.groupTz)
  return new Set(items.flatMap((i) => (i.kind === 'post' && i.locked ? [i.post.id] : [])))
}

/** The post the caller may see, or the `post` refusals. */
export function visiblePost(ctx: Ctx, postId: unknown): Post {
  const posts = ctx.store.posts()
  const p = posts.find((x) => x.id === postId)
  if (!p) throw new UserError('That post is gone')
  if (lockedPostIds(ctx, posts).has(p.id)) throw new UserError('Post your quest to see this')
  return p
}

export function parseRecap(json: string): RecapData | null {
  try {
    return JSON.parse(json) as RecapData
  } catch {
    return null
  }
}
