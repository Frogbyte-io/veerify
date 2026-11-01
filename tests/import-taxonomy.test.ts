import { getTableName } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveFeedbackStatus, resolveTaxonomy } from '~/server/services/imports/taxonomy'

const state = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, any>[]> }))

vi.mock('~/server/database/drizzle', () => ({ db: {} }))

function fakeTx() {
  const rowsOf = (table: any) => (state.tables[getTableName(table)] ??= [])
  return {
    select: () => ({
      from: (table: any) => ({
        where: () => {
          const rows = rowsOf(table).map((r) => ({ ...r }))
          return Object.assign(Promise.resolve(rows), {
            orderBy: async () => [...rows].sort((a, b) => a.sortOrder - b.sortOrder || (a.value < b.value ? -1 : 1)),
          })
        },
      }),
    }),
    insert: (table: any) => ({
      values: (values: any) => ({
        onConflictDoNothing: async () => {
          const key = getTableName(table) === 'feedback_status' ? 'value' : 'slug'
          for (const v of Array.isArray(values) ? values : [values]) {
            if (!rowsOf(table).some((r) => r.projectId === v.projectId && r[key] === v[key]))
              rowsOf(table).push({ ...v })
          }
        },
      }),
    }),
  } as any
}

const underReview = { statuses: [{ externalId: 's1', name: 'Under review' }], categories: [] }

describe('resolveTaxonomy', () => {
  beforeEach(() => {
    state.tables = {}
  })

  it('seeds system statuses before adding a new one (preview)', async () => {
    const res = await resolveTaxonomy('p1', underReview, { apply: false, tx: fakeTx() })
    expect(res.toCreate.statuses.map((s) => s.value)).toEqual([
      'open',
      'planned',
      'in_progress',
      'completed',
      'closed',
      'under_review',
    ])
    expect(res.toCreate.statuses.map((s) => s.systemDefault ?? false)).toEqual([true, true, true, true, true, false])
    expect(res.statusValueByExternalId.get('s1')).toBe('under_review')
    expect(state.tables['feedback_status']).toEqual([])
  })

  it('inserts the 6 rows with open as default when applying', async () => {
    await resolveTaxonomy('p1', underReview, { apply: true, tx: fakeTx() })
    const rows = state.tables['feedback_status']
    expect(rows).toHaveLength(6)
    expect(rows.filter((r) => r.isDefault).map((r) => r.value)).toEqual(['open'])
    expect(rows.find((r) => r.value === 'under_review')?.sortOrder).toBe(5)
  })

  it('maps onto an existing status without creating', async () => {
    state.tables['feedback_status'] = [{ projectId: 'p1', value: 'planned', sortOrder: 0 }]
    const res = await resolveTaxonomy(
      'p1',
      { statuses: [{ externalId: 's1', name: 'Planned' }], categories: [] },
      { apply: true, tx: fakeTx() }
    )
    expect(res.statusValueByExternalId.get('s1')).toBe('planned')
    expect(res.toCreate.statuses).toEqual([])
    expect(state.tables['feedback_status']).toHaveLength(1)
  })

  it('warns on an invalid mapTo and falls back to the name', async () => {
    const res = await resolveTaxonomy(
      'p1',
      { statuses: [{ externalId: 's1', name: 'Planned', mapTo: 'nope' }], categories: [] },
      { apply: false, tx: fakeTx() }
    )
    expect(res.issues).toHaveLength(1)
    expect(res.issues[0]).toMatchObject({ severity: 'warning', entityType: 'status', externalId: 's1' })
    expect(res.statusValueByExternalId.get('s1')).toBe('planned')
  })

  it('creates a shared new value once for two sources', async () => {
    const res = await resolveTaxonomy(
      'p1',
      {
        statuses: [
          { externalId: 'a', name: 'Under review' },
          { externalId: 'b', name: 'under-review' },
        ],
        categories: [],
      },
      { apply: false, tx: fakeTx() }
    )
    expect(res.toCreate.statuses.filter((s) => s.value === 'under_review')).toHaveLength(1)
    expect(res.statusValueByExternalId.get('b')).toBe('under_review')
  })

  it('maps a category by slug and by mapTo id, creates missing', async () => {
    state.tables['feedback_category'] = [
      { id: 'c1', projectId: 'p1', slug: 'bug-reports', sortOrder: 0 },
      { id: 'c2', projectId: 'p1', slug: 'ideas', sortOrder: 1 },
    ]
    const res = await resolveTaxonomy(
      'p1',
      {
        statuses: [],
        categories: [
          { externalId: 'x', name: 'Bug Reports' },
          { externalId: 'y', name: 'Whatever', mapTo: 'c2' },
          { externalId: 'z', name: 'Docs' },
        ],
      },
      { apply: true, tx: fakeTx() }
    )
    expect(res.categoryIdByExternalId.get('x')).toBe('c1')
    expect(res.categoryIdByExternalId.get('y')).toBe('c2')
    const docs = state.tables['feedback_category'].find((r) => r.slug === 'docs')
    expect(docs).toBeTruthy()
    expect(res.categoryIdByExternalId.get('z')).toBe(docs!.id)
    expect(res.toCreate.categories.map((c) => c.slug)).toEqual(['docs'])
  })

  it('creates categories as null ids on preview', async () => {
    const res = await resolveTaxonomy(
      'p1',
      { statuses: [], categories: [{ externalId: 'z', name: 'Docs' }] },
      { apply: false, tx: fakeTx() }
    )
    expect(res.categoryIdByExternalId.get('z')).toBeNull()
    expect(res.toCreate.categories).toEqual([{ name: 'Docs', slug: 'docs', color: undefined }])
  })
})

describe('resolveTaxonomy extras', () => {
  beforeEach(() => {
    state.tables = {}
  })
  const rows = [
    { projectId: 'p1', value: 'backlog', sortOrder: 3, isDefault: true },
    { projectId: 'p1', value: 'done', sortOrder: 7, isDefault: false },
  ]

  it('falls back to the project default status', async () => {
    state.tables['feedback_status'] = rows.map((r) => ({ ...r }))
    const r = await resolveTaxonomy('p1', { statuses: [], categories: [] }, { apply: false, tx: fakeTx() })
    expect(r.defaultStatusValue).toBe('backlog')
    const out = resolveFeedbackStatus('x', r, new Set(['backlog', 'done']))
    expect(out.value).toBe('backlog')
    expect(out.issue?.severity).toBe('warning')
    expect(resolveFeedbackStatus(undefined, r, new Set(['backlog'])).value).toBe('backlog')
  })

  it('uses the lowest sortOrder when no default row, and open without rows', async () => {
    state.tables['feedback_status'] = rows.map((r) => ({ ...r, isDefault: false }))
    const r = await resolveTaxonomy('p1', { statuses: [], categories: [] }, { apply: false, tx: fakeTx() })
    expect(r.defaultStatusValue).toBe('backlog')
    state.tables = {}
    const e = await resolveTaxonomy('p1', { statuses: [], categories: [] }, { apply: false, tx: fakeTx() })
    expect(e.defaultStatusValue).toBe('open')
  })

  it('accepts a valid status mapTo', async () => {
    state.tables['feedback_status'] = rows.map((r) => ({ ...r }))
    const r = await resolveTaxonomy(
      'p1',
      { statuses: [{ externalId: 's', name: 'Whatever', mapTo: 'done' }], categories: [] },
      { apply: true, tx: fakeTx() }
    )
    expect(r.statusValueByExternalId.get('s')).toBe('done')
    expect(r.issues).toEqual([])
    expect(r.toCreate.statuses).toEqual([])
  })

  it('appends a new status after existing rows with max + 1 and default colour', async () => {
    state.tables['feedback_status'] = rows.map((r) => ({ ...r }))
    const batch = { statuses: [{ externalId: 's', name: 'Under review' }], categories: [] }
    const preview = await resolveTaxonomy('p1', batch, { apply: false, tx: fakeTx() })
    expect(preview.toCreate.statuses).toEqual([{ name: 'Under review', value: 'under_review', color: '#6b7280' }])
    await resolveTaxonomy('p1', batch, { apply: true, tx: fakeTx() })
    const added = state.tables['feedback_status'].find((r) => r.value === 'under_review')
    expect(added?.sortOrder).toBe(8)
    expect(state.tables['feedback_status']).toHaveLength(3)
  })

  it('resolves mapTo to a value created earlier in the batch without a warning', async () => {
    const r = await resolveTaxonomy(
      'p1',
      {
        statuses: [
          { externalId: 'a', name: 'Under review' },
          { externalId: 'b', name: 'Other', mapTo: 'under_review' },
        ],
        categories: [],
      },
      { apply: false, tx: fakeTx() }
    )
    expect(r.issues).toEqual([])
    expect(r.statusValueByExternalId.get('b')).toBe('under_review')
  })
})

describe('resolveFeedbackStatus', () => {
  const res: any = { statusValueByExternalId: new Map([['s1', 'under_review']]), defaultStatusValue: 'open' }
  const effective = new Set(['open', 'planned', 'under_review'])

  it('prefers the external id map, then a valid value, then open with a warning', () => {
    expect(resolveFeedbackStatus('s1', res, effective)).toEqual({ value: 'under_review' })
    expect(resolveFeedbackStatus('planned', res, effective)).toEqual({ value: 'planned' })
    const out = resolveFeedbackStatus('x', res, effective)
    expect(out.value).toBe('open')
    expect(out.issue?.severity).toBe('warning')
  })

  it('returns open silently when undefined', () => {
    expect(resolveFeedbackStatus(undefined, res, effective)).toEqual({ value: 'open' })
  })
})
