import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    // Mirrors Nuxt's `~` and `@` root aliases (see .nuxt/tsconfig.json) so server
    // modules that import via `~/server/...` resolve under plain vitest, without
    // needing the full Nuxt test environment. Without this, any test that
    // transitively imports a server util fails to collect.
    alias: {
      '~': fileURLToPath(new URL('./', import.meta.url)),
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
  },
})
