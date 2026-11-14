// feed, post, react, comment, group, recap.
import { newId } from '../../shared/codes'
import { buildFeed } from '../../shared/feed'
import type { ApiResults, FeedItemView, GroupMemberView, Post } from '../../shared/types'
import type { Args, Ctx } from './context'
import { chars, clean, num, str, UserError } from './context'
import { isEmoji, lockedPostIds, memberView, memberViews, openAssignment, parseRecap, postViewer, reactionSummary, visiblePost } from './views'

const PAGE = 20
const MAX_COMMENT = 500

export function feed(ctx: Ctx, args: Args): ApiResults['feed'] {
  const { store, member, now, config } = ctx
  const assignments = store.assignments()
  const open = openAssignment(assignments.filter((a) => a.memberId === member.id))
  const before = num(args.before)
  const all = buildFeed(store.posts(), assignments, store.recaps(), { memberId: member.id, open }, now, config.groupTz).filter(
    (i) => before === null || i.at < before,
  )
  const page = all.slice(0, PAGE)
  const view = postViewer(ctx, assignments)

  const items = page.map((i): FeedItemView => {
    switch (i.kind) {
      case 'post':
        return i.locked
          ? { kind: 'post', at: i.at, locked: true, postId: i.post.id, memberId: i.post.memberId }
          : { kind: 'post', at: i.at, locked: false, post: view(i.post) }
      case 'missed':
        return { kind: 'missed', at: i.at, memberId: i.memberId, assignmentId: i.assignmentId }
      case 'recap':
        return { kind: 'recap', at: i.at, month: i.recap.month, totalDone: parseRecap(i.recap.json)?.totalDone ?? 0 }
    }
  })

  return { items, members: memberViews(ctx), nextBefore: all.length > PAGE ? page[PAGE - 1].at : null }
}

export function post(ctx: Ctx, args: Args): ApiResults['post'] {
  const p = visiblePost(ctx, args.postId)
  const comments = ctx.store
    .comments(p.id)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(({ id, postId, memberId, text, createdAt }) => ({ id, postId, memberId, text, createdAt }))
  return { post: postViewer(ctx)(p), comments, members: memberViews(ctx) }
}

export function react(ctx: Ctx, args: Args): ApiResults['react'] {
  const emoji = args.emoji
  if (!isEmoji(emoji)) throw new UserError("That reaction isn't available")
  const p = visiblePost(ctx, args.postId)
  ctx.store.toggleReaction({ postId: p.id, memberId: ctx.member.id, emoji })
  return reactionSummary(ctx.store.reactions(p.id), ctx.member.id)
}

export function comment(ctx: Ctx, args: Args): ApiResults['comment'] {
  const text = clean(str(args.text))
  if (chars(text) < 1 || chars(text) > MAX_COMMENT) throw new UserError('Comments need 1 to 500 characters')
  const p = visiblePost(ctx, args.postId)
  const c = { id: newId('c'), postId: p.id, memberId: ctx.member.id, text, createdAt: ctx.now }
  ctx.store.addComment(c)
  return { comment: c }
}

const latest = (xs: number[]): number | null => (xs.length ? Math.max(...xs) : null)

export function group(ctx: Ctx): ApiResults['group'] {
  const { store, now } = ctx
  const assignments = store.assignments()
  const posts = store.posts()
  const members: GroupMemberView[] = store
    .members()
    .sort((a, b) => a.name.localeCompare(b.name, 'cs'))
    .map((m) => {
      const mine = assignments.filter((a) => a.memberId === m.id)
      return {
        ...memberView(m),
        hasOpen: mine.some((a) => a.status === 'open' && a.deadlineAt !== null && now < a.deadlineAt),
        lastPostAt: latest(posts.filter((p) => p.memberId === m.id).map((p) => p.createdAt)),
        lastMissedAt: latest(mine.flatMap((a) => (a.status === 'missed' && a.deadlineAt !== null ? [a.deadlineAt] : []))),
      }
    })
  return { members }
}

export function recap(ctx: Ctx, args: Args): ApiResults['recap'] {
  const found = ctx.store.recaps().find((r) => r.month === str(args.month))
  const data = found ? parseRecap(found.json) : null
  if (!data) throw new UserError('No recap for that month yet')

  const posts = ctx.store.posts()
  const locked = lockedPostIds(ctx, posts)
  const ids = [...new Set([...data.gallery, ...(data.mostReacted ? [data.mostReacted.postId] : [])])]
  const view = postViewer(ctx)
  const shown = ids.flatMap((id) => posts.filter((p: Post) => p.id === id && !locked.has(p.id)).map(view))
  return { recap: data, posts: shown, members: memberViews(ctx) }
}
