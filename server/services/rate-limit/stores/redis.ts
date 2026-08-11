import type Redis from 'ioredis'
import { createLogger } from '~/server/utils/logger'
import type { RateLimitStore } from '../types'

const logger = createLogger('rate-limit')

/**
 * Atomic sliding-window log, backed by a Redis sorted set per key.
 *
 * Score = request timestamp (ms). Member = timestamp + a per-process counter,
 * so two requests landing in the same millisecond don't collide into one
 * sorted-set member and get undercounted.
 *
 * Trim-then-count-then-add runs as a single Lua script via EVAL, which makes
 * the whole operation atomic — Redis guarantees no other command interleaves
 * during a script's execution. A plain ZREMRANGEBYSCORE + ZCARD + ZADD issued
 * as separate commands from application code would race: two requests could
 * both read a count just under the limit before either writes, and both get
 * admitted, letting a burst through right at the boundary. A Lua script was
 * chosen over WATCH/MULTI because it needs a single round trip and no retry
 * loop on a failed CAS.
 */
const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)

if count < max then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)
  return 1
end

return 0
`

export function createRedisStore(client: Redis): RateLimitStore {
  // Per-process counter, not per-key: it only needs to disambiguate members
  // within the same millisecond, and a single counter is simpler than one
  // per key.
  let counter = 0

  return {
    name: 'redis',

    async consume(key: string, windowMs: number, maxRequests: number): Promise<boolean> {
      const now = Date.now()
      counter = (counter + 1) % Number.MAX_SAFE_INTEGER
      const member = `${now}-${counter}`

      try {
        const result = await client.eval(
          SLIDING_WINDOW_SCRIPT,
          1,
          key,
          String(now),
          String(windowMs),
          String(maxRequests),
          member
        )
        return result === 1
      } catch (error) {
        // Fail open: a Redis outage must not take down the public API this
        // limiter protects. Denying by default here would turn a Redis blip
        // into a full outage for feedback submission, voting, and comments.
        logger.error('Rate limit store request failed; allowing request (fail open)', {
          key,
          error: error instanceof Error ? error.message : String(error),
        })
        return true
      }
    },
  }
}
