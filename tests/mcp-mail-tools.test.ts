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
    'GET /api/projects/other': () => ok({ id: 'proj-2', slug: 'other' }),
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
  // Input validation errors are plain text, not JSON.
  if (result.isError && !result.content[0]!.text.startsWith('{')) return { isError: true, json: null }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions index freely into tool JSON
  return { isError: result.isError === true, json: JSON.parse(result.content[0]!.text) as any }
}

describe('mail tools', () => {
  it('lists the mail tools with read-only and destructive annotations', async () => {
    const { tools } = await client.listTools()
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
    for (const n of ['mail_list_domains', 'mail_list_addresses', 'mail_list_inboxes']) {
      expect(byName[n]!.annotations?.readOnlyHint, n).toBe(true)
    }
    for (const n of ['mail_remove_domain', 'mail_delete_address', 'mail_stop_forwarding']) {
      expect(byName[n]!.annotations?.destructiveHint, n).toBe(true)
    }
    for (const n of ['mail_add_domain', 'mail_verify_domain', 'mail_create_address', 'mail_update_address']) {
      expect(byName[n], n).toBeDefined()
    }
    expect(client.getInstructions()).toContain('mail_add_domain')
  })

  it('keys domain routes by the active project id and mail routes by its slug', async () => {
    routes['GET /api/support/projects/proj-1/sending-domains'] = () => ok({ domains: [] })
    routes['GET /api/projects/web-app/mail/addresses'] = () => ok({ addresses: [] })
    expect((await call('mail_list_domains')).json).toEqual({ domains: [] })
    expect((await call('mail_list_addresses')).json).toEqual({ addresses: [] })
  })

  it('resolves another project by slug', async () => {
    routes['POST /api/support/projects/proj-2/sending-domains'] = (req) => ok({ domain: req.body })
    const result = await call('mail_add_domain', { project: 'other', domain: 'mail.newsite.com' })
    expect(result.isError).toBe(false)
    expect(result.json).toEqual({ domain: { domain: 'mail.newsite.com' } })
  })

  it('lists inboxes with the project id as a query parameter', async () => {
    routes['GET /api/support/inboxes'] = (req) => ok({ query: req.query })
    expect((await call('mail_list_inboxes')).json).toEqual({ query: { projectId: 'proj-1' } })
  })

  it('creates a forwarding address and moves one to another inbox', async () => {
    routes['POST /api/support/inboxes/inbox-1/addresses'] = (req) => ok({ body: req.body })
    routes['PATCH /api/support/inboxes/inbox-1/addresses/addr-1'] = (req) => ok({ body: req.body })

    const created = await call('mail_create_address', {
      inboxId: 'inbox-1',
      address: 'hello@newsite.com',
      deliverToInbox: false,
      forwardTo: ['me@example.org'],
    })
    expect(created.json.body).toEqual({
      address: 'hello@newsite.com',
      deliverToInbox: false,
      forwardTo: ['me@example.org'],
    })

    const moved = await call('mail_update_address', {
      inboxId: 'inbox-1',
      addressId: 'addr-1',
      moveToInboxId: 'inbox-2',
    })
    expect(moved.json.body).toEqual({ inboxId: 'inbox-2' })
  })

  it('refuses more than five forwards and unsafe ids before calling the API', async () => {
    const tooMany = await call('mail_create_address', {
      inboxId: 'inbox-1',
      address: 'hello@newsite.com',
      forwardTo: ['a@x.org', 'b@x.org', 'c@x.org', 'd@x.org', 'e@x.org', 'f@x.org'],
    })
    expect(tooMany.isError).toBe(true)
    const traversal = await call('mail_delete_address', { inboxId: '..', addressId: 'addr-1' })
    expect(traversal.isError).toBe(true)
    expect(callApi).not.toHaveBeenCalled()
  })

  it('passes a provider rate limit through as a tool error', async () => {
    routes['POST /api/projects/web-app/mail/destinations/dest-1/resend'] = () => ({
      status: 429,
      body: { success: false, error: { code: 'FORWARD_CONFIRMATION_THROTTLED', message: 'Try again in 600 seconds' } },
    })
    const result = await call('mail_resend_forward_confirmation', { destinationId: 'dest-1' })
    expect(result.isError).toBe(true)
    expect(result.json.status).toBe(429)
  })
})
