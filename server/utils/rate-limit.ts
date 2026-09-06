/**
 * Rate limiting utilities
 *
 * Implements a sliding window rate limiter. Storage is pluggable via
 * `server/services/rate-limit/` — an in-memory store (default, correct for a
 * single instance) or a Redis-backed store (correct across instances),
 * selected the same way the realtime driver is: `RATE_LIMIT_STORE` env var,
 * inferred from `REDIS_URL` when unset.
 */

import type { H3Event } from 'h3'
import { getRateLimitStore } from '~/server/services/rate-limit'
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

  /**
   * Optional stable subject for traffic that shares a client IP, such as a
   * webhook provider delivering for many inboxes.
   */
  subject?: string
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
  const subject = config.subject ?? getClientId(event)
  const key = `${config.identifier ?? 'default'}:${subject}`
  const windowMs = config.windowSeconds * 1000

  return getRateLimitStore().consume(key, windowMs, config.maxRequests)
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
