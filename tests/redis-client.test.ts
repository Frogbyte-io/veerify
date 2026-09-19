import { afterEach, describe, expect, it, vi } from 'vitest'

const Redis = vi.hoisted(() =>
  vi.fn(function RedisMock() {
    return {
      on: vi.fn(),
      disconnect: vi.fn(),
    }
  })
)

vi.mock('ioredis', () => ({ default: Redis }))

const { getSharedRedisClient, resetSharedRedisClients } = await import('~/server/services/redis/client')

describe('shared Redis client', () => {
  afterEach(() => {
    resetSharedRedisClients()
    Redis.mockClear()
  })

  it('does not queue regular commands while disconnected', () => {
    getSharedRedisClient('redis://shared.test')

    expect(Redis).toHaveBeenCalledWith(
      'redis://shared.test',
      expect.objectContaining({
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
      })
    )
  })
})
