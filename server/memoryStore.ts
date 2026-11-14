import type { Assignment, Comment, Config, Member, Post, Quest, Reaction, Recap, RerollUse } from '../shared/types'
import type { Store } from './store'

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

function upsert<T>(rows: T[], row: T, same: (a: T) => boolean): void {
  const i = rows.findIndex(same)
  if (i >= 0) rows[i] = copy(row)
  else rows.push(copy(row))
}

type Init = Partial<{
  config: Config
  members: Member[]
  quests: Quest[]
  assignments: Assignment[]
  posts: Post[]
  reactions: Reaction[]
  comments: Comment[]
  rerollUses: RerollUse[]
  recaps: Recap[]
}>

const EMPTY_CONFIG: Config = { groupSecret: '', groupChannel: '', folderId: '', groupTz: '', apiKey: '', appUrl: '' }

/** In-memory Store for tests. Deep-copies on the way in and out. */
export class MemoryStore implements Store {
  private cfg: Config
  private _members: Member[]
  private _quests: Quest[]
  private _assignments: Assignment[]
  private _posts: Post[]
  private _reactions: Reaction[]
  private _comments: Comment[]
  private _rerolls: RerollUse[]
  private _recaps: Recap[]

  constructor(init: Init = {}) {
    this.cfg = copy(init.config ?? EMPTY_CONFIG)
    this._members = copy(init.members ?? [])
    this._quests = copy(init.quests ?? [])
    this._assignments = copy(init.assignments ?? [])
    this._posts = copy(init.posts ?? [])
    this._reactions = copy(init.reactions ?? [])
    this._comments = copy(init.comments ?? [])
    this._rerolls = copy(init.rerollUses ?? [])
    this._recaps = copy(init.recaps ?? [])
  }

  getConfig() {
    return copy(this.cfg)
  }
  putConfig(c: Config) {
    this.cfg = copy(c)
  }
  members() {
    return copy(this._members)
  }
  putMember(m: Member) {
    upsert(this._members, m, (x) => x.id === m.id)
  }
  quests() {
    return copy(this._quests)
  }
  putQuests(q: Quest[]) {
    this._quests = copy(q)
  }
  assignments(f: { memberId?: string; status?: Assignment['status'] } = {}) {
    return copy(this._assignments.filter((a) => (f.memberId === undefined || a.memberId === f.memberId) && (f.status === undefined || a.status === f.status)))
  }
  putAssignment(a: Assignment) {
    upsert(this._assignments, a, (x) => x.id === a.id)
  }
  posts() {
    return copy(this._posts)
  }
  putPost(p: Post) {
    upsert(this._posts, p, (x) => x.id === p.id)
  }
  reactions(postId?: string) {
    return copy(postId === undefined ? this._reactions : this._reactions.filter((r) => r.postId === postId))
  }
  toggleReaction(r: Reaction) {
    const i = this._reactions.findIndex((x) => x.postId === r.postId && x.memberId === r.memberId && x.emoji === r.emoji)
    if (i >= 0) this._reactions.splice(i, 1)
    else this._reactions.push(copy(r))
  }
  comments(postId?: string) {
    return copy(postId === undefined ? this._comments : this._comments.filter((c) => c.postId === postId))
  }
  addComment(c: Comment) {
    upsert(this._comments, c, (x) => x.id === c.id)
  }
  rerollUses() {
    return copy(this._rerolls)
  }
  addRerollUse(u: RerollUse) {
    upsert(this._rerolls, u, (x) => x.memberId === u.memberId && x.weekKey === u.weekKey)
  }
  recaps() {
    return copy(this._recaps)
  }
  putRecap(r: Recap) {
    upsert(this._recaps, r, (x) => x.month === r.month)
  }
}
