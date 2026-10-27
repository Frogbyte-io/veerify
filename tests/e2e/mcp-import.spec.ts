import { expect, test, type APIRequestContext } from '@playwright/test'
import { loginViaProgrammatic, withOriginHeaders } from './helpers/auth'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'

const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
}

test.setTimeout(120_000)

let rpcId = 100

function toolText(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map((item) => item.text).join('\n')
}

/** Calls an MCP tool and returns its parsed JSON payload; fails the test on a tool error. */
async function callTool(request: APIRequestContext, key: string, name: string, args: Record<string, unknown> = {}) {
  const response = await request.post('/mcp', {
    headers: { ...MCP_HEADERS, authorization: `Bearer ${key}` },
    data: { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } },
  })
  expect(response.status()).toBe(200)
  const result = (await response.json()).result
  expect(result.isError, `${name}: ${toolText(result)}`).toBeFalsy()
  return JSON.parse(toolText(result))
}

test('an agent imports feedback through /mcp, and a re-run changes nothing', async ({ playwright }) => {
  const cookieContext = await playwright.request.newContext()
  const bareContext = await playwright.request.newContext()
  let keyId = ''
  try {
    await loginViaProgrammatic(cookieContext, { email: TEST_EMAIL, password: TEST_PASSWORD })
    const created = await cookieContext.post('/api/user/api-keys', {
      headers: withOriginHeaders('/settings'),
      data: { name: 'MCP import e2e' },
    })
    expect(created.status()).toBe(201)
    const createdPayload = await created.json()
    keyId = createdPayload.data.id
    const key: string = createdPayload.data.key

    const stamp = Date.now()
    const source = `e2e-${stamp}`
    const titleA = `Import e2e dark mode ${stamp}`
    const titleB = `Import e2e export csv ${stamp}`
    const records = {
      people: [
        { externalId: 'p-1', name: 'Ada Import', email: `ada-${stamp}@import-e2e.invalid` },
        { externalId: 'p-2', name: 'Grace Import', email: `grace-${stamp}@import-e2e.invalid` },
        { externalId: 'p-3', name: 'Linus Import', email: `linus-${stamp}@import-e2e.invalid` },
      ],
      feedback: [
        {
          externalId: 'f-1',
          title: titleA,
          body: 'Please add a dark theme.',
          authorExternalId: 'p-1',
          votes: [
            { personExternalId: 'p-1', type: 'upvote' },
            { personExternalId: 'p-2', type: 'upvote' },
            { personExternalId: 'p-3', type: 'upvote' },
          ],
        },
        { externalId: 'f-2', title: titleB, body: 'Let me export to CSV.', authorExternalId: 'p-2' },
      ],
      comments: [{ externalId: 'c-1', feedbackExternalId: 'f-1', body: 'Looking into it.', authorExternalId: 'p-2' }],
    }

    const projectContext = await callTool(bareContext, key, 'call_api', { method: 'GET', path: '/api/projects/active' })
    expect(projectContext.status).toBe(200)
    const projectId: string = projectContext.body.data.project.id
    expect(projectId).toBeTruthy()

    const format = await callTool(bareContext, key, 'import_get_format')
    expect(JSON.stringify(format)).toContain('veerify-import/1')

    async function runImport(label: string) {
      const run = await callTool(bareContext, key, 'import_create_run', { source, sourceLabel: label })
      const runId: string = run.id
      expect(runId).toBeTruthy()
      await callTool(bareContext, key, 'import_add_records', { runId, records })
      const preview = await callTool(bareContext, key, 'import_preview', { runId })
      const commit = await callTool(bareContext, key, 'import_commit', { runId })
      return { runId, preview, commit }
    }

    const first = await runImport('E2E first run')
    expect(first.preview.counts.feedback.create).toBe(2)
    expect(first.preview.counts.comments.create).toBe(1)
    expect(first.preview.counts.votes.create).toBe(3)
    expect(first.commit.run.status).toBe('completed')

    const list = await callTool(bareContext, key, 'call_api', {
      method: 'GET',
      path: '/api/feedback',
      query: { projectId, search: `${stamp}`, limit: 100 },
    })
    expect(list.status).toBe(200)
    const items: Array<{ title: string; voteCount: number }> = list.body.data.items
    const itemA = items.find((item) => item.title === titleA)
    const itemB = items.find((item) => item.title === titleB)
    expect(itemA).toBeTruthy()
    expect(itemB).toBeTruthy()
    expect(itemA!.voteCount).toBe(3)

    // Re-running the same records is a no-op
    const second = await runImport('E2E second run')
    expect(second.preview.counts.feedback.create).toBe(0)
    expect(second.preview.counts.feedback.unchanged).toBe(2)
    expect(second.preview.counts.comments.create).toBe(0)
    expect(second.preview.counts.votes.create).toBe(0)
    expect(second.commit.run.status).toBe('completed')

    // A committed run can no longer be previewed
    const late = await bareContext.post('/mcp', {
      headers: { ...MCP_HEADERS, authorization: `Bearer ${key}` },
      data: {
        jsonrpc: '2.0',
        id: rpcId++,
        method: 'tools/call',
        params: { name: 'import_preview', arguments: { runId: second.runId } },
      },
    })
    const lateResult = (await late.json()).result
    expect(lateResult.isError).toBe(true)
    expect(toolText(lateResult)).toContain('409')
  } finally {
    if (keyId) {
      await cookieContext.delete(`/api/user/api-keys/${keyId}`, { headers: withOriginHeaders('/settings') })
    }
    await cookieContext.dispose()
    await bareContext.dispose()
  }
})
