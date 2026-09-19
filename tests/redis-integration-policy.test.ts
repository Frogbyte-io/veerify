import { describe, expect, it } from 'vitest'

const { isDedicatedRedisUrl, isLocalRedisUrl } = await import('../scripts/redis-integration-policy.mjs')

describe('Redis integration endpoint policy', () => {
  it.each(['redis://localhost:6379', 'redis://127.0.0.1:6379', 'redis://[::1]:6379', 'redis://valkey:6379'])(
    'accepts local endpoint %s',
    (url) => {
      expect(isLocalRedisUrl(url)).toBe(true)
      expect(isDedicatedRedisUrl(url, {})).toBe(true)
    }
  )

  it('accepts a remote endpoint only when explicitly dedicated', () => {
    const url = 'redis://shared.example.test:6379'
    expect(isLocalRedisUrl(url)).toBe(false)
    expect(isDedicatedRedisUrl(url, {})).toBe(false)
    expect(isDedicatedRedisUrl(url, { REDIS_INTEGRATION_DEDICATED: '1' })).toBe(true)
  })

  it.each(['http://localhost:6379', 'https://127.0.0.1:6379'])('rejects non-Redis schemes: %s', (url) => {
    expect(isLocalRedisUrl(url)).toBe(false)
    expect(isDedicatedRedisUrl(url, {})).toBe(false)
  })
})
