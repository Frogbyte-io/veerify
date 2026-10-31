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

function ok(data: unknown, status = 200): ApiResult {
  return { status, body: { success: true, data } }
}

let routes: Record<string, (req: Parameters<ApiCaller>[0]) => ApiResult>
let callApi: ReturnType<typeof vi.fn<ApiCaller>>
let client: Client

beforeEach(async () => {
  routes = {
    'GET /api/projects/active': () => ok({ project: { id: 'proj-1', slug: 'web-app' }, organization: { id: 'org-1' } }),
  }
  callApi = vi.fn<ApiCaller>(async (req) => {
    const route = routes[`${req.method} ${req.path}`]
    return route
      ? route(req)
      : { status: 404, body: { success: false, error: { code: 'NOT_FOUND', message: req.path } } }
  })
  const server = createVeerifyMcpServer({ principal, callApi, contextPinned: false })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'test', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
})

afterEach(async () => {
  await client.close()
})

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> }

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions index freely into tool JSON
  return { isError: result.isError === true, json: JSON.parse(result.content[0]!.text) as any }
}

describe('import tools', () => {
  it('lists the seven import tools with annotations and the batch limit', async () => {
    const { tools } = await client.listTools()
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
    for (const n of [
      'import_get_format',
      'import_create_run',
      'import_add_records',
      'import_preview',
      'import_commit',
      'import_status',
      'import_cancel',
    ]) {
      expect(byName[n], n).toBeDefined()
    }
    expect(tools).toHaveLength(25)
    expect(byName.import_commit!.annotations?.destructiveHint).toBe(true)
    expect(byName.import_cancel!.annotations?.destructiveHint).toBe(true)
    for (const n of ['import_preview', 'import_status', 'import_get_format']) {
      expect(byName[n]!.annotations?.readOnlyHint).toBe(true)
    }
    expect(byName.import_add_records!.description).toContain('1,000')
    expect(byName.import_add_records!.description).toContain('4 MiB')
    // records is the sections only, never the full document
    expect(byName.import_add_records!.description).toContain('not the full document')
    for (const key of ['`format`', '`target`', '`source`'])
      expect(byName.import_add_records!.description).toContain(key)
    expect(byName.import_add_records!.description).toContain('rejected')
    expect(client.getInstructions()).toContain('import_get_format')
  })

  it('import_get_format returns the schema payload', async () => {
    routes['GET /api/imports/schema'] = () => ok({ format: 'veerify-import/1', schema: {}, example: {} })
    const res = await call('import_get_format')
    expect(res.isError).toBe(false)
    expect(res.json.format).toBe('veerify-import/1')
  })

  it('serves the schema as a resource', async () => {
    routes['GET /api/imports/schema'] = () => ok({ format: 'veerify-import/1', schema: {}, example: {} })
    const { resources } = await client.listResources()
    expect(resources.map((r) => r.uri)).toContain('veerify://imports/schema')
    const read = await client.readResource({ uri: 'veerify://imports/schema' })
    expect(read.contents[0]!.mimeType).toBe('application/json')
    expect(JSON.parse((read.contents[0] as { text: string }).text).format).toBe('veerify-import/1')
  })

  it('import_add_records posts the exact body to the right path', async () => {
    const records = { statuses: [{ key: 'a' }], feedback: [{ externalId: '1', title: 'x' }] }
    routes['POST /api/projects/acme/imports/run-1/records'] = () => ok({ seq: 1, recordCount: 2 }, 201)
    const res = await call('import_add_records', { project: 'acme', runId: 'run-1', records })
    expect(res.isError).toBe(false)
    expect(callApi).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', path: '/api/projects/acme/imports/run-1/records', body: records })
    )
  })

  it('resolves the slug from the active project when omitted', async () => {
    routes['GET /api/projects/web-app/imports/run-1'] = () => ok({ run: { id: 'run-1' }, issues: [] })
    const res = await call('import_status', { runId: 'run-1' })
    expect(res.isError).toBe(false)
    expect(res.json.run.id).toBe('run-1')
  })

  it('import_create_run posts source, label and options', async () => {
    routes['POST /api/projects/acme/imports'] = () => ok({ id: 'run-1' }, 201)
    await call('import_create_run', { project: 'acme', source: 'canny', sourceLabel: 'Canny', onExisting: 'skip' })
    expect(callApi).toHaveBeenCalledWith(
      expect.objectContaining({ body: { source: 'canny', sourceLabel: 'Canny', onExisting: 'skip' } })
    )
  })

  it('surfaces a 409 from preview as a tool error with the body', async () => {
    const body = { success: false, error: { code: 'CONFLICT', message: 'not draft' } }
    routes['GET /api/projects/acme/imports/run-1/preview'] = () => ({ status: 409, body })
    const res = await call('import_preview', { project: 'acme', runId: 'run-1' })
    expect(res.isError).toBe(true)
    expect(res.json).toEqual({ status: 409, body })
  })

  it('import_commit adds a note while the run is still committing', async () => {
    routes['POST /api/projects/acme/imports/run-1/commit'] = () => ok({ id: 'run-1', status: 'committing' }, 202)
    const res = await call('import_commit', { project: 'acme', runId: 'run-1' })
    expect(res.json.run.status).toBe('committing')
    expect(res.json.note).toContain('import_status')

    routes['POST /api/projects/acme/imports/run-1/commit'] = () =>
      ok({ id: 'run-1', status: 'completed', summary: { counts: {}, kept: [] } })
    const done = await call('import_commit', { project: 'acme', runId: 'run-1' })
    expect(done.json.run.status).toBe('completed')
    expect(done.json.note).toBeUndefined()
  })

  it('import_cancel posts to cancel', async () => {
    routes['POST /api/projects/acme/imports/run-1/cancel'] = () => ok({ id: 'run-1', status: 'canceled' })
    const res = await call('import_cancel', { project: 'acme', runId: 'run-1' })
    expect(res.json.status).toBe('canceled')
  })
  it.each([
    ['runId', { project: 'acme', runId: '../x' }],
    ['runId', { project: 'acme', runId: '..' }],
    ['runId', { project: 'acme', runId: 'a/b' }],
    ['project', { project: 'a/b', runId: 'run-1' }],
    ['project', { project: '..', runId: 'run-1' }],
  ])('rejects an unsafe %s without calling the API', async (_field, args) => {
    const result = (await client.callTool({ name: 'import_status', arguments: args })) as ToolResult
    expect(result.isError).toBe(true)
    expect(callApi).not.toHaveBeenCalled()
  })

  it('refuses an unsafe slug returned by the active project', async () => {
    routes['GET /api/projects/active'] = () => ok({ project: { id: 'p', slug: '../../user' } })
    const res = await call('import_status', { runId: 'run-1' })
    expect(res.isError).toBe(true)
    expect(callApi).toHaveBeenCalledTimes(1)
  })

  it('reports a 409 when there is no active project', async () => {
    const body = { success: false, error: { code: 'CONFLICT', message: 'no project' } }
    routes['GET /api/projects/active'] = () => ({ status: 409, body })
    const res = await call('import_status', { runId: 'run-1' })
    expect(res.isError).toBe(true)
    expect(res.json).toEqual({ status: 409, body })
  })
})
