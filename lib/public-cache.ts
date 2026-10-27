/**
 * Small client-side cache for the public project site (one entry per org,
 * project, tab and filter). Entries are fresh for 60 s, concurrent requests for
 * the same key share one network call, and a stale entry can still be shown
 * while it is revalidated (stale-while-revalidate). The cache lives in module
 * scope on the client only; on the server nothing is stored, so requests never
 * leak into each other.
 */

export const PUBLIC_CACHE_FRESH_MS = 60_000

export interface PublicCacheHit<T> {
  data: T
  /** Older than the freshness window: show it, then revalidate */
  stale: boolean
}

export interface PublicCacheOptions {
  now?: () => number
  enabled?: () => boolean
  freshMs?: number
}

interface Entry {
  data: unknown
  at: number
  hasData: boolean
  promise: Promise<unknown> | null
}

export function createPublicCache(options: PublicCacheOptions = {}) {
  const now = options.now ?? (() => Date.now())
  const enabled = options.enabled ?? (() => Boolean(import.meta.client))
  const freshMs = options.freshMs ?? PUBLIC_CACHE_FRESH_MS
  const store = new Map<string, Entry>()

  function peek<T>(key: string): PublicCacheHit<T> | null {
    const entry = store.get(key)
    if (!entry || !entry.hasData) return null
    return { data: entry.data as T, stale: now() - entry.at >= freshMs }
  }

  /**
   * Resolve `key` from the cache or `fetcher`. Fresh entries and in-flight
   * requests are reused; `force` skips only the freshness check (an in-flight
   * request is still shared).
   */
  function load<T>(key: string, fetcher: () => Promise<T>, opts: { force?: boolean } = {}): Promise<T> {
    if (!enabled()) return fetcher()
    const existing = store.get(key)
    if (existing?.promise) return existing.promise as Promise<T>
    if (existing?.hasData && !opts.force && now() - existing.at < freshMs) {
      return Promise.resolve(existing.data as T)
    }
    const entry: Entry = existing ?? { data: undefined, at: 0, hasData: false, promise: null }
    const promise = fetcher()
      .then((data) => {
        // `clear` may have dropped the entry while the request was in flight
        if (store.get(key) === entry) {
          entry.data = data
          entry.at = now()
          entry.hasData = true
        }
        return data
      })
      .finally(() => {
        entry.promise = null
        if (!entry.hasData && store.get(key) === entry) store.delete(key)
      })
    entry.promise = promise
    store.set(key, entry)
    return promise
  }

  /** Warm a key; failures are swallowed (the real load will surface them). */
  function prefetch<T>(key: string, fetcher: () => Promise<T>): void {
    load(key, fetcher).catch(() => {})
  }

  /** Drop every entry whose key starts with `prefix` (all entries without one). */
  function clear(prefix = ''): void {
    for (const key of [...store.keys()]) {
      if (key.startsWith(prefix)) store.delete(key)
    }
  }

  return { peek, load, prefetch, clear }
}

export const publicCache = createPublicCache()

/** Cache key: `org/project/tab/<filter>`. */
export function publicCacheKey(scope: string, tab: string, filter = ''): string {
  return `${scope}/${tab}/${filter}`
}

/** `org/project` scope shared by every key of one project. */
export function publicCacheScope(orgSlug: string, projectSlug: string): string {
  return `${orgSlug}/${projectSlug}`
}

export function publicApiBase(orgSlug: string, projectSlug: string): string {
  return `/api/public/o/${encodeURIComponent(orgSlug)}/${encodeURIComponent(projectSlug)}`
}

export type PublicTab = 'feedback' | 'roadmap' | 'changelog' | 'testimonials'

/** Query string of a feedback board page (also the filter part of its cache key). */
export function feedbackBoardQuery(params: {
  page: number
  limit: number
  sortBy: string
  status?: string
  categoryId?: string
  tag?: string
}): string {
  const query = new URLSearchParams()
  query.set('page', String(params.page))
  query.set('limit', String(params.limit))
  query.set('sortBy', params.sortBy)
  query.set('sortOrder', 'desc')
  if (params.status) query.set('status', params.status)
  if (params.categoryId) query.set('categoryId', params.categoryId)
  if (params.tag) query.set('tag', params.tag)
  return query.toString()
}

/**
 * Cache key + fetcher for a tab's first page of data. Used both by the tab
 * bodies and by the shell's hover/focus prefetch, so both hit the same entry.
 * Returns null for a feedback board without a chosen product.
 */
export function publicTabRequest(
  tab: PublicTab,
  orgSlug: string,
  projectSlug: string,
  opts: { product?: string; productSlug?: string } = {}
): { key: string; fetcher: () => Promise<unknown> } | null {
  const scope = publicCacheScope(orgSlug, projectSlug)
  const base = publicApiBase(orgSlug, projectSlug)
  const product = opts.product || ''
  if (tab === 'roadmap') {
    return {
      key: publicCacheKey(scope, 'roadmap', product),
      fetcher: () => $fetch(`${base}/roadmap`, { query: product ? { product } : {} }),
    }
  }
  if (tab === 'changelog') {
    return {
      key: publicCacheKey(scope, 'changelog', product),
      fetcher: () => $fetch(`${base}/changelog`, { query: product ? { product } : {} }),
    }
  }
  if (tab === 'testimonials') {
    return { key: publicCacheKey(scope, 'testimonials'), fetcher: () => $fetch(`${base}/testimonials`) }
  }
  const productSlug = opts.productSlug || ''
  if (!productSlug) return null
  const query = feedbackBoardQuery({ page: 1, limit: 20, sortBy: 'voteCount' })
  return {
    key: publicCacheKey(scope, 'feedback', `${productSlug}?${query}`),
    fetcher: () => $fetch(`${base}/products/${encodeURIComponent(productSlug)}/feedback?${query}`),
  }
}
