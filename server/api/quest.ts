// me, reroll.
import { canReroll, pickQuest, seenQuestIds } from '../../shared/quests'
import { monthBounds } from '../../shared/recap'
import { localParts } from '../../shared/time'
import type { ApiResults, Assignment, HistoryItem, OpenQuest } from '../../shared/types'
import type { Ctx } from './context'
import { newestFirst, UserError } from './context'
import { memberView, openAssignment, postViewer, questTextOf } from './views'

function openQuest(ctx: Ctx, a: Assignment): OpenQuest {
  const quest = ctx.store.quests().find((q) => q.id === a.questId)
  return {
    assignmentId: a.id,
    questText: quest?.text ?? '',
    difficulty: quest?.difficulty ?? 'easy',
    dropAt: a.dropAt,
    deadlineAt: a.deadlineAt,
    rerollAvailable: canReroll(ctx.member.id, a.weekKey, ctx.store.rerollUses(), a, ctx.now),
  }
}

export function me(ctx: Ctx): ApiResults['me'] {
  const { store, member, now, config } = ctx
  const mine = store.assignments({ memberId: member.id })
  const quests = store.quests()
  const posts = store.posts()
  const view = postViewer(ctx)

  const open = openAssignment(mine)
  const lastDropped = mine.filter((a) => a.status !== 'scheduled').sort(newestFirst((a) => a.dropAt))[0]
  const late =
    lastDropped?.status === 'missed'
      ? { assignmentId: lastDropped.id, questText: questTextOf(quests, lastDropped.questId), dropAt: lastDropped.dropAt, deadlineAt: lastDropped.deadlineAt }
      : null

  const p = localParts(now, member.tz)
  const month = monthBounds(`${p.y}-${String(p.m).padStart(2, '0')}`, member.tz)
  const monthDone = posts.filter((x) => x.memberId === member.id && x.createdAt >= month.start && x.createdAt < month.end).length

  const history: HistoryItem[] = mine
    .filter((a): a is Assignment & { status: 'done' | 'missed' } => a.status === 'done' || a.status === 'missed')
    .sort(newestFirst((a) => a.dropAt))
    .map((a) => {
      const post = posts.find((x) => x.assignmentId === a.id)
      return {
        assignmentId: a.id,
        status: a.status,
        questText: questTextOf(quests, a.questId),
        dropAt: a.dropAt,
        deadlineAt: a.deadlineAt,
        post: post ? view(post) : null,
      }
    })

  return {
    member: memberView(member),
    questChannel: member.questChannel,
    groupChannel: config.groupChannel,
    open: open ? openQuest(ctx, open) : null,
    late,
    monthDone,
    history,
  }
}

export function reroll(ctx: Ctx): ApiResults['reroll'] {
  const { store, member, now, ports } = ctx
  const mine = store.assignments({ memberId: member.id })
  const a = openAssignment(mine)
  // An open quest past its deadline (the tick has not marked it missed yet) is not rerollable either.
  if (!a || (a.deadlineAt !== null && now >= a.deadlineAt)) throw new UserError('You have no open quest to reroll')
  const uses = store.rerollUses()
  if (!canReroll(member.id, a.weekKey, uses, a, now)) throw new UserError("You've used this week's reroll")

  const seen = seenQuestIds(member.id, mine, uses)
  const quest = pickQuest(store.quests(), seen, ports.rng, a.questId ?? undefined)
  const updated = { ...a, questId: quest.id } // dropAt and deadlineAt stay
  store.putAssignment(updated)
  // Remember the quest rerolled away: the assignment no longer carries it, but it has been seen.
  store.addRerollUse({ memberId: member.id, weekKey: a.weekKey, questId: a.questId })
  return { open: openQuest(ctx, updated) }
}
