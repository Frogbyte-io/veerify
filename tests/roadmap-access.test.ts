import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  project: { id: 'p1', teamId: 't1', settings: { roadmapEnabled: true } } as Record<string, unknown>,
  moduleRow: [{ roadmapEnabled: true }] as unknown[],
}))

const httpError = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { statusCode, data: { error: { message } } })

vi.mock('~/server/database/drizzle', () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(state.moduleRow) }) }),
    }),
  },
}))

vi.mock('~/server/utils/project-access', () => ({
  requireProjectAccess: vi.fn(async (projectId: string) => {
    if (projectId === 'missing') throw httpError(404, 'Not Found')
    if (projectId === 'foreign') throw httpError(403, 'Forbidden')
    return state.project
  }),
}))

vi.mock('h3', () => ({
  createError: (input: Record<string, unknown>) => Object.assign(new Error(String(input.statusMessage)), input),
}))

const { requireRoadmapAccess } = await import('~/server/utils/roadmap-access')

beforeEach(() => {
  state.project = { id: 'p1', teamId: 't1', settings: { roadmapEnabled: true } }
  state.moduleRow = [{ roadmapEnabled: true }]
})

describe('requireRoadmapAccess', () => {
  it('returns the project and team when both switches are on', async () => {
    await expect(requireRoadmapAccess('p1', 'u1')).resolves.toEqual({ project: state.project, teamId: 't1' })
  })

  it('propagates project 404 and non-member 403', async () => {
    await expect(requireRoadmapAccess('missing', 'u1')).rejects.toMatchObject({ statusCode: 404 })
    await expect(requireRoadmapAccess('foreign', 'u1')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects with 403 when the team module is off', async () => {
    state.moduleRow = [{ roadmapEnabled: false }]
    await expect(requireRoadmapAccess('p1', 'u1')).rejects.toMatchObject({
      statusCode: 403,
      data: { error: { message: 'Roadmap is not enabled for this team' } },
    })
  })

  it('treats a missing team settings row as the registry default (off)', async () => {
    state.moduleRow = []
    await expect(requireRoadmapAccess('p1', 'u1')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects with 403 when the product toggle is off or unset', async () => {
    state.project = { id: 'p1', teamId: 't1', settings: { roadmapEnabled: false } }
    await expect(requireRoadmapAccess('p1', 'u1')).rejects.toMatchObject({
      statusCode: 403,
      data: { error: { message: 'Roadmap is not enabled for this product' } },
    })
    state.project = { id: 'p1', teamId: 't1', settings: null }
    await expect(requireRoadmapAccess('p1', 'u1')).rejects.toMatchObject({ statusCode: 403 })
  })
})
