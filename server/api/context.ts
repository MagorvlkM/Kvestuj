import type { Config, Member } from '../../shared/types'
import type { Ports } from '../ports'
import type { Store } from '../store'

export const GENERIC = 'Something went wrong. Please try again.'
export const AUTH = 'Please rejoin with your recovery code'

/** A refusal shown to the user as-is (exact docs/api.md text). */
export class UserError extends Error {
  constructor(
    message: string,
    readonly code?: 'auth',
  ) {
    super(message)
    this.name = 'UserError'
  }
}

/** Request arguments as sent by the client: untrusted, untyped. */
export type Args = Record<string, unknown>

export type BaseCtx = { store: Store; ports: Ports; config: Config; now: number }
export type Ctx = BaseCtx & { member: Member }

/** The string argument, or '' for anything else. */
export const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The finite number argument, or null for anything else. */
export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** NFC-normalised and trimmed. */
export const clean = (s: string): string => s.normalize('NFC').trim()

/** Length in code points (an emoji counts once). */
export const chars = (s: string): number => [...s].length

/** Latest-first comparator on a numeric key. */
export const newestFirst =
  <T>(key: (x: T) => number) =>
  (a: T, b: T) =>
    key(b) - key(a)
