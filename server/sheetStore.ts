/// <reference types="google-apps-script" />
import type { Assignment, Comment, Config, Member, Post, Quest, Reaction, Recap, RerollUse } from '../shared/types'
import { SPECS, TABS, decodeQuest, decodeRecord, decodeValue, encodeValue, type Kind, type TabName } from './sheetSchema'
import type { Store } from './store'

export { TABS }

type Sheet = GoogleAppsScript.Spreadsheet.Sheet
type Obj = Record<string, unknown>

/** One tab, read at most once. recs[i] / raw[i] mirror sheet row i + 2; a null rec is a blank or skipped row. */
class Table<T extends object> {
  private header: string[] = []
  private raw: unknown[][] = []
  private recs: (T | null)[] = []
  private loaded = false

  constructor(
    private sheet: Sheet,
    private spec: Record<string, Kind>,
    private decode: (o: Obj) => T | null = (o) => decodeRecord<T>(spec, o),
  ) {}

  private load() {
    if (this.loaded) return
    this.loaded = true
    const values = this.sheet.getDataRange().getValues()
    this.header = (values[0] ?? []).map((h) => String(h).trim())
    this.raw = values.slice(1)
    this.recs = this.raw.map((row) => this.decode(this.toObj(row)))
  }

  private toObj(row: unknown[]): Obj {
    const o: Obj = {}
    this.header.forEach((h, j) => (o[h] = row[j]))
    return o
  }

  /** Existing row (so unknown columns survive) overlaid with the record's fields. */
  private encode(rec: T, base?: unknown[]): unknown[] {
    const row = base ? base.slice() : this.header.map(() => '')
    this.header.forEach((h, j) => {
      if (h in this.spec) row[j] = encodeValue((rec as Obj)[h])
    })
    return row
  }

  all(): T[] {
    this.load()
    return this.recs.filter((r): r is T => r !== null).map((r) => ({ ...r }))
  }

  upsert(rec: T, same: (r: T) => boolean) {
    this.load()
    const i = this.recs.findIndex((r) => r !== null && same(r))
    const row = this.encode(rec, i >= 0 ? this.raw[i] : undefined)
    const at = i >= 0 ? i : this.recs.length
    this.sheet.getRange(at + 2, 1, 1, this.header.length).setValues([row as never[]])
    this.recs[at] = { ...rec }
    this.raw[at] = row
  }

  /** Deletes the sheet row, keeping the cached row indices in step. Returns whether a row matched. */
  remove(same: (r: T) => boolean): boolean {
    this.load()
    const i = this.recs.findIndex((r) => r !== null && same(r))
    if (i < 0) return false
    this.sheet.deleteRow(i + 2)
    this.recs.splice(i, 1)
    this.raw.splice(i, 1)
    return true
  }

  replaceAll(recs: T[]) {
    this.load()
    if (this.raw.length > 0) this.sheet.getRange(2, 1, this.raw.length, this.header.length).clearContent()
    this.raw = recs.map((r) => this.encode(r))
    this.recs = recs.map((r) => ({ ...r }))
    if (recs.length > 0) this.sheet.getRange(2, 1, recs.length, this.header.length).setValues(this.raw as never[][])
  }
}

/** Store backed by one Google Sheet. Create one per request: each tab is read lazily, once. */
export class SheetStore implements Store {
  private tables = new Map<TabName, Table<never>>()
  private cfg: Config | null = null

  constructor(private ss: GoogleAppsScript.Spreadsheet.Spreadsheet) {}

  private sheet(name: TabName): Sheet {
    const s = this.ss.getSheetByName(name)
    if (!s) throw new Error(`Missing tab "${name}"`)
    return s
  }

  private table<T extends object>(name: Exclude<TabName, 'Config'>, decode?: (o: Obj) => T | null): Table<T> {
    let t = this.tables.get(name) as Table<T> | undefined
    if (!t) {
      t = new Table<T>(this.sheet(name), SPECS[name], decode)
      this.tables.set(name, t as unknown as Table<never>)
    }
    return t
  }

  getConfig(): Config {
    if (!this.cfg) {
      const kv: Obj = {}
      for (const [k, v] of this.sheet('Config').getDataRange().getValues().slice(1)) kv[String(k).trim()] = v
      const cfg: Obj = {}
      for (const [field, kind] of Object.entries(SPECS.Config)) cfg[field] = decodeValue(kind, kv[field])
      this.cfg = cfg as Config
    }
    return { ...this.cfg }
  }
  putConfig(c: Config) {
    const sheet = this.sheet('Config')
    const rows = Object.keys(SPECS.Config).map((k) => [k, encodeValue((c as Record<string, unknown>)[k])])
    sheet.clearContents()
    sheet.getRange(1, 1, rows.length + 1, 2).setValues([['key', 'value'], ...rows] as never[][])
    this.cfg = { ...c }
  }

  members = () => this.table<Member>('Members').all()
  putMember = (m: Member) => this.table<Member>('Members').upsert(m, (x) => x.id === m.id)

  quests = () => this.table<Quest>('Quests', decodeQuest).all()
  putQuests = (q: Quest[]) => this.table<Quest>('Quests', decodeQuest).replaceAll(q)

  assignments(f: { memberId?: string; status?: Assignment['status'] } = {}) {
    return this.table<Assignment>('Assignments')
      .all()
      .filter((a) => (f.memberId === undefined || a.memberId === f.memberId) && (f.status === undefined || a.status === f.status))
  }
  putAssignment = (a: Assignment) => this.table<Assignment>('Assignments').upsert(a, (x) => x.id === a.id)

  posts = () => this.table<Post>('Posts').all()
  putPost = (p: Post) => this.table<Post>('Posts').upsert(p, (x) => x.id === p.id)

  reactions(postId?: string) {
    const all = this.table<Reaction>('Reactions').all()
    return postId === undefined ? all : all.filter((r) => r.postId === postId)
  }
  toggleReaction(r: Reaction) {
    const t = this.table<Reaction>('Reactions')
    const same = (x: Reaction) => x.postId === r.postId && x.memberId === r.memberId && x.emoji === r.emoji
    if (!t.remove(same)) t.upsert(r, same)
  }

  comments(postId?: string) {
    const all = this.table<Comment>('Comments').all()
    return postId === undefined ? all : all.filter((c) => c.postId === postId)
  }
  addComment = (c: Comment) => this.table<Comment>('Comments').upsert(c, (x) => x.id === c.id)

  rerollUses = () => this.table<RerollUse>('Rerolls').all()
  addRerollUse = (u: RerollUse) => this.table<RerollUse>('Rerolls').upsert(u, (x) => x.memberId === u.memberId && x.weekKey === u.weekKey)

  recaps = () => this.table<Recap>('Recaps').all()
  putRecap = (r: Recap) => this.table<Recap>('Recaps').upsert(r, (x) => x.month === r.month)
}
