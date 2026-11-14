import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { hashSecret, newChannel, newId, newRecoveryCode, newToken, normalizeRecoveryCode } from './codes'

describe('hashSecret', () => {
  it('matches the NIST vectors', () => {
    expect(hashSecret('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(hashSecret('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(hashSecret('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })
  it('matches node crypto for non-ASCII, astral and long input', () => {
    for (const s of ['Zuzana Černá – příliš žluťoučký kůň', 'quest 🎉🔥 ❤️', 'x'.repeat(1000), 'é'.repeat(64), 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64)]) {
      expect(hashSecret(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'))
    }
  })
  it('encodes a lone surrogate as U+FFFD like TextEncoder', () => {
    const s = 'a\ud800b'
    expect(hashSecret(s)).toBe(createHash('sha256').update(new TextEncoder().encode(s)).digest('hex'))
  })
})

describe('newToken', () => {
  it('is 43 base64url chars and unique over 1000 draws', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      const t = newToken()
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/)
      seen.add(t)
    }
    expect(seen.size).toBe(1000)
  })
})

describe('newRecoveryCode', () => {
  it('matches the canonical format', () => {
    for (let i = 0; i < 200; i++) expect(newRecoveryCode()).toMatch(/^KVS-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/)
  })
  it('rejects biased bytes (rejection sampling)', () => {
    const alphabetLen = 31
    const limit = 256 - (256 % alphabetLen) // 248
    // first batch is all rejected (>= limit), then valid bytes 0..7
    let calls = 0
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(((a: Uint8Array) => {
      calls++
      for (let i = 0; i < a.length; i++) a[i] = calls === 1 ? limit + (i % 8) : i % 8
      return a
    }) as typeof crypto.getRandomValues)
    try {
      expect(newRecoveryCode()).toBe('KVS-2345-6789') // alphabet[0..7] = 23456789
    } finally {
      spy.mockRestore()
    }
    expect(calls).toBeGreaterThan(1)
  })
})

describe('normalizeRecoveryCode', () => {
  it('canonicalises sloppy input', () => {
    for (const s of ['kvs 7q4m 28xd', '7Q4M28XD', 'KVS-7Q4M-28XD', '  kvs-7q4m-28xd ']) {
      expect(normalizeRecoveryCode(s)).toBe('KVS-7Q4M-28XD')
    }
  })
  it('rejects malformed input', () => {
    for (const s of ['', 'KVS-7Q4M', 'KVS-7Q4M-28XDX', '7Q4M28X0', '7Q4M28XI', 'KVS-7Q4M-28X!', 'ABC']) {
      expect(normalizeRecoveryCode(s)).toBeNull()
    }
  })
  it('round-trips generated codes', () => {
    const c = newRecoveryCode()
    expect(normalizeRecoveryCode(c.toLowerCase())).toBe(c)
  })
})

describe('newChannel / newId', () => {
  it('channel is kvestuj- plus 12 base32 chars', () => {
    expect(newChannel()).toMatch(/^kvestuj-[a-z2-7]{12}$/)
  })
  it('ids carry the prefix', () => {
    expect(newId('m')).toMatch(/^m_[a-z2-7]{12}$/)
    expect(newId('p')).toMatch(/^p_[a-z2-7]{12}$/)
    expect(newId('m')).not.toBe(newId('m'))
  })
})

describe('no secure random', () => {
  it('throws', () => {
    const orig = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true })
    try {
      expect(() => newToken()).toThrow('No secure random source')
    } finally {
      Object.defineProperty(globalThis, 'crypto', orig)
    }
  })
})
