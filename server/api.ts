// The request handler: one JSON op in, one JSON response out (docs/api.md).
// Pure over Store + Ports; handlers live in ./api/*.
import { hashSecret } from '../shared/codes'
import type { ApiOp, ApiRequest, ApiResponse } from '../shared/types'
import { join, recover, setTz } from './api/account'
import type { Args, BaseCtx, Ctx } from './api/context'
import { AUTH, GENERIC, UserError } from './api/context'
import { createUpload, finalizePost } from './api/posting'
import { me, reroll } from './api/quest'
import { comment, feed, group, post, react, recap } from './api/social'
import type { Ports } from './ports'
import type { Store } from './store'

export { UserError } from './api/context'

const PUBLIC = new Map<string, (ctx: BaseCtx, args: Args) => unknown>([
  ['join', join],
  ['recover', recover],
])

const AUTHED = new Map<string, (ctx: Ctx, args: Args) => unknown>([
  ['me', me],
  ['feed', feed],
  ['post', post],
  ['reroll', reroll],
  ['createUpload', createUpload],
  ['finalizePost', finalizePost],
  ['react', react],
  ['comment', comment],
  ['group', group],
  ['recap', recap],
  ['setTz', setTz],
])

const MUTATING = new Set<string>([
  'join',
  'recover',
  'reroll',
  'createUpload',
  'finalizePost',
  'react',
  'comment',
  'setTz',
] satisfies ApiOp[])

function authenticate(ctx: BaseCtx, token: unknown): Ctx {
  const hash = typeof token === 'string' && token !== '' ? hashSecret(token) : null
  const member = hash === null ? undefined : ctx.store.members().find((m) => m.tokenHash === hash)
  if (!member) throw new UserError(AUTH, 'auth')
  return { ...ctx, member }
}

function dispatch(req: ApiRequest, store: Store, ports: Ports): unknown {
  const base: BaseCtx = { store, ports, config: store.getConfig(), now: ports.now() }
  const pub = PUBLIC.get(req.op)
  if (pub) return pub(base, req)
  const authed = AUTHED.get(req.op)
  if (authed) return authed(authenticate(base, req.token), req)
  ports.log(`unknown op: ${String(req.op).slice(0, 40)}`)
  throw new UserError(GENERIC)
}

/** Handles one request. Never throws; never returns a stack trace. */
export function handle(req: ApiRequest, store: Store, ports: Ports): ApiResponse {
  try {
    if (!req || typeof req !== 'object' || typeof req.op !== 'string') throw new UserError(GENERIC)
    const run = () => dispatch(req, store, ports)
    // Mutating ops read and write under the script lock, so concurrent requests can't interleave.
    const data = MUTATING.has(req.op) ? ports.lock(run) : run()
    return { ok: true, data }
  } catch (e) {
    if (e instanceof UserError) return e.code ? { ok: false, error: e.message, code: e.code } : { ok: false, error: e.message }
    try {
      ports.log(e instanceof Error ? (e.stack ?? `${e.name}: ${e.message}`) : String(e))
    } catch {
      // logging must never turn a refusal into a crash
    }
    return { ok: false, error: GENERIC }
  }
}
