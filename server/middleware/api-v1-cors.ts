// CORS for the public app API (/api/v1/**). Runs before the route handler so the headers are
// already on the response when auth or validation errors are thrown; the Tauri webview would
// otherwise see an opaque network error instead of the 401/400/429 body.
export default defineEventHandler((event) => {
  const pathname = getRequestURL(event).pathname
  if (!pathname.startsWith('/api/v1/')) return

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
