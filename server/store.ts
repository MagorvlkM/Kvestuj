import type { Assignment, Comment, Config, Member, Post, Quest, Reaction, Recap, RerollUse } from '../shared/types'

/**
 * Persistence for every record type. Reads return copies (callers may mutate).
 * Upsert keys: id (Member, Quest, Assignment, Post, Comment), memberId+weekKey
 * (RerollUse), month (Recap), postId+memberId+emoji (Reaction).
 */
export interface Store {
  getConfig(): Config
  putConfig(c: Config): void
  members(): Member[]
  putMember(m: Member): void
  quests(): Quest[]
  /** Replaces the whole quest bank. */
  putQuests(q: Quest[]): void
  assignments(f?: { memberId?: string; status?: Assignment['status'] }): Assignment[]
  putAssignment(a: Assignment): void
  posts(): Post[]
  putPost(p: Post): void
  reactions(postId?: string): Reaction[]
  /** Adds the reaction if absent, removes it if present. */
  toggleReaction(r: Reaction): void
  comments(postId?: string): Comment[]
  addComment(c: Comment): void
  rerollUses(): RerollUse[]
  addRerollUse(u: RerollUse): void
  recaps(): Recap[]
  putRecap(r: Recap): void
}
