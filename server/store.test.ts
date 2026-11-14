import { describe, expect, it } from 'vitest'
import type { Assignment, Comment, Config, Member, Post, Quest, Recap, Reaction, RerollUse } from '../shared/types'
import { MemoryStore } from './memoryStore'
import type { Store } from './store'

const config: Config = {
  groupSecret: 's3cret',
  groupChannel: 'kvestuj-abcdefghijkl',
  folderId: 'folder1',
  groupTz: 'Europe/Prague',
  apiKey: 'key',
  appUrl: 'https://example.github.io/kvestuj/',
}
const member = (id: string, over: Partial<Member> = {}): Member => ({
  id,
  name: `Name ${id}`,
  tz: 'Europe/Prague',
  tokenHash: `th_${id}`,
  recoveryHash: `rh_${id}`,
  joinedAt: 1_700_000_000_000,
  questChannel: `kvestuj-${id}`,
  ...over,
})
const quest = (id: string, over: Partial<Quest> = {}): Quest => ({ id, text: `Quest ${id}`, difficulty: 'easy', enabled: true, ...over })
const assignment = (id: string, over: Partial<Assignment> = {}): Assignment => ({
  id,
  memberId: 'm1',
  questId: 'q1',
  dropAt: 1_700_000_000_000,
  deadlineAt: 1_700_043_200_000,
  status: 'open',
  remindedAt: null,
  weekKey: '2026-W46',
  ...over,
})
const post = (id: string, over: Partial<Post> = {}): Post => ({
  id,
  assignmentId: 'a1',
  memberId: 'm1',
  kind: 'photo',
  fileId: 'f1',
  stillFileId: '',
  caption: 'hi',
  capturedAt: null,
  createdAt: 1_700_000_100_000,
  late: false,
  recordedEarlier: false,
  expired: false,
  durationS: null,
  ...over,
})
const reaction = (postId: string, memberId: string, emoji: string): Reaction => ({ postId, memberId, emoji })
const comment = (id: string, postId: string, over: Partial<Comment> = {}): Comment => ({
  id,
  postId,
  memberId: 'm1',
  text: 'nice',
  createdAt: 1_700_000_200_000,
  ...over,
})

export function storeContract(make: () => Store): void {
  describe('config', () => {
    it('round-trips', () => {
      const s = make()
      s.putConfig(config)
      expect(s.getConfig()).toEqual(config)
    })
  })

  describe('members', () => {
    it('round-trips and upserts by id', () => {
      const s = make()
      expect(s.members()).toEqual([])
      s.putMember(member('m1'))
      s.putMember(member('m2'))
      s.putMember(member('m1', { name: 'Renamed', tokenHash: 'new' }))
      expect(s.members()).toHaveLength(2)
      expect(s.members().find((m) => m.id === 'm1')).toEqual(member('m1', { name: 'Renamed', tokenHash: 'new' }))
    })
    it('returns copies', () => {
      const s = make()
      s.putMember(member('m1'))
      const out = s.members()
      out[0].name = 'mutated'
      out.push(member('m9'))
      expect(s.members()).toEqual([member('m1')])
    })
  })

  describe('quests', () => {
    it('putQuests replaces the whole bank', () => {
      const s = make()
      s.putQuests([quest('q1'), quest('q2', { difficulty: 'hard', enabled: false })])
      expect(s.quests()).toEqual([quest('q1'), quest('q2', { difficulty: 'hard', enabled: false })])
      s.putQuests([quest('q3')])
      expect(s.quests()).toEqual([quest('q3')])
    })
    it('returns copies', () => {
      const s = make()
      s.putQuests([quest('q1')])
      s.quests()[0].text = 'mutated'
      expect(s.quests()).toEqual([quest('q1')])
    })
  })

  describe('assignments', () => {
    it('round-trips with null fields and upserts by id', () => {
      const s = make()
      s.putAssignment(assignment('a1', { questId: null, deadlineAt: null }))
      s.putAssignment(assignment('a2'))
      s.putAssignment(assignment('a1', { questId: 'q9', status: 'done', remindedAt: 5 }))
      expect(s.assignments()).toHaveLength(2)
      expect(s.assignments().find((a) => a.id === 'a1')).toEqual(assignment('a1', { questId: 'q9', status: 'done', remindedAt: 5 }))
      const nulls = make()
      nulls.putAssignment(assignment('a1', { questId: null, deadlineAt: null }))
      expect(nulls.assignments()[0]).toEqual(assignment('a1', { questId: null, deadlineAt: null }))
    })
    it('filters by member and status', () => {
      const s = make()
      s.putAssignment(assignment('a1', { memberId: 'm1', status: 'open' }))
      s.putAssignment(assignment('a2', { memberId: 'm1', status: 'done' }))
      s.putAssignment(assignment('a3', { memberId: 'm2', status: 'open' }))
      const ids = (xs: Assignment[]) => xs.map((a) => a.id).sort()
      expect(ids(s.assignments({ memberId: 'm1' }))).toEqual(['a1', 'a2'])
      expect(ids(s.assignments({ status: 'open' }))).toEqual(['a1', 'a3'])
      expect(ids(s.assignments({ memberId: 'm1', status: 'open' }))).toEqual(['a1'])
      expect(s.assignments({ memberId: 'nobody' })).toEqual([])
      expect(ids(s.assignments({}))).toEqual(['a1', 'a2', 'a3'])
    })
    it('returns copies', () => {
      const s = make()
      s.putAssignment(assignment('a1'))
      s.assignments()[0].status = 'missed'
      expect(s.assignments()[0].status).toBe('open')
    })
  })

  describe('posts', () => {
    it('round-trips every field and upserts by id', () => {
      const s = make()
      const video = post('p1', { kind: 'video', stillFileId: 'st', capturedAt: 1_699_999_999_000, late: true, recordedEarlier: true, expired: true, durationS: 42 })
      s.putPost(video)
      s.putPost(post('p2'))
      expect(s.posts().find((p) => p.id === 'p1')).toEqual(video)
      s.putPost({ ...video, expired: false, caption: 'edited' })
      expect(s.posts()).toHaveLength(2)
      expect(s.posts().find((p) => p.id === 'p1')?.caption).toBe('edited')
    })
    it('returns copies', () => {
      const s = make()
      s.putPost(post('p1'))
      s.posts()[0].caption = 'mutated'
      expect(s.posts()[0].caption).toBe('hi')
    })
  })

  describe('reactions', () => {
    it('toggleReaction adds then removes', () => {
      const s = make()
      s.toggleReaction(reaction('p1', 'm1', '🔥'))
      expect(s.reactions()).toEqual([reaction('p1', 'm1', '🔥')])
      s.toggleReaction(reaction('p1', 'm1', '🔥'))
      expect(s.reactions()).toEqual([])
    })
    it('keys on post+member+emoji and filters by post', () => {
      const s = make()
      s.toggleReaction(reaction('p1', 'm1', '🔥'))
      s.toggleReaction(reaction('p1', 'm1', '😂'))
      s.toggleReaction(reaction('p1', 'm2', '🔥'))
      s.toggleReaction(reaction('p2', 'm1', '🔥'))
      expect(s.reactions()).toHaveLength(4)
      expect(s.reactions('p1')).toHaveLength(3)
      s.toggleReaction(reaction('p1', 'm1', '🔥'))
      expect(s.reactions('p1')).toEqual([reaction('p1', 'm1', '😂'), reaction('p1', 'm2', '🔥')])
      expect(s.reactions('p2')).toEqual([reaction('p2', 'm1', '🔥')])
      expect(s.reactions('nope')).toEqual([])
    })
    it('survives removing a row in the middle', () => {
      const s = make()
      const rs = [reaction('p1', 'm1', '🔥'), reaction('p1', 'm2', '🔥'), reaction('p1', 'm3', '🔥')]
      rs.forEach((r) => s.toggleReaction(r))
      s.toggleReaction(rs[1])
      s.toggleReaction(reaction('p1', 'm4', '🔥'))
      s.toggleReaction(rs[2])
      expect(s.reactions()).toEqual([rs[0], reaction('p1', 'm4', '🔥')])
    })
  })

  describe('comments', () => {
    it('adds and filters by post', () => {
      const s = make()
      s.addComment(comment('c1', 'p1'))
      s.addComment(comment('c2', 'p2'))
      s.addComment(comment('c3', 'p1', { text: 'second' }))
      expect(s.comments()).toHaveLength(3)
      expect(s.comments('p1').map((c) => c.id)).toEqual(['c1', 'c3'])
      expect(s.comments('p2')).toEqual([comment('c2', 'p2')])
      expect(s.comments('none')).toEqual([])
    })
    it('upserts by id and returns copies', () => {
      const s = make()
      s.addComment(comment('c1', 'p1'))
      s.addComment(comment('c1', 'p1', { text: 'edited' }))
      expect(s.comments()).toHaveLength(1)
      expect(s.comments()[0].text).toBe('edited')
      s.comments()[0].text = 'mutated'
      expect(s.comments()[0].text).toBe('edited')
    })
  })

  describe('reroll uses', () => {
    it('upserts by member+week', () => {
      const s = make()
      const u1: RerollUse = { memberId: 'm1', weekKey: '2026-W46' }
      s.addRerollUse(u1)
      s.addRerollUse({ ...u1 })
      s.addRerollUse({ memberId: 'm1', weekKey: '2026-W47' })
      s.addRerollUse({ memberId: 'm2', weekKey: '2026-W46' })
      expect(s.rerollUses()).toHaveLength(3)
      expect(s.rerollUses()).toContainEqual(u1)
    })
  })

  describe('recaps', () => {
    it('round-trips and upserts by month', () => {
      const s = make()
      const r: Recap = { month: '2026-10', json: '{"totalDone":3}' }
      s.putRecap(r)
      s.putRecap({ month: '2026-09', json: '{}' })
      s.putRecap({ month: '2026-10', json: '{"totalDone":4}' })
      expect(s.recaps()).toHaveLength(2)
      expect(s.recaps().find((x) => x.month === '2026-10')?.json).toBe('{"totalDone":4}')
    })
  })
}

describe('MemoryStore', () => {
  storeContract(() => new MemoryStore())

  it('seeds from init without aliasing the inputs', () => {
    const m = member('m1')
    const s = new MemoryStore({ config, members: [m], posts: [post('p1')] })
    m.name = 'mutated after'
    expect(s.getConfig()).toEqual(config)
    expect(s.members()[0].name).toBe('Name m1')
    expect(s.posts()).toHaveLength(1)
  })

  it('does not alias records passed to put*', () => {
    const s = new MemoryStore()
    const m = member('m1')
    s.putMember(m)
    m.name = 'mutated after'
    expect(s.members()[0].name).toBe('Name m1')
  })

  it('getConfig returns a copy', () => {
    const s = new MemoryStore({ config })
    s.getConfig().apiKey = 'mutated'
    expect(s.getConfig().apiKey).toBe('key')
  })
})
