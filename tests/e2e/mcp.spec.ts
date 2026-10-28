import { expect, test, type APIRequestContext } from '@playwright/test'
import { loginViaProgrammatic, withOriginHeaders } from './helpers/auth'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'
const SEEDED_PROJECT_SLUG = 'demo'
const MCP_MAX_BODY_BYTES = 4 * 1024 * 1024
const CONTEXT_PINNED_MESSAGE =
  'This connection fixes its workspace/project with X-Veerify-Organization / X-Veerify-Project headers, so set_context cannot change it.'

const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
}

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'veerify-e2e', version: '1.0.0' },
  },
}

test.setTimeout(90_000)

async function createKey(request: APIRequestContext, name: string): Promise<{ id: string; key: string }> {
  const response = await request.post('/api/user/api-keys', {
    headers: withOriginHeaders('/settings'),
    data: { name },
  })
  expect(response.status()).toBe(201)
  const payload = await response.json()
  return { id: payload.data.id, key: payload.data.key }
}

function rpc(request: APIRequestContext, key: string | null, body: unknown, headers: Record<string, string> = {}) {
  return request.post('/mcp', {
    headers: { ...MCP_HEADERS, ...(key ? { authorization: `Bearer ${key}` } : {}), ...headers },
    data: body,
  })
}

function toolText(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map((item) => item.text).join('\n')
}

test('MCP endpoint serves the universal tools to a personal API key', async ({ playwright }) => {
  // Cookie context creates the key; a separate context with no cookies calls /mcp.
  const cookieContext = await playwright.request.newContext()
  const bareContext = await playwright.request.newContext()
  try {
    await loginViaProgrammatic(cookieContext, { email: TEST_EMAIL, password: TEST_PASSWORD })
    const { id, key } = await createKey(cookieContext, 'MCP e2e')
    await exerciseKey(cookieContext, bareContext, id, key)
  } finally {
    await cookieContext.dispose()
    await bareContext.dispose()
  }
})

async function exerciseKey(cookieContext: APIRequestContext, bareContext: APIRequestContext, id: string, key: string) {
  try {
    const init = await rpc(bareContext, key, INITIALIZE)
    expect(init.status()).toBe(200)
    const initPayload = await init.json()
    expect(initPayload.result.serverInfo.name).toBe('veerify')

    const list = await rpc(bareContext, key, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    expect(list.status()).toBe(200)
    const tools = (await list.json()).result.tools.map((tool: { name: string }) => tool.name).sort()
    expect(tools).toEqual(
      [
        'call_api',
        'import_add_records',
        'import_cancel',
        'import_commit',
        'import_create_run',
        'import_get_format',
        'import_preview',
        'import_status',
        'list_projects',
        'list_workspaces',
        'search_api',
        'set_context',
        'whoami',
      ].sort()
    )

    const whoami = await rpc(bareContext, key, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'whoami', arguments: {} },
    })
    expect(whoami.status()).toBe(200)
    const whoamiResult = (await whoami.json()).result
    expect(whoamiResult.isError).toBeFalsy()
    expect(toolText(whoamiResult)).toContain(TEST_EMAIL)

    const callApi = await rpc(bareContext, key, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'call_api', arguments: { method: 'GET', path: '/api/projects' } },
    })
    expect(callApi.status()).toBe(200)
    const callApiResult = (await callApi.json()).result
    expect(callApiResult.isError).toBeFalsy()
    const callApiPayload = JSON.parse(toolText(callApiResult))
    expect(callApiPayload.status).toBe(200)
    expect(JSON.stringify(callApiPayload.body)).toContain(`"slug":"${SEEDED_PROJECT_SLUG}"`)

    // Stateless transport: no SSE stream and no session to delete
    const get = await bareContext.get('/mcp', { headers: { ...MCP_HEADERS, authorization: `Bearer ${key}` } })
    expect(get.status()).toBe(405)
    expect(get.headers()['allow']).toBe('POST')
    const del = await bareContext.delete('/mcp', { headers: { ...MCP_HEADERS, authorization: `Bearer ${key}` } })
    expect(del.status()).toBe(405)

    // No credential at all
    const anonymous = await rpc(bareContext, null, INITIALIZE)
    expect(anonymous.status()).toBe(401)
    const anonymousBody = JSON.stringify(await anonymous.json())
    expect(anonymousBody).toContain('No valid API key.')
    expect(anonymousBody).toContain('/api/device/code')
    expect(anonymous.headers()['www-authenticate']).toBe('Bearer realm="veerify"')

    // A cookie session is not enough: /mcp accepts only personal API keys
    const cookieOnly = await cookieContext.post('/mcp', {
      headers: { ...MCP_HEADERS, ...withOriginHeaders('/settings') },
      data: INITIALIZE,
    })
    expect(cookieOnly.status()).toBe(401)
    expect(JSON.stringify(await cookieOnly.json())).toContain('device')
    expect(cookieOnly.headers()['www-authenticate']).toBe('Bearer realm="veerify"')

    // Cookie plus a valid key: the key wins and the request acts as the key
    const cookieAndKey = await cookieContext.post('/mcp', {
      headers: { ...MCP_HEADERS, ...withOriginHeaders('/settings'), authorization: `Bearer ${key}` },
      data: { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'whoami', arguments: {} } },
    })
    expect(cookieAndKey.status()).toBe(200)
    const cookieAndKeyWhoami = JSON.parse(toolText((await cookieAndKey.json()).result))
    expect(cookieAndKeyWhoami.credential).toBe('api_key')
    expect(cookieAndKeyWhoami.user.email).toBe(TEST_EMAIL)

    // X-Veerify-Project pins the connection: whoami reports it and set_context refuses
    const pinned = { 'x-veerify-project': SEEDED_PROJECT_SLUG }
    const pinnedWhoami = await rpc(
      bareContext,
      key,
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'whoami', arguments: {} } },
      pinned
    )
    expect(pinnedWhoami.status()).toBe(200)
    expect(JSON.parse(toolText((await pinnedWhoami.json()).result)).contextPinned).toBe(true)
    const setContext = await rpc(
      bareContext,
      key,
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'set_context', arguments: { project: 'mobile-app' } },
      },
      pinned
    )
    expect(setContext.status()).toBe(200)
    const setContextResult = (await setContext.json()).result
    expect(setContextResult.isError).toBe(true)
    expect(toolText(setContextResult)).toContain(CONTEXT_PINNED_MESSAGE)

    // A whitespace-only context header does not pin the connection
    const blankHeader = await rpc(
      bareContext,
      key,
      { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'whoami', arguments: {} } },
      { 'x-veerify-project': '   ' }
    )
    expect(blankHeader.status()).toBe(200)
    expect(JSON.parse(toolText((await blankHeader.json()).result)).contextPinned).toBe(false)

    // Bodies above the SDK's 4 MiB cap are refused before the transport sees them
    const oversized = await rpc(bareContext, key, {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/list',
      params: { padding: 'x'.repeat(MCP_MAX_BODY_BYTES) },
    })
    expect(oversized.status()).toBe(413)
    expect((await oversized.json()).data.error.code).toBe('VALIDATION_ERROR')
  } finally {
    const revoke = await cookieContext.delete(`/api/user/api-keys/${id}`, { headers: withOriginHeaders('/settings') })
    expect(revoke.ok()).toBe(true)
  }

  // Revoked key: the very next request is refused
  const revoked = await rpc(bareContext, key, INITIALIZE)
  expect(revoked.status()).toBe(401)
  expect(revoked.headers()['www-authenticate']).toBe('Bearer realm="veerify"')
}
