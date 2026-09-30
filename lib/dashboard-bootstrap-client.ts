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
  teamContext?: {
    teams?: unknown[]
    activeTeam?: Record<string, unknown> | null
    activeOrganization?: Record<string, unknown> | null
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
  dashboardBootstrapCache.data = null
  dashboardBootstrapCache.loadedAt = 0
  dashboardBootstrapCache.pendingRequest = null
}

export async function fetchDashboardBootstrap(options: { force?: boolean } = {}) {
  if (!options.force && isCacheFresh()) {
    return dashboardBootstrapCache.data
  }

  if (!dashboardBootstrapCache.pendingRequest) {
    dashboardBootstrapCache.pendingRequest = $fetch<{ data?: DashboardBootstrap }>('/api/dashboard/bootstrap')
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
