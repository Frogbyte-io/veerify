import type { H3Event } from 'h3'
import type Redis from 'ioredis'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { setRateLimitStore } from '../server/services/rate-limit'
import { createMemoryStore } from '../server/services/rate-limit/stores/memory'
import { createRedisStore } from '../server/services/rate-limit/stores/redis'
import type { RateLimitStore } from '../server/services/rate-limit/types'
import { checkRateLimit, rateLimits, requireRateLimit } from '../server/utils/rate-limit'

function makeEvent(ip = '203.0.113.1'): H3Event {
  return {
    node: {
      req: {
        headers: {},
        socket: { remoteAddress: ip },
      },
    },
  } as unknown as H3Event
}

function makeFakeRedis(evalImpl: (...args: unknown[]) => Promise<unknown>): Redis {
  return { eval: vi.fn(evalImpl) } as unknown as Redis
}

// `createError` is one of Nuxt's server auto-imports; stub it the way the
// other server-util tests do, since plain vitest has no Nuxt runtime.
vi.stubGlobal('createError', (input: any) => {
  const err = new Error(input?.statusMessage || 'Request failed') as any
  Object.assign(err, input)
  return err
})

describe('memory rate limit store', () => {
  it('allows requests up to the limit and denies the next one in the same window', async () => {
    const store = createMemoryStore()

    expect(await store.consume('k1', 60_000, 2)).toBe(true)
    expect(await store.consume('k1', 60_000, 2)).toBe(true)
    expect(await store.consume('k1', 60_000, 2)).toBe(false)
  })

  it('keeps separate windows per key', async () => {
    const store = createMemoryStore()

    expect(await store.consume('a', 60_000, 1)).toBe(true)
    expect(await store.consume('b', 60_000, 1)).toBe(true)
    expect(await store.consume('a', 60_000, 1)).toBe(false)
  })

  it('allows requests again once the window has slid past old entries', async () => {
    const store = createMemoryStore()
    const nowSpy = vi.spyOn(Date, 'now')

    nowSpy.mockReturnValue(0)
    expect(await store.consume('k2', 1_000, 1)).toBe(true)
    expect(await store.consume('k2', 1_000, 1)).toBe(false)

    nowSpy.mockReturnValue(1_001)
    expect(await store.consume('k2', 1_000, 1)).toBe(true)

    nowSpy.mockRestore()
  })
})

describe('redis rate limit store', () => {
  it('runs the sliding-window script atomically via EVAL with one key', async () => {
    const client = makeFakeRedis(async () => 1)
    const store = createRedisStore(client)

    await store.consume('rl:1.2.3.4', 60_000, 5)

    expect(client.eval).toHaveBeenCalledTimes(1)
    const call = (client.eval as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[1]).toBe(1) // numkeys
    expect(call[2]).toBe('rl:1.2.3.4') // KEYS[1]
    expect(call[4]).toBe('60000') // ARGV[2] window
    expect(call[5]).toBe('5') // ARGV[3] max
  })

  it('maps a script result of 1 to allowed and 0 to denied', async () => {
    const allow = createRedisStore(makeFakeRedis(async () => 1))
    const deny = createRedisStore(makeFakeRedis(async () => 0))

    expect(await allow.consume('k', 1_000, 1)).toBe(true)
    expect(await deny.consume('k', 1_000, 1)).toBe(false)
  })

  it('gives each request a unique sorted-set member even within the same millisecond', async () => {
    const client = makeFakeRedis(async () => 1)
    const store = createRedisStore(client)
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000)

    await store.consume('k', 1_000, 5)
    await store.consume('k', 1_000, 5)

    const calls = (client.eval as ReturnType<typeof vi.fn>).mock.calls
    expect(calls[0][6]).not.toBe(calls[1][6])

    nowSpy.mockRestore()
  })

  it('fails open when Redis is unreachable, so a broker outage never becomes an API outage', async () => {
    const client = makeFakeRedis(async () => {
      throw new Error('connection lost')
    })
    const store = createRedisStore(client)

    await expect(store.consume('k', 60_000, 5)).resolves.toBe(true)
  })
})

describe('checkRateLimit / requireRateLimit call-site contract', () => {
  afterEach(() => {
    setRateLimitStore(null)
  })

  it('delegates to the configured store with a windowMs derived from windowSeconds', async () => {
    const consume = vi.fn(async () => true)
    const fakeStore: RateLimitStore = { name: 'fake', consume }
    setRateLimitStore(fakeStore)

    await checkRateLimit(makeEvent(), { maxRequests: 5, windowSeconds: 60, identifier: 'test' })

    expect(consume).toHaveBeenCalledWith('test:203.0.113.1', 60_000, 5)
  })

  it('defaults the bucket identifier to "default" when none is given', async () => {
    const consume = vi.fn(async () => true)
    setRateLimitStore({ name: 'fake', consume })

    await checkRateLimit(makeEvent(), { maxRequests: 5, windowSeconds: 60 })

    expect(consume).toHaveBeenCalledWith('default:203.0.113.1', 60_000, 5)
  })

  it('requireRateLimit throws a 429 when the store denies the request', async () => {
    setRateLimitStore({ name: 'fake', consume: async () => false })

    await expect(requireRateLimit(makeEvent(), rateLimits.standard)).rejects.toMatchObject({
      statusCode: 429,
    })
  })

  it('requireRateLimit does not throw when the store allows the request', async () => {
    setRateLimitStore({ name: 'fake', consume: async () => true })

    await expect(requireRateLimit(makeEvent(), rateLimits.standard)).resolves.toBeUndefined()
  })
})
