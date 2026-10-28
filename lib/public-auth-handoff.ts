export const PUBLIC_AUTH_HANDOFF_QUERY_PARAM = 'authHandoff'

function stripPublicAuthHandoffTokenFromUrl() {
  if (!import.meta.client) return

  const url = new URL(window.location.href)
  url.searchParams.delete(PUBLIC_AUTH_HANDOFF_QUERY_PARAM)
  window.history.replaceState({}, '', url.toString())
}

export async function completePublicAuthHandoffFromUrl() {
  if (!import.meta.client) return false

  const url = new URL(window.location.href)
  const token = url.searchParams.get(PUBLIC_AUTH_HANDOFF_QUERY_PARAM)
  if (!token) return false

  try {
    await $fetch('/api/public/auth/handoff/consume', {
      method: 'POST',
      body: { token },
    })
    return true
  } finally {
    stripPublicAuthHandoffTokenFromUrl()
  }
}

export async function fetchPublicAuthSession() {
  // Untyped call: the typed Nitro route map made inference for this path exceed the instantiation depth limit.
  const fetchSession = $fetch as unknown as (url: string) => Promise<{ data?: { session?: any; user?: any } | null }>
  const response = await fetchSession('/api/public/auth/session')
  return response?.data || { session: null, user: null }
}
