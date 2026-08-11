import type { RateLimitStore } from '../types'

/**
 * In-memory sliding-window store. Correct for a single instance only — state
 * does not cross processes or survive a restart.
 *
 * This is `server/utils/rate-limit.ts`'s original behaviour, extracted
 * unchanged behind the `RateLimitStore` interface.
 */
export function createMemoryStore(): RateLimitStore {
  const store = new Map<string, number[]>()

  // Clean up stale entries every 5 minutes to prevent unbounded memory growth.
  const cleanup = setInterval(
    () => {
      const now = Date.now()
      for (const [key, timestamps] of store.entries()) {
        const fresh = timestamps.filter((t) => now - t < 3_600_000)
        if (fresh.length === 0) {
          store.delete(key)
        } else {
          store.set(key, fresh)
        }
      }
    },
    5 * 60 * 1000
  )

  // Allow the Node.js process to exit normally even if this timer is pending.
  if (typeof (cleanup as NodeJS.Timeout).unref === 'function') {
    ;(cleanup as NodeJS.Timeout).unref()
  }

  return {
    name: 'memory',

    async consume(key: string, windowMs: number, maxRequests: number): Promise<boolean> {
      const now = Date.now()

      // Retrieve existing timestamps and discard those outside the current window.
      const timestamps = (store.get(key) ?? []).filter((t) => now - t < windowMs)

      if (timestamps.length >= maxRequests) {
        return false
      }

      // Record this request.
      timestamps.push(now)
      store.set(key, timestamps)

      return true
    },
  }
}
