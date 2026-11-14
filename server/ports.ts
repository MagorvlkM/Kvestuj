/// <reference types="google-apps-script" />
import type { Rng } from '../shared/drops'
import type { Config } from '../shared/types'

export interface DriveFile {
  name: string
  parents: string[]
  mimeType: string
}

/** Everything the handlers need from the outside world. Faked in tests; `gasPorts` in Apps Script. */
export interface Ports {
  now(): number
  rng: Rng
  drive: {
    /** Starts a resumable upload into the group folder; returns the upload URL the phone PUTs to. */
    createUploadSession(name: string, mime: string, size: number | null): string
    /** The file's metadata, or null when it does not exist or is trashed. */
    getFile(fileId: string): DriveFile | null
    shareAnyoneReader(fileId: string): void
    trash(fileId: string): void
  }
  /** Never throws: a failed notification is logged. */
  ntfy: { send(channel: string, title: string, body: string): void }
  /** Runs `fn` holding the script-wide lock. */
  lock<T>(fn: () => T): T
  log(message: string): void
}

/** `https://host` of a URL (Apps Script V8 has no `URL` global). */
export function originOf(url: string): string {
  const m = /^(https?:\/\/[^/?#]+)/i.exec(url)
  if (!m) throw new Error('appUrl is not an http(s) URL: ' + url)
  return m[1]
}

function header(headers: object, name: string): string | null {
  const want = name.toLowerCase()
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === want) return Array.isArray(v) ? String(v[0]) : String(v)
  }
  return null
}

/** The Google Apps Script implementation. Not unit-tested (no Apps Script runtime in tests). */
export function gasPorts(config: Config): Ports {
  const auth = () => ({ Authorization: 'Bearer ' + ScriptApp.getOAuthToken() })
  const log = (message: string) => console.log(message)

  return {
    now: () => Date.now(),
    rng: Math.random,
    log,
    drive: {
      createUploadSession(name, mime, size) {
        const res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
          method: 'post',
          contentType: 'application/json; charset=UTF-8',
          headers: {
            ...auth(),
            'X-Upload-Content-Type': mime,
            ...(size != null ? { 'X-Upload-Content-Length': String(size) } : {}),
            Origin: originOf(config.appUrl),
          },
          payload: JSON.stringify({ name, parents: [config.folderId] }),
          muteHttpExceptions: true,
        })
        const code = res.getResponseCode()
        if (code !== 200) throw new Error(`Drive upload session failed (${code}): ${res.getContentText()}`)
        const location = header(res.getAllHeaders(), 'Location')
        if (!location) throw new Error('Drive upload session returned no Location header')
        return location
      },
      getFile(fileId) {
        const res = UrlFetchApp.fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=name,parents,mimeType,trashed`,
          { method: 'get', headers: auth(), muteHttpExceptions: true },
        )
        const code = res.getResponseCode()
        if (code === 404 || code === 400) return null
        if (code !== 200) throw new Error(`Drive getFile failed (${code}): ${res.getContentText()}`)
        const f = JSON.parse(res.getContentText()) as { name?: string; parents?: string[]; mimeType?: string; trashed?: boolean }
        if (f.trashed) return null
        return { name: f.name ?? '', parents: f.parents ?? [], mimeType: f.mimeType ?? '' }
      },
      shareAnyoneReader(fileId) {
        DriveApp.getFileById(fileId).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW)
      },
      trash(fileId) {
        DriveApp.getFileById(fileId).setTrashed(true)
      },
    },
    ntfy: {
      send(channel, title, body) {
        try {
          const res = UrlFetchApp.fetch('https://ntfy.sh/' + channel, {
            method: 'post',
            contentType: 'text/plain; charset=utf-8',
            payload: body,
            headers: { Title: title, Click: config.appUrl },
            muteHttpExceptions: true,
          })
          const code = res.getResponseCode()
          if (code >= 300) log(`ntfy ${channel} failed (${code}): ${res.getContentText()}`)
        } catch (e) {
          log(`ntfy ${channel} failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      },
    },
    lock(fn) {
      const lock = LockService.getScriptLock()
      lock.waitLock(20000)
      try {
        return fn()
      } finally {
        lock.releaseLock()
      }
    },
  }
}
