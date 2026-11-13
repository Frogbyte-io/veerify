// CORS for the public app API (/api/v1/**). Runs before the route handler so the headers are
// already on the response when auth or validation errors are thrown; the Tauri webview would
// otherwise see an opaque network error instead of the 401/400/429 body.
// Form submissions (/api/v1/forms/**) are left out on purpose: they take a secret server key,
// which must never be used from a browser, so browsers get no CORS grant for them. Browser forms
// use /api/public/forms/** with its own origin allowlist.
export default defineEventHandler((event) => {
  const pathname = getRequestURL(event).pathname
  if (!pathname.startsWith('/api/v1/') || pathname.startsWith('/api/v1/forms/')) return

  setResponseHeaders(event, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  })

  if (event.method === 'OPTIONS') {
    setResponseStatus(event, 204)
    return ''
  }
})
