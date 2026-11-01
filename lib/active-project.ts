import { reactive } from 'vue'
import { apiErrorStatus } from '~/lib/api-error'
import type { ModuleSettings } from '~/lib/modules'
import type { ProjectIdentity } from '~/lib/project-identity'

/**
 * Client-side cache of `GET /api/projects/active`, shared by the sidebar, the
 * product pickers, the marketing pages and any page that works in the active
 * project. A warm navigation renders from the cache at once and revalidates in
 * the background, so nothing flickers between pages.
 *
 * `context` is `undefined` before the first load, `null` when the user has no
 * project yet (the endpoint answers 409), and the response's `data` otherwise.
 * Switching project or toggling tools fires `veerify:active-project-changed` /
 * `veerify:project-modules-changed`; both invalidate the cache.
 */

export type ActiveProjectProduct = { id: string; name: string; slug: string; [key: string]: unknown }

/** A project the user can open, as listed in All projects (server/utils/project-summary.ts ScopeProject). */
export type ScopeProject = {
  id: string
  slug: string
  name: string
  isPublic: boolean
  role: 'admin' | 'member'
  organizationId: string
  identity: ProjectIdentity
  modules: ModuleSettings
  productCount: number
  [key: string]: unknown
}

export type ActiveProjectContext = {
  /** `'all'` while working in All projects; `project` is then the last single project. */
  scope?: 'project' | 'all'
  /** Every project the user can open in the organization. */
  projects?: ScopeProject[]
  allProjectsAvailable?: boolean
  project: {
    identity?: ProjectIdentity
    id: string
    slug: string
    name: string
    role?: 'admin' | 'member'
    isPublic?: boolean
    settings?: Record<string, unknown>
    [key: string]: unknown
  }
  organization?: { id?: string; slug?: string; name?: string; role?: string; [key: string]: unknown }
  products?: ActiveProjectProduct[]
  modules?: Partial<ModuleSettings>
  [key: string]: unknown
}

const FRESH_MS = 30_000

export const activeProjectStore = reactive({
  context: undefined as ActiveProjectContext | null | undefined,
  error: null as unknown,
  loadedAt: 0,
})

let generation = 0
let inflight: { generation: number; promise: Promise<ActiveProjectContext | null> } | null = null

export function invalidateActiveProject() {
  generation += 1
  activeProjectStore.loadedAt = 0
}

/** Forget the cached project entirely (sign-out, sign-in, workspace change). */
export function resetActiveProject() {
  invalidateActiveProject()
  inflight = null
  activeProjectStore.context = undefined
  activeProjectStore.error = null
}

if (import.meta.client) {
  window.addEventListener('veerify:active-project-changed', invalidateActiveProject)
  window.addEventListener('veerify:project-modules-changed', invalidateActiveProject)
}

/**
 * Resolve the active project. Returns the cached value while it is fresh (unless
 * `force`), and shares one request between concurrent callers. Rejects on
 * failures other than 409 (no project), keeping the last good value in the store.
 */
export function loadActiveProject(options: { force?: boolean } = {}): Promise<ActiveProjectContext | null> {
  const fresh = activeProjectStore.loadedAt > 0 && Date.now() - activeProjectStore.loadedAt < FRESH_MS
  if (!options.force && fresh && activeProjectStore.context !== undefined) {
    return Promise.resolve(activeProjectStore.context)
  }
  if (inflight && inflight.generation === generation) return inflight.promise

  const requestGeneration = generation
  const entry: { generation: number; promise: Promise<ActiveProjectContext | null> } = {
    generation: requestGeneration,
    promise: Promise.resolve(null),
  }
  entry.promise = (async () => {
    try {
      // Typed loosely: the generated route types for this endpoint are too deep for TS
      const fetchActive = $fetch as unknown as (url: string) => Promise<{ data?: ActiveProjectContext }>
      const response = await fetchActive('/api/projects/active')
      const context = response?.data?.project ? response.data : null
      if (requestGeneration === generation) {
        activeProjectStore.context = context
        activeProjectStore.error = null
        activeProjectStore.loadedAt = Date.now()
      }
      return context
    } catch (err) {
      if (apiErrorStatus(err) === 409) {
        if (requestGeneration === generation) {
          activeProjectStore.context = null
          activeProjectStore.error = null
          activeProjectStore.loadedAt = Date.now()
        }
        return null
      }
      if (requestGeneration === generation) activeProjectStore.error = err
      throw err
    } finally {
      if (inflight === entry) inflight = null
    }
  })()
  inflight = entry
  return entry.promise
}

/** The cached context without a request (`undefined` if never loaded). */
export function cachedActiveProject(): ActiveProjectContext | null | undefined {
  return activeProjectStore.context
}
