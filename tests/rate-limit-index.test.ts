import { afterEach, describe, expect, it, vi } from 'vitest'

const sharedClient = vi.hoisted(() => ({ eval: vi.fn(async () => 1) }))
const getSharedRedisClient = vi.hoisted(() => vi.fn(() => sharedClient))
const createRedisConnection = vi.hoisted(() => vi.fn())

vi.mock('~/server/services/redis/client', () => ({
  getSharedRedisClient,
  createRedisConnection,
}))

const { getRateLimitStore, setRateLimitStore } = await import('~/server/services/rate-limit')

describe('rate-limit Redis client selection', () => {
  const originalRedisUrl = process.env.REDIS_URL
  const originalStore = process.env.RATE_LIMIT_STORE

  afterEach(() => {
    setRateLimitStore(null)
    if (originalRedisUrl === undefined) delete process.env.REDIS_URL
    else process.env.REDIS_URL = originalRedisUrl
    if (originalStore === undefined) delete process.env.RATE_LIMIT_STORE
    else process.env.RATE_LIMIT_STORE = originalStore
    getSharedRedisClient.mockClear()
    createRedisConnection.mockClear()
  })

  it('delegates Redis connection creation to the shared client', () => {
    process.env.REDIS_URL = 'redis://rate-limit.test'
    process.env.RATE_LIMIT_STORE = 'redis'

    expect(getRateLimitStore().name).toBe('redis')
    expect(getSharedRedisClient).toHaveBeenCalledWith('redis://rate-limit.test')
    expect(createRedisConnection).not.toHaveBeenCalled()
  })
})
