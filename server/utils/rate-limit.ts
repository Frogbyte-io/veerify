/**
 * Rate limiting utilities
 *
 * Implements a sliding window rate limiter using an in-memory Map.
 * Works correctly for single-instance deployments. For multi-instance
 * deployments, swap the in-memory store for a shared Redis backend
 * (e.g. @upstash/ratelimit).
 */

import type { H3Event } from 'h3'
import { ErrorCode, createErrorResponse } from './response'

export interface RateLimitConfig {
  /**
   * Maximum number of requests allowed in the time window
   */
  maxRequests: number

  /**
   * Time window in seconds
   */
  windowSeconds: number

  /**
   * Optional identifier for different rate limit buckets
   */
  identifier?: string
}

// In-memory store: key → array of request timestamps (ms)
const _store = new Map<string, number[]>()

// Clean up stale entries every 5 minutes to prevent unbounded memory growth
const _cleanup = setInterval(
  () => {
    const now = Date.now()
    for (const [key, timestamps] of _store.entries()) {
      const fresh = timestamps.filter((t) => now - t < 3_600_000)
      if (fresh.length === 0) {
        _store.delete(key)
      } else {
        _store.set(key, fresh)
      }
    }
  },
  5 * 60 * 1000
)

// Allow the Node.js process to exit normally even if this timer is pending
if (typeof (_cleanup as NodeJS.Timeout).unref === 'function') {
  ;(_cleanup as NodeJS.Timeout).unref()
}

/**
 * Checks whether a client is within its rate limit for the given configuration.
 * Uses a sliding window algorithm.
 *
 * @param event - H3 event
 * @param config - Rate limit configuration
 * @returns True if the request is within limits; false if the limit has been exceeded
 */
export async function checkRateLimit(event: H3Event, config: RateLimitConfig): Promise<boolean> {
  const clientId = getClientId(event)
  const key = `${config.identifier ?? 'default'}:${clientId}`
  const now = Date.now()
  const windowMs = config.windowSeconds * 1000

  // Retrieve existing timestamps and discard those outside the current window
  const timestamps = (_store.get(key) ?? []).filter((t) => now - t < windowMs)

  if (timestamps.length >= config.maxRequests) {
    return false
  }

  // Record this request
  timestamps.push(now)
  _store.set(key, timestamps)

  return true
}

/**
 * Rate limit middleware — throws 429 if limit exceeded.
 *
 * @param event - H3 event
 * @param config - Rate limit configuration
 * @throws 429 Too Many Requests if rate limit exceeded
 */
export async function requireRateLimit(event: H3Event, config: RateLimitConfig): Promise<void> {
  const allowed = await checkRateLimit(event, config)

  if (!allowed) {
    throw createError({
      statusCode: 429,
      statusMessage: 'Too Many Requests',
      data: createErrorResponse(ErrorCode.RATE_LIMITED, 'Rate limit exceeded. Please try again later.', {
        maxRequests: config.maxRequests,
        windowSeconds: config.windowSeconds,
      }),
    })
  }
}

/**
 * Gets a unique client identifier for rate limiting.
 * Prefers the first IP from X-Forwarded-For, falls back to the socket remote address.
 *
 * @param event - H3 event
 * @returns Client identifier string
 */
function getClientId(event: H3Event): string {
  const forwarded = event.node.req.headers['x-forwarded-for']
  const ip = forwarded
    ? Array.isArray(forwarded)
      ? forwarded[0]
      : forwarded.split(',')[0].trim()
    : event.node.req.socket.remoteAddress

  return ip || 'unknown'
}

/**
 * Common rate limit configurations
 */
export const rateLimits = {
  // Strict — for sensitive write operations (feedback submission, auth)
  strict: {
    maxRequests: 5,
    windowSeconds: 60, // 5 requests per minute
  },

  // Standard — for most write endpoints (comments, etc.)
  standard: {
    maxRequests: 60,
    windowSeconds: 60, // 60 requests per minute
  },

  // Relaxed — for high-frequency interactions (voting, reads)
  relaxed: {
    maxRequests: 100,
    windowSeconds: 60, // 100 requests per minute
  },

  // Webhooks — for external webhook ingestion
  webhook: {
    maxRequests: 1000,
    windowSeconds: 60, // 1000 requests per minute
  },
} as const
