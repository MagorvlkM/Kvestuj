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
