import { reactive } from 'vue'
import { apiErrorStatus } from '~/lib/api-error'
import type { ModuleSettings } from '~/lib/modules'

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

export type ActiveProjectContext = {
  project: {
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
  const promise = (async () => {
    try {
      const response = await $fetch<{ data?: ActiveProjectContext }>('/api/projects/active')
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
      if (inflight?.promise === promise) inflight = null
    }
  })()
  inflight = { generation: requestGeneration, promise }
  return promise
}

/** The cached context without a request (`undefined` if never loaded). */
export function cachedActiveProject(): ActiveProjectContext | null | undefined {
  return activeProjectStore.context
}
