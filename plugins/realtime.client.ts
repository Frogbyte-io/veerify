import { fetchDashboardBootstrap, getCachedDashboardBootstrap } from '~/lib/dashboard-bootstrap-client'
import { RealtimeClient } from '~/lib/realtime-client'

/**
 * Browser wiring for the reusable realtime client (SUP-00-4).
 *
 * The client itself (`lib/realtime-client.ts`) is framework-agnostic and
 * knows nothing about `window`/`document`/Nuxt bootstrap data — this plugin
 * supplies those. It is intentionally the only place that does.
 *
 * Provided as `$realtime` (usable from Options API components as
 * `this.$realtime`), and as `nuxtApp.$realtime` / `useNuxtApp().$realtime`.
 *
 * NOT wired into `NotificationBell.vue` — that component keeps its own
 * `{type:'notification'}` WebSocket consumer until SUP-00-9 resolves the
 * open design question in `docs/plans/2026-08-11-support-platform/deltas.md`
 * (D-01). `$realtime` deliberately ignores `notification` frames.
 */
export default defineNuxtPlugin(() => {
  const client = new RealtimeClient({
    getToken: async () => {
      const cached = getCachedDashboardBootstrap()
      const cachedToken = cached?.session?.session?.token
      if (cachedToken) return cachedToken

      const bootstrap = await fetchDashboardBootstrap()
      return bootstrap?.session?.session?.token ?? null
    },
    buildUrl: (token: string) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      return `${protocol}//${window.location.host}/_ws?token=${encodeURIComponent(token)}`
    },
  })

  const handleVisibilityChange = () => {
    if (document.hidden) {
      client.notifyHidden()
    } else {
      client.notifyVisible()
    }
  }

  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('focus', () => client.notifyVisible())
  window.addEventListener('pagehide', () => client.disconnect())

  return {
    provide: {
      realtime: client,
    },
  }
})

declare module '#app' {
  interface NuxtApp {
    $realtime: RealtimeClient
  }
}

declare module 'vue' {
  interface ComponentCustomProperties {
    $realtime: RealtimeClient
  }
}
