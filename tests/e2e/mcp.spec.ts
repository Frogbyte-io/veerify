import { expect, test, type APIRequestContext } from '@playwright/test'
import { loginViaProgrammatic, withOriginHeaders } from './helpers/auth'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'
const SEEDED_PROJECT_SLUG = 'demo'

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

function rpc(request: APIRequestContext, key: string | null, body: unknown) {
  return request.post('/mcp', {
    headers: { ...MCP_HEADERS, ...(key ? { authorization: `Bearer ${key}` } : {}) },
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
  await loginViaProgrammatic(cookieContext, { email: TEST_EMAIL, password: TEST_PASSWORD })
  const { id, key } = await createKey(cookieContext, 'MCP e2e')

  try {
    const init = await rpc(bareContext, key, INITIALIZE)
    expect(init.status()).toBe(200)
    const initPayload = await init.json()
    expect(initPayload.result.serverInfo.name).toBe('veerify')

    const list = await rpc(bareContext, key, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    expect(list.status()).toBe(200)
    const tools = (await list.json()).result.tools.map((tool: { name: string }) => tool.name).sort()
    expect(tools).toEqual(['call_api', 'list_projects', 'list_workspaces', 'search_api', 'set_context', 'whoami'])

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
    expect(anonymous.headers()['www-authenticate']).toBe('Bearer realm="veerify"')

    // A cookie session is not enough: /mcp accepts only personal API keys
    const cookieOnly = await cookieContext.post('/mcp', {
      headers: { ...MCP_HEADERS, ...withOriginHeaders('/settings') },
      data: INITIALIZE,
    })
    expect(cookieOnly.status()).toBe(401)
    expect(cookieOnly.headers()['www-authenticate']).toBe('Bearer realm="veerify"')
  } finally {
    const revoke = await cookieContext.delete(`/api/user/api-keys/${id}`, { headers: withOriginHeaders('/settings') })
    expect(revoke.ok()).toBe(true)
  }

  // Revoked key: the very next request is refused
  const revoked = await rpc(bareContext, key, INITIALIZE)
  expect(revoked.status()).toBe(401)
  expect(revoked.headers()['www-authenticate']).toBe('Bearer realm="veerify"')

  await cookieContext.dispose()
  await bareContext.dispose()
})
