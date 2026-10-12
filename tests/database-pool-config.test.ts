import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_POOL_MAX, resolvePoolMax } from '../server/database/connection-config'

describe('resolvePoolMax', () => {
  it('defaults to 20', () => {
    expect(DEFAULT_POOL_MAX).toBe(20)
    expect(resolvePoolMax({})).toBe(20)
    expect(resolvePoolMax({ PG_POOL_MAX: '' })).toBe(20)
    expect(resolvePoolMax({ PG_POOL_MAX: 'lots' })).toBe(20)
    expect(resolvePoolMax({ PG_POOL_MAX: '0' })).toBe(20)
  })

  it('reads PG_POOL_MAX and clamps it', () => {
    expect(resolvePoolMax({ PG_POOL_MAX: '35' })).toBe(35)
    expect(resolvePoolMax({ PG_POOL_MAX: ' 8 ' })).toBe(8)
    expect(resolvePoolMax({ PG_POOL_MAX: '5000' })).toBe(200)
  })
})

describe('database pool', () => {
  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('pg')
    delete process.env.PG_POOL_MAX
  })

  it('creates the pg Pool with an explicit max from PG_POOL_MAX', async () => {
    const created: Array<{ max?: number }> = []
    vi.doMock('pg', () => ({
      Pool: class {
        constructor(config: { max?: number }) {
          created.push(config)
        }
        on() {}
      },
    }))
    vi.doMock('drizzle-orm/node-postgres', () => ({ drizzle: () => ({}) }))
    process.env.PG_POOL_MAX = '12'
    await import('../server/database/drizzle')
    expect(created).toHaveLength(1)
    expect(created[0].max).toBe(12)
  })

  it('uses 20 when PG_POOL_MAX is unset', async () => {
    const created: Array<{ max?: number }> = []
    vi.doMock('pg', () => ({
      Pool: class {
        constructor(config: { max?: number }) {
          created.push(config)
        }
        on() {}
      },
    }))
    vi.doMock('drizzle-orm/node-postgres', () => ({ drizzle: () => ({}) }))
    await import('../server/database/drizzle')
    expect(created[0].max).toBe(20)
  })
})
