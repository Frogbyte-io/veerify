import { resetActiveProject } from '~/lib/active-project'

const DASHBOARD_BOOTSTRAP_CACHE_MAX_AGE_MS = 5 * 60 * 1000

export type DashboardBootstrap = {
  session?: {
    user?: {
      name?: string
      email?: string
      emailVerified?: boolean
    }
    session?: {
      token?: string
    }
  }
  projectContext?: {
    organizations?: Array<{ id: string; name: string; slug?: string }>
    activeOrganization?: { id: string; name: string; slug?: string } | null
    projects?: Array<Record<string, any>>
    activeProject?: Record<string, any> | null
  }
  workspace?: {
    stats?: Record<string, unknown>
  } | null
  personal?: Record<string, unknown> | null
  notifications?: {
    unreadCount?: number
  }
}

const dashboardBootstrapCache: {
  data: DashboardBootstrap | null
  loadedAt: number
  pendingRequest: Promise<DashboardBootstrap | null> | null
} = {
  data: null,
  loadedAt: 0,
  pendingRequest: null,
}

function isCacheFresh() {
  return (
    dashboardBootstrapCache.data && Date.now() - dashboardBootstrapCache.loadedAt < DASHBOARD_BOOTSTRAP_CACHE_MAX_AGE_MS
  )
}

export function getCachedDashboardBootstrap() {
  return dashboardBootstrapCache.data
}

export function setDashboardBootstrapCache(data: DashboardBootstrap | null) {
  dashboardBootstrapCache.data = data
  dashboardBootstrapCache.loadedAt = data ? Date.now() : 0
}

export function clearDashboardBootstrapCache() {
  // Every caller changes who or where the user is (sign-out, project or workspace switch,
  // invitation, onboarding), so the cached active project is stale too.
  resetActiveProject()
  dashboardBootstrapCache.data = null
  dashboardBootstrapCache.loadedAt = 0
  dashboardBootstrapCache.pendingRequest = null
}

export async function fetchDashboardBootstrap(options: { force?: boolean } = {}) {
  if (!options.force && isCacheFresh()) {
    return dashboardBootstrapCache.data
  }

  if (!dashboardBootstrapCache.pendingRequest) {
    // Called through a narrowly typed alias: Nitro's typed `$fetch` resolves the
    // response against every API route, and with the routes Marketing adds that
    // inference exceeds TypeScript's instantiation depth (TS2589).
    const fetchBootstrap = $fetch as unknown as (url: string) => Promise<{ data?: DashboardBootstrap }>
    dashboardBootstrapCache.pendingRequest = fetchBootstrap('/api/dashboard/bootstrap')
      .then((response) => {
        const data = response?.data || null
        setDashboardBootstrapCache(data)
        return data
      })
      .finally(() => {
        dashboardBootstrapCache.pendingRequest = null
      })
  }

  return dashboardBootstrapCache.pendingRequest
}
