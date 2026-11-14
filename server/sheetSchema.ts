import { hashSecret } from '../shared/codes'
import type { Assignment, Comment, Config, Member, Post, Quest, Reaction, Recap, RerollUse } from '../shared/types'

/** s = string, sn = nullable string, n = number (epoch ms etc.), nn = nullable number, b = boolean. */
export type Kind = 's' | 'sn' | 'n' | 'nn' | 'b'
/** Exhaustive over the record's fields, so adding a field to a type fails typecheck until it is listed here. */
type Spec<T> = Record<keyof T & string, Kind>

export const SPECS = {
  Config: { groupSecret: 's', groupChannel: 's', folderId: 's', groupTz: 's', apiKey: 's', appUrl: 's' } satisfies Spec<Config>,
  Members: { id: 's', name: 's', tz: 's', tokenHash: 's', recoveryHash: 's', joinedAt: 'n', questChannel: 's' } satisfies Spec<Member>,
  Quests: { id: 's', text: 's', difficulty: 's', enabled: 'b' } satisfies Spec<Quest>,
  Assignments: { id: 's', memberId: 's', questId: 'sn', dropAt: 'n', deadlineAt: 'nn', status: 's', remindedAt: 'nn', weekKey: 's' } satisfies Spec<Assignment>,
  Posts: {
    id: 's', assignmentId: 's', memberId: 's', kind: 's', fileId: 's', stillFileId: 's', caption: 's',
    capturedAt: 'nn', createdAt: 'n', late: 'b', recordedEarlier: 'b', expired: 'b', durationS: 'nn',
  } satisfies Spec<Post>,
  Reactions: { postId: 's', memberId: 's', emoji: 's' } satisfies Spec<Reaction>,
  Comments: { id: 's', postId: 's', memberId: 's', text: 's', createdAt: 'n' } satisfies Spec<Comment>,
  Rerolls: { memberId: 's', weekKey: 's' } satisfies Spec<RerollUse>,
  Recaps: { month: 's', json: 's' } satisfies Spec<Recap>,
}
export type TabName = keyof typeof SPECS

/** Tab names and their header columns, in order. Config is a two-column key/value tab. */
export const TABS: Record<TabName, string[]> = {
  Config: ['key', 'value'],
  Members: Object.keys(SPECS.Members),
  Quests: Object.keys(SPECS.Quests),
  Assignments: Object.keys(SPECS.Assignments),
  Posts: Object.keys(SPECS.Posts),
  Reactions: Object.keys(SPECS.Reactions),
  Comments: Object.keys(SPECS.Comments),
  Rerolls: Object.keys(SPECS.Rerolls),
  Recaps: Object.keys(SPECS.Recaps),
}

export const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)
const blank = (v: unknown) => v === undefined || v === null || v === ''

function toNum(v: unknown): number | null {
  if (blank(v)) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime()
  const s = String(v).trim()
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : t
}

function toBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  const s = String(v ?? '').trim().toUpperCase()
  return s === 'TRUE' ? true : s === 'FALSE' ? false : null
}

/** Number format applied before writing, so Sheets stores strings verbatim ('@') and numbers as numbers. Booleans keep the default. */
export function formatFor(kind: Kind): string | null {
  return kind === 's' || kind === 'sn' ? '@' : kind === 'n' || kind === 'nn' ? '0' : null
}

/** A string-kind cell that Sheets parsed anyway (hand-typed): Date in `month` -> 'YYYY-MM' (the Date's own Y/M), else String(value). */
function toStr(v: unknown, field: string): string {
  if (v instanceof Date && field === 'month' && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}`
  }
  return String(v)
}

export function decodeValue(kind: Kind, v: unknown, field = ''): string | number | boolean | null {
  switch (kind) {
    case 's': return blank(v) ? '' : toStr(v, field)
    case 'sn': return blank(v) ? null : toStr(v, field)
    case 'n': return toNum(v) ?? 0
    case 'nn': return toNum(v)
    case 'b': return toBool(v) ?? false
  }
}

export function encodeValue(v: unknown): string | number | boolean {
  return v === null || v === undefined ? '' : (v as string | number | boolean)
}

/** Decodes a header-keyed row by `spec`. Unknown columns are ignored, missing ones read as empty. Fully blank rows give null. */
export function decodeRecord<T>(spec: Record<string, Kind>, obj: Record<string, unknown>): T | null {
  if (Object.values(obj).every(blank)) return null
  const out: Record<string, unknown> = {}
  for (const [field, kind] of Object.entries(spec)) out[field] = decodeValue(kind, hasOwn(obj, field) ? obj[field] : undefined, field)
  return out as T
}

/** Owner-editable bank: skip rows without text, derive a stable id, default enabled to true, tidy difficulty. */
export function decodeQuest(obj: Record<string, unknown>): Quest | null {
  const text = blank(obj.text) ? '' : String(obj.text).trim()
  if (!text) return null
  const diff = String(obj.difficulty ?? '').trim().toLowerCase()
  return {
    id: blank(obj.id) ? 'h' + hashSecret(text).slice(0, 10) : String(obj.id),
    text,
    difficulty: diff === 'easy' || diff === 'hard' ? diff : 'medium',
    enabled: toBool(obj.enabled) ?? true,
  }
}
