import { describe, expect, it } from 'vitest'
import { HOUR } from '../../shared/time'
import type { ApiResults } from '../../shared/types'
import { asg, config, data, DEADLINE0, driveFile, MB, pst, refusal, T0, world } from './testkit'

const upload = (over: Record<string, unknown> = {}) => ({ assignmentId: 'a1', kind: 'photo', mime: 'image/jpeg', size: 2 * MB, hasStill: false, ...over })
const finalize = (over: Record<string, unknown> = {}) => ({ assignmentId: 'a1', fileId: 'f1', caption: ' look ', capturedAt: T0 + 30 * 60_000, ...over })

describe('createUpload', () => {
  it('creates a session named after the assignment', () => {
    const w = world({ assignments: [asg('a1', 'm1')] })
    const r = data<ApiResults['createUpload']>(w.ada('createUpload', upload()))
    expect(r).toEqual({ uploadUrl: 'https://upload.test/a1-main.jpg' })
    expect(w.ports.sessions).toEqual([{ name: 'a1-main.jpg', mime: 'image/jpeg', size: 2 * MB }])
  })

  it('a video with a still gets two sessions', () => {
    const w = world({ assignments: [asg('a1', 'm1')] })
    const r = data<ApiResults['createUpload']>(w.ada('createUpload', upload({ kind: 'video', mime: 'video/quicktime', size: 40 * MB, hasStill: true })))
    expect(r).toEqual({ uploadUrl: 'https://upload.test/a1-main.mov', stillUploadUrl: 'https://upload.test/a1-still.jpg' })
    expect(w.ports.sessions).toEqual([
      { name: 'a1-main.mov', mime: 'video/quicktime', size: 40 * MB },
      { name: 'a1-still.jpg', mime: 'image/jpeg', size: null },
    ])
  })

  it('maps mime types to file extensions', () => {
    const cases: [string, string, string][] = [
      ['photo', 'image/png', 'png'],
      ['photo', 'image/heic', 'heic'],
      ['photo', 'image/webp', 'webp'],
      ['photo', 'image/gif', 'bin'],
      ['video', 'video/mp4', 'mp4'],
      ['video', 'video/webm', 'webm'],
    ]
    for (const [kind, mime, ext] of cases) {
      const w = world({ assignments: [asg('a1', 'm1')] })
      expect(data(w.ada('createUpload', upload({ kind, mime }))).uploadUrl).toBe(`https://upload.test/a1-main.${ext}`)
    }
  })

  it("createUpload refused for someone else's assignment", () => {
    const w = world({ assignments: [asg('b1', 'm2')] })
    expect(refusal(w.ada('createUpload', upload({ assignmentId: 'b1' })))).toBe("That quest isn't yours")
    expect(refusal(w.ada('createUpload', upload({ assignmentId: 'nope' })))).toBe("That quest isn't yours")
    expect(w.ports.sessions).toEqual([])
  })

  it('refuses a scheduled or already posted quest', () => {
    const w = world({ assignments: [asg('a1', 'm1', { status: 'scheduled', dropAt: T0 + 5 * HOUR, deadlineAt: null }), asg('a2', 'm1', { status: 'done', dropAt: T0 - 50 * HOUR })] })
    expect(refusal(w.ada('createUpload', upload()))).toBe("That quest hasn't dropped yet")
    expect(refusal(w.ada('createUpload', upload({ assignmentId: 'a2' })))).toBe('You already posted this quest')
  })

  it("createUpload refused after the member's next drop", () => {
    const missed = asg('a1', 'm1', { dropAt: T0 - 48 * HOUR, deadlineAt: T0 - 36 * HOUR, status: 'missed' })
    const next = asg('a2', 'm1', { dropAt: T0, status: 'scheduled', deadlineAt: null }) // dropped; tick not yet run
    const w = world({ assignments: [missed, next] })
    expect(refusal(w.ada('createUpload', upload()))).toBe('This quest is closed. You have a new one.')
  })

  it('allows a late post for a missed quest whose next drop is still ahead', () => {
    const missed = asg('a1', 'm1', { dropAt: T0 - 48 * HOUR, deadlineAt: T0 - 36 * HOUR, status: 'missed' })
    const next = asg('a2', 'm1', { dropAt: T0 + 5 * HOUR, status: 'scheduled', deadlineAt: null })
    const w = world({ assignments: [missed, next] })
    expect(data(w.ada('createUpload', upload())).uploadUrl).toBe('https://upload.test/a1-main.jpg')
  })

  it('refuses anything but a photo or video', () => {
    const w = world({ assignments: [asg('a1', 'm1')] })
    for (const over of [{ mime: 'application/pdf' }, { kind: 'video', mime: 'image/jpeg' }, { kind: 'audio', mime: 'audio/mp3' }, { mime: 42 }]) {
      expect(refusal(w.ada('createUpload', upload(over)))).toBe('Only photos and videos can be posted')
    }
  })

  it('enforces the size limits', () => {
    const w = world({ assignments: [asg('a1', 'm1')] })
    data(w.ada('createUpload', upload({ size: 15 * MB })))
    expect(refusal(w.ada('createUpload', upload({ size: 15 * MB + 1 })))).toBe('Photos can be up to 15 MB')
    data(w.ada('createUpload', upload({ kind: 'video', mime: 'video/mp4', size: 100 * MB })))
    expect(refusal(w.ada('createUpload', upload({ kind: 'video', mime: 'video/mp4', size: 100 * MB + 1 })))).toBe('Videos can be up to 100 MB')
  })
})

describe('finalizePost', () => {
  function ready(over: Parameters<typeof asg>[2] = {}, now = T0 + HOUR) {
    const w = world({ assignments: [asg('a1', 'm1', over)], now })
    driveFile(w.ports, 'f1', 'a1-main.jpg', 'image/jpeg')
    return w
  }

  it('stores the post, shares the file, closes the quest and notifies the group', () => {
    const w = ready()
    const r = data<ApiResults['finalizePost']>(w.ada('finalizePost', finalize()))
    expect(r.post).toMatchObject({
      assignmentId: 'a1',
      memberId: 'm1',
      kind: 'photo',
      fileId: 'f1',
      stillFileId: null,
      caption: 'look',
      capturedAt: T0 + 30 * 60_000,
      createdAt: T0 + HOUR,
      late: false,
      recordedEarlier: false,
      expired: false,
      durationS: null,
      questText: 'QTEXT-one',
      commentCount: 0,
      mine: [],
    })
    expect(r.post.reactions).toEqual({ '😂': 0, '🔥': 0, '😮': 0, '❤️': 0, '👏': 0, '💀': 0 })
    expect(w.store.posts()).toHaveLength(1)
    expect(w.store.assignments()[0].status).toBe('done')
    expect(w.ports.shared).toEqual(['f1'])
    expect(w.ports.sent).toEqual([{ channel: config.groupChannel, title: 'Kvestuj', body: 'Ada posted their quest' }])
    expect(JSON.stringify(w.ports.sent)).not.toContain('QTEXT')
  })

  it('finalize twice returns same post and notifies once', () => {
    const w = ready()
    const first = data<ApiResults['finalizePost']>(w.ada('finalizePost', finalize()))
    const second = data<ApiResults['finalizePost']>(w.ada('finalizePost', finalize({ caption: 'different' })))
    expect(second.post).toEqual(first.post)
    expect(w.store.posts()).toHaveLength(1)
    expect(w.ports.sent).toHaveLength(1)
    expect(w.ports.shared).toEqual(['f1'])
  })

  it('late post marks late and done', () => {
    const w = ready({ status: 'missed' }, DEADLINE0 + 2 * HOUR)
    const r = data<ApiResults['finalizePost']>(w.ada('finalizePost', finalize()))
    expect(r.post.late).toBe(true)
    expect(w.store.posts()[0].late).toBe(true)
    expect(w.store.assignments()[0].status).toBe('done')
  })

  it('recordedEarlier set when capturedAt < dropAt', () => {
    const w = ready()
    const r = data<ApiResults['finalizePost']>(w.ada('finalizePost', finalize({ capturedAt: T0 - 1 })))
    expect(r.post.recordedEarlier).toBe(true)
    expect(w.store.posts()[0].recordedEarlier).toBe(true)
  })

  it('unknown capturedAt is stored as null and not recordedEarlier', () => {
    const w = ready()
    const r = data<ApiResults['finalizePost']>(w.ada('finalizePost', finalize({ capturedAt: 'yesterday' })))
    expect(r.post).toMatchObject({ capturedAt: null, recordedEarlier: false })
  })

  it('a video keeps its still and duration; kind comes from the file', () => {
    const w = world({ assignments: [asg('a1', 'm1')] })
    driveFile(w.ports, 'v1', 'a1-main.mp4', 'video/mp4')
    driveFile(w.ports, 's1', 'a1-still.jpg', 'image/jpeg')
    const r = data<ApiResults['finalizePost']>(w.ada('finalizePost', finalize({ fileId: 'v1', stillFileId: 's1', durationS: 42 })))
    expect(r.post).toMatchObject({ kind: 'video', fileId: 'v1', stillFileId: 's1', durationS: 42 })
    expect(w.ports.shared).toEqual(['v1', 's1'])
  })

  it('durationS is ignored for photos and capped for videos', () => {
    const w = ready()
    expect(data(w.ada('finalizePost', finalize({ durationS: 99 }))).post.durationS).toBeNull()
    const v = world({ assignments: [asg('a1', 'm1')] })
    driveFile(v.ports, 'v1', 'a1-main.mp4', 'video/mp4')
    expect(refusal(v.ada('finalizePost', finalize({ fileId: 'v1', durationS: 62 })))).toBe('Videos can be up to 60 seconds')
    expect(data(v.ada('finalizePost', finalize({ fileId: 'v1', durationS: 61 }))).post.durationS).toBe(61)
  })

  it('refuses a file outside the folder, with another assignment prefix, or missing', () => {
    const w = world({ assignments: [asg('a1', 'm1')] })
    driveFile(w.ports, 'out', 'a1-main.jpg', 'image/jpeg', ['elsewhere'])
    driveFile(w.ports, 'other', 'a2-main.jpg', 'image/jpeg')
    driveFile(w.ports, 'prefix', 'a10-main.jpg', 'image/jpeg')
    driveFile(w.ports, 'ok', 'a1-main.jpg', 'image/jpeg')
    for (const over of [{ fileId: 'out' }, { fileId: 'other' }, { fileId: 'prefix' }, { fileId: 'missing' }, { fileId: '' }, { fileId: 'ok', stillFileId: 'other' }]) {
      expect(refusal(w.ada('finalizePost', finalize(over)))).toBe("That upload wasn't found")
    }
    expect(w.store.posts()).toEqual([])
    expect(w.ports.shared).toEqual([])
    expect(w.ports.sent).toEqual([])
  })

  it('refuses a caption over 500 characters', () => {
    const w = ready()
    expect(refusal(w.ada('finalizePost', finalize({ caption: 'x'.repeat(501) })))).toBe('Captions can be up to 500 characters')
    expect(data(w.ada('finalizePost', finalize({ caption: '🔥'.repeat(500) }))).post.caption).toBe('🔥'.repeat(500))
  })

  it("applies the assignment checks: someone else's, scheduled, closed", () => {
    const w = world({
      assignments: [
        asg('b1', 'm2'),
        asg('a1', 'm1', { status: 'scheduled', dropAt: T0 + 5 * HOUR, deadlineAt: null }),
        asg('a0', 'm1', { status: 'missed', dropAt: T0 - 48 * HOUR }),
        asg('a9', 'm1', { status: 'open', dropAt: T0 }),
      ],
    })
    driveFile(w.ports, 'f1', 'a0-main.jpg', 'image/jpeg')
    expect(refusal(w.ada('finalizePost', finalize({ assignmentId: 'b1' })))).toBe("That quest isn't yours")
    expect(refusal(w.ada('finalizePost', finalize({ assignmentId: 'a1' })))).toBe("That quest hasn't dropped yet")
    expect(refusal(w.ada('finalizePost', finalize({ assignmentId: 'a0' })))).toBe('This quest is closed. You have a new one.')
  })

  it('returns an existing post even once the quest is closed', () => {
    const w = world({
      assignments: [asg('a0', 'm1', { status: 'done', dropAt: T0 - 48 * HOUR }), asg('a9', 'm1', { dropAt: T0 })],
      posts: [pst('p0', 'a0', 'm1')],
    })
    expect(data(w.ada('finalizePost', finalize({ assignmentId: 'a0' }))).post.id).toBe('p0')
    expect(w.ports.sent).toEqual([])
  })
})
