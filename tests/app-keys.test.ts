import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  APP_KEY_PREFIX,
  deriveTitle,
  generateAppKey,
  hashAppKey,
  readBearerAppKey,
  requireAppKey,
  toFeedbackType,
} from '../server/utils/app-keys'

const state = vi.hoisted(() => ({ row: null as Record<string, unknown> | null }))

vi.mock('~/server/database/drizzle', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => (state.row ? [state.row] : [])),
    })),
  },
}))

function eventWith(authorization?: string) {
  return { node: { req: { headers: authorization === undefined ? {} : { authorization } } } } as never
}

describe('app keys', () => {
  beforeEach(() => {
    state.row = null
    vi.stubGlobal('createError', (input: Record<string, unknown>) => Object.assign(new Error('err'), input))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('generateAppKey returns prefixed key, prefix and hash', () => {
    const a = generateAppKey()
    const b = generateAppKey()
    expect(a.key.startsWith(APP_KEY_PREFIX)).toBe(true)
    expect(a.keyPrefix).toBe(a.key.slice(0, 12))
    expect(a.keyHash).toBe(hashAppKey(a.key))
    expect(a.key).not.toBe(b.key)
  })

  it('deriveTitle uses the first non-empty line, capped at 80 chars', () => {
    expect(deriveTitle('Fix it\nmore detail')).toBe('Fix it')
    expect(deriveTitle('\n\n  Slider jumps  \nx')).toBe('Slider jumps')
    const long = deriveTitle('a'.repeat(100))
    expect(long).toHaveLength(80)
    expect(long.endsWith('…')).toBe(true)
    expect(deriveTitle('a'.repeat(80))).toBe('a'.repeat(80))
  })

  it('readBearerAppKey parses the Authorization header', () => {
    expect(readBearerAppKey(eventWith('bearer  vfy_pub_abc '))).toBe('vfy_pub_abc')
    expect(readBearerAppKey(eventWith('Bearer xyz'))).toBeNull()
    expect(readBearerAppKey(eventWith())).toBeNull()
  })

  it('toFeedbackType maps types', () => {
    expect(toFeedbackType('bug')).toBe('bug_report')
    expect(toFeedbackType('feature')).toBe('feature_request')
  })

  it('requireAppKey throws 401 for missing header or unknown key', async () => {
    await expect(requireAppKey(eventWith())).rejects.toMatchObject({ statusCode: 401 })
    await expect(requireAppKey(eventWith('Bearer vfy_pub_unknown'))).rejects.toMatchObject({ statusCode: 401 })
  })

  it('requireAppKey returns the row for a valid key', async () => {
    state.row = { id: 'k1', name: 'Dot X' }
    await expect(requireAppKey(eventWith('Bearer vfy_pub_good'))).resolves.toMatchObject({ id: 'k1' })
  })
})
