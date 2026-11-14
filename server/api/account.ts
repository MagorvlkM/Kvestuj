// join, recover, setTz.
import { hashSecret, newChannel, newId, newRecoveryCode, newToken, normalizeRecoveryCode } from '../../shared/codes'
import { planWeek, weekKey } from '../../shared/drops'
import { isValidTimeZone, startOfLocalWeek } from '../../shared/time'
import type { ApiResults, Member } from '../../shared/types'
import type { Args, BaseCtx, Ctx } from './context'
import { chars, str, UserError } from './context'
import { memberView } from './views'

const MAX_MEMBERS = 10
const MAX_NAME = 24

/** NFC, trimmed, inner whitespace collapsed to one space. */
export const normalizeName = (name: string): string => name.normalize('NFC').trim().replace(/\s+/g, ' ')

const sameName = (a: string, b: string) => normalizeName(a).toLowerCase() === normalizeName(b).toLowerCase()

function checkSecret(ctx: BaseCtx, secret: unknown): void {
  if (!ctx.config.groupSecret || secret !== ctx.config.groupSecret) throw new UserError("This invite link isn't valid")
}

function checkTz(tz: unknown): string {
  if (!isValidTimeZone(tz)) throw new UserError('Pick a valid time zone')
  return tz
}

export function join(ctx: BaseCtx, args: Args): ApiResults['join'] {
  const { store, ports, config, now } = ctx
  checkSecret(ctx, args.secret)
  const members = store.members()
  if (members.length >= MAX_MEMBERS) throw new UserError(`The group is full (${MAX_MEMBERS} of ${MAX_MEMBERS})`)
  const name = normalizeName(str(args.name))
  if (chars(name) < 1 || chars(name) > MAX_NAME) throw new UserError('Pick a name of 1 to 24 characters')
  if (members.some((m) => sameName(m.name, name))) throw new UserError('That name is taken')
  const tz = checkTz(args.tz)

  let recoveryCode: string
  if (args.recoveryCode === undefined || args.recoveryCode === null || args.recoveryCode === '') {
    recoveryCode = newRecoveryCode()
  } else {
    const canonical = normalizeRecoveryCode(str(args.recoveryCode))
    if (canonical === null) throw new UserError("That recovery code isn't valid")
    recoveryCode = canonical
  }

  const token = newToken()
  const member: Member = {
    id: newId('m'),
    name,
    tz,
    tokenHash: hashSecret(token),
    recoveryHash: hashSecret(recoveryCode),
    joinedAt: now,
    questChannel: newChannel(),
  }
  store.putMember(member)

  // The rest of the current week; later weeks are planned by the weekly tick.
  for (const dropAt of planWeek(startOfLocalWeek(now, tz), tz, now, ports.rng)) {
    store.putAssignment({
      id: newId('a'),
      memberId: member.id,
      questId: null,
      dropAt,
      deadlineAt: null,
      status: 'scheduled',
      remindedAt: null,
      weekKey: weekKey(dropAt, tz),
    })
  }

  return { token, recoveryCode, member: memberView(member), questChannel: member.questChannel, groupChannel: config.groupChannel }
}

export function recover(ctx: BaseCtx, args: Args): ApiResults['recover'] {
  const { store, config } = ctx
  checkSecret(ctx, args.secret)
  const mismatch = new UserError("Name or recovery code doesn't match")
  const member = store.members().find((m) => sameName(m.name, str(args.name)))
  const code = normalizeRecoveryCode(str(args.code))
  if (!member || code === null || hashSecret(code) !== member.recoveryHash) throw mismatch

  const token = newToken()
  const updated = { ...member, tokenHash: hashSecret(token) } // the old token stops working
  store.putMember(updated)
  return { token, member: memberView(updated), questChannel: updated.questChannel, groupChannel: config.groupChannel }
}

/** Only the member's zone changes: planned drops keep their dropAt and weekKey (future weeks use the new zone). */
export function setTz(ctx: Ctx, args: Args): ApiResults['setTz'] {
  const tz = checkTz(args.tz)
  const updated = { ...ctx.member, tz }
  ctx.store.putMember(updated)
  return { member: memberView(updated) }
}
