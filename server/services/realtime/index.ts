import { createLogger } from '~/server/utils/logger'
import { createMemoryDriver } from './drivers/memory'
import { createRedisDriver } from './drivers/redis'
import { createEnvelope, type RealtimeDriver, type RealtimeEnvelope, type RealtimeHandler } from './types'

export * from './types'

const logger = createLogger('realtime')

let driver: RealtimeDriver | null = null

function resolveDriverName(): 'redis' | 'memory' {
  const configured = (process.env.REALTIME_DRIVER || '').trim().toLowerCase()

  if (configured === 'redis') return 'redis'
  if (configured === 'memory') return 'memory'

  // Unset: infer from whether a broker is configured, so a fresh clone boots
  // without any realtime configuration at all.
  return process.env.REDIS_URL ? 'redis' : 'memory'
}

function createDriver(): RealtimeDriver {
  const name = resolveDriverName()

  if (name === 'redis') {
    const url = process.env.REDIS_URL
    if (!url) {
      // Explicitly asking for redis without a URL is a misconfiguration, not a
      // reason to silently degrade — say so, then keep serving.
      logger.error('REALTIME_DRIVER=redis but REDIS_URL is not set; falling back to the in-memory driver')
      return createMemoryDriver()
    }
    logger.info('Realtime driver: redis')
    return createRedisDriver(url)
  }

  logger.info('Realtime driver: memory (single instance only)')
  return createMemoryDriver()
}

/** Process-wide driver. Constructed on first use. */
export function getRealtimeDriver(): RealtimeDriver {
  if (!driver) driver = createDriver()
  return driver
}

/**
 * Publish an event to a channel.
 *
 * Never throws: realtime delivery is an enhancement layered on top of the HTTP
 * API, so a broker outage must not turn a successful write into a failed request.
 */
export async function publishRealtime(
  channel: string,
  input: Omit<RealtimeEnvelope, 'v'> & { v?: number }
): Promise<void> {
  try {
    await getRealtimeDriver().publish(channel, createEnvelope(input))
  } catch (error) {
    logger.error('publishRealtime failed', {
      channel,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function subscribeRealtime(channel: string, handler: RealtimeHandler): Promise<void> {
  await getRealtimeDriver().subscribe(channel, handler)
}

export async function unsubscribeRealtime(channel: string, handler: RealtimeHandler): Promise<void> {
  await getRealtimeDriver().unsubscribe(channel, handler)
}

/** Tear down the driver. Used by tests and graceful shutdown. */
export async function closeRealtime(): Promise<void> {
  if (!driver) return
  const current = driver
  driver = null
  await current.close()
}

/** Test seam: force a specific driver instance. */
export function setRealtimeDriver(next: RealtimeDriver | null): void {
  driver = next
}
