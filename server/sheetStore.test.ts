import { describe, expect, it } from 'vitest'
import { SheetStore, TABS } from './sheetStore'
import { config, member, post, storeContract } from './storeContract'

type Cell = unknown

/** In-memory Spreadsheet that, like Sheets, parses values written to cells that are not formatted as plain text. */
class FakeSheet {
  data: Cell[][]
  formats: string[][] = []
  reads = 0
  constructor(
    public name: string,
    header: string[],
    private log: string[],
  ) {
    this.data = [header]
  }
  private parse(v: Cell, fmt: string | undefined): Cell {
    if (typeof v !== 'string' || fmt === '@') return v
    if (v.startsWith('=')) return `#FORMULA(${v})`
    if (/^\d{4}-\d{2}$/.test(v)) return new Date(Number(v.slice(0, 4)), Number(v.slice(5)) - 1, 1)
    if (v.toUpperCase() === 'TRUE') return true
    if (v.toUpperCase() === 'FALSE') return false
    if (/^[-+]?\d+(\.\d+)?$/.test(v)) return Number(v)
    return v
  }
  getDataRange() {
    return { getValues: () => (this.reads++, this.data.map((r) => r.slice())) }
  }
  getRange(r: number, c: number, nr: number, nc: number) {
    const at = `${this.name}!r${r}c${c}`
    return {
      setNumberFormat: (f: string) => {
        this.log.push(`fmt ${at} rows=${nr} cols=${nc} ${f}`)
        for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) ((this.formats[r - 1 + i] ??= [])[c - 1 + j] = f)
      },
      setValues: (v: Cell[][]) => {
        this.log.push(`set ${at} rows=${nr} cols=${nc}`)
        for (let i = 0; i < nr; i++) {
          const row = (this.data[r - 1 + i] ??= [])
          for (let j = 0; j < nc; j++) row[c - 1 + j] = this.parse(v[i][j], this.formats[r - 1 + i]?.[c - 1 + j])
        }
      },
      clearContent: () => {
        this.log.push(`clear ${at}`)
        for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (this.data[r - 1 + i]) this.data[r - 1 + i][c - 1 + j] = ''
      },
    }
  }
  deleteRow(n: number) {
    this.data.splice(n - 1, 1)
    this.formats.splice(n - 1, 1)
  }
  clearContents() {
    this.log.push(`clearAll ${this.name}`)
    this.data = []
  }
}

function makeEnv() {
  const log: string[] = []
  const sheets: Record<string, FakeSheet> = {}
  for (const [n, h] of Object.entries(TABS)) sheets[n] = new FakeSheet(n, h, log)
  const ss = { getSheetByName: (n: string) => sheets[n] ?? null } as never
  return { log, sheets, ss, store: () => new SheetStore(ss) }
}

describe('SheetStore (fake spreadsheet)', () => {
  storeContract(() => makeEnv().store())

  it('persists across instances', () => {
    const env = makeEnv()
    env.store().putMember(member('m1', { joinedAt: 5 }))
    expect(env.store().members()).toEqual([member('m1', { joinedAt: 5 })])
  })

  it('reads each tab at most once per instance', () => {
    const env = makeEnv()
    const s = env.store()
    s.members()
    s.members()
    s.putMember(member('x'))
    s.members()
    expect(env.sheets.Members.reads).toBe(1)
  })

  it('sets plain-text formats on string columns before writing values', () => {
    const env = makeEnv()
    env.store().putMember(member('m1'))
    const firstSet = env.log.findIndex((l) => l.startsWith('set Members!'))
    const textCols = env.log.slice(0, firstSet).filter((l) => l.startsWith('fmt Members!') && l.endsWith(' @'))
    // id, name, tz, tokenHash, recoveryHash, questChannel
    expect(textCols).toHaveLength(6)
    expect(env.log.slice(0, firstSet).filter((l) => l.endsWith(' 0'))).toHaveLength(1) // joinedAt
    expect(env.log.slice(0, firstSet).every((l) => l.startsWith('fmt '))).toBe(true)
  })

  it('formats before values on append, update and replaceAll', () => {
    const env = makeEnv()
    const s = env.store()
    s.putRecap({ month: '2026-10', json: '{}' })
    s.putRecap({ month: '2026-10', json: '{"a":1}' })
    s.putQuests([{ id: 'q1', text: 'x', difficulty: 'easy', enabled: true }])
    const lines = env.log
    lines.forEach((l, i) => {
      if (!l.startsWith('set ')) return
      const tab = l.slice(4, l.indexOf('!'))
      const before = lines.slice(0, i).filter((x) => x.startsWith(`fmt ${tab}!`))
      expect(before.length).toBeGreaterThan(0)
      expect(lines[i - 1].startsWith('fmt ')).toBe(true)
    })
  })

  it('config tab is plain text in both columns, formatted before values', () => {
    const env = makeEnv()
    env.store().putConfig({ ...config, groupSecret: '-abc_DEF' })
    const iFmt = env.log.findIndex((l) => l.startsWith('fmt Config!'))
    const iSet = env.log.findIndex((l) => l.startsWith('set Config!'))
    expect(iFmt).toBeGreaterThanOrEqual(0)
    expect(iFmt).toBeLessThan(iSet)
    expect(env.log[iFmt]).toMatch(/cols=2 @$/)
    expect(env.store().getConfig().groupSecret).toBe('-abc_DEF')
  })

  it('stores a formula-looking caption verbatim', () => {
    const env = makeEnv()
    const caption = '=IMPORTDATA("x")'
    env.store().putPost(post('p1', { caption }))
    expect(env.sheets.Posts.data[1]).toContain(caption)
    expect(env.store().posts()[0].caption).toBe(caption)
  })

  it('a recap month round-trips and upserts without duplicates', () => {
    const env = makeEnv()
    const s = env.store()
    s.putRecap({ month: '2026-10', json: '{}' })
    env.store().putRecap({ month: '2026-10', json: '{"a":1}' })
    const out = env.store().recaps()
    expect(out).toEqual([{ month: '2026-10', json: '{"a":1}' }])
    expect(env.sheets.Recaps.data).toHaveLength(2)
  })

  it('digit-like and boolean-like names survive', () => {
    const env = makeEnv()
    for (const [i, name] of ['007', '1/2', 'TRUE', '+5', '2026-10'].entries()) env.store().putMember(member(`m${i}`, { name }))
    expect(env.store().members().map((m) => m.name)).toEqual(['007', '1/2', 'TRUE', '+5', '2026-10'])
  })

  it('coerces hand-typed values in string columns back to strings', () => {
    const env = makeEnv()
    env.sheets.Recaps.data.push([new Date(2026, 9, 1), '{}'])
    env.sheets.Members.data.push(['m1', 12345, 'UTC', 't', 'r', 1, 'q'])
    const s = env.store()
    expect(s.recaps()[0].month).toBe('2026-10')
    expect(s.members()[0].name).toBe('12345')
  })

  it('coerces numbers, dates and strings in number columns; booleans as TRUE/FALSE', () => {
    const env = makeEnv()
    env.sheets.Posts.data.push(['p1', 'a', 'm', 'photo', 'f', '', 'c', '', '1700', 'TRUE', 'FALSE', true, ''])
    env.sheets.Members.data.push(['m2', 'B', 'UTC', 't', 'r', new Date(1000), 'q'])
    const s = env.store()
    expect(s.posts()[0]).toMatchObject({ capturedAt: null, createdAt: 1700, late: true, recordedEarlier: false, expired: true, durationS: null })
    expect(s.members()[0].joinedAt).toBe(1000)
  })

  it('applies the owner-editable quest rules', () => {
    const env = makeEnv()
    env.sheets.Quests.data.push(['', 'Take a selfie', ' Hard ', ''], ['q2', '', 'easy', true], ['q3', 'Walk', 'easy', 'FALSE'])
    const q = env.store().quests()
    expect(q).toHaveLength(2)
    expect(q[0]).toMatchObject({ text: 'Take a selfie', difficulty: 'hard', enabled: true })
    expect(q[0].id).toMatch(/^h[0-9a-f]{10}$/)
    expect(q[1]).toMatchObject({ id: 'q3', enabled: false })
  })

  it('reads reroll rows from a tab without a questId column as questId null', () => {
    const env = makeEnv()
    const old = new FakeSheet('Rerolls', ['memberId', 'weekKey'], env.log)
    old.data.push(['m1', '2026-W46'])
    env.sheets.Rerolls = old
    expect(env.store().rerollUses()).toEqual([{ memberId: 'm1', weekKey: '2026-W46', questId: null }])
  })

  it('ignores unknown columns and preserves them on update', () => {
    const env = makeEnv()
    env.sheets.Reactions.data[0] = ['postId', 'note', 'memberId', 'emoji']
    env.sheets.Reactions.data.push(['p', 'keep me', 'm', '🔥'])
    const s = env.store()
    expect(s.reactions()).toEqual([{ postId: 'p', memberId: 'm', emoji: '🔥' }])
    s.toggleReaction({ postId: 'p2', memberId: 'm', emoji: '😂' })
    expect(env.sheets.Reactions.data[2]).toEqual(['p2', '', 'm', '😂'])
    const pre = env.sheets.Reactions.data[1]
    expect(pre[1]).toBe('keep me')
  })
})
