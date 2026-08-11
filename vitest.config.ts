import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Mirrors Nuxt's `~` root alias (see .nuxt/tsconfig.json) so server
    // modules that import via `~/server/...` resolve under plain vitest,
    // without needing the full Nuxt test environment.
    alias: {
      '~': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
  },
})
