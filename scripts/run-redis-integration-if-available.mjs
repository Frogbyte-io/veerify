import { spawnSync } from 'node:child_process'
import Redis from 'ioredis'
import 'dotenv/config'
import { isDedicatedRedisUrl } from './redis-integration-policy.mjs'

/**
 * Guarded runner for the Redis/rate-limit integration suite (delta D-15).
 *
 * Mirrors `run-playwright-if-available.mjs`: skip cleanly with a clear reason
 * when the dependency isn't reachable, so `yarn harness:verify` stays green on
 * a machine with no Redis running, while still exercising the real driver
 * against local Valkey or an explicitly dedicated remote integration endpoint.
 */

const isCloudEnvironment = Boolean(
  process.env.GITHUB_ACTIONS || process.env.VERCEL || process.env.CIRCLECI || process.env.BUILDKITE || process.env.CI
)
const failOnPreflightSkip =
  process.env.REDIS_INTEGRATION_SKIP_IS_FAILURE === '1' ||
  (isCloudEnvironment && process.env.REDIS_INTEGRATION_SKIP_IS_FAILURE !== '0')

// Unlike the Playwright guard (which requires cloud/CI or an explicit force
// flag), this one runs by default whenever a local or explicitly dedicated
// Redis endpoint is reachable. Shared/production endpoints are rejected
// because the reconnect test intentionally kills every pub/sub connection.
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
const connectTimeoutMs = Number(process.env.REDIS_INTEGRATION_CONNECT_TIMEOUT_MS) || 2_000

async function verifyRedisAvailable() {
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: connectTimeoutMs,
    retryStrategy: () => null, // don't retry during the preflight check
    enableOfflineQueue: false,
  })

  // Without a listener, ioredis's connection-failure error surfaces as an
  // "Unhandled error event" crash-looking dump on stderr, even though it is
  // the entirely expected outcome of this preflight check. The skip message
  // below is the actual, readable report of what happened.
  client.on('error', () => {})

  try {
    await client.connect()
    const pong = await client.ping()
    return pong === 'PONG'
  } catch {
    return false
  } finally {
    client.disconnect()
  }
}

// The reconnect test uses CLIENT KILL TYPE pubsub, which is intentionally
// destructive to every realtime subscriber on the target server. Only run it
// against a local container or an endpoint explicitly declared dedicated to
// this suite; never point it at a shared/production Redis by accident.
const dedicatedRedis = isDedicatedRedisUrl(redisUrl)
const redisAvailable = dedicatedRedis ? await verifyRedisAvailable() : false

if (!redisAvailable) {
  // Do not echo redisUrl: REDIS_URL may contain a username and password, and
  // CI logs are not a safe place to disclose credentials.
  const reason = dedicatedRedis
    ? 'Redis is not reachable'
    : 'REDIS_URL is not local or explicitly marked as a dedicated integration endpoint'

  if (failOnPreflightSkip) {
    console.error(`[redis-integration] Preflight failed: ${reason}.`)
    process.exit(1)
  }

  console.log(`[redis-integration] Skipping: ${reason}.`)
  console.log('[redis-integration] Start it locally with: docker compose -f docker-compose-dev.yml up -d valkey')
  process.exit(0)
}

const command = process.platform === 'win32' ? 'yarn.cmd' : 'yarn'
const result = spawnSync(command, ['test:integration', 'tests/integration/redis.test.ts'], {
  stdio: 'inherit',
  env: { ...process.env, REDIS_URL: redisUrl },
  shell: process.platform === 'win32',
})

if (result.error) {
  throw result.error
}

process.exit(result.status ?? 1)
