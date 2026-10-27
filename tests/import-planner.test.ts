import { getTableName } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Fixture DB: every query returns the rows of its table (fixtures hold one project and one run), so the planner
// must not depend on the where clause for correctness of these scenarios.
const state = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, any>[]>,
  params: {} as Record<string, string>,
  access: null as null | { statusCode: number },
}))

const requireProjectBySlug = vi.hoisted(() =>
  vi.fn(async (_event: unknown, _slug: string, _options?: { admin?: boolean }) => {
    if (state.access) throw Object.assign(new Error('x'), state.access)
    return { session: { user: { id: 'user-1' } }, project: { id: 'proj-1' } }
  })
)

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string; data?: unknown }) =>
  Object.assign(new Error(input.statusMessage), input)
)
vi.stubGlobal('getRouterParam', (_e: unknown, name: string) => state.params[name])

vi.mock('~/server/utils/project-categories', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/server/utils/project-categories')>()),
  requireProjectBySlug,
}))

vi.mock('~/server/database/drizzle', () => {
  const rowsOf = (table: any) => (state.tables[getTableName(table)] ??= [])
  const db: any = {
    select: vi.fn(() => {
      let table: any
      let max = Infinity
      const run = () => rowsOf(table).slice(0, max)
      const chain: any = {
        from: (t: any) => ((table = t), chain),
        where: () => chain,
        orderBy: () => chain,
        limit: (n: number) => ((max = n), chain),
        then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
      }
      return chain
    }),
    insert: vi.fn(() => {
      throw new Error('planner must not write')
    }),
    update: vi.fn(() => {
      throw new Error('planner must not write')
    }),
    delete: vi.fn(() => {
      throw new Error('planner must not write')
    }),
  }
  return { db }
})

import { SYNC_FIELDS, planFieldSync, planImport, snapshotFor } from '~/server/services/imports/planner'

const previewHandler = (await import('~/server/api/projects/[slug]/imports/[runId]/preview.get')).default as (
  e: unknown
) => Promise<any>

describe('planFieldSync', () => {
  const fields = SYNC_FIELDS.feedback

  it('applies a field nobody touched in Veerify', () => {
    const r = planFieldSync({ title: 'A' }, { title: 'A' }, { title: 'B' }, fields)
    expect(r.apply).toEqual({ title: 'B' })
    expect(r.kept).toEqual([])
    expect(r.nextSnapshot).toEqual({ title: 'B' })
  })

  it('keeps a field the team edited and retains the old snapshot (Review Focus 2)', () => {
    const r = planFieldSync(
      { title: 'Fixed title', status: 'in_progress' },
      { title: 'Old title', status: 'open' },
      { title: 'Source title', status: 'planned' },
      fields
    )
    expect(r.apply).toEqual({})
    expect(r.kept).toEqual(['title', 'status'])
    expect(r.nextSnapshot).toEqual({ title: 'Old title', status: 'open' })
  })

  it('updates untouched fields while keeping edited ones', () => {
    const r = planFieldSync(
      { title: 'Old', status: 'in_progress' },
      { title: 'Old', status: 'open' },
      { title: 'New', status: 'planned' },
      fields
    )
    expect(r.apply).toEqual({ title: 'New' })
    expect(r.kept).toEqual(['status'])
    expect(r.nextSnapshot).toEqual({ title: 'New', status: 'open' })
  })

  it('neither applies nor keeps identical values', () => {
    const r = planFieldSync({ title: 'A' }, { title: 'Z' }, { title: 'A' }, fields)
    expect(r.apply).toEqual({})
    expect(r.kept).toEqual([])
  })

  it('applies a default-valued field from a full insert snapshot (isPinned false -> true)', () => {
    const row = {
      title: 'A',
      body: null,
      status: 'open',
      categoryId: null,
      isPinned: false,
      isLocked: false,
      isHidden: false,
    }
    const r = planFieldSync(row, snapshotFor('feedback', row), { isPinned: true, status: 'planned' }, fields)
    expect(r.apply).toEqual({ isPinned: true, status: 'planned' })
    expect(r.kept).toEqual([])
  })

  it('applies everything when there is no snapshot', () => {
    const r = planFieldSync({ title: 'A', isPinned: true }, null, { title: 'B', isPinned: false }, fields)
    expect(r.apply).toEqual({ title: 'B', isPinned: false })
    expect(r.kept).toEqual([])
    expect(r.nextSnapshot).toEqual({ title: 'B', isPinned: false })
  })

  it('ignores fields absent from incoming and fields outside the list', () => {
    const r = planFieldSync({ title: 'A', body: 'x' }, { title: 'A', body: 'x' }, { title: 'B', url: 'u' }, fields)
    expect(r.apply).toEqual({ title: 'B' })
    expect(r.nextSnapshot).toEqual({ title: 'B', body: 'x' })
  })

  it('compares dates, arrays and null/undefined by value', () => {
    const r = planFieldSync(
      { publishedAt: new Date('2025-02-01T12:00:00Z'), labels: ['new'], body: null },
      { publishedAt: '2025-02-01T12:00:00Z', labels: ['new'], body: undefined },
      { publishedAt: '2025-02-01T12:00:00.000Z', labels: ['new', 'fixed'], body: 'b' },
      SYNC_FIELDS.changelog
    )
    expect(r.apply).toEqual({ labels: ['new', 'fixed'], body: 'b' })
    expect(r.kept).toEqual([])
  })
})

describe('snapshotFor', () => {
  it('picks every synced feedback field from the stored row', () => {
    const row = {
      id: 'fb-1',
      title: 'A',
      body: null,
      status: 'open',
      categoryId: null,
      isPinned: false,
      isLocked: false,
      isHidden: false,
      voteCount: 3,
    }
    const snap = snapshotFor('feedback', row)
    expect(Object.keys(snap).sort()).toEqual([...SYNC_FIELDS.feedback].sort())
    expect(snap).toEqual({
      title: 'A',
      body: null,
      status: 'open',
      categoryId: null,
      isPinned: false,
      isLocked: false,
      isHidden: false,
    })
  })

  it('normalizes dates to ISO strings and missing fields to null', () => {
    const snap = snapshotFor('changelog', {
      title: 'T',
      body: '',
      labels: [],
      publishedAt: new Date('2025-02-01T12:00:00Z'),
    })
    expect(snap).toEqual({ title: 'T', body: '', labels: [], status: null, publishedAt: '2025-02-01T12:00:00.000Z' })
    expect(Object.keys(snapshotFor('comment', { body: 'b', isInternal: false }))).toEqual([...SYNC_FIELDS.comment])
  })
})

// The document an earlier run committed, and the DB state that commit left behind.
const doc = () => ({
  statuses: [{ externalId: 'st-1', name: 'Planned' }],
  categories: [{ externalId: 'cat-1', name: 'Ideas' }],
  people: [
    { externalId: 'p-1', name: 'Ada', email: 'ada@example.com' },
    { externalId: 'p-2', name: 'Grace' },
  ],
  feedback: [
    {
      externalId: 'f-1',
      title: 'Dark mode',
      body: 'Please',
      status: 'st-1',
      category: 'cat-1',
      authorExternalId: 'p-1',
      votes: [
        { personExternalId: 'p-1', type: 'upvote' },
        { personExternalId: 'p-2', type: 'downvote' },
      ],
    },
  ],
  comments: [
    { externalId: 'c-1', feedbackExternalId: 'f-1', body: 'Looking into it', authorExternalId: 'p-2' },
    { externalId: 'c-2', feedbackExternalId: 'f-1', parentExternalId: 'c-1', body: 'Thanks' },
  ],
  changelog: [
    {
      externalId: 'cl-1',
      title: 'Shipped',
      body: 'Dark mode shipped',
      labels: ['new'],
      status: 'published' as const,
      publishedAt: '2025-02-01T12:00:00Z',
    },
  ],
})

function seed(payloads: Record<string, any>[], run: Record<string, any> = {}) {
  state.tables.import_run = [
    { id: 'run-2', projectId: 'proj-1', productId: 'prod-1', source: 'canny', onExisting: 'sync', ...run },
  ]
  state.tables.import_run_batch = payloads.map((payload, i) => ({
    id: `b-${i}`,
    runId: 'run-2',
    seq: i + 1,
    payload: { statuses: [], categories: [], people: [], feedback: [], comments: [], changelog: [], ...payload },
  }))
  state.tables.import_run_issue = []
  state.tables.feedback_status = []
  state.tables.feedback_category = [{ id: 'cat-db-1', projectId: 'proj-1', slug: 'ideas', name: 'Ideas', sortOrder: 0 }]
  state.tables.imported_person = [
    { id: 'ip-1', projectId: 'proj-1', source: 'canny', externalId: 'p-1', name: 'Ada', email: 'ada@example.com' },
    { id: 'ip-2', projectId: 'proj-1', source: 'canny', externalId: 'p-2', name: 'Grace', email: null },
  ]
  const fbSnapshot = { title: 'Dark mode', body: 'Please', status: 'planned', categoryId: 'cat-db-1' }
  state.tables.feedback = [
    {
      id: 'fb-1',
      projectId: 'proj-1',
      externalSource: 'canny',
      externalId: 'f-1',
      ...fbSnapshot,
      isPinned: false,
      isLocked: false,
      isHidden: false,
      importSnapshot: { ...fbSnapshot },
    },
  ]
  state.tables.vote = [
    { id: 'v-1', feedbackId: 'fb-1', importedPersonId: 'ip-1', type: 'upvote' },
    { id: 'v-2', feedbackId: 'fb-1', importedPersonId: 'ip-2', type: 'downvote' },
  ]
  state.tables.feedback_comment = [
    {
      id: 'cm-1',
      feedbackId: 'fb-1',
      externalSource: 'canny',
      externalId: 'c-1',
      body: 'Looking into it',
      isInternal: false,
      importSnapshot: { body: 'Looking into it' },
    },
    {
      id: 'cm-2',
      feedbackId: 'fb-1',
      parentCommentId: 'cm-1',
      externalSource: 'canny',
      externalId: 'c-2',
      body: 'Thanks',
      isInternal: false,
      importSnapshot: { body: 'Thanks' },
    },
  ]
  const clSnapshot = {
    title: 'Shipped',
    body: 'Dark mode shipped',
    labels: ['new'],
    status: 'published',
    publishedAt: '2025-02-01T12:00:00Z',
  }
  state.tables.changelog_entry = [
    {
      id: 'ce-1',
      projectId: 'proj-1',
      externalSource: 'canny',
      externalId: 'cl-1',
      ...clSnapshot,
      publishedAt: new Date('2025-02-01T12:00:00Z'),
      importSnapshot: clSnapshot,
    },
  ]
}

const zero = { create: 0, update: 0, unchanged: 0, skip: 0 }

describe('planImport', () => {
  beforeEach(() => {
    state.tables = {}
    state.access = null
    state.params = { slug: 'proj', runId: 'run-2' }
    requireProjectBySlug.mockClear()
  })

  it('reports an identical re-run as all unchanged with nothing to create (Review Focus 1)', async () => {
    seed([doc()])
    const plan = await planImport('run-2')
    expect(plan.counts).toEqual({
      statuses: { ...zero, unchanged: 1 },
      categories: { ...zero, unchanged: 1 },
      people: { ...zero, unchanged: 2 },
      feedback: { ...zero, unchanged: 1 },
      votes: { ...zero, unchanged: 2 },
      comments: { ...zero, unchanged: 2 },
      changelog: { ...zero, unchanged: 1 },
    })
    expect(plan.kept).toEqual([])
    expect(plan.taxonomy).toEqual({ statuses: [], categories: [] })
    expect(plan.issues).toEqual([])
  })

  it('merges batches in seq order', async () => {
    const d = doc()
    seed([
      { statuses: d.statuses, categories: d.categories, people: d.people },
      { feedback: d.feedback, comments: d.comments, changelog: d.changelog },
    ])
    const plan = await planImport('run-2')
    expect(plan.counts.feedback).toEqual({ ...zero, unchanged: 1 })
    expect(plan.counts.comments).toEqual({ ...zero, unchanged: 2 })
  })

  it('counts a new comment on existing feedback as a create', async () => {
    seed([{ comments: [{ externalId: 'c-3', feedbackExternalId: 'f-1', parentExternalId: 'c-1', body: 'New' }] }])
    const plan = await planImport('run-2')
    expect(plan.counts.comments).toEqual({ ...zero, create: 1 })
    expect(plan.issues).toEqual([])
  })

  it('skips a comment on unknown feedback or with an unknown parent', async () => {
    seed([
      {
        comments: [
          { externalId: 'c-9', feedbackExternalId: 'f-missing', body: 'x' },
          { externalId: 'c-10', feedbackExternalId: 'f-1', parentExternalId: 'c-missing', body: 'y' },
          { externalId: 'c-11', feedbackExternalId: 'f-1', parentExternalId: 'c-10', body: 'z' },
        ],
      },
    ])
    const plan = await planImport('run-2')
    expect(plan.counts.comments).toEqual({ ...zero, skip: 3 })
    expect(plan.issues.map((i) => [i.severity, i.entityType, i.externalId])).toEqual([
      ['skipped', 'comment', 'c-9'],
      ['skipped', 'comment', 'c-10'],
      ['skipped', 'comment', 'c-11'],
    ])
  })

  it('counts a duplicate vote by the same person in one feedback as skip', async () => {
    seed([
      {
        feedback: [
          { externalId: 'f-new', title: 'New', votes: [{ personExternalId: 'p-1' }, { personExternalId: 'p-1' }] },
        ],
      },
    ])
    const plan = await planImport('run-2')
    expect(plan.counts.votes).toEqual({ ...zero, create: 1, skip: 1 })
  })

  it('skips votes by unknown people and warns on unknown feedback authors', async () => {
    seed([
      {
        feedback: [
          { externalId: 'f-new', title: 'New', authorExternalId: 'p-ghost', votes: [{ personExternalId: 'p-ghost' }] },
        ],
      },
    ])
    const plan = await planImport('run-2')
    expect(plan.counts.feedback).toEqual({ ...zero, create: 1 })
    expect(plan.counts.votes).toEqual({ ...zero, skip: 1 })
    expect(plan.issues.map((i) => [i.severity, i.entityType, i.externalId])).toEqual([
      ['warning', 'feedback', 'f-new'],
      ['skipped', 'vote', 'f-new'],
    ])
  })

  it('creates new people, feedback and votes and lists taxonomy to create', async () => {
    seed([
      {
        statuses: [{ externalId: 'st-9', name: 'Under review' }],
        categories: [{ externalId: 'cat-9', name: 'Bugs' }],
        people: [{ externalId: 'p-3', name: 'Linus' }],
        feedback: [
          {
            externalId: 'f-2',
            title: 'Crash',
            status: 'st-9',
            category: 'cat-9',
            votes: [{ personExternalId: 'p-3' }, { personExternalId: 'p-1' }],
          },
        ],
      },
    ])
    const plan = await planImport('run-2')
    expect(plan.counts.statuses.create).toBe(6) // 5 system statuses seeded + under_review
    expect(plan.counts.categories).toEqual({ ...zero, create: 1 })
    expect(plan.counts.people).toEqual({ ...zero, create: 1 })
    expect(plan.counts.feedback).toEqual({ ...zero, create: 1 })
    expect(plan.counts.votes).toEqual({ ...zero, create: 2 })
    expect(plan.taxonomy.categories.map((c) => c.slug)).toEqual(['bugs'])
  })

  it('lists edited fields as kept and still counts untouched changes as updates (Review Focus 2)', async () => {
    seed([doc()])
    Object.assign(state.tables.feedback[0], { status: 'in_progress' })
    const d = doc()
    d.feedback[0].title = 'Dark mode (renamed upstream)'
    d.statuses = [{ externalId: 'st-1', name: 'Completed' }]
    const batch = state.tables.import_run_batch[0]
    batch.payload = { ...batch.payload, ...d }
    const plan = await planImport('run-2')
    expect(plan.counts.feedback).toEqual({ ...zero, update: 1 })
    expect(plan.kept).toEqual([{ entity: 'feedback', externalId: 'f-1', fields: ['status'] }])
  })

  it('counts a record with only kept fields as unchanged', async () => {
    seed([doc()])
    Object.assign(state.tables.changelog_entry[0], { title: 'Shipped!' })
    const batch = state.tables.import_run_batch[0]
    batch.payload.changelog = [{ ...doc().changelog[0], title: 'Shipped v2' }]
    const plan = await planImport('run-2')
    expect(plan.counts.changelog).toEqual({ ...zero, unchanged: 1 })
    expect(plan.kept).toEqual([{ entity: 'changelog', externalId: 'cl-1', fields: ['title'] }])
  })

  it('updates people from the source because they have no snapshot', async () => {
    seed([{ people: [{ externalId: 'p-1', name: 'Ada Lovelace', email: 'ada@example.com' }] }])
    const plan = await planImport('run-2')
    expect(plan.counts.people).toEqual({ ...zero, update: 1 })
  })

  it("onExisting 'skip' puts existing records under unchanged with no updates", async () => {
    const d = doc()
    d.feedback[0].title = 'Changed'
    d.comments[0].body = 'Changed'
    d.changelog[0].title = 'Changed'
    d.people[0].name = 'Changed'
    seed([d], { onExisting: 'skip' })
    const plan = await planImport('run-2')
    for (const section of ['people', 'feedback', 'comments', 'changelog'] as const) {
      expect(plan.counts[section].update).toBe(0)
      expect(plan.counts[section].create).toBe(0)
    }
    expect(plan.counts.feedback.unchanged).toBe(1)
    expect(plan.kept).toEqual([])
  })

  it('includes staged issues and caps issues at 500', async () => {
    seed([
      {
        comments: Array.from({ length: 600 }, (_, i) => ({
          externalId: `c-x${i}`,
          feedbackExternalId: 'f-missing',
          body: 'x',
        })),
      },
    ])
    state.tables.import_run_issue = [
      { id: 'i-1', runId: 'run-2', severity: 'skipped', entityType: 'feedback', externalId: 'f-dup', message: 'dup' },
    ]
    const plan = await planImport('run-2')
    expect(plan.issues).toHaveLength(500)
    expect(plan.issues[0]).toEqual({ severity: 'skipped', entityType: 'feedback', externalId: 'f-dup', message: 'dup' })
    expect(plan.counts.comments.skip).toBe(600)
  })
})

describe('GET /api/projects/:slug/imports/:runId/preview', () => {
  beforeEach(() => {
    state.tables = {}
    state.access = null
    state.params = { slug: 'proj', runId: 'run-2' }
    requireProjectBySlug.mockClear()
  })

  it('requires project admin', async () => {
    state.access = { statusCode: 403 }
    await expect(previewHandler({})).rejects.toMatchObject({ statusCode: 403 })
    expect(requireProjectBySlug.mock.calls[0]?.[2]).toEqual({ admin: true })
  })

  it('404s for a run of another project', async () => {
    seed([doc()], { projectId: 'proj-other' })
    state.tables.import_run = []
    await expect(previewHandler({})).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns the plan', async () => {
    seed([doc()])
    const res = await previewHandler({})
    expect(res.success).toBe(true)
    expect(res.data.counts.feedback).toEqual({ ...zero, unchanged: 1 })
  })
})
