import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

import {
  APP_KEY_PREFIX,
  deriveTitle,
  generateAppKey,
  hashAppKey,
  readBearerAppKey,
  requireAppKey,
  requireServerKey,
  SERVER_KEY_PREFIX,
  toFeedbackType,
} from '../server/utils/app-keys'

const state = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, where: null as unknown }))

// Honors the kind filter: the stored row is returned only when the query asks for its kind.
vi.mock('~/server/database/drizzle', () => ({
  db: {
    select: vi.fn(() => {
      const chain = {
        from: () => chain,
        where: (arg: unknown) => {
          state.where = arg
          return chain
        },
        limit: async () => {
          if (!state.row) return []
          const { sql, params } = new PgDialect().sqlToQuery(state.where as SQL)
          expect(sql).toContain('"project_api_key"."kind" = $')
          return params.includes(state.row.kind) ? [state.row] : []
        },
      }
      return chain
    }),
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
    state.row = { id: 'k1', name: 'Dot X', kind: 'app', productId: 'product-1' }
    await expect(requireAppKey(eventWith('Bearer vfy_pub_good'))).resolves.toMatchObject({ id: 'k1' })
  })

  it('requireAppKey refuses a server key, even one presented with the app prefix', async () => {
    // A product id too, so only the kind filter can refuse it.
    state.row = { id: 'k2', name: 'Shop', kind: 'server', productId: 'product-1' }
    await expect(requireAppKey(eventWith('Bearer vfy_srv_good'))).rejects.toMatchObject({ statusCode: 401 })
    await expect(requireAppKey(eventWith('Bearer vfy_pub_good'))).rejects.toMatchObject({ statusCode: 401 })
  })

  it('generateAppKey makes server keys with their own prefix', () => {
    const server = generateAppKey('server')
    expect(server.key.startsWith(SERVER_KEY_PREFIX)).toBe(true)
    expect(server.keyPrefix).toBe(server.key.slice(0, 12))
  })

  it('requireServerKey accepts only vfy_srv_ bearer tokens', async () => {
    state.row = { id: 'k3', name: 'Shop', kind: 'server', productId: null }
    await expect(requireServerKey(eventWith('Bearer vfy_srv_good'))).resolves.toMatchObject({ id: 'k3' })
    await expect(requireServerKey(eventWith('Bearer vfy_pub_good'))).rejects.toMatchObject({ statusCode: 401 })
    await expect(requireServerKey(eventWith())).rejects.toMatchObject({ statusCode: 401 })
    // An app key row behind a vfy_srv_ token (forged prefix) is still refused by kind.
    state.row = { id: 'k4', name: 'App', kind: 'app', productId: 'product-1' }
    await expect(requireServerKey(eventWith('Bearer vfy_srv_good'))).rejects.toMatchObject({ statusCode: 401 })
    state.row = null
    await expect(requireServerKey(eventWith('Bearer vfy_srv_unknown'))).rejects.toMatchObject({ statusCode: 401 })
  })
})
