import { getSharedRedisClient } from '~/server/services/redis/client'
import { createLogger } from '~/server/utils/logger'
import { createMemoryStore } from './stores/memory'
import { createRedisStore } from './stores/redis'
import type { RateLimitStore } from './types'

export * from './types'

const logger = createLogger('rate-limit')

let store: RateLimitStore | null = null

function resolveStoreName(): 'redis' | 'memory' {
  const configured = (process.env.RATE_LIMIT_STORE || '').trim().toLowerCase()

  if (configured === 'redis') return 'redis'
  if (configured === 'memory') return 'memory'

  // Unset: infer from whether a broker is configured, so a fresh clone boots
  // without any rate-limit configuration at all. Mirrors
  // `server/services/realtime/index.ts`'s `resolveDriverName`.
  return process.env.REDIS_URL ? 'redis' : 'memory'
}

function createStore(): RateLimitStore {
  const name = resolveStoreName()

  if (name === 'redis') {
    const url = process.env.REDIS_URL
    if (!url) {
      // Explicitly asking for redis without a URL is a misconfiguration, not a
      // reason to silently degrade — say so, then keep serving.
      logger.error('RATE_LIMIT_STORE=redis but REDIS_URL is not set; falling back to the in-memory store')
      return createMemoryStore()
    }
    logger.info('Rate limit store: redis')
    return createRedisStore(getSharedRedisClient(url))
  }

  logger.info('Rate limit store: memory (single instance only)')
  return createMemoryStore()
}

/** Process-wide store. Constructed on first use. */
export function getRateLimitStore(): RateLimitStore {
  if (!store) store = createStore()
  return store
}

/** Test seam: force a specific store instance. */
export function setRateLimitStore(next: RateLimitStore | null): void {
  store = next
}
