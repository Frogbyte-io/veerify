import { describe, expect, it, vi } from 'vitest'
import { createPublicCache, feedbackBoardQuery, publicCacheKey } from '~/lib/public-cache'

function makeCache() {
  let time = 1_000
  const cache = createPublicCache({ now: () => time, enabled: () => true, freshMs: 60_000 })
  return { cache, advance: (ms: number) => (time += ms) }
}

describe('public cache', () => {
  it('serves fresh entries without a second request', async () => {
    const { cache } = makeCache()
    const fetcher = vi.fn().mockResolvedValue('a')
    await cache.load('k', fetcher)
    await expect(cache.load('k', fetcher)).resolves.toBe('a')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(cache.peek('k')).toEqual({ data: 'a', stale: false })
  })

  it('dedupes concurrent requests for one key', async () => {
    const { cache } = makeCache()
    const fetcher = vi.fn().mockResolvedValue('a')
    await Promise.all([cache.load('k', fetcher), cache.load('k', fetcher)])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('keeps a stale entry readable and refetches it', async () => {
    const { cache, advance } = makeCache()
    await cache.load('k', () => Promise.resolve('old'))
    advance(61_000)
    expect(cache.peek('k')).toEqual({ data: 'old', stale: true })
    await expect(cache.load('k', () => Promise.resolve('new'))).resolves.toBe('new')
    expect(cache.peek('k')).toEqual({ data: 'new', stale: false })
  })

  it('does not cache failures and clears by prefix', async () => {
    const { cache } = makeCache()
    await expect(cache.load('a/x', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    expect(cache.peek('a/x')).toBeNull()
    await cache.load('a/x', () => Promise.resolve(1))
    await cache.load('b/x', () => Promise.resolve(2))
    cache.clear('a/')
    expect(cache.peek('a/x')).toBeNull()
    expect(cache.peek('b/x')).not.toBeNull()
  })

  it('stores nothing when disabled (server)', async () => {
    const cache = createPublicCache({ enabled: () => false })
    const fetcher = vi.fn().mockResolvedValue('a')
    await cache.load('k', fetcher)
    await cache.load('k', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(cache.peek('k')).toBeNull()
  })
})

describe('key helpers', () => {
  it('builds keys and board queries', () => {
    expect(publicCacheKey('org/proj', 'roadmap', 'web')).toBe('org/proj/roadmap/web')
    expect(feedbackBoardQuery({ page: 1, limit: 20, sortBy: 'voteCount', status: 'open' })).toBe(
      'page=1&limit=20&sortBy=voteCount&sortOrder=desc&status=open'
    )
  })
})
