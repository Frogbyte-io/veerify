import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * Separate config for the Redis integration suite (delta D-15), kept out of
 * the default `yarn test` run since it requires a real Redis/Valkey server.
 * Run via `yarn test:integration:if-available`, which checks reachability
 * first and skips with a clear reason when none is running.
 */
export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./', import.meta.url)),
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    globals: true,
    include: ['tests/integration/**/*.test.ts'],
    // These suites exercise global claim queues and shared database tables.
    // Running files concurrently lets one suite claim another suite's
    // intentionally pending row, which is not application behavior under
    // test. Keep files serial; concurrency inside each suite remains explicit.
    fileParallelism: false,
    // Integration tests exercise real network round trips and, for the
    // reconnect case, a deliberate multi-second wait for ioredis's retry
    // strategy — the default 5s test timeout is too tight.
    testTimeout: 15_000,
  },
})
