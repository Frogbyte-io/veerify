import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import Redis from 'ioredis'

import { createRedisDriver } from '~/server/services/realtime/drivers/redis'
import { createEnvelope } from '~/server/services/realtime/types'
import { createRedisStore } from '~/server/services/rate-limit/stores/redis'

/**
 * Integration coverage for the Redis driver and the Lua rate-limit script
 * against a real Redis/Valkey server (delta D-15).
 *
 * Everything else in the suite exercises the memory driver or a fake client.
 * Cross-instance delivery is the entire premise of Stage 00's Redis decision,
 * and notifications (SUP-00-9) now depend on it too, so this is the one place
 * that proves the actual wire behaviour rather than the interface contract.
 *
 * Skipped entirely unless a real Redis is reachable — see
 * `scripts/run-redis-integration-if-available.mjs`.
 */

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

function uniqueChannel(label: string): string {
  // Random suffix so parallel runs (or a re-run right after a failure) never
  // collide on a channel or key another run is still using.
  return `test:${label}:${Math.random().toString(36).slice(2)}`
}

describe('redis realtime driver (integration)', () => {
  const drivers: Array<{ close: () => Promise<void> }> = []
  let admin: Redis

  beforeAll(() => {
    // Separate connection used only to force server-side disconnects for the
    // reconnect test (CLIENT KILL) — kept apart from any driver connection so
    // killing it never dismantles the thing being tested.
    admin = new Redis(REDIS_URL)
  })

  afterEach(async () => {
    for (const driver of drivers.splice(0)) {
      await driver.close()
    }
  })

  afterAll(async () => {
    await admin.quit()
  })

  it('delivers a publish from one driver instance to a subscriber on another', async () => {
    // Each createRedisDriver() call gets its own dedicated subscriber socket
    // (a Redis connection in subscriber mode can't issue other commands), so
    // this exercises the real fan-out path even though both calls share one
    // process-wide publisher client. That sharing only affects which local
    // object issues PUBLISH; the message still travels through Redis and back
    // down each subscriber's own socket, which is the behaviour under test.
    const instanceA = createRedisDriver(REDIS_URL)
    const instanceB = createRedisDriver(REDIS_URL)
    drivers.push(instanceA, instanceB)

    const channel = uniqueChannel('cross-instance')
    const received: unknown[] = []

    await instanceB.subscribe(channel, (envelope) => received.push(envelope))
    // Give the SUBSCRIBE a moment to land before publishing — otherwise the
    // publish can race the subscription and the message is lost, which is
    // real Redis pub/sub semantics (no backlog for a subscriber that wasn't
    // listening yet), not a bug in the driver.
    await new Promise((resolve) => setTimeout(resolve, 100))

    const envelope = createEnvelope({ type: 'conversation.created', teamId: 't1', conversationId: 'c1' })
    await instanceA.publish(channel, envelope)

    await waitForCondition(() => received.length > 0)

    expect(received[0]).toEqual(envelope)
  })

  it('does not deliver a publish to a subscriber on a different channel', async () => {
    const driver = createRedisDriver(REDIS_URL)
    drivers.push(driver)

    const channelA = uniqueChannel('isolation-a')
    const channelB = uniqueChannel('isolation-b')
    const received: unknown[] = []

    await driver.subscribe(channelA, (envelope) => received.push(envelope))
    await new Promise((resolve) => setTimeout(resolve, 100))

    await driver.publish(channelB, createEnvelope({ type: 'x', teamId: 't1' }))

    // Give a would-be leak time to arrive, then assert it didn't.
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(received).toHaveLength(0)
  })

  it('restores subscriptions after the subscriber connection is dropped', async () => {
    const driver = createRedisDriver(REDIS_URL)
    drivers.push(driver)

    const channel = uniqueChannel('reconnect')
    const received: unknown[] = []

    await driver.subscribe(channel, (envelope) => received.push(envelope))
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Force a server-side disconnect of every subscriber-mode connection.
    // Valkey/Redis support CLIENT KILL TYPE pubsub for exactly this — it
    // drops the driver's subscriber socket without touching `admin`, which
    // issued the kill and is not itself in subscriber mode.
    await admin.call('CLIENT', 'KILL', 'TYPE', 'pubsub').catch(() => {
      // No matching connections is not a failure — it just means the driver
      // hadn't finished subscribing yet, which the next publish will expose.
    })

    // ioredis's retryStrategy caps backoff at 10s (server/services/redis/client.ts);
    // give it real time to reconnect and for the driver's `on('ready', ...)`
    // handler to re-issue SUBSCRIBE, rather than asserting on a fixed delay.
    await waitForCondition(
      async () => {
        received.length = 0
        await driver.publish(channel, createEnvelope({ type: 'x', teamId: 't1' }))
        await new Promise((resolve) => setTimeout(resolve, 200))
        return received.length > 0
      },
      { timeoutMs: 12_000, intervalMs: 500 }
    )

    expect(received.length).toBeGreaterThan(0)
  })
})

describe('redis rate limit store (integration)', () => {
  let client: Redis

  beforeAll(() => {
    client = new Redis(REDIS_URL)
  })

  afterAll(async () => {
    await client.quit()
  })

  it('admits exactly the configured limit under concurrent requests', async () => {
    // This is what the Lua script exists to prevent: a plain
    // ZREMRANGEBYSCORE + ZCARD + ZADD issued as separate commands would race,
    // letting a burst through right at the boundary. Firing more concurrent
    // requests than the limit and counting exact admissions is the only way
    // to actually exercise that race rather than just trusting the script.
    const store = createRedisStore(client)
    const key = uniqueChannel('atomicity')
    const limit = 5
    const attempts = 25

    const results = await Promise.all(Array.from({ length: attempts }, () => store.consume(key, 60_000, limit)))

    expect(results.filter(Boolean)).toHaveLength(limit)
    expect(results.filter((r) => !r)).toHaveLength(attempts - limit)
  })

  it('frees up slots once the window passes', async () => {
    const store = createRedisStore(client)
    const key = uniqueChannel('window-expiry')
    const windowMs = 500

    expect(await store.consume(key, windowMs, 1)).toBe(true)
    expect(await store.consume(key, windowMs, 1)).toBe(false)

    await new Promise((resolve) => setTimeout(resolve, windowMs + 200))

    expect(await store.consume(key, windowMs, 1)).toBe(true)
  })

  it('fails open when Redis is unreachable', async () => {
    // A Redis outage must not take down the public API this limiter
    // protects. Point the store at a port nothing listens on, with
    // reconnection disabled, so the command rejects promptly instead of
    // queuing forever under enableOfflineQueue — the failure this test
    // forces is deliberately faster than production's real retry behaviour,
    // it just needs to exercise the same catch block.
    const unreachable = new Redis('redis://127.0.0.1:1', {
      lazyConnect: true,
      connectTimeout: 500,
      retryStrategy: () => null,
      enableOfflineQueue: false,
    })

    const store = createRedisStore(unreachable)

    await expect(store.consume(uniqueChannel('fail-open'), 60_000, 1)).resolves.toBe(true)

    unreachable.disconnect()
  })
})

/**
 * Poll `check` until it returns truthy or `timeoutMs` elapses. Vitest's
 * built-in `vi.waitFor` is designed for the fake-timer/synchronous case; this
 * suite waits on real network round trips and real ioredis reconnect timers,
 * so a plain polling loop against wall-clock time is the honest tool here.
 */
async function waitForCondition(
  check: () => boolean | Promise<boolean>,
  options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5_000
  const intervalMs = options.intervalMs ?? 100
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(`waitForCondition: condition not met within ${timeoutMs}ms`)
}
