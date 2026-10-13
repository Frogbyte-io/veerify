import { createRedisConnection, getSharedRedisClient } from '~/server/services/redis/client'
import { createLogger } from '~/server/utils/logger'
import { parseEnvelope, type RealtimeDriver, type RealtimeEnvelope, type RealtimeHandler } from '../types'

const logger = createLogger('realtime')

/**
 * Redis pub/sub driver.
 *
 * Written against the Redis wire protocol via ioredis rather than a
 * vendor SDK, so Upstash (cloud) and Valkey (self-hosted) are the same code
 * behind one `REDIS_URL`. Swapping providers is a connection string, not a port.
 *
 * Two connections are required: a Redis connection in subscriber mode cannot
 * issue any other command, so publishing needs its own socket. The publisher
 * uses the process-wide shared client (also used by the rate limiter); the
 * subscriber is a dedicated connection built from the same factory.
 */
export function createRedisDriver(url: string): RealtimeDriver {
  const publisher = getSharedRedisClient(url)
  const subscriber = createRedisConnection(url, 'realtime-subscriber')

  /** Local fan-out map. One Redis subscription per channel, many handlers per channel. */
  const handlers = new Map<string, Set<RealtimeHandler>>()

  // ioredis restores subscriptions itself after a reconnect, but re-issuing is
  // idempotent and guards against a dropped SUBSCRIBE during the handshake.
  subscriber.on('ready', () => {
    const channels = [...handlers.keys()]
    if (channels.length === 0) return
    subscriber.subscribe(...channels).catch((error: Error) => {
      logger.error('Failed to restore realtime subscriptions', {
        error: error.message,
        channelCount: channels.length,
      })
    })
  })

  subscriber.on('message', (channel: string, message: string) => {
    const envelope = parseEnvelope(message)
    if (!envelope) {
      logger.warn('Discarded malformed realtime message', { channel })
      return
    }

    const channelHandlers = handlers.get(channel)
    if (!channelHandlers) return

    for (const handler of [...channelHandlers]) {
      try {
        handler(envelope, channel)
      } catch (error) {
        logger.error('Realtime handler threw', {
          channel,
          type: envelope.type,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  })

  return {
    name: 'redis',

    async publish(channel: string, envelope: RealtimeEnvelope) {
      try {
        await publisher.publish(channel, JSON.stringify(envelope))
      } catch (error) {
        // Realtime is an enhancement, never a correctness dependency. A broker
        // failure must not fail the HTTP request that triggered it.
        logger.error('Failed to publish realtime envelope', {
          channel,
          type: envelope.type,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },

    async subscribe(channel: string, handler: RealtimeHandler) {
      const existing = handlers.get(channel)

      if (existing) {
        existing.add(handler)
        return
      }

      handlers.set(channel, new Set([handler]))
      await subscriber.subscribe(channel)
    },

    async unsubscribe(channel: string, handler: RealtimeHandler) {
      const channelHandlers = handlers.get(channel)
      if (!channelHandlers) return

      channelHandlers.delete(handler)
      if (channelHandlers.size > 0) return

      handlers.delete(channel)
      await subscriber.unsubscribe(channel)
    },

    async close() {
      handlers.clear()
      // `publisher` is the process-wide shared client and may still be in use
      // by other subsystems (e.g. the rate limiter) — this driver only owns
      // its dedicated subscriber connection, so only that one is quit here.
      await subscriber.quit().catch((error: Error) => {
        logger.error('Failed to close realtime subscriber cleanly', { error: error.message })
      })
    },
  }
}
