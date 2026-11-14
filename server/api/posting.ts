// createUpload, finalizePost (docs/api.md "Posting").
import { newId } from '../../shared/codes'
import { isLate, isRecordedEarlier } from '../../shared/feed'
import type { ApiResults, Assignment, Post } from '../../shared/types'
import type { DriveFile } from '../ports'
import type { Args, Ctx } from './context'
import { chars, clean, GENERIC, num, str, UserError } from './context'
import { postViewer } from './views'

const MB = 1024 * 1024
const LIMITS = {
  photo: { bytes: 15 * MB, refusal: 'Photos can be up to 15 MB', prefix: 'image/' },
  video: { bytes: 100 * MB, refusal: 'Videos can be up to 100 MB', prefix: 'video/' },
} as const
const MAX_CAPTION = 500
const MAX_DURATION_S = 61 // "up to 60 seconds", with a second of slack for rounding

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
}

/** Check 1: the assignment exists and is the caller's. */
function ownAssignment(ctx: Ctx, assignmentId: unknown): { a: Assignment; mine: Assignment[] } {
  const mine = ctx.store.assignments({ memberId: ctx.member.id })
  const a = mine.find((x) => x.id === assignmentId)
  if (!a) throw new UserError("That quest isn't yours")
  return { a, mine }
}

/** Checks 2 and 3: dropped, not yet posted, and the member's next drop hasn't happened. */
function checkPostable(ctx: Ctx, a: Assignment, mine: Assignment[]): void {
  if (a.status === 'scheduled') throw new UserError("That quest hasn't dropped yet")
  if (a.status === 'done') throw new UserError('You already posted this quest')
  if (mine.some((x) => x.id !== a.id && x.dropAt > a.dropAt && x.dropAt <= ctx.now)) {
    throw new UserError('This quest is closed. You have a new one.')
  }
}

export function createUpload(ctx: Ctx, args: Args): ApiResults['createUpload'] {
  const { a, mine } = ownAssignment(ctx, args.assignmentId)
  checkPostable(ctx, a, mine)

  const kind = args.kind
  const mime = str(args.mime).toLowerCase()
  if ((kind !== 'photo' && kind !== 'video') || !mime.startsWith(LIMITS[kind].prefix)) {
    throw new UserError('Only photos and videos can be posted')
  }
  const size = num(args.size)
  if (size === null || size <= 0) throw new UserError(GENERIC) // the client always sends File.size
  if (size > LIMITS[kind].bytes) throw new UserError(LIMITS[kind].refusal)

  const drive = ctx.ports.drive
  const uploadUrl = drive.createUploadSession(`${a.id}-main.${EXT[mime] ?? 'bin'}`, mime, size)
  if (args.hasStill !== true) return { uploadUrl }
  return { uploadUrl, stillUploadUrl: drive.createUploadSession(`${a.id}-still.jpg`, 'image/jpeg', null) }
}

/** An uploaded file of this assignment: exists, sits in the group folder, named `<assignmentId>-…`. */
function uploadedFile(ctx: Ctx, a: Assignment, fileId: string): DriveFile {
  const f = fileId ? ctx.ports.drive.getFile(fileId) : null
  if (!f || !f.parents.includes(ctx.config.folderId) || !f.name.startsWith(a.id + '-')) {
    throw new UserError("That upload wasn't found")
  }
  return f
}

export function finalizePost(ctx: Ctx, args: Args): ApiResults['finalizePost'] {
  const { store, ports, member, config, now } = ctx
  const { a, mine } = ownAssignment(ctx, args.assignmentId)

  // Idempotent: a retry after a lost response gets the same post, with no second share or notification.
  const existing = store.posts().find((p) => p.assignmentId === a.id)
  if (existing) return { post: postViewer(ctx)(existing) }
  checkPostable(ctx, a, mine)

  const fileId = str(args.fileId)
  const main = uploadedFile(ctx, a, fileId)
  const stillFileId = str(args.stillFileId)
  if (stillFileId) uploadedFile(ctx, a, stillFileId)

  const mimeType = main.mimeType.toLowerCase()
  const kind = mimeType.startsWith('image/') ? 'photo' : mimeType.startsWith('video/') ? 'video' : null
  if (!kind) throw new UserError('Only photos and videos can be posted')

  const caption = clean(str(args.caption))
  if (chars(caption) > MAX_CAPTION) throw new UserError('Captions can be up to 500 characters')
  const duration = kind === 'video' ? num(args.durationS) : null
  if (duration !== null && duration > MAX_DURATION_S) throw new UserError('Videos can be up to 60 seconds')
  const capturedAt = num(args.capturedAt)

  ports.drive.shareAnyoneReader(fileId)
  if (stillFileId) ports.drive.shareAnyoneReader(stillFileId)

  const post: Post = {
    id: newId('p'),
    assignmentId: a.id,
    memberId: member.id,
    kind,
    fileId,
    stillFileId, // '' when there is none (the view sends null)
    caption,
    capturedAt,
    createdAt: now,
    late: isLate(now, a),
    recordedEarlier: isRecordedEarlier(capturedAt, a.dropAt),
    expired: false,
    durationS: duration !== null && duration >= 0 ? duration : null,
  }
  store.putPost(post)
  store.putAssignment({ ...a, status: 'done' })
  ports.ntfy.send(config.groupChannel, 'Kvestuj', `${member.name} posted their quest`)
  return { post: postViewer(ctx)(post) }
}
