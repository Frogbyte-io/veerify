import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attachUploadsToFeedback,
  isRowUploader,
  loadFeedbackAttachmentContext,
} from '../server/utils/feedback-attachment-access'
import { runFeedbackAttachmentCleanup } from '../server/utils/feedback-attachment-cleanup'

const state = vi.hoisted(() => ({
  feedbackRow: null as any,
  projectRow: null as any,
  membership: [] as any[],
  session: null as any,
  anon: null as any,
  selectQueue: [] as any[][],
  updateReturning: [] as any[],
  updateWhere: null as any,
  deletes: [] as string[],
  deletedObjects: [] as string[],
  cleanupRows: [] as any[],
  deleteFails: false,
}))

vi.mock('~/server/utils/auth-middleware', () => ({ optionalAuth: vi.fn(async () => state.session) }))
vi.mock('~/server/utils/project-access', () => ({
  hasProjectAccess: vi.fn(async () => state.membership.length > 0),
}))
vi.mock('~/server/utils/anonymous-session', () => ({ getAnonSession: vi.fn(async () => state.anon) }))
vi.mock('~/server/database/drizzle', () => {
  const makeSelect = () => {
    const chain: Record<string, any> = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => state.selectQueue.shift() ?? []),
      then: (resolve: any) => resolve(state.selectQueue.shift() ?? []),
    }
    return chain
  }
  return {
    db: {
      select: vi.fn(makeSelect),
      update: vi.fn(() => ({
        set: vi.fn().mockReturnThis(),
        where: vi.fn((condition: unknown) => {
          state.updateWhere = condition
          return { returning: vi.fn(async () => state.updateReturning) }
        }),
      })),
      delete: vi.fn(() => ({
        where: vi.fn(async () => {
          state.deletes.push('row')
        }),
      })),
    },
  }
})

function stubGlobals() {
  vi.stubGlobal('useRuntimeConfig', () => ({ uploadTokenSecret: 'unit-test-secret' }))
  vi.stubGlobal('createError', (input: any) => Object.assign(new Error(input?.data?.error?.message ?? 'err'), input))
}

function load(
  overrides: {
    feedback?: Record<string, unknown>
    project?: Record<string, unknown>
    product?: Record<string, unknown>
  } = {}
) {
  state.selectQueue = [
    [
      {
        id: 'fb-1',
        projectId: 'p-1',
        productId: 'pr-1',
        authorUserId: 'author',
        authorSessionId: 'anon-author',
        isHidden: false,
        metadata: null,
        ...overrides.feedback,
      },
    ],
    [{ id: 'p-1', organizationId: 'o-1', isPublic: true, ...overrides.project }],
    [{ isPublic: true, ...overrides.product }],
  ]
  return loadFeedbackAttachmentContext({} as any, 'fb-1')
}

describe('loadFeedbackAttachmentContext (authorization matrix against feedback rows)', () => {
  beforeEach(() => {
    stubGlobals()
    state.session = null
    state.anon = null
    state.membership = []
  })

  it('anonymous visitor: public product, visible feedback -> view only', async () => {
    const ctx = await load()
    expect(ctx.access).toEqual({ canView: true, canUpload: false, canDelete: false })
  })

  it('anonymous visitor: private project -> no view', async () => {
    expect((await load({ project: { isPublic: false } })).access.canView).toBe(false)
  })

  it('anonymous visitor: private product of a public project -> no view', async () => {
    expect((await load({ product: { isPublic: false } })).access.canView).toBe(false)
  })

  it('anonymous visitor: hidden feedback -> no view', async () => {
    expect((await load({ feedback: { isHidden: true } })).access.canView).toBe(false)
  })

  it('anonymous visitor: support-derived feedback -> no view', async () => {
    expect((await load({ feedback: { metadata: { source: 'support_conversation' } } })).access.canView).toBe(false)
  })

  it('anonymous author (matching session) can view, add and delete', async () => {
    state.anon = { id: 'anon-author' }
    const ctx = await load({ feedback: { isHidden: true } })
    expect(ctx.isAuthor).toBe(true)
    expect(ctx.access).toEqual({ canView: true, canUpload: true, canDelete: true })
  })

  it('a different anonymous session is not the author', async () => {
    state.anon = { id: 'someone-else' }
    expect((await load()).access).toEqual({ canView: true, canUpload: false, canDelete: false })
  })

  it('signed-in non-member on a private project -> no access', async () => {
    state.session = { user: { id: 'stranger' } }
    expect((await load({ project: { isPublic: false } })).access.canView).toBe(false)
  })

  it('project member sees hidden and support-derived feedback on private projects and may delete', async () => {
    state.session = { user: { id: 'member' } }
    state.membership = [{ id: 'tm-1' }]
    const ctx = await load({
      project: { isPublic: false },
      feedback: { isHidden: true, metadata: { source: 'support_conversation' } },
    })
    expect(ctx.isTeamMember).toBe(true)
    expect(ctx.access).toEqual({ canView: true, canUpload: true, canDelete: true })
  })

  it('signed-in author (user id) can manage their item', async () => {
    state.session = { user: { id: 'author' } }
    const ctx = await load()
    expect(ctx.access.canDelete).toBe(true)
  })

  it('404s when the feedback does not exist', async () => {
    state.selectQueue = [[]]
    await expect(loadFeedbackAttachmentContext({} as any, 'missing')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('isRowUploader', () => {
  it('matches user or anonymous session uploaders only', () => {
    const row = { uploadedByUserId: 'u1', uploadedBySessionId: null }
    expect(isRowUploader(row, { userId: 'u1', anonSessionId: null })).toBe(true)
    expect(isRowUploader(row, { userId: 'u2', anonSessionId: null })).toBe(false)
    expect(isRowUploader(row, { userId: null, anonSessionId: 's1' })).toBe(false)
    expect(
      isRowUploader({ uploadedByUserId: null, uploadedBySessionId: 's1' }, { userId: null, anonSessionId: 's1' })
    ).toBe(true)
    expect(isRowUploader(row, { userId: null, anonSessionId: null })).toBe(false)
  })
})

describe('attachUploadsToFeedback', () => {
  beforeEach(() => {
    stubGlobals()
    state.updateReturning = []
  })
  const now = new Date()

  async function run(ids: string[]) {
    const { db } = await import('~/server/database/drizzle')
    return attachUploadsToFeedback(db as any, {
      attachmentIds: ids,
      feedbackId: 'fb-1',
      projectId: 'p-1',
      actor: { userId: 'u1', anonSessionId: null },
      now,
    })
  }

  it('is a no-op without ids', async () => {
    await expect(run([])).resolves.toBeUndefined()
  })

  it('rejects more than 5 attachments and duplicates', async () => {
    await expect(run(['1', '2', '3', '4', '5', '6'])).rejects.toMatchObject({ statusCode: 400 })
    await expect(run(['1', '1'])).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects when any id is foreign, unfinished, or already used (fewer rows updated)', async () => {
    state.updateReturning = [{ id: 'a' }]
    await expect(run(['a', 'b'])).rejects.toMatchObject({ statusCode: 400 })
  })

  it('passes when every id was bound', async () => {
    state.updateReturning = [{ id: 'a' }, { id: 'b' }]
    await expect(run(['a', 'b'])).resolves.toBeUndefined()
  })
})

describe('runFeedbackAttachmentCleanup', () => {
  beforeEach(() => {
    state.deletes = []
    state.deletedObjects = []
    state.deleteFails = false
  })

  function storage() {
    return {
      deleteObject: vi.fn(async (key: string) => {
        if (state.deleteFails) throw new Error('provider detail /secret/path')
        if (key.includes('gone')) throw Object.assign(new Error('missing'), { code: 'OBJECT_NOT_FOUND' })
        state.deletedObjects.push(key)
      }),
    } as any
  }

  it('does nothing when nothing is stale', async () => {
    state.selectQueue = [[]]
    const s = storage()
    expect(await runFeedbackAttachmentCleanup({ storage: s })).toEqual({
      claimed: 0,
      expired: 0,
      orphaned: 0,
      retried: 0,
    })
    expect(s.deleteObject).not.toHaveBeenCalled()
  })

  it('deletes stale pending uploads and orphans of deleted feedback from storage, then the rows', async () => {
    state.selectQueue = [
      [
        { id: 'a', storageKey: 'feedback-attachments/p/a/x.png', attachedAt: null },
        { id: 'b', storageKey: 'feedback-attachments/p/b/y.log', attachedAt: new Date() },
        { id: 'c', storageKey: 'feedback-attachments/p/gone/z.txt', attachedAt: null },
      ],
    ]
    const result = await runFeedbackAttachmentCleanup({ storage: storage() })
    expect(result).toEqual({ claimed: 3, expired: 2, orphaned: 1, retried: 0 })
    expect(state.deletedObjects).toEqual(['feedback-attachments/p/a/x.png', 'feedback-attachments/p/b/y.log'])
    expect(state.deletes).toHaveLength(3)
  })

  it('keeps the row for retry when storage deletion fails, without leaking provider detail', async () => {
    state.selectQueue = [[{ id: 'a', storageKey: 'feedback-attachments/p/a/x.png', attachedAt: null }]]
    state.deleteFails = true
    const result = await runFeedbackAttachmentCleanup({ storage: storage() })
    expect(result).toEqual({ claimed: 1, expired: 0, orphaned: 0, retried: 1 })
    expect(state.deletes).toHaveLength(0)
  })
})
