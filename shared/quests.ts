import type { Rng } from './drops'
import type { Assignment, Quest, RerollUse } from './types'

type Difficulty = Quest['difficulty']

export const DIFFICULTY_WEIGHTS = { easy: 0.45, medium: 0.4, hard: 0.15 } as const

const idx = (r: number, n: number) => Math.min(n - 1, Math.floor(r * n))

/**
 * Picks a quest. Unseen enabled quests first; when all are seen, a new cycle
 * starts over all enabled quests, excluding `avoid` unless it is the only one.
 * Always consumes exactly two rng() calls.
 */
export function pickQuest(bank: Quest[], seen: Set<string>, rng: Rng, avoid?: string): Quest {
  const enabled = bank.filter((q) => q.enabled)
  if (enabled.length === 0) throw new Error('No enabled quests')
  let pool = enabled.filter((q) => !seen.has(q.id))
  if (pool.length === 0) {
    pool = enabled.filter((q) => q.id !== avoid)
    if (pool.length === 0) pool = enabled
  }
  const r = rng()
  const d: Difficulty =
    r < DIFFICULTY_WEIGHTS.easy ? 'easy' : r < DIFFICULTY_WEIGHTS.easy + DIFFICULTY_WEIGHTS.medium ? 'medium' : 'hard'
  const ofDiff = pool.filter((q) => q.difficulty === d)
  const from = ofDiff.length > 0 ? ofDiff : pool
  return from[idx(rng(), from.length)]
}

/**
 * One free reroll per week. `weekKey` must be the ASSIGNMENT's weekKey
 * (the reroll belongs to the quest's week), not the current calendar week.
 */
export function canReroll(memberId: string, weekKey: string, uses: RerollUse[], a: Assignment, now: number): boolean {
  return (
    a.memberId === memberId &&
    a.status === 'open' &&
    a.deadlineAt !== null &&
    now < a.deadlineAt &&
    !uses.some((u) => u.memberId === memberId && u.weekKey === weekKey)
  )
}

function parseRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let touched = false
  const endRow = () => {
    row.push(field)
    if (!(row.length === 1 && row[0].trim() === '' && !touched)) rows.push(row)
    row = []
    field = ''
    touched = false
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') {
      quoted = true
      touched = true
    } else if (c === ',') {
      row.push(field)
      field = ''
      touched = true
    } else if (c === '\r') {
      if (text[i + 1] === '\n') i++
      endRow()
    } else if (c === '\n') endRow()
    else {
      field += c
      if (c.trim() !== '') touched = true
    }
  }
  if (quoted) throw new Error('row ' + rows.length + ': unterminated quote')
  if (field !== '' || row.length > 0) endRow()
  return rows
}

export function parseQuestCsv(text: string): Omit<Quest, 'id' | 'enabled'>[] {
  const rows = parseRows(text.replace(/^﻿/, ''))
  const header = rows[0]?.map((h) => h.trim().toLowerCase())
  if (!header || header.length !== 2 || header[0] !== 'text' || header[1] !== 'difficulty') {
    throw new Error('row 0: header must be "text,difficulty"')
  }
  return rows.slice(1).map((r, i) => {
    const n = i + 1
    const t = (r[0] ?? '').trim()
    const d = (r[1] ?? '').trim().toLowerCase()
    if (!t) throw new Error(`row ${n}: text is empty`)
    if (d !== 'easy' && d !== 'medium' && d !== 'hard') {
      throw new Error(`row ${n}: difficulty must be easy|medium|hard, got "${r[1] ?? ''}"`)
    }
    return { text: t, difficulty: d }
  })
}
