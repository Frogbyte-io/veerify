import { describe, expect, it, vi } from 'vitest'

vi.mock('~/server/generated/openapi-routes', () => ({
  openapiPaths: {
    '/api/projects': {
      get: {
        tags: ['Projects'],
        summary: 'List projects and their status counts',
        operationId: 'listProjects',
        responses: { 200: { description: 'ok' } },
      },
    },
    '/api/projects/{slug}/statuses': {
      post: {
        tags: ['Statuses'],
        summary: 'Create a workflow column',
        description: 'Adds a column to the board.',
        operationId: 'createProjectStatus',
        parameters: [{ in: 'path', name: 'slug', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } } } } },
        },
        responses: { 201: { description: 'created' } },
      },
    },
    '/api/auth/session': {
      get: {
        tags: ['Authentication'],
        summary: 'Get current session status',
        operationId: 'getCurrentSessionStatus',
        responses: { 200: { description: 'ok' } },
      },
    },
  },
}))

const { getApiOperation, searchApi } = await import('~/server/mcp/api-search')

describe('searchApi', () => {
  it('ranks the operation with the token in its operationId first', () => {
    const results = searchApi('status')
    expect(results[0]).toEqual({
      operationId: 'createProjectStatus',
      method: 'POST',
      path: '/api/projects/{slug}/statuses',
      summary: 'Create a workflow column',
      tags: ['Statuses'],
    })
    expect(results.map((r) => r.operationId)).toEqual(['createProjectStatus', 'listProjects'])
  })

  it('never returns operations under blocked paths', () => {
    expect(searchApi('session').map((r) => r.operationId)).not.toContain('getCurrentSessionStatus')
    expect(searchApi('authentication')).toEqual([])
    expect(searchApi('', { limit: 25 }).map((r) => r.path)).not.toContain('/api/auth/session')
  })

  it('filters by tag case-insensitively and honours the limit', () => {
    expect(searchApi('', { tag: 'statuses' }).map((r) => r.operationId)).toEqual(['createProjectStatus'])
    expect(searchApi('project', { limit: 1 })).toHaveLength(1)
  })
})

describe('getApiOperation', () => {
  it('returns the full operation including its requestBody', () => {
    const op = getApiOperation('createProjectStatus')
    expect(op).toMatchObject({
      operationId: 'createProjectStatus',
      method: 'POST',
      path: '/api/projects/{slug}/statuses',
      description: 'Adds a column to the board.',
      parameters: [{ in: 'path', name: 'slug', required: true, schema: { type: 'string' } }],
      responses: { 201: { description: 'created' } },
    })
    expect(op?.requestBody).toEqual({
      required: true,
      content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } } } } },
    })
  })

  it('returns null for unknown or blocked operations', () => {
    expect(getApiOperation('nope')).toBeNull()
    expect(getApiOperation('getCurrentSessionStatus')).toBeNull()
  })
})
