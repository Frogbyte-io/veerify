import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // Vitest bundles a Vite type version that differs from Nuxt's root Vite.
  // The plugin is runtime-compatible; this cast only bridges those declarations.
  plugins: [vue() as never],
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
    // e2e requires Playwright; integration requires a real Redis. Both run via
    // their own `*:if-available` guarded script, never the default `yarn test`.
    exclude: ['tests/e2e/**', 'tests/integration/**'],
  },
})
