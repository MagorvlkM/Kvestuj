import { describe, expect, it } from 'vitest'
import { monthBounds } from '../../shared/recap'
import { HOUR } from '../../shared/time'
import type { ApiResults, FeedItemView } from '../../shared/types'
import { asg, config, data, pst, refusal, T0, world } from './testkit'

const MINUTE = 60_000

// Bo posted after Ada's open quest dropped: locked for Ada until she posts.
function lockedWorld() {
  return world({
    assignments: [asg('a1', 'm1', { questId: 'q1' }), asg('b1', 'm2', { questId: 'q5', status: 'done' })],
    posts: [
      pst('pB', 'b1', 'm2', { createdAt: T0 + 30 * MINUTE, caption: 'SECRET-CAPTION', fileId: 'SECRET-FILE' }),
      pst('pOld', 'b0', 'm2', { createdAt: T0 - HOUR }),
    ],
  })
}

describe('feed', () => {
  it('locked post is redacted in feed', () => {
    const w = lockedWorld()
    const r = data<ApiResults['feed']>(w.ada('feed'))
    expect(r.items[0]).toEqual({ kind: 'post', at: T0 + 30 * MINUTE, locked: true, postId: 'pB', memberId: 'm2' })
    const json = JSON.stringify(r)
    expect(json).not.toContain('SECRET')
    expect(json).not.toContain('QTEXT-five')
    expect(r.items[1]).toMatchObject({ kind: 'post', locked: false, post: { id: 'pOld' } })
    // Bo sees his own post
    const bo = data<ApiResults['feed']>(w.bo('feed'))
    expect(bo.items[0]).toMatchObject({ kind: 'post', locked: false, post: { id: 'pB', fileId: 'SECRET-FILE', questText: 'QTEXT-five' } })
    expect(bo.members.map((m) => m.id).sort()).toEqual(['m1', 'm2'])
    expect(JSON.stringify(bo.members)).not.toMatch(/tokenHash|recoveryHash|questChannel/)
  })

  it('shows missed quests and recaps', () => {
    const recap = { month: '2026-10', counts: [], totalDone: 7, totalPosts: 7, mostReacted: null, gallery: [] }
    const w = world({
      assignments: [asg('b1', 'm2', { status: 'missed', dropAt: T0 - 30 * HOUR, deadlineAt: T0 - 20 * HOUR })],
      recaps: [{ month: '2026-10', json: JSON.stringify(recap) }],
    })
    const r = data<ApiResults['feed']>(w.ada('feed'))
    expect(r.items).toEqual<FeedItemView[]>([
      { kind: 'missed', at: T0 - 20 * HOUR, memberId: 'm2', assignmentId: 'b1' },
      { kind: 'recap', at: monthBounds('2026-10', config.groupTz).end, month: '2026-10', totalDone: 7 },
    ])
    expect(r.nextBefore).toBeNull()
  })

  it('feed pagination: 25 posts give 20 + nextBefore, then 5', () => {
    const posts = Array.from({ length: 25 }, (_, i) => pst(`p${String(i).padStart(2, '0')}`, `x${i}`, 'm2', { createdAt: T0 - (i + 1) * HOUR }))
    const w = world({ posts })
    const page1 = data<ApiResults['feed']>(w.ada('feed'))
    expect(page1.items).toHaveLength(20)
    expect(page1.nextBefore).toBe(T0 - 20 * HOUR)
    const page2 = data<ApiResults['feed']>(w.ada('feed', { before: page1.nextBefore }))
    expect(page2.items).toHaveLength(5)
    expect(page2.nextBefore).toBeNull()
    const ids = [...page1.items, ...page2.items].map((i) => (i.kind === 'post' && !i.locked ? i.post.id : ''))
    expect(ids).toEqual(posts.map((p) => p.id))
  })

  it('a PostView has every reaction key, the caller’s own reactions and the comment count; expired videos lose fileId', () => {
    const w = world({
      posts: [pst('p1', 'x1', 'm2', { kind: 'video', expired: true, stillFileId: 's1', durationS: 12 })],
      reactions: [
        { postId: 'p1', memberId: 'm1', emoji: '🔥' },
        { postId: 'p1', memberId: 'm2', emoji: '🔥' },
        { postId: 'p1', memberId: 'm2', emoji: '❤️' },
      ],
      comments: [{ id: 'c1', postId: 'p1', memberId: 'm2', text: 'yo', createdAt: T0 + 2 * HOUR }],
    })
    const item = data<ApiResults['feed']>(w.ada('feed')).items[0]
    if (item.kind !== 'post' || item.locked) throw new Error('expected an unlocked post')
    expect(item.post).toMatchObject({ fileId: null, stillFileId: 's1', expired: true, durationS: 12, questText: '', commentCount: 1, mine: ['🔥'] })
    expect(item.post.reactions).toEqual({ '😂': 0, '🔥': 2, '😮': 0, '❤️': 1, '👏': 0, '💀': 0 })
  })
})

describe('post', () => {
  it('returns the post with comments in order and members', () => {
    const w = world({
      posts: [pst('p1', 'x1', 'm2', { createdAt: T0 - HOUR })],
      comments: [
        { id: 'c2', postId: 'p1', memberId: 'm1', text: 'second', createdAt: T0 + 2 * HOUR },
        { id: 'c1', postId: 'p1', memberId: 'm2', text: 'first', createdAt: T0 + HOUR },
        { id: 'c9', postId: 'other', memberId: 'm2', text: 'elsewhere', createdAt: T0 },
      ],
    })
    const r = data<ApiResults['post']>(w.ada('post', { postId: 'p1' }))
    expect(r.post.id).toBe('p1')
    expect(r.comments).toEqual([
      { id: 'c1', postId: 'p1', memberId: 'm2', text: 'first', createdAt: T0 + HOUR },
      { id: 'c2', postId: 'p1', memberId: 'm1', text: 'second', createdAt: T0 + 2 * HOUR },
    ])
    expect(r.members).toHaveLength(2)
  })

  it('refuses a locked or unknown post', () => {
    const w = lockedWorld()
    expect(refusal(w.ada('post', { postId: 'pB' }))).toBe('Post your quest to see this')
    expect(refusal(w.ada('post', { postId: 'nope' }))).toBe('That post is gone')
    expect(data(w.bo('post', { postId: 'pB' })).post.id).toBe('pB')
  })
})

describe('react', () => {
  it('react rejects 👍', () => {
    const w = world({ posts: [pst('p1', 'x1', 'm2')] })
    expect(refusal(w.ada('react', { postId: 'p1', emoji: '👍' }))).toBe("That reaction isn't available")
    expect(refusal(w.ada('react', { postId: 'p1', emoji: '❤' }))).toBe("That reaction isn't available") // no FE0F
    expect(w.store.reactions()).toEqual([])
  })

  it('toggles the reaction and returns counts and mine', () => {
    const w = world({ posts: [pst('p1', 'x1', 'm2')], reactions: [{ postId: 'p1', memberId: 'm2', emoji: '😂' }] })
    const on = data<ApiResults['react']>(w.ada('react', { postId: 'p1', emoji: '❤️' }))
    expect(on).toEqual({ reactions: { '😂': 1, '🔥': 0, '😮': 0, '❤️': 1, '👏': 0, '💀': 0 }, mine: ['❤️'] })
    const off = data<ApiResults['react']>(w.ada('react', { postId: 'p1', emoji: '❤️' }))
    expect(off).toEqual({ reactions: { '😂': 1, '🔥': 0, '😮': 0, '❤️': 0, '👏': 0, '💀': 0 }, mine: [] })
  })

  it('refuses a locked or unknown post', () => {
    const w = lockedWorld()
    expect(refusal(w.ada('react', { postId: 'pB', emoji: '🔥' }))).toBe('Post your quest to see this')
    expect(refusal(w.ada('react', { postId: 'nope', emoji: '🔥' }))).toBe('That post is gone')
    expect(w.store.reactions()).toEqual([])
  })
})

describe('comment', () => {
  it('adds a trimmed comment', () => {
    const w = world({ posts: [pst('p1', 'x1', 'm2')] })
    const r = data<ApiResults['comment']>(w.ada('comment', { postId: 'p1', text: '  nice one  ' }))
    expect(r.comment).toMatchObject({ postId: 'p1', memberId: 'm1', text: 'nice one', createdAt: T0 + HOUR })
    expect(w.store.comments()).toEqual([r.comment])
  })

  it('comment over 500 refused', () => {
    const w = world({ posts: [pst('p1', 'x1', 'm2')] })
    expect(refusal(w.ada('comment', { postId: 'p1', text: 'x'.repeat(501) }))).toBe('Comments need 1 to 500 characters')
    expect(refusal(w.ada('comment', { postId: 'p1', text: '   ' }))).toBe('Comments need 1 to 500 characters')
    expect(data(w.ada('comment', { postId: 'p1', text: '💀'.repeat(500) })).comment.text).toBe('💀'.repeat(500))
    expect(w.store.comments()).toHaveLength(1)
  })

  it('refuses a locked or unknown post', () => {
    const w = lockedWorld()
    expect(refusal(w.ada('comment', { postId: 'pB', text: 'hi' }))).toBe('Post your quest to see this')
    expect(refusal(w.ada('comment', { postId: 'nope', text: 'hi' }))).toBe('That post is gone')
    expect(w.store.comments()).toEqual([])
  })
})
