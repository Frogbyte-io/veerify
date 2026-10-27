import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { ApiCaller, ApiResult } from '~/server/mcp/types'
import type { AuthSession } from '~/server/utils/auth-middleware'

const { createVeerifyMcpServer } = await import('~/server/mcp/server')

const principal = {
  user: { id: 'user-1', name: 'Ada', email: 'ada@example.com', emailVerified: true },
  session: { id: 's', userId: 'user-1', activeOrganizationId: 'org-1', activeProjectId: 'proj-1' },
  credential: { kind: 'user_api_key', id: 'key-1' },
} as unknown as AuthSession

const workspaces = [
  { id: 'org-1', name: 'Acme', slug: 'acme', logo: null, role: 'owner' },
  { id: 'org-2', name: 'Globex', slug: 'globex', logo: null, role: 'member' },
]
const projectsByOrg: Record<string, unknown[]> = {
  'org-1': [{ id: 'proj-1', slug: 'web', name: 'Web', organizationId: 'org-1' }],
  'org-2': [{ id: 'proj-9', slug: 'app', name: 'App', organizationId: 'org-2' }],
}

let routes: Record<string, (req: Parameters<ApiCaller>[0]) => ApiResult>
let callApi: ReturnType<typeof vi.fn<ApiCaller>>
let client: Client

function ok(data: unknown, status = 200): ApiResult {
  return { status, body: { success: true, data } }
}

beforeEach(async () => {
  let active = { orgId: 'org-1', projectId: 'proj-1' }
  routes = {
    'GET /api/organizations/list': () => ok(workspaces),
    'GET /api/projects': (req) => ok(projectsByOrg[req.headers?.['x-veerify-organization'] ?? active.orgId] ?? []),
    'GET /api/projects/active': () =>
      ok({ project: { id: active.projectId }, organization: { id: active.orgId }, products: [], modules: {} }),
    'POST /api/organizations/active': (req) => {
      const body = req.body as { organizationId: string; projectId?: string }
      active = { orgId: body.organizationId, projectId: body.projectId ?? 'first' }
      return ok({ organization: { id: body.organizationId }, project: { id: active.projectId } })
    },
    'POST /api/projects/active': (req) => {
      const { projectId } = req.body as { projectId: string }
      const owner = Object.entries(projectsByOrg).find(([, list]) =>
        list.some((p) => (p as { id: string }).id === projectId)
      )
      if (!owner) return { status: 404, body: { success: false, error: { code: 'NOT_FOUND', message: 'no' } } }
      active = { orgId: owner[0], projectId }
      return ok({ project: { id: projectId }, organization: { id: owner[0] } })
    },
  }
  callApi = vi.fn<ApiCaller>(async (req) => {
    const route = routes[`${req.method} ${req.path}`]
    return route
      ? route(req)
      : { status: 404, body: { success: false, error: { code: 'NOT_FOUND', message: req.path } } }
  })

  await connect(false)
})

async function connect(contextPinned: boolean) {
  const server = createVeerifyMcpServer({ principal, callApi, contextPinned })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'test', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
}

afterEach(async () => {
  await client.close()
})

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> }

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult
  expect(result.content).toHaveLength(1)
  expect(result.content[0]!.type).toBe('text')
  const text = result.content[0]!.text
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    json = undefined
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions index freely into tool JSON
  return { isError: result.isError === true, text, json: json as any }
}

describe('createVeerifyMcpServer', () => {
  it('lists the universal and import tools with annotations', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'call_api',
        'list_projects',
        'list_workspaces',
        'search_api',
        'set_context',
        'whoami',
        'import_get_format',
        'import_create_run',
        'import_add_records',
        'import_preview',
        'import_commit',
        'import_status',
        'import_cancel',
      ].sort()
    )
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
    expect(byName.call_api!.annotations?.destructiveHint).toBe(true)
    for (const name of ['whoami', 'list_workspaces', 'list_projects', 'search_api']) {
      expect(byName[name]!.annotations?.readOnlyHint).toBe(true)
    }
    expect(byName.set_context!.annotations).toMatchObject({ destructiveHint: false, idempotentHint: true })
  })

  it('identifies itself and explains the workflow', () => {
    expect(client.getServerVersion()).toMatchObject({ name: 'veerify', version: '1.0.0' })
    const instructions = client.getInstructions() ?? ''
    for (const word of ['whoami', 'set_context', 'search_api', 'call_api', '{ status, body }', 'X-Veerify-Project']) {
      expect(instructions).toContain(word)
    }
  })

  it('call_api refuses /api/auth/* without calling the API', async () => {
    const result = await call('call_api', { method: 'POST', path: '/api/auth/sign-out' })
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/\/api\/auth/)
    expect(callApi).not.toHaveBeenCalled()
  })

  it('call_api refuses paths outside /api/', async () => {
    const result = await call('call_api', { method: 'GET', path: 'https://evil/x' })
    expect(result.isError).toBe(true)
    expect(callApi).not.toHaveBeenCalled()
  })

  it('call_api GET /api/projects returns the stub body', async () => {
    const result = await call('call_api', { method: 'GET', path: '/api/projects', query: { q: 'w' } })
    expect(result.isError).toBe(false)
    expect(result.json).toEqual({ status: 200, body: { success: true, data: projectsByOrg['org-1'] } })
    expect(callApi).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '/api/projects', query: { q: 'w' } })
    )
  })

  it('call_api turns a 403 into a tool error carrying { status, body }', async () => {
    routes['DELETE /api/projects/web'] = () => ({
      status: 403,
      body: { success: false, error: { code: 'FORBIDDEN', message: 'no' } },
    })
    const result = await call('call_api', { method: 'DELETE', path: '/api/projects/web' })
    expect(result.isError).toBe(true)
    expect(result.json).toEqual({ status: 403, body: { success: false, error: { code: 'FORBIDDEN', message: 'no' } } })
  })

  it('set_context with neither field is an input validation error', async () => {
    const result = await call('set_context', {})
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/Input validation error/)
    expect(callApi).not.toHaveBeenCalled()
  })

  it('whoami reports the user, credential and active context', async () => {
    const result = await call('whoami')
    expect(result.isError).toBe(false)
    expect(result.json).toMatchObject({
      user: { id: 'user-1', name: 'Ada', email: 'ada@example.com' },
      credential: 'api_key',
      contextPinned: false,
      activeOrganizationId: 'org-1',
      activeProjectId: 'proj-1',
      project: { id: 'proj-1' },
      organization: { id: 'org-1' },
    })
  })

  it('whoami reports no workspace on 409 rather than the possibly stale stored one', async () => {
    routes['GET /api/projects/active'] = () => ({
      status: 409,
      body: { success: false, error: { code: 'CONFLICT', message: 'no project' } },
    })
    expect((await call('whoami')).json).toMatchObject({
      activeOrganizationId: null,
      activeProjectId: null,
      project: null,
    })
  })

  it('set_context reports the verified workspace when it has no project yet (409)', async () => {
    routes['GET /api/projects/active'] = () => ({
      status: 409,
      body: { success: false, error: { code: 'CONFLICT', message: 'no project' } },
    })
    expect((await call('set_context', { workspace: 'globex' })).json).toMatchObject({
      activeOrganizationId: 'org-2',
      activeProjectId: null,
    })
  })

  it('list_workspaces and list_projects return the API data', async () => {
    expect((await call('list_workspaces')).json).toEqual(workspaces)
    expect((await call('list_projects')).json).toEqual(projectsByOrg['org-1'])
  })

  it('list_projects with a workspace slug sends X-Veerify-Organization for that call only', async () => {
    const result = await call('list_projects', { workspace: 'globex' })
    expect(result.json).toEqual(projectsByOrg['org-2'])
    const projectCall = callApi.mock.calls.find(([req]) => req.path === '/api/projects')![0]
    expect(projectCall.headers).toEqual({ 'x-veerify-organization': 'org-2' })
    expect(projectCall.inheritContext).toBe(false)
  })

  it('set_context resolves slugs, switches workspace and project, and returns the new whoami', async () => {
    const result = await call('set_context', { workspace: 'globex', project: 'app' })
    expect(result.isError).toBe(false)
    expect(callApi).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/api/organizations/active',
        body: { organizationId: 'org-2', projectId: 'proj-9' },
      })
    )
    expect(result.json).toMatchObject({ activeOrganizationId: 'org-2', activeProjectId: 'proj-9' })
  })

  it('set_context switches and re-reads the stored context without inheriting connection headers', async () => {
    await call('set_context', { workspace: 'globex', project: 'app' })
    const writes = callApi.mock.calls.map(([req]) => req).filter((req) => req.method === 'POST')
    expect(writes.map((req) => req.path)).toEqual(['/api/organizations/active', '/api/projects/active'])
    for (const req of writes) expect(req.inheritContext).toBe(false)
    const followUp = callApi.mock.calls
      .map(([req]) => req)
      .filter((req) => req.path === '/api/projects/active' && req.method === 'GET')
    expect(followUp).toHaveLength(1)
    expect(followUp[0]!.inheritContext).toBe(false)
  })

  it('set_context refuses without any API call when connection headers pin the context', async () => {
    await client.close()
    await connect(true)

    const result = await call('set_context', { project: 'proj-1' })
    expect(result.isError).toBe(true)
    expect(result.json).toEqual({
      error:
        'This connection fixes its workspace/project with X-Veerify-Organization / X-Veerify-Project headers, so set_context cannot change it. Remove those headers from the MCP configuration to switch with set_context, or pass a different workspace to list_projects.',
    })
    expect(callApi).not.toHaveBeenCalled()

    expect((await call('whoami')).json).toMatchObject({ contextPinned: true })
  })

  it('set_context with only a project id switches the project', async () => {
    const result = await call('set_context', { project: 'proj-1' })
    expect(result.isError).toBe(false)
    expect(callApi).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', path: '/api/projects/active', body: { projectId: 'proj-1' } })
    )
  })

  it('set_context names an unknown workspace or project', async () => {
    const ws = await call('set_context', { workspace: 'nope' })
    expect(ws.isError).toBe(true)
    expect(ws.text).toMatch(/workspace.*nope/i)

    const proj = await call('set_context', { workspace: 'acme', project: 'ghost' })
    expect(proj.isError).toBe(true)
    expect(proj.text).toMatch(/project.*ghost/i)
    expect(callApi.mock.calls.some(([req]) => req.method === 'POST')).toBe(false)
  })

  it('search_api finds operations and returns details by operationId', async () => {
    const found = await call('search_api', { query: 'statuses', limit: 3 })
    expect(found.isError).toBe(false)
    expect(Array.isArray(found.json)).toBe(true)
    expect(found.json.length).toBeGreaterThan(0)
    expect(found.json.length).toBeLessThanOrEqual(3)

    const detail = await call('search_api', { operationId: found.json[0].operationId })
    expect(detail.json).toMatchObject({ operationId: found.json[0].operationId, responses: expect.any(Object) })

    const missing = await call('search_api', { operationId: 'doesNotExist' })
    expect(missing.isError).toBe(true)
  })
})
