import { randomUUID } from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { db } from '../../server/database/drizzle'
import { member, organization, user } from '../../server/database/schema/auth'
import { changelogEntry, changelogEntryFeedback } from '../../server/database/schema/changelog'
import {
  feedback,
  feedbackComment,
  importedPerson,
  product,
  project,
  vote,
} from '../../server/database/schema/feedback'
import { importRun, importRunIssue } from '../../server/database/schema/imports'
import type { ImportBatch } from '../../server/services/imports/format'

/**
 * Commit engine against a real Postgres: idempotent re-runs, counters, Veerify-wins sync, vote baselines,
 * cross-project isolation, the lease under concurrent advance calls, and no side effects.
 */

type FakeEvent = {
  session: { user: { id: string }; session: { token: string; activeOrganizationId: string; activeProjectId: null } }
  params: Record<string, string>
  status?: number
}

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRouterParam', (event: FakeEvent, name: string) => event.params[name])
vi.stubGlobal('setResponseStatus', (event: FakeEvent, status: number) => {
  event.status = status
})
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string; data?: unknown }) =>
  Object.assign(new Error(input.statusMessage), input)
)

vi.mock('~/server/utils/auth-middleware', () => ({
  requireAuth: async (event: FakeEvent) => event.session,
}))

// Every function export of the side-effect modules becomes a spy; a commit must call none of them.
const spyAll = vi.hoisted(() => async (load: () => Promise<Record<string, unknown>>) => {
  const mod = await load()
  return Object.fromEntries(Object.entries(mod).map(([k, v]) => [k, typeof v === 'function' ? vi.fn() : v]))
})
vi.mock('~/server/utils/notifications', (orig) => spyAll(orig as () => Promise<Record<string, unknown>>))
vi.mock('~/lib/email', (orig) => spyAll(orig as () => Promise<Record<string, unknown>>))
vi.mock('~/server/services/realtime', (orig) => spyAll(orig as () => Promise<Record<string, unknown>>))
vi.mock('~/server/services/changelog/hooks', (orig) => spyAll(orig as () => Promise<Record<string, unknown>>))
vi.mock('~/server/services/changelog/entries', async (orig) => {
  const mod = (await orig()) as Record<string, unknown>
  return { ...mod, publishEntry: vi.fn(), createEntry: vi.fn(), updateEntry: vi.fn() }
})
// Pass-through spy: an advance call that loses the lease must not even load the staged batch.
vi.mock('~/server/services/imports/planner', async (orig) => {
  const mod = (await orig()) as typeof import('../../server/services/imports/planner')
  return { ...mod, loadRunBatch: vi.fn(mod.loadRunBatch) }
})

const { addImportBatch, createImportRun } = await import('../../server/services/imports/runs')
const { loadRunBatch, planImport } = await import('../../server/services/imports/planner')
const { advanceImportRun, advanceImportRuns, commitImportRun } = await import('../../server/services/imports/committer')
const commitRoute = (await import('../../server/api/projects/[slug]/imports/[runId]/commit.post'))
  .default as unknown as (e: FakeEvent) => Promise<{ success: boolean; data: any }>

const sideEffectModules = await Promise.all([
  import('~/server/utils/notifications'),
  import('~/lib/email'),
  import('~/server/services/realtime'),
  import('~/server/services/changelog/hooks'),
  import('~/server/services/changelog/entries'),
])

function expectNoSideEffects() {
  for (const mod of sideEffectModules) {
    for (const [name, fn] of Object.entries(mod)) {
      if (vi.isMockFunction(fn)) expect(fn, name).not.toHaveBeenCalled()
    }
  }
}

const suffix = randomUUID().slice(0, 8)
const orgId = `ic_org_${suffix}`
const ownerId = `ic_owner_${suffix}`
const userEmail = `ic-ada-${suffix}@example.com`
const projA = { id: `ic_pa_${suffix}`, slug: `ic-a-${suffix}`, productId: `ic_pra_${suffix}` }
const projB = { id: `ic_pb_${suffix}`, slug: `ic-b-${suffix}`, productId: `ic_prb_${suffix}` }
const SOURCE = 'canny'

function doc(overrides: { titleF1?: string; statusF1?: string } = {}): ImportBatch {
  return {
    statuses: [{ externalId: 'st-1', name: 'Under review', color: '#f59e0b' }],
    categories: [],
    people: [
      // Same email as the seeded Veerify user: must still not become authorUserId/voterUserId (Review Focus 4)
      { externalId: 'p-1', name: 'Ada Lovelace', email: userEmail },
      { externalId: 'p-2', name: 'Grace Hopper', email: `ic-grace-${suffix}@example.com` },
    ],
    feedback: [
      {
        externalId: 'f-1',
        title: overrides.titleF1 ?? 'Dark mode',
        body: 'Please add a dark theme.',
        url: 'https://example.canny.io/posts/dark-mode',
        status: overrides.statusF1 ?? 'st-1',
        authorExternalId: 'p-1',
        createdAt: '2025-01-15T10:00:00Z',
        voteCount: 10,
        votes: [
          { personExternalId: 'p-1', type: 'upvote', createdAt: '2025-01-15T10:00:00Z' },
          { personExternalId: 'p-2', type: 'upvote' },
        ],
      },
      {
        externalId: 'f-2',
        title: 'Export to CSV',
        authorExternalId: 'p-2',
        createdAt: '2025-01-10T10:00:00Z',
        updatedAt: '2025-01-12T10:00:00Z',
        votes: [
          { personExternalId: 'p-1', type: 'upvote' },
          { personExternalId: 'p-2', type: 'downvote' },
        ],
      },
      {
        externalId: 'f-3',
        title: 'Keyboard shortcuts',
        votes: [{ personExternalId: 'p-2', type: 'upvote' }],
      },
    ],
    comments: [
      {
        externalId: 'c-1',
        feedbackExternalId: 'f-1',
        body: 'We are looking into this.',
        authorExternalId: 'p-1',
        createdAt: '2025-01-16T09:00:00Z',
      },
      {
        externalId: 'c-2',
        feedbackExternalId: 'f-1',
        parentExternalId: 'c-1',
        body: 'Thanks!',
        authorExternalId: 'p-2',
      },
    ],
    changelog: [
      {
        externalId: 'cl-1',
        title: 'Dark mode is live',
        body: 'Dark mode shipped.',
        labels: ['new', 'bogus'],
        status: 'published',
        publishedAt: '2025-02-01T12:00:00Z',
        feedbackExternalIds: ['f-1'],
      },
    ],
  }
}

async function stage(projectId: string, productId: string, batch: ImportBatch, source = SOURCE) {
  const run = await createImportRun({ projectId, productId, userId: ownerId, source, sourceLabel: 'Canny' })
  await addImportBatch(run.id, batch)
  return run
}

async function importedFeedback(projectId: string, source = SOURCE) {
  const rows = await db
    .select()
    .from(feedback)
    .where(and(eq(feedback.projectId, projectId), eq(feedback.externalSource, source)))
  return Object.fromEntries(rows.map((r) => [r.externalId!, r]))
}

async function countsFor(projectId: string, source = SOURCE) {
  const fb = await importedFeedback(projectId, source)
  const ids = Object.values(fb).map((f) => f.id)
  const votes = ids.length ? await db.select().from(vote).where(inArray(vote.feedbackId, ids)) : []
  const comments = ids.length
    ? await db.select().from(feedbackComment).where(inArray(feedbackComment.feedbackId, ids))
    : []
  const people = await db
    .select()
    .from(importedPerson)
    .where(and(eq(importedPerson.projectId, projectId), eq(importedPerson.source, source)))
  const changelog = await db
    .select()
    .from(changelogEntry)
    .where(and(eq(changelogEntry.projectId, projectId), eq(changelogEntry.externalSource, source)))
  return {
    feedback: ids.length,
    votes: votes.length,
    comments: comments.length,
    people: people.length,
    changelog: changelog.length,
    counters: Object.fromEntries(
      Object.entries(fb).map(([k, f]) => [k, { voteCount: f.voteCount, commentCount: f.commentCount }])
    ),
  }
}

describe('import commit engine (real Postgres)', () => {
  beforeAll(async () => {
    await db.insert(organization).values({ id: orgId, name: 'IC Org', slug: `ic-org-${suffix}` })
    await db.insert(user).values({ id: ownerId, name: 'Owner', email: userEmail, emailVerified: true })
    await db.insert(member).values({ id: `${ownerId}_m`, organizationId: orgId, userId: ownerId, role: 'owner' })
    for (const p of [projA, projB]) {
      await db.insert(project).values({ id: p.id, organizationId: orgId, slug: p.slug, name: p.slug })
      await db.insert(product).values({ id: p.productId, projectId: p.id, name: 'Main', slug: 'main' })
    }
  })

  afterAll(async () => {
    const projectIds = [projA.id, projB.id]
    await db.delete(changelogEntry).where(inArray(changelogEntry.projectId, projectIds))
    await db.delete(feedback).where(inArray(feedback.projectId, projectIds))
    await db.delete(organization).where(eq(organization.id, orgId))
    await db.delete(user).where(eq(user.id, ownerId))
  })

  it('commits a document: rows, counters, people without users, published changelog, matching the preview', async () => {
    const run = await stage(projA.id, projA.productId, doc())
    const preview = await planImport(run.id)

    const done = await commitImportRun(run.id)
    expect(done.status).toBe('completed')
    expect(done.completedAt).toBeTruthy()
    expect(done.leaseUntil).toBeNull()
    expect(done.summary?.counts).toEqual(preview.counts)
    // One imported status; the built-in statuses saved with it are not counted.
    expect(done.summary?.counts.statuses.create).toBe(1)

    const fb = await importedFeedback(projA.id)
    expect(Object.keys(fb).sort()).toEqual(['f-1', 'f-2', 'f-3'])
    // f-1: voteCount 10 with 2 listed upvotes -> baseline 8, counter 8 + 2
    expect(fb['f-1']).toMatchObject({ voteCount: 10, importedVoteBaseline: 8, commentCount: 2 })
    // f-2: one up, one down, no voteCount -> 0
    expect(fb['f-2']).toMatchObject({ voteCount: 0, importedVoteBaseline: 0, commentCount: 0 })
    expect(fb['f-3']).toMatchObject({ voteCount: 1, importedVoteBaseline: 0 })

    const f1 = fb['f-1']
    expect(f1.productId).toBe(projA.productId)
    expect(f1.status).toBe('under_review')
    expect(f1.authorUserId).toBeNull()
    expect(f1.authorEmail).toBe(userEmail)
    expect(f1.authorName).toBe('Ada Lovelace')
    expect(f1.importedPersonId).toBeTruthy()
    expect(f1.sourceLabel).toBe('Canny')
    expect(f1.metadata?.import).toEqual({ runId: run.id, url: 'https://example.canny.io/posts/dark-mode' })
    expect(f1.createdAt.toISOString()).toBe('2025-01-15T10:00:00.000Z')
    expect(f1.updatedAt.toISOString()).toBe('2025-01-15T10:00:00.000Z')
    expect(fb['f-2'].updatedAt.toISOString()).toBe('2025-01-12T10:00:00.000Z')
    expect(f1.importSnapshot).toMatchObject({ title: 'Dark mode', status: 'under_review', isPinned: false })

    const ids = Object.values(fb).map((f) => f.id)
    const votes = await db.select().from(vote).where(inArray(vote.feedbackId, ids))
    expect(votes).toHaveLength(5)
    expect(votes.filter((v) => v.type === 'downvote')).toHaveLength(1)
    expect(votes.every((v) => v.voterUserId === null && v.importedPersonId)).toBe(true)

    const comments = await db.select().from(feedbackComment).where(eq(feedbackComment.feedbackId, f1.id))
    const c1 = comments.find((c) => c.externalId === 'c-1')!
    const c2 = comments.find((c) => c.externalId === 'c-2')!
    expect(c2.parentCommentId).toBe(c1.id)
    expect(c1.createdAt.toISOString()).toBe('2025-01-16T09:00:00.000Z')
    expect(comments.every((c) => c.authorUserId === null)).toBe(true)

    const [entry] = await db
      .select()
      .from(changelogEntry)
      .where(and(eq(changelogEntry.projectId, projA.id), eq(changelogEntry.externalId, 'cl-1')))
    expect(entry).toMatchObject({ status: 'published', labels: ['new'], authorUserId: null })
    expect(entry.publishedAt?.toISOString()).toBe('2025-02-01T12:00:00.000Z')
    const links = await db.select().from(changelogEntryFeedback).where(eq(changelogEntryFeedback.entryId, entry.id))
    expect(links.map((l) => l.feedbackId)).toEqual([f1.id])

    const issues = await db.select().from(importRunIssue).where(eq(importRunIssue.runId, run.id))
    expect(issues.some((i) => i.message.includes('"bogus"'))).toBe(true)

    expectNoSideEffects()
  })

  it('re-running the identical document creates nothing and changes no counts (Review Focus 1)', async () => {
    const before = await countsFor(projA.id)
    const run = await stage(projA.id, projA.productId, doc())
    const preview = await planImport(run.id)
    for (const section of Object.values(preview.counts)) expect(section.create).toBe(0)

    const done = await commitImportRun(run.id)
    expect(done.status).toBe('completed')
    expect(done.summary?.counts).toEqual(preview.counts)
    for (const section of Object.values(done.summary!.counts as Record<string, { create: number; update: number }>)) {
      expect(section.create).toBe(0)
      expect(section.update).toBe(0)
    }
    expect(await countsFor(projA.id)).toEqual(before)
    expectNoSideEffects()
  })

  it('committing the same externalIds into another project leaves the first project untouched', async () => {
    const before = await countsFor(projA.id)
    const beforeRows = await importedFeedback(projA.id)

    const run = await stage(projB.id, projB.productId, doc({ titleF1: 'Project B title' }))
    const done = await commitImportRun(run.id)
    expect(done.status).toBe('completed')
    expect(done.summary?.counts.feedback.create).toBe(3)

    const b = await countsFor(projB.id)
    expect(b).toMatchObject({ feedback: 3, votes: 5, comments: 2, people: 2, changelog: 1 })
    expect(b.counters['f-1']).toEqual({ voteCount: 10, commentCount: 2 })

    expect(await countsFor(projA.id)).toEqual(before)
    const afterRows = await importedFeedback(projA.id)
    expect(afterRows['f-1'].title).toBe('Dark mode')
    expect(afterRows['f-1'].updatedAt).toEqual(beforeRows['f-1'].updatedAt)
    expect((await importedFeedback(projB.id))['f-1'].productId).toBe(projB.productId)
  })

  it('keeps a field the team edited and updates the untouched ones (Review Focus 2)', async () => {
    const fbBefore = await importedFeedback(projA.id)
    await db.update(feedback).set({ status: 'in_progress' }).where(eq(feedback.id, fbBefore['f-1'].id))

    const run = await stage(
      projA.id,
      projA.productId,
      doc({ titleF1: 'Dark mode (all platforms)', statusF1: 'planned' })
    )
    const done = await commitImportRun(run.id)
    expect(done.status).toBe('completed')
    expect(done.summary?.counts.feedback.update).toBe(1)
    expect(done.summary?.kept).toBe(1)

    const f1 = (await importedFeedback(projA.id))['f-1']
    expect(f1.title).toBe('Dark mode (all platforms)')
    expect(f1.status).toBe('in_progress')
    expect(f1.voteCount).toBe(10)
    expect(f1.commentCount).toBe(2)
  })

  it('moves the counter by the baseline difference, keeping live votes (140 + 5 live, re-import 150 -> 155)', async () => {
    const single = (voteCount: number): ImportBatch => ({
      statuses: [],
      categories: [],
      people: [],
      feedback: [{ externalId: 'f-baseline', title: 'Baseline', voteCount }],
      comments: [],
      changelog: [],
    })
    await commitImportRun((await stage(projA.id, projA.productId, single(140))).id)
    const row = (await importedFeedback(projA.id))['f-baseline']
    expect(row).toMatchObject({ voteCount: 140, importedVoteBaseline: 140 })

    // Five live votes, counted the way the vote route counts them
    await db.insert(vote).values(Array.from({ length: 5 }, () => ({ id: randomUUID(), feedbackId: row.id })))
    await db
      .update(feedback)
      .set({ voteCount: sql`${feedback.voteCount} + 5` })
      .where(eq(feedback.id, row.id))

    await commitImportRun((await stage(projA.id, projA.productId, single(150))).id)
    expect((await importedFeedback(projA.id))['f-baseline']).toMatchObject({
      voteCount: 155,
      importedVoteBaseline: 150,
    })
  })

  it('serializes two concurrent advance calls on one run through the lease (Review Focus 5)', async () => {
    const source = `concurrent-${suffix}`
    const run = await stage(projA.id, projA.productId, doc(), source)
    await db.update(importRun).set({ status: 'committing', committedAt: new Date() }).where(eq(importRun.id, run.id))

    vi.mocked(loadRunBatch).mockClear()
    const results = await Promise.all([
      advanceImportRun(run.id, { budgetMs: 20_000 }),
      advanceImportRun(run.id, { budgetMs: 20_000 }),
    ])
    expect(results.filter((r) => r.done)).toHaveLength(1)
    expect(results.filter((r) => !r.done)).toHaveLength(1)
    // Exactly one call did the work: the other did not get the lease, so it never loaded the batch
    expect(loadRunBatch).toHaveBeenCalledTimes(1)

    const counts = await countsFor(projA.id, source)
    expect(counts).toMatchObject({ feedback: 3, votes: 5, comments: 2, people: 2, changelog: 1 })
    expect(counts.counters['f-1']).toEqual({ voteCount: 10, commentCount: 2 })

    const [after] = await db.select().from(importRun).where(eq(importRun.id, run.id))
    expect(after.status).toBe('completed')
    // A completed run is never claimed again
    expect(await advanceImportRun(run.id, { budgetMs: 20_000 })).toEqual({ done: false })
  })

  it('keeps the baseline when a re-run omits voteCount (140 + 5 live, re-run without voteCount -> 145)', async () => {
    const single = (voteCount?: number): ImportBatch => ({
      statuses: [],
      categories: [],
      people: [],
      feedback: [{ externalId: 'f-keep', title: 'Keep baseline', ...(voteCount !== undefined ? { voteCount } : {}) }],
      comments: [],
      changelog: [],
    })
    await commitImportRun((await stage(projA.id, projA.productId, single(140))).id)
    const row = (await importedFeedback(projA.id))['f-keep']
    await db.insert(vote).values(Array.from({ length: 5 }, () => ({ id: randomUUID(), feedbackId: row.id })))
    await db
      .update(feedback)
      .set({ voteCount: sql`${feedback.voteCount} + 5` })
      .where(eq(feedback.id, row.id))

    await commitImportRun((await stage(projA.id, projA.productId, single())).id)
    expect((await importedFeedback(projA.id))['f-keep']).toMatchObject({ voteCount: 145, importedVoteBaseline: 140 })
  })

  it('keeps voteCount a signed net sum (no clamp at zero)', async () => {
    const single = (voteCount: number): ImportBatch => ({
      statuses: [],
      categories: [],
      people: [],
      feedback: [{ externalId: 'f-clamp', title: 'Clamp', voteCount }],
      comments: [],
      changelog: [],
    })
    await commitImportRun((await stage(projA.id, projA.productId, single(10))).id)
    const row = (await importedFeedback(projA.id))['f-clamp']
    // Live downvotes pulled the counter under the baseline
    await db.update(feedback).set({ voteCount: 3 }).where(eq(feedback.id, row.id))
    await commitImportRun((await stage(projA.id, projA.productId, single(0))).id)
    // 3 + (0 − 10): the counter is a signed net sum, like the vote route keeps it
    expect((await importedFeedback(projA.id))['f-clamp']).toMatchObject({ voteCount: -7, importedVoteBaseline: 0 })
  })

  it('derives changelog status on sync: publishedAt alone publishes; status published stamps publishedAt', async () => {
    const entries = (cl: ImportBatch['changelog']): ImportBatch => ({
      statuses: [],
      categories: [],
      people: [],
      feedback: [],
      comments: [],
      changelog: cl,
    })
    await commitImportRun(
      (
        await stage(
          projA.id,
          projA.productId,
          entries([
            { externalId: 'cl-date', title: 'Dated', body: 'b' },
            { externalId: 'cl-status', title: 'Status', body: 'b' },
          ])
        )
      ).id
    )
    const before = Date.now()
    await commitImportRun(
      (
        await stage(
          projA.id,
          projA.productId,
          entries([
            { externalId: 'cl-date', title: 'Dated', body: 'b', publishedAt: '2025-03-01T00:00:00Z' },
            { externalId: 'cl-status', title: 'Status', body: 'b', status: 'published' },
          ])
        )
      ).id
    )
    const rows = await db
      .select()
      .from(changelogEntry)
      .where(and(eq(changelogEntry.projectId, projA.id), inArray(changelogEntry.externalId, ['cl-date', 'cl-status'])))
    const byId = Object.fromEntries(rows.map((r) => [r.externalId!, r]))
    expect(byId['cl-date'].status).toBe('published')
    expect(byId['cl-date'].publishedAt?.toISOString()).toBe('2025-03-01T00:00:00.000Z')
    expect(byId['cl-status'].status).toBe('published')
    expect(byId['cl-status'].publishedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000)
  })

  it('a worker whose lease was re-claimed stops at its next run write and changes nothing (lease fencing)', async () => {
    const source = `fenced-${suffix}`
    const run = await stage(projA.id, projA.productId, doc(), source)
    await db.update(importRun).set({ status: 'committing', committedAt: new Date() }).where(eq(importRun.id, run.id))

    // Worker A claims; while it loads the batch, its lease is taken over by worker B (as after an expiry).
    const workerBToken = new Date(Date.now() + 10 * 60_000)
    const real = vi.mocked(loadRunBatch).getMockImplementation()!
    vi.mocked(loadRunBatch).mockImplementationOnce(async (id: string) => {
      await db.update(importRun).set({ leaseUntil: workerBToken }).where(eq(importRun.id, id))
      return real(id)
    })

    expect(await advanceImportRun(run.id, { budgetMs: 20_000 })).toEqual({ done: false })
    const [after] = await db.select().from(importRun).where(eq(importRun.id, run.id))
    expect(after.status).toBe('committing')
    expect(after.leaseUntil?.getTime()).toBe(workerBToken.getTime())
    expect(after.progress).toBeNull()
    expect(after.summary).toBeNull()
    expect((await countsFor(projA.id, source)).people).toBe(0)
    expect(await db.select().from(importRunIssue).where(eq(importRunIssue.runId, run.id))).toHaveLength(0)
  })

  it('resumes across many budget-exhausted calls with the same result as one call', async () => {
    const singleSource = `single-${suffix}`
    const loopSource = `loop-${suffix}`
    const single = await stage(projA.id, projA.productId, doc(), singleSource)
    const singleDone = await commitImportRun(single.id)
    expect(singleDone.status).toBe('completed')

    const looped = await stage(projA.id, projA.productId, doc(), loopSource)
    await db.update(importRun).set({ status: 'committing', committedAt: new Date() }).where(eq(importRun.id, looped.id))
    let calls = 0
    for (; calls < 200; ) {
      calls++
      if ((await advanceImportRun(looped.id, { budgetMs: 1 })).done) break
    }
    expect(calls).toBeGreaterThan(6) // several calls per phase, not one pass
    const [loopDone] = await db.select().from(importRun).where(eq(importRun.id, looped.id))
    expect(loopDone.status).toBe('completed')
    expect(loopDone.summary).toEqual(singleDone.summary)
    expect(await countsFor(projA.id, loopSource)).toEqual(await countsFor(projA.id, singleSource))

    const issueKeys = async (runId: string) =>
      (await db.select().from(importRunIssue).where(eq(importRunIssue.runId, runId)))
        .map((i) => [i.severity, i.entityType, i.externalId, i.message].join('|'))
        .sort()
    const loopIssues = await issueKeys(looped.id)
    expect(new Set(loopIssues).size).toBe(loopIssues.length)
    expect(loopIssues).toEqual(await issueKeys(single.id))
    expect(loopIssues.length).toBeGreaterThan(0)
  })

  it('rejects committing a run that is not a draft', async () => {
    const run = await stage(projA.id, projA.productId, doc())
    await commitImportRun(run.id)
    await expect(commitImportRun(run.id)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('route: 200 with the completed run inline; 202 for a large run that the scheduled task finishes', async () => {
    const session = {
      user: { id: ownerId },
      session: { token: 'tok', activeOrganizationId: orgId, activeProjectId: null },
    }
    const small = await stage(projA.id, projA.productId, doc())
    const event: FakeEvent = { session, params: { slug: projA.slug, runId: small.id } }
    const res = await commitRoute(event)
    expect(res.data.status).toBe('completed')
    expect(event.status ?? 200).toBe(200)

    const source = `large-${suffix}`
    const people = Array.from({ length: 501 }, (_, i) => ({ externalId: `lp-${i}`, name: `Person ${i}` }))
    const large = await stage(
      projA.id,
      projA.productId,
      { statuses: [], categories: [], people, feedback: [], comments: [], changelog: [] },
      source
    )
    const largeEvent: FakeEvent = { session, params: { slug: projA.slug, runId: large.id } }
    const pending = await commitRoute(largeEvent)
    expect(largeEvent.status).toBe(202)
    expect(pending.data.status).toBe('committing')

    const { processed } = await advanceImportRuns({ budgetMs: 30_000 })
    expect(processed).toBeGreaterThanOrEqual(1)
    const [finished] = await db.select().from(importRun).where(eq(importRun.id, large.id))
    expect(finished.status).toBe('completed')
    expect(finished.summary?.counts.people.create).toBe(501)
    expect((await countsFor(projA.id, source)).people).toBe(501)
  }, 60_000)

  it('commits a feedback with 2,500 listed votes (inserted in chunks below the bind-parameter limit)', async () => {
    const source = `many-votes-${suffix}`
    // People already imported by an earlier run, inserted in bulk to keep the test fast.
    const people = Array.from({ length: 2500 }, (_, i) => ({
      id: `ic_mv_${suffix}_${i}`,
      projectId: projA.id,
      source,
      externalId: `mv-${i}`,
    }))
    await db.insert(importedPerson).values(people)
    const votes = people.map((p, i) => ({
      personExternalId: p.externalId,
      type: (i % 5 === 0 ? 'downvote' : 'upvote') as 'upvote' | 'downvote',
    }))
    const run = await stage(
      projA.id,
      projA.productId,
      {
        statuses: [],
        categories: [],
        people: [],
        feedback: [{ externalId: 'popular', title: 'Popular', votes }],
        comments: [],
        changelog: [],
      },
      source
    )
    const preview = await planImport(run.id)
    const done = await commitImportRun(run.id)
    expect(done.status).toBe('completed')
    expect(done.summary?.counts.votes).toEqual({ create: 2500, update: 0, unchanged: 0, skip: 0 })
    expect(done.summary?.counts).toEqual(preview.counts)
    const fb = (await importedFeedback(projA.id, source)).popular
    // 2,000 upvotes − 500 downvotes
    expect(fb.voteCount).toBe(1500)
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(vote)
      .where(eq(vote.feedbackId, fb.id))
    expect(n).toBe(2500)
  }, 60_000)
})
