import type { RecapData } from './recap'

export type Member = {
  id: string
  name: string
  tz: string
  tokenHash: string
  recoveryHash: string
  joinedAt: number
  questChannel: string
}

export type Quest = {
  id: string
  text: string
  difficulty: 'easy' | 'medium' | 'hard'
  enabled: boolean
}

export type Assignment = {
  id: string
  memberId: string
  questId: string | null
  dropAt: number
  deadlineAt: number | null
  status: 'scheduled' | 'open' | 'done' | 'missed'
  remindedAt: number | null
  weekKey: string
}

export type Post = {
  id: string
  assignmentId: string
  memberId: string
  kind: 'photo' | 'video'
  fileId: string
  stillFileId: string
  caption: string
  capturedAt: number | null
  createdAt: number
  late: boolean
  recordedEarlier: boolean
  expired: boolean
  /** Video length in seconds (for the "VIDEO · 0:42" label); null for photos. */
  durationS: number | null
}

export type Reaction = {
  postId: string
  memberId: string
  emoji: string
}

export type Comment = {
  id: string
  postId: string
  memberId: string
  text: string
  createdAt: number
}

export type RerollUse = {
  memberId: string
  weekKey: string
}

export type Recap = {
  /** 'YYYY-MM' */
  month: string
  /** Serialized recap payload. */
  json: string
}

export type Config = {
  groupSecret: string
  groupChannel: string
  folderId: string
  groupTz: string
  apiKey: string
  /** Pages URL of the web app, e.g. https://magorvlkm.github.io/kvestuj/ */
  appUrl: string
}

// ---------------------------------------------------------------------------
// API types (docs/api.md). Shared by the server handlers and the web client.

/** The six reactions, in display order. ❤️ is U+2764 U+FE0F. */
export const EMOJI = ['😂', '🔥', '😮', '❤️', '👏', '💀'] as const
export type Emoji = (typeof EMOJI)[number]

/** A member as other members see them: never tokenHash, recoveryHash or questChannel. */
export type MemberView = Pick<Member, 'id' | 'name' | 'tz' | 'joinedAt'>

export type PostView = {
  id: string
  assignmentId: string
  memberId: string
  kind: Post['kind']
  /** null once a video has expired (trashed). */
  fileId: string | null
  stillFileId: string | null
  caption: string
  createdAt: number
  capturedAt: number | null
  durationS: number | null
  late: boolean
  recordedEarlier: boolean
  expired: boolean
  questText: string
  /** All six keys, 0 when none. */
  reactions: Record<Emoji, number>
  /** The caller's reactions. */
  mine: Emoji[]
  commentCount: number
}

export type CommentView = Pick<Comment, 'id' | 'postId' | 'memberId' | 'text' | 'createdAt'>

export type OpenQuest = {
  assignmentId: string
  questText: string
  difficulty: Quest['difficulty']
  dropAt: number
  deadlineAt: number | null
  rerollAvailable: boolean
}

/** The most recent missed quest, still postable (late). */
export type LateQuest = { assignmentId: string; questText: string; dropAt: number; deadlineAt: number | null }

export type HistoryItem = {
  assignmentId: string
  status: 'done' | 'missed'
  questText: string
  dropAt: number
  deadlineAt: number | null
  post: PostView | null
}

export type FeedItemView =
  | { kind: 'post'; at: number; locked: false; post: PostView }
  /** Redacted: no media, caption, quest or reactions. */
  | { kind: 'post'; at: number; locked: true; postId: string; memberId: string }
  | { kind: 'missed'; at: number; memberId: string; assignmentId: string }
  | { kind: 'recap'; at: number; month: string; totalDone: number }

export type GroupMemberView = MemberView & { hasOpen: boolean; lastPostAt: number | null; lastMissedAt: number | null }

/** Arguments of each op (besides `op` and `token`). */
export type ApiArgs = {
  join: { secret: string; name: string; tz: string; recoveryCode?: string }
  recover: { secret: string; name: string; code: string }
  me: Record<string, never>
  feed: { before?: number }
  post: { postId: string }
  reroll: Record<string, never>
  createUpload: { assignmentId: string; kind: Post['kind']; mime: string; size: number; hasStill: boolean }
  finalizePost: {
    assignmentId: string
    fileId: string
    stillFileId?: string
    caption: string
    capturedAt: number | null
    durationS?: number
  }
  react: { postId: string; emoji: Emoji }
  comment: { postId: string; text: string }
  group: Record<string, never>
  recap: { month: string }
  setTz: { tz: string }
}

/** Result (`data`) of each op. */
export type ApiResults = {
  join: { token: string; recoveryCode: string; member: MemberView; questChannel: string; groupChannel: string }
  recover: { token: string; member: MemberView; questChannel: string; groupChannel: string }
  me: {
    member: MemberView
    questChannel: string
    groupChannel: string
    open: OpenQuest | null
    late: LateQuest | null
    monthDone: number
    history: HistoryItem[]
  }
  feed: { items: FeedItemView[]; members: MemberView[]; nextBefore: number | null }
  post: { post: PostView; comments: CommentView[]; members: MemberView[] }
  reroll: { open: OpenQuest }
  createUpload: { uploadUrl: string; stillUploadUrl?: string }
  finalizePost: { post: PostView }
  react: { reactions: Record<Emoji, number>; mine: Emoji[] }
  comment: { comment: CommentView }
  group: { members: GroupMemberView[] }
  recap: { recap: RecapData; posts: PostView[]; members: MemberView[] }
  setTz: { member: MemberView }
}

export type ApiOp = keyof ApiArgs

export type ApiRequest = { op: string; token?: string; [k: string]: unknown }

export type ApiResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string; code?: 'auth' }
