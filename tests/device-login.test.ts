import { describe, expect, it, vi } from 'vitest'

// Pure helpers only; keep the module's database handle inert.
vi.mock('~/server/database/drizzle', () => ({ db: {} }))

const { USER_CODE_ALPHABET, formatUserCode, generateUserCode, normalizeUserCode } =
  await import('../server/services/device-login')

describe('device login user codes', () => {
  it('generates 8 characters from the alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateUserCode()
      expect(code).toHaveLength(8)
      for (const ch of code) expect(USER_CODE_ALPHABET).toContain(ch)
    }
  })

  it('normalises case, dashes and spaces', () => {
    expect(normalizeUserCode(' bcdf-ghjk ')).toBe('BCDFGHJK')
  })

  it('drops characters outside the alphabet', () => {
    expect(normalizeUserCode('BCDF-GHJA')).toBe('BCDFGHJ')
  })

  it('formats as XXXX-XXXX', () => {
    expect(formatUserCode('BCDFGHJK')).toBe('BCDF-GHJK')
  })
})
