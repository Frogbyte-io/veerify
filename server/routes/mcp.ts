/**
 * MCP endpoint for personal API keys (`claude mcp add --transport http veerify <host>/mcp
 * --header "Authorization: Bearer vfy_usr_…"`).
 *
 * Stateless Streamable HTTP: every POST gets a fresh McpServer + transport bound to the
 * request's credentials, with JSON responses and no SSE stream, so GET and DELETE are 405.
 * Only credential principals (bearer keys) are accepted; a cookie session gets 401.
 */
import type { H3Event } from 'h3'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { requireAuth, isCredentialPrincipal, type AuthSession } from '~/server/utils/auth-middleware'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import { createVeerifyMcpServer } from '~/server/mcp/server'
import { createApiCaller } from '~/server/mcp/api-bridge'
import { readMcpJsonBody } from '~/server/mcp/request-body'
import { getClientIp } from '~/server/utils/rate-limit'

const WWW_AUTHENTICATE = 'Bearer realm="veerify"'
const CONTEXT_HEADERS = ['x-veerify-organization', 'x-veerify-project'] as const

async function requireCredentialPrincipal(event: H3Event): Promise<AuthSession> {
  let principal: AuthSession
  try {
    principal = await requireAuth(event)
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 401) {
      setResponseHeader(event, 'WWW-Authenticate', WWW_AUTHENTICATE)
    }
    throw error
  }

  if (!isCredentialPrincipal(principal)) {
    setResponseHeader(event, 'WWW-Authenticate', WWW_AUTHENTICATE)
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      data: createErrorResponse(
        ErrorCode.UNAUTHORIZED,
        'The MCP endpoint requires a personal API key (Bearer vfy_usr_…)'
      ),
    })
  }
  return principal
}

/** The connection's `x-veerify-*` context headers, lowercased and trimmed; blank values are dropped. */
function readContextHeaders(event: H3Event): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const name of CONTEXT_HEADERS) {
    const value = getRequestHeader(event, name)?.trim()
    if (value) headers[name] = value
  }
  return headers
}

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    setResponseHeader(event, 'Allow', 'POST')
    throw createError({
      statusCode: 405,
      statusMessage: 'Method Not Allowed',
      data: createErrorResponse(ErrorCode.METHOD_NOT_ALLOWED, 'The MCP endpoint is stateless and accepts only POST'),
    })
  }

  const principal = await requireCredentialPrincipal(event)
  // Bounded read (413 above MCP_MAX_BODY_BYTES) before any MCP server or transport exists.
  const body = await readMcpJsonBody(event)
  const contextHeaders = readContextHeaders(event)
  const callApi = createApiCaller(getRequestHeader(event, 'authorization') ?? '', contextHeaders, {
    clientIp: getClientIp(event),
  })

  const server = createVeerifyMcpServer({
    principal,
    callApi,
    contextPinned: Object.keys(contextHeaders).length > 0,
  })
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })

  const res = event.node.res
  let closed = false
  const closeAll = () => {
    if (closed) return
    closed = true
    void transport.close().catch(() => {})
    void server.close().catch(() => {})
  }
  res.on('close', closeAll)

  try {
    await server.connect(transport)
    await transport.handleRequest(event.node.req, res, body)
  } catch (error) {
    closeAll()
    if (res.headersSent) {
      event._handled = true
      return
    }
    throw error
  }

  // The transport wrote the response itself; stop h3 from sending a second one.
  event._handled = true
})
