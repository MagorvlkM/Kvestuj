import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import type { Rng } from './drops'
import { canReroll, DIFFICULTY_WEIGHTS, parseQuestCsv, pickQuest } from './quests'
import type { Assignment, Quest } from './types'

// mulberry32: small seeded PRNG in [0,1)
function seeded(s: number): Rng {
  let a = s >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const bank: Quest[] = parseQuestCsv(readFileSync('data/kvestuj-quests.csv', 'utf8')).map((q, i) => ({
  ...q,
  id: 'q' + String(i + 1).padStart(3, '0'),
  enabled: true,
}))

function count20k(b: Quest[]) {
  const c = { easy: 0, medium: 0, hard: 0 }
  for (let i = 0; i < 20000; i++) c[pickQuest(b, new Set(), seeded(i)).difficulty]++
  return c
}

const openA: Assignment = {
  id: 'a1',
  memberId: 'm1',
  questId: 'q001',
  dropAt: 1_000_000,
  deadlineAt: 2_000_000,
  status: 'open',
  remindedAt: null,
  weekKey: '2026-W47',
}
const now = 1_500_000

describe('pickQuest', () => {
  test('weights are fixed', () => expect(DIFFICULTY_WEIGHTS).toEqual({ easy: 0.45, medium: 0.4, hard: 0.15 }))
  test('never repeats until bank exhausted', () => {
    const seen = new Set<string>()
    for (let i = 0; i < bank.length; i++) {
      const q = pickQuest(bank, seen, seeded(i))
      expect(seen.has(q.id)).toBe(false)
      seen.add(q.id)
    }
  })
  test('weights within ±2pp over 20k on full bank', () => {
    const c = count20k(bank)
    expect(c.easy / 20000).toBeCloseTo(0.45, 1)
    expect(c.medium / 20000).toBeCloseTo(0.4, 1)
    expect(c.hard / 20000).toBeCloseTo(0.15, 1)
    expect(Math.abs(c.easy / 20000 - 0.45)).toBeLessThan(0.02)
    expect(Math.abs(c.medium / 20000 - 0.4)).toBeLessThan(0.02)
    expect(Math.abs(c.hard / 20000 - 0.15)).toBeLessThan(0.02)
  })
  test('disabled never picked', () => {
    const b = bank.map((q, i) => ({ ...q, enabled: i % 2 === 0 }))
    for (let i = 0; i < 500; i++) expect(pickQuest(b, new Set(), seeded(i)).enabled).toBe(true)
  })
  test('new cycle never returns avoid when others exist', () => {
    const seen = new Set(bank.map((q) => q.id))
    for (let i = 0; i < 500; i++) expect(pickQuest(bank, seen, seeded(i), 'q007').id).not.toBe('q007')
  })
  test('new cycle with single enabled quest returns it even if avoided', () => {
    const b = bank.map((q, i) => ({ ...q, enabled: i === 3 }))
    expect(pickQuest(b, new Set([b[3].id]), seeded(1), b[3].id).id).toBe(b[3].id)
  })
  test('throws with zero enabled quests', () => {
    const b = bank.map((q) => ({ ...q, enabled: false }))
    expect(() => pickQuest(b, new Set(), seeded(1))).toThrow('No enabled quests')
  })
})

describe('canReroll', () => {
  test('happy path', () => expect(canReroll('m1', '2026-W47', [], openA, now)).toBe(true))
  test('reroll once per week', () => {
    expect(canReroll('m1', '2026-W47', [{ memberId: 'm1', weekKey: '2026-W47' }], openA, now)).toBe(false)
  })
  test('use in another week does not block', () => {
    expect(canReroll('m1', '2026-W47', [{ memberId: 'm1', weekKey: '2026-W46' }], openA, now)).toBe(true)
  })
  test('reroll refused after deadline', () => expect(canReroll('m1', '2026-W47', [], openA, openA.deadlineAt! + 1)).toBe(false))
  test('refused for another member', () => expect(canReroll('m2', '2026-W47', [], openA, now)).toBe(false))
  test('refused when done', () => expect(canReroll('m1', '2026-W47', [], { ...openA, status: 'done' }, now)).toBe(false))
})

describe('parseQuestCsv', () => {
  test('parses real bank', () => expect(parseQuestCsv(readFileSync('data/kvestuj-quests.csv', 'utf8'))).toHaveLength(200))
  test('real bank split 90/80/30 and keeps quotes', () => {
    const rows = parseQuestCsv(readFileSync('data/kvestuj-quests.csv', 'utf8'))
    const n = (d: string) => rows.filter((r) => r.difficulty === d).length
    expect([n('easy'), n('medium'), n('hard')]).toEqual([90, 80, 30])
    expect(rows.some((r) => r.text.includes('"have a nice day"'))).toBe(true)
  })
  test('quoted comma, escaped quotes, CRLF, BOM, blank lines', () => {
    const csv = '﻿text,difficulty\r\n"Say ""hi"", loudly",Easy\r\n\r\nPlain text, hard\r\n"multi\nline",MEDIUM\r\n'
    expect(parseQuestCsv(csv)).toEqual([
      { text: 'Say "hi", loudly', difficulty: 'easy' },
      { text: 'Plain text', difficulty: 'hard' },
      { text: 'multi\nline', difficulty: 'medium' },
    ])
  })
  test('bad difficulty', () => {
    expect(() => parseQuestCsv('text,difficulty\na,easy\nb,extreme\n')).toThrow(/^row 2: .*extreme/)
  })
  test('bad header', () => {
    expect(() => parseQuestCsv('foo,bar\na,easy\n')).toThrow('row 0: header must be "text,difficulty"')
  })
  test('empty text', () => {
    expect(() => parseQuestCsv('text,difficulty\n  ,easy\n')).toThrow(/^row 1: /)
  })
})
