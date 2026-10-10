import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  SecretDecryptionError,
  SecretsConfigError,
  decryptSecret,
  encryptSecret,
  isSecretsConfigured,
  keyHint,
  needsReencryption,
} from '../server/utils/secrets'

const keyA = randomBytes(32)
const keyB = randomBytes(32)
const ORIGINAL_KEY = process.env.SECRETS_ENCRYPTION_KEY
const ORIGINAL_PREVIOUS = process.env.SECRETS_ENCRYPTION_KEY_PREVIOUS

function restore(name: 'SECRETS_ENCRYPTION_KEY' | 'SECRETS_ENCRYPTION_KEY_PREVIOUS', value: string | undefined) {
  if (value === undefined) Reflect.deleteProperty(process.env, name)
  else process.env[name] = value
}

function setKey(value?: string, previous?: string) {
  restore('SECRETS_ENCRYPTION_KEY', value)
  restore('SECRETS_ENCRYPTION_KEY_PREVIOUS', previous)
}

// Flip the first character of a payload part (index 2 = iv, 3 = tag, 4 = ciphertext).
function tamper(payload: string, index: number) {
  const parts = payload.split('.')
  const part = parts[index]
  parts[index] = (part[0] === 'A' ? 'B' : 'A') + part.slice(1)
  return parts.join('.')
}

describe('secrets', () => {
  beforeEach(() => setKey(keyA.toString('base64')))
  afterEach(() => {
    restore('SECRETS_ENCRYPTION_KEY', ORIGINAL_KEY)
    restore('SECRETS_ENCRYPTION_KEY_PREVIOUS', ORIGINAL_PREVIOUS)
  })

  it('round trips and uses the documented payload format', () => {
    const payload = encryptSecret('sk-ant-secret')
    expect(payload).toMatch(/^v1\.[0-9a-f]{8}\.[\w-]+\.[\w-]+\.[\w-]*$/)
    expect(payload).not.toContain('sk-ant-secret')
    expect(decryptSecret(payload)).toBe('sk-ant-secret')
  })

  it('uses a fresh 12-byte IV for every encryption', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'))
    expect(Buffer.from(encryptSecret('same').split('.')[2], 'base64url')).toHaveLength(12)
  })

  it('handles unicode and empty strings', () => {
    for (const text of ['', 'héllo wörld ✓ 日本語 🔑']) {
      expect(decryptSecret(encryptSecret(text))).toBe(text)
    }
  })

  it('requires matching associated data', () => {
    const payload = encryptSecret('key', 'team:1:openai')
    expect(decryptSecret(payload, 'team:1:openai')).toBe('key')
    expect(() => decryptSecret(payload, 'team:2:openai')).toThrow(SecretDecryptionError)
    expect(() => decryptSecret(payload, 'team:1:anthropic')).toThrow(SecretDecryptionError)
    expect(() => decryptSecret(payload)).toThrow(SecretDecryptionError)
    expect(() => decryptSecret(encryptSecret('key'), 'team:1:openai')).toThrow(SecretDecryptionError)
  })

  it.each([
    ['iv', 2],
    ['tag', 3],
    ['ciphertext', 4],
  ])('rejects a tampered %s', (_name, index) => {
    const payload = encryptSecret('some secret value')
    expect(() => decryptSecret(tamper(payload, index))).toThrow(SecretDecryptionError)
  })

  it('rejects malformed payloads, unknown versions and unknown key ids', () => {
    const parts = encryptSecret('x').split('.')
    expect(() => decryptSecret('garbage')).toThrow(SecretDecryptionError)
    expect(() => decryptSecret(parts.slice(0, 4).join('.'))).toThrow(SecretDecryptionError)
    expect(() => decryptSecret(['v2', ...parts.slice(1)].join('.'))).toThrow(/version/)
    expect(() => decryptSecret([parts[0], 'deadbeef', ...parts.slice(2)].join('.'))).toThrow(SecretDecryptionError)
    expect(() => decryptSecret([parts[0], parts[1], parts[2], 'AAAA', parts[4]].join('.'))).toThrow(
      SecretDecryptionError
    )
    expect(() => needsReencryption('garbage')).toThrow(SecretDecryptionError)
  })

  it('does not leak plaintext or key material in error messages', () => {
    const payload = encryptSecret('super-secret-plaintext', 'aad')
    let message = ''
    try {
      decryptSecret(payload, 'other')
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).not.toBe('')
    expect(message).not.toContain('super-secret-plaintext')
    expect(message).not.toContain(keyA.toString('base64'))
  })

  it('accepts hex, base64 and base64url keys that describe the same bytes', () => {
    const payload = encryptSecret('value')
    setKey(keyA.toString('hex'))
    expect(decryptSecret(payload)).toBe('value')
    setKey(keyA.toString('base64url'))
    expect(decryptSecret(payload)).toBe('value')
    setKey(keyA.toString('base64').replace(/=+$/, ''))
    expect(decryptSecret(payload)).toBe('value')
  })

  it('accepts url-safe base64 containing - and _', () => {
    const key = Buffer.alloc(32, 0xfb) // standard base64 would contain + and /
    const encoded = key.toString('base64url')
    expect(encoded).toMatch(/[-_]/)
    setKey(encoded)
    expect(decryptSecret(encryptSecret('v'))).toBe('v')
  })

  it('throws a config error for missing or invalid keys without echoing the value', () => {
    const bad = [
      '   ',
      'short',
      randomBytes(16).toString('base64'),
      randomBytes(33).toString('base64'),
      randomBytes(16).toString('hex'),
      'g'.repeat(64),
      `${keyA.toString('base64')}!!`,
    ]
    for (const value of bad) {
      setKey(value)
      expect(isSecretsConfigured()).toBe(false)
      expect(() => encryptSecret('x')).toThrow(SecretsConfigError)
      expect(() => decryptSecret('v1.a.b.c.d')).toThrow(SecretsConfigError)
      let message = ''
      try {
        encryptSecret('x')
      } catch (error) {
        message = (error as Error).message
      }
      if (value.trim().length > 8) expect(message).not.toContain(value.trim())
    }
    setKey('')
    expect(() => encryptSecret('x')).toThrow(/not set/)
    setKey(undefined)
    expect(() => encryptSecret('x')).toThrow(/not set/)
  })

  it('reports configuration without throwing', () => {
    expect(isSecretsConfigured()).toBe(true)
    setKey(undefined)
    expect(isSecretsConfigured()).toBe(false)
  })

  it('rejects an invalid previous key', () => {
    setKey(keyA.toString('base64'), 'nope')
    expect(isSecretsConfigured()).toBe(false)
    expect(() => encryptSecret('x')).toThrow(SecretsConfigError)
  })

  describe('rotation', () => {
    it('decrypts with a previous key and flags it for re-encryption', () => {
      setKey(keyB.toString('base64'))
      const old = encryptSecret('legacy', 'ctx')
      setKey(keyA.toString('base64'), keyB.toString('hex'))
      expect(decryptSecret(old, 'ctx')).toBe('legacy')
      expect(needsReencryption(old)).toBe(true)

      const fresh = encryptSecret('legacy', 'ctx')
      expect(needsReencryption(fresh)).toBe(false)
      expect(decryptSecret(fresh, 'ctx')).toBe('legacy')
    })

    it('supports several previous keys with whitespace and empty entries', () => {
      const keyC = randomBytes(32)
      setKey(keyC.toString('base64'))
      const fromC = encryptSecret('c')
      setKey(keyB.toString('base64'))
      const fromB = encryptSecret('b')
      setKey(keyA.toString('base64'), ` ${keyB.toString('base64')} , ,${keyC.toString('hex')},`)
      expect(decryptSecret(fromB)).toBe('b')
      expect(decryptSecret(fromC)).toBe('c')
    })

    it('fails once the old key is no longer configured', () => {
      setKey(keyB.toString('base64'))
      const old = encryptSecret('legacy')
      setKey(keyA.toString('base64'))
      expect(() => decryptSecret(old)).toThrow(SecretDecryptionError)
    })

    it('never encrypts with a previous key', () => {
      setKey(keyA.toString('base64'), keyB.toString('base64'))
      expect(needsReencryption(encryptSecret('x'))).toBe(false)
    })
  })

  describe('keyHint', () => {
    it('shows the last four characters', () => {
      expect(keyHint('sk-ant-abcdef1234')).toBe('…1234')
      expect(keyHint('12345678')).toBe('…5678')
    })

    it('hides short secrets entirely', () => {
      expect(keyHint('1234567')).toBe('…')
      expect(keyHint('')).toBe('…')
    })
  })
})
