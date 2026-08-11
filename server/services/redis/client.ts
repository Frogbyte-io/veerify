import Redis, { type RedisOptions } from 'ioredis'
import { createLogger } from '~/server/utils/logger'

const logger = createLogger('redis')

/** Exponential backoff capped at 10s, so a broker outage does not spin. */
function retryStrategy(times: number): number {
  return Math.min(times * 200, 10_000)
}

function baseOptions(): RedisOptions {
  return {
    retryStrategy,
    // Queue commands issued while disconnected rather than throwing at call sites.
    enableOfflineQueue: true,
    maxRetriesPerRequest: null,
  }
}

/**
 * Create a new, independent ioredis connection against `url`, with the
 * shared retry strategy and error logging.
 *
 * Use this directly whenever a subsystem needs a *dedicated* socket — most
 * notably a pub/sub subscriber, since a Redis connection in subscriber mode
 * cannot issue any other command. Anything that only issues regular commands
 * (GET/SET/EVAL/PUBLISH/...) should prefer `getSharedRedisClient` instead of
 * calling this, so subsystems don't each open their own socket for no reason.
 */
export function createRedisConnection(url: string, label: string): Redis {
  const client = new Redis(url, baseOptions())

  client.on('error', (error: Error) => {
    logger.error('Redis connection error', { label, error: error.message })
  })

  return client
}

const sharedClients = new Map<string, Redis>()

/**
 * Process-wide shared connection for regular (non-subscriber) command usage,
 * keyed by `url`. Subsystems that only issue commands — rate limiting,
 * realtime publish — share one socket instead of each constructing their own
 * client with its own retry/error-logging behaviour. Only subscriber-mode
 * usage needs its own dedicated connection; see `createRedisConnection`.
 *
 * Callers that hold this client must not `quit()`/`disconnect()` it — it is
 * not theirs to close. Use `resetSharedRedisClients` (tests) for teardown.
 */
export function getSharedRedisClient(url: string): Redis {
  let client = sharedClients.get(url)
  if (!client) {
    client = createRedisConnection(url, 'shared')
    sharedClients.set(url, client)
  }
  return client
}

/** Test seam: drop cached shared clients so a new URL or mock takes effect. */
export function resetSharedRedisClients(): void {
  for (const client of sharedClients.values()) {
    client.disconnect()
  }
  sharedClients.clear()
}
