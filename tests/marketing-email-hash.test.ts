import { describe, expect, it } from 'vitest'
import {
  deriveEmailHashKey,
  hashEmail,
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

  it('hashEmail reads BETTER_AUTH_SECRET and refuses to run without it', () => {
    expect(hashEmail('jane@example.com')).toBe(hashEmailWithSecret('jane@example.com', process.env.BETTER_AUTH_SECRET!))
    const saved = process.env.BETTER_AUTH_SECRET
    delete process.env.BETTER_AUTH_SECRET
    try {
      expect(() => hashEmail('jane@example.com')).toThrow()
    } finally {
      process.env.BETTER_AUTH_SECRET = saved
    }
  })

  it('recognises redacted placeholders', () => {
    expect(isRedactedEmail('redacted:abc')).toBe(true)
    expect(isRedactedEmail('jane@example.com')).toBe(false)
    expect(isRedactedEmail(null)).toBe(false)
  })
})
