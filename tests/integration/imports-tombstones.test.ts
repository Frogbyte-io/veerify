import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { db } from '../../server/database/drizzle'
import { member, organization, user } from '../../server/database/schema/auth'
import {
  feedback,
  feedbackComment,
  importedPerson,
  product,
  project,
  vote,
} from '../../server/database/schema/feedback'
import { importRunIssue, importTombstone } from '../../server/database/schema/imports'
import type { ImportBatch } from '../../server/services/imports/format'

/**
 * What the team deletes in Veerify stays deleted on the next sync: deleted imported feedback and comments are skipped
 * (tombstones, "Deleted in Veerify"; the preview agrees), and a claimed user's unvote keeps the imported vote row
 * detached from the user so a re-import does not add it back.
 */

type FakeEvent = {
  session: { user: { id: string } } | null
  params: Record<string, string>
  body?: unknown
}

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRouterParam', (event: FakeEvent, name: string) => event.params[name])
vi.stubGlobal('readBody', async (event: FakeEvent) => event.body)
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string; data?: unknown }) =>
  Object.assign(new Error(input.statusMessage), input)
)
vi.mock('~/server/utils/auth-middleware', () => ({
  requireAuth: async (event: FakeEvent) => event.session,
  optionalAuth: async (event: FakeEvent) => event.session,
  isCredentialPrincipal: () => false,
}))
vi.mock('~/server/utils/rate-limit', () => ({ requireRateLimit: async () => {}, rateLimits: { relaxed: {} } }))
// Voting needs a public project and product; that rule is covered elsewhere.
vi.mock('~/server/utils/feedback-access', () => ({ requirePublicFeedback: async () => {} }))
vi.mock('~/lib/email', async (orig) => {
  const mod = (await orig()) as Record<string, unknown>
  return Object.fromEntries(
    Object.entries(mod).map(([k, v]) => [k, typeof v === 'function' ? vi.fn(async () => {}) : v])
  )
})

const { createImportRun, addImportBatch } = await import('../../server/services/imports/runs')
const { planImport } = await import('../../server/services/imports/planner')
const { commitImportRun } = await import('../../server/services/imports/committer')
const { claimImportedActivity } = await import('../../server/services/imports/claim')
type Handler = (e: FakeEvent) => Promise<{ success: boolean; data: any }>
const deleteFeedback = (await import('../../server/api/feedback/[id].delete')).default as unknown as Handler
const deleteComment = (await import('../../server/api/feedback/[id]/comments/[commentId].delete'))
  .default as unknown as Handler
const voteRoute = (await import('../../server/api/feedback/[id]/vote.post')).default as unknown as Handler

const suffix = randomUUID().slice(0, 8)
const orgId = `itb_org_${suffix}`
const ownerId = `itb_owner_${suffix}`
const SOURCE = 'canny'
const projects: { id: string; slug: string; productId: string }[] = []
const userIds: string[] = [ownerId]

function doc(email: string): ImportBatch {
  return {
    statuses: [],
    categories: [],
    people: [
      { externalId: 'p-1', name: 'Ada', email },
      { externalId: 'p-2', name: 'Grace', email: `itb-grace-${suffix}@example.com` },
    ],
    feedback: [
      {
        externalId: 'f-1',
        title: 'Dark mode',
        authorExternalId: 'p-1',
        votes: [
          { personExternalId: 'p-1', type: 'upvote' },
          { personExternalId: 'p-2', type: 'upvote' },
        ],
      },
      {
        externalId: 'f-2',
        title: 'Spam',
        authorExternalId: 'p-2',
        votes: [{ personExternalId: 'p-2', type: 'upvote' }],
      },
    ],
    comments: [
      { externalId: 'c-1', feedbackExternalId: 'f-1', body: 'Off topic', authorExternalId: 'p-2' },
      { externalId: 'c-2', feedbackExternalId: 'f-1', parentExternalId: 'c-1', body: 'Reply', authorExternalId: 'p-1' },
      { externalId: 'c-3', feedbackExternalId: 'f-1', body: 'Useful', authorExternalId: 'p-1' },
      { externalId: 'c-4', feedbackExternalId: 'f-2', body: 'On spam', authorExternalId: 'p-1' },
    ],
    changelog: [],
  }
}

async function newProject(key: string) {
  const p = { id: `itb_p${key}_${suffix}`, slug: `itb-${key}-${suffix}`, productId: `itb_pr${key}_${suffix}` }
  await db.insert(project).values({ id: p.id, organizationId: orgId, slug: p.slug, name: p.slug })
  await db.insert(product).values({ id: p.productId, projectId: p.id, name: 'Main', slug: 'main' })
  projects.push(p)
  return p
}

async function importInto(p: { id: string; productId: string }, batch: ImportBatch) {
  const run = await createImportRun({
    projectId: p.id,
    productId: p.productId,
    userId: ownerId,
    source: SOURCE,
    sourceLabel: 'Canny',
  })
  await addImportBatch(run.id, batch)
  const preview = await planImport(run.id)
  const done = await commitImportRun(run.id)
  expect(done.status).toBe('completed')
  expect(done.summary?.counts).toEqual(preview.counts)
  return { runId: run.id, counts: preview.counts, preview }
}

async function state(projectId: string) {
  const fbRows = await db.select().from(feedback).where(eq(feedback.projectId, projectId))
  const fb = Object.fromEntries(fbRows.map((r) => [r.externalId!, r]))
  const ids = fbRows.map((r) => r.id)
  return {
    fb,
    comments: ids.length ? await db.select().from(feedbackComment).where(inArray(feedbackComment.feedbackId, ids)) : [],
    votes: ids.length ? await db.select().from(vote).where(inArray(vote.feedbackId, ids)) : [],
    people: await db.select().from(importedPerson).where(eq(importedPerson.projectId, projectId)),
  }
}

describe('deletions in Veerify survive re-imports (real Postgres)', () => {
  beforeAll(async () => {
    await db.insert(organization).values({ id: orgId, name: 'ITB Org', slug: `itb-org-${suffix}` })
    await db
      .insert(user)
      .values({ id: ownerId, name: 'Owner', email: `itb-owner-${suffix}@example.com`, emailVerified: true })
    await db.insert(member).values({ id: `${ownerId}_m`, organizationId: orgId, userId: ownerId, role: 'owner' })
  })

  afterAll(async () => {
    const projectIds = projects.map((p) => p.id)
    if (projectIds.length) await db.delete(feedback).where(inArray(feedback.projectId, projectIds))
    await db.delete(organization).where(eq(organization.id, orgId))
    await db.delete(user).where(inArray(user.id, userIds))
  })

  it('skips deleted feedback and comments (and replies) on re-import, with the preview agreeing', async () => {
    const p = await newProject('a')
    await importInto(p, doc(`itb-ada-${suffix}@example.com`))
    const before = await state(p.id)
    const owner = { user: { id: ownerId } }

    await deleteFeedback({ session: owner, params: { id: before.fb['f-2'].id } })
    const c1 = before.comments.find((c) => c.externalId === 'c-1')!
    await deleteComment({ session: owner, params: { id: before.fb['f-1'].id, commentId: c1.id } })

    const stones = await db.select().from(importTombstone).where(eq(importTombstone.projectId, p.id))
    expect(stones.map((t) => [t.entity, t.source, t.externalId]).sort()).toEqual([
      ['comment', SOURCE, JSON.stringify(['f-1', 'c-1'])],
      ['feedback', SOURCE, 'f-2'],
    ])
    const deleted = await state(p.id)
    expect(deleted.fb['f-2']).toBeUndefined()
    // c-2 is a reply to c-1 and went with it
    expect(deleted.comments.map((c) => c.externalId).sort()).toEqual(['c-3'])

    const again = await importInto(p, doc(`itb-ada-${suffix}@example.com`))
    expect(again.counts.feedback).toEqual({ create: 0, update: 0, unchanged: 1, skip: 1 })
    // c-1 deleted, c-2 under a skipped parent, c-4 on deleted feedback; c-3 unchanged
    expect(again.counts.comments).toEqual({ create: 0, update: 0, unchanged: 1, skip: 3 })
    // f-2's listed vote is skipped with the feedback
    expect(again.counts.votes).toEqual({ create: 0, update: 0, unchanged: 2, skip: 1 })
    expect(again.preview.issues).toEqual(
      expect.arrayContaining([
        { severity: 'skipped', entityType: 'feedback', externalId: 'f-2', message: 'Deleted in Veerify' },
        { severity: 'skipped', entityType: 'comment', externalId: 'c-1', message: 'Deleted in Veerify' },
      ])
    )
    const issues = await db.select().from(importRunIssue).where(eq(importRunIssue.runId, again.runId))
    expect(
      issues
        .filter((i) => i.message === 'Deleted in Veerify')
        .map((i) => i.externalId)
        .sort()
    ).toEqual(['c-1', 'f-2'])

    const after = await state(p.id)
    expect(after.fb['f-2']).toBeUndefined()
    expect(after.comments.map((c) => c.externalId).sort()).toEqual(['c-3'])
    expect(after.fb['f-1'].commentCount).toBe(deleted.fb['f-1'].commentCount)
  })

  it('a tombstone is per project and source: another project imports the same ids normally', async () => {
    const q = await newProject('b')
    const { counts } = await importInto(q, doc(`itb-ada2-${suffix}@example.com`))
    expect(counts.feedback).toMatchObject({ create: 2, skip: 0 })
    expect(counts.comments).toMatchObject({ create: 4, skip: 0 })
  })

  it("keeps a claimed user's unvoted imported vote detached, so a re-import does not add it back", async () => {
    const email = `itb-claim-${suffix}@example.com`
    const p = await newProject('v')
    await importInto(p, doc(email))
    const userId = `itb_u_${randomUUID().slice(0, 8)}`
    await db.insert(user).values({ id: userId, name: 'Ada', email, emailVerified: true })
    userIds.push(userId)
    await claimImportedActivity(userId, email)
    const claimed = await state(p.id)
    const ada = claimed.people.find((x) => x.externalId === 'p-1')!
    const f1 = claimed.fb['f-1']
    expect(f1.voteCount).toBe(2)

    const res = await voteRoute({ session: { user: { id: userId } }, params: { id: f1.id }, body: { type: 'upvote' } })
    expect(res.data).toMatchObject({ voted: false, voteCount: 1 })
    const [row] = await db
      .select()
      .from(vote)
      .where(and(eq(vote.feedbackId, f1.id), eq(vote.importedPersonId, ada.id)))
    expect(row).toMatchObject({ voterUserId: null, importedPersonId: ada.id })

    const { counts } = await importInto(p, doc(email))
    expect(counts.votes).toMatchObject({ create: 0 })
    const after = await state(p.id)
    expect(after.fb['f-1'].voteCount).toBe(1)
    expect(after.votes.filter((v) => v.feedbackId === f1.id)).toHaveLength(2)

    // Voting again is a normal user vote.
    const again = await voteRoute({ session: { user: { id: userId } }, params: { id: f1.id }, body: {} })
    expect(again.data).toMatchObject({ voted: true, voteCount: 2 })
  })
})
