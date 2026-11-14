// Fakes and fixtures for the API handler tests (MemoryStore + recording Ports).
import { expect } from 'vitest'
import { hashSecret } from '../../shared/codes'
import { awakeDeadline } from '../../shared/deadline'
import type { Rng } from '../../shared/drops'
import { weekKey } from '../../shared/drops'
import { HOUR } from '../../shared/time'
import type { Assignment, Comment, Member, Post, Quest, Reaction, Recap, RerollUse } from '../../shared/types'
import { handle } from '../api'
import { MemoryStore } from '../memoryStore'
import type { DriveFile, Ports } from '../ports'
import { config } from '../storeContract'

export { config }
export const TZ = 'Europe/Prague'
/** Monday 2026-11-16 10:00 Prague (CET). */
export const T0 = Date.UTC(2026, 10, 16, 9, 0)
export const DEADLINE0 = awakeDeadline(T0, TZ) // 22:00 the same day
export const MB = 1024 * 1024
export const RECOVERY = 'KVS-2345-6789'

/** Deterministic rng (mulberry32). */
export function seeded(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type FakePorts = Ports & {
  clock: { t: number }
  sent: { channel: string; title: string; body: string }[]
  shared: string[]
  trashed: string[]
  sessions: { name: string; mime: string; size: number | null }[]
  files: Map<string, DriveFile>
  lockCalls: number
  logs: string[]
}

export function fakePorts(now: number, seed = 7): FakePorts {
  const p: FakePorts = {
    clock: { t: now },
    sent: [],
    shared: [],
    trashed: [],
    sessions: [],
    files: new Map(),
    lockCalls: 0,
    logs: [],
    now: () => p.clock.t,
    rng: seeded(seed),
    drive: {
      createUploadSession(name, mime, size) {
        p.sessions.push({ name, mime, size })
        return `https://upload.test/${name}`
      },
      getFile: (id) => p.files.get(id) ?? null,
      shareAnyoneReader: (id) => void p.shared.push(id),
      trash: (id) => void p.trashed.push(id),
    },
    ntfy: { send: (channel, title, body) => void p.sent.push({ channel, title, body }) },
    lock<T>(fn: () => T): T {
      p.lockCalls++
      return fn()
    },
    log: (m) => void p.logs.push(m),
  }
  return p
}

export const tok = (memberId: string) => `tok-${memberId}`

export const mem = (id: string, name: string, over: Partial<Member> = {}): Member => ({
  id,
  name,
  tz: TZ,
  tokenHash: hashSecret(tok(id)),
  recoveryHash: hashSecret(RECOVERY),
  joinedAt: T0 - 30 * 24 * HOUR,
  questChannel: `kvestuj-q-${id}`,
  ...over,
})

export const quests: Quest[] = [
  { id: 'q1', text: 'QTEXT-one', difficulty: 'easy', enabled: true },
  { id: 'q2', text: 'QTEXT-two', difficulty: 'easy', enabled: true },
  { id: 'q3', text: 'QTEXT-three', difficulty: 'medium', enabled: true },
  { id: 'q4', text: 'QTEXT-four', difficulty: 'medium', enabled: true },
  { id: 'q5', text: 'QTEXT-five', difficulty: 'hard', enabled: true },
  { id: 'q6', text: 'QTEXT-six', difficulty: 'hard', enabled: true },
]

export const asg = (id: string, memberId: string, over: Partial<Assignment> = {}): Assignment => ({
  id,
  memberId,
  questId: 'q1',
  dropAt: T0,
  deadlineAt: DEADLINE0,
  status: 'open',
  remindedAt: null,
  weekKey: weekKey(T0, TZ),
  ...over,
})

export const pst = (id: string, assignmentId: string, memberId: string, over: Partial<Post> = {}): Post => ({
  id,
  assignmentId,
  memberId,
  kind: 'photo',
  fileId: `file-${id}`,
  stillFileId: '',
  caption: `caption ${id}`,
  capturedAt: null,
  createdAt: T0 + HOUR,
  late: false,
  recordedEarlier: false,
  expired: false,
  durationS: null,
  ...over,
})

export const ADA = mem('m1', 'Ada')
export const BO = mem('m2', 'Bo')

type WorldInit = Partial<{
  quests: Quest[]
  members: Member[]
  assignments: Assignment[]
  posts: Post[]
  reactions: Reaction[]
  comments: Comment[]
  rerollUses: RerollUse[]
  recaps: Recap[]
  now: number
}>

export function world(init: WorldInit = {}) {
  const store = new MemoryStore({
    config,
    quests: init.quests ?? quests,
    members: init.members ?? [ADA, BO],
    assignments: init.assignments,
    posts: init.posts,
    reactions: init.reactions,
    comments: init.comments,
    rerollUses: init.rerollUses,
    recaps: init.recaps,
  })
  const ports = fakePorts(init.now ?? T0 + HOUR)
  const anon = (op: string, args: Record<string, unknown> = {}) => handle({ op, ...args }, store, ports)
  const as = (memberId: string) => (op: string, args: Record<string, unknown> = {}) =>
    handle({ op, token: tok(memberId), ...args }, store, ports)
  return { store, ports, anon, as, ada: as('m1'), bo: as('m2') }
}

type Res = ReturnType<typeof handle>

/** The data of a successful response (fails the test otherwise). */
export function data<T = any>(res: Res): T {
  if (!res.ok) expect.fail(`expected ok, got error: ${res.error}`)
  return res.data as T
}

/** The error text of a refused response (fails the test otherwise). */
export function refusal(res: Res): string {
  if (res.ok) expect.fail(`expected a refusal, got ${JSON.stringify(res.data)}`)
  return res.error
}

/** A Drive file the fake getFile returns, placed in the group folder by default. */
export function driveFile(ports: FakePorts, id: string, name: string, mimeType: string, parents = [config.folderId]) {
  ports.files.set(id, { name, mimeType, parents })
}
