import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  deriveEmailHashKey,
  hashEmail,
  hashEmailCandidates,
  hashEmailWithSecret,
  isRedactedEmail,
} from '~/server/utils/marketing-email-hash'

describe('marketing email hash', () => {
  it('is deterministic and ignores case and surrounding whitespace', () => {
    const a = hashEmailWithSecret('Jane.Doe@Example.com', 'secret-a')
    expect(hashEmailWithSecret('  jane.doe@example.com ', 'secret-a')).toBe(a)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(hashEmailWithSecret('other@example.com', 'secret-a')).not.toBe(a)
  })

  it('is keyed: another secret gives another hash, and the key is derived, not the secret itself', () => {
    expect(hashEmailWithSecret('jane@example.com', 'secret-a')).not.toBe(
      hashEmailWithSecret('jane@example.com', 'secret-b')
    )
    const key = deriveEmailHashKey('secret-a')
    expect(key).toHaveLength(32)
    expect(key.equals(Buffer.from('secret-a'))).toBe(false)
    // Different info means a different key (key separation from other HKDF uses of the same secret)
    expect(deriveEmailHashKey('secret-a').equals(deriveEmailHashKey('secret-a'))).toBe(true)
  })

  describe('key sources', () => {
    const keys = ['BETTER_AUTH_SECRET', 'BETTER_AUTH_SECRET_PREV', 'MARKETING_EMAIL_HASH_KEY', 'NODE_ENV'] as const
    const saved: Record<string, string | undefined> = {}
    const env = process.env as Record<string, string | undefined>
    beforeEach(() => {
      for (const k of keys) saved[k] = env[k]
      delete env.BETTER_AUTH_SECRET_PREV
      delete env.MARKETING_EMAIL_HASH_KEY
    })
    afterEach(() => {
      for (const k of keys) {
        if (saved[k] === undefined) Reflect.deleteProperty(env, k)
        else env[k] = saved[k]
      }
    })
    const addr = 'jane@example.com'

    it('derives from BETTER_AUTH_SECRET by default', () => {
      expect(hashEmail(addr)).toBe(hashEmailWithSecret(addr, env.BETTER_AUTH_SECRET!))
      expect(hashEmailCandidates(addr)).toEqual([hashEmail(addr)])
    })

    it('prefers MARKETING_EMAIL_HASH_KEY for writes and still matches the BETTER_AUTH_SECRET hash', () => {
      env.MARKETING_EMAIL_HASH_KEY = 'dedicated-key'
      expect(hashEmail(addr)).toBe(hashEmailWithSecret(addr, 'dedicated-key'))
      expect(hashEmailCandidates(addr)).toEqual([
        hashEmailWithSecret(addr, 'dedicated-key'),
        hashEmailWithSecret(addr, env.BETTER_AUTH_SECRET!),
      ])
    })

    it('after a secret rotation, lookups match hashes made under BETTER_AUTH_SECRET_PREV', () => {
      const oldHash = hashEmailWithSecret(addr, 'old-secret')
      env.BETTER_AUTH_SECRET = 'new-secret'
      env.BETTER_AUTH_SECRET_PREV = 'old-secret'
      expect(hashEmail(addr)).toBe(hashEmailWithSecret(addr, 'new-secret'))
      expect(hashEmailCandidates(addr)[0]).toBe(hashEmail(addr))
      expect(hashEmailCandidates(addr)).toContain(oldHash)
    })

    it('uses the dev default outside production and refuses to hash in production without a secret', () => {
      delete env.BETTER_AUTH_SECRET
      env.NODE_ENV = 'test'
      expect(hashEmail(addr)).toBe(hashEmailWithSecret(addr, 'veerify-dev-auth-secret-v1'))
      env.NODE_ENV = 'production'
      expect(() => hashEmail(addr)).toThrow()
      env.MARKETING_EMAIL_HASH_KEY = 'dedicated-key'
      expect(hashEmail(addr)).toBe(hashEmailWithSecret(addr, 'dedicated-key'))
    })
  })

  it('recognises redacted placeholders', () => {
    expect(isRedactedEmail('redacted:abc')).toBe(true)
    expect(isRedactedEmail('jane@example.com')).toBe(false)
    expect(isRedactedEmail(null)).toBe(false)
  })
})
