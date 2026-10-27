import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { db } from '../../server/database/drizzle'
import { organization, user } from '../../server/database/schema/auth'
import {
  feedback,
  feedbackComment,
  importedPerson,
  product,
  project,
  vote,
} from '../../server/database/schema/feedback'
import { importRun, importRunBatch } from '../../server/database/schema/imports'
import type { ImportBatch } from '../../server/services/imports/format'

/** Contact erasure covers imported people (authors and voters), org-scoped, case-insensitive, counts intact. */

vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string; data?: unknown }) =>
  Object.assign(new Error(input.statusMessage), input)
)
vi.mock('~/lib/email', async (orig) => {
  const mod = (await orig()) as Record<string, unknown>
  return Object.fromEntries(
    Object.entries(mod).map(([k, v]) => [k, typeof v === 'function' ? vi.fn(async () => {}) : v])
  )
})

const { createImportRun, addImportBatch, cancelImportRun } = await import('../../server/services/imports/runs')
const { planImport } = await import('../../server/services/imports/planner')
const { commitImportRun } = await import('../../server/services/imports/committer')
const { claimImportedActivity } = await import('../../server/services/imports/claim')
const { eraseContact } = await import('../../server/services/marketing/privacy')

const suffix = randomUUID().slice(0, 8)
const orgId = `ier_org_${suffix}`
const otherOrgId = `ier_oorg_${suffix}`
const ownerId = `ier_owner_${suffix}`
const mk = (k: string, org: string) => ({
  id: `ier_p${k}_${suffix}`,
  org,
  slug: `ier-${k}-${suffix}`,
  productId: `ier_pr${k}_${suffix}`,
})
const projects = [mk('a', orgId), mk('b', orgId), mk('x', otherOrgId)]
const [projA, projB, projX] = projects
const createdUserIds: string[] = [ownerId]
const email = `ier-ada-${suffix}@example.com`

function doc(personEmail: string): ImportBatch {
  return {
    statuses: [],
    categories: [],
    people: [
      { externalId: 'p-1', name: 'Ada Lovelace', email: personEmail },
      { externalId: 'p-2', name: 'Grace Hopper', email: `ier-grace-${suffix}@example.com` },
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
        title: 'CSV',
        authorExternalId: 'p-2',
        votes: [{ personExternalId: 'p-1', type: 'upvote' }],
      },
    ],
    comments: [{ externalId: 'c-1', feedbackExternalId: 'f-1', body: 'Me too', authorExternalId: 'p-1' }],
    changelog: [],
  }
}

async function importInto(p: (typeof projects)[number], batch: ImportBatch) {
  const run = await createImportRun({
    projectId: p.id,
    productId: p.productId,
    userId: ownerId,
    source: 'canny',
    sourceLabel: 'Canny',
  })
  await addImportBatch(run.id, batch)
  expect((await commitImportRun(run.id)).status).toBe('completed')
  return run.id
}

async function draftRun(p: (typeof projects)[number], batch: ImportBatch) {
  const run = await createImportRun({
    projectId: p.id,
    productId: p.productId,
    userId: ownerId,
    source: 'canny',
    sourceLabel: 'Canny',
  })
  await addImportBatch(run.id, batch)
  return run.id
}

const batchCount = async (runId: string) =>
  (await db.select().from(importRunBatch).where(eq(importRunBatch.runId, runId))).length

async function snapshot(projectId: string) {
  const fb = await db.select().from(feedback).where(eq(feedback.projectId, projectId))
  const ids = fb.map((f) => f.id)
  return {
    fb: Object.fromEntries(fb.map((f) => [f.externalId!, f])),
    votes: await db.select().from(vote).where(inArray(vote.feedbackId, ids)),
    comments: await db.select().from(feedbackComment).where(inArray(feedbackComment.feedbackId, ids)),
    people: await db.select().from(importedPerson).where(eq(importedPerson.projectId, projectId)),
  }
}

describe('eraseContact covers imported people (real Postgres)', () => {
  beforeAll(async () => {
    await db.insert(organization).values({ id: orgId, name: 'IER Org', slug: `ier-org-${suffix}` })
    await db.insert(organization).values({ id: otherOrgId, name: 'IER Other', slug: `ier-oorg-${suffix}` })
    await db
      .insert(user)
      .values({ id: ownerId, name: 'Owner', email: `ier-owner-${suffix}@example.com`, emailVerified: true })
    for (const p of projects) {
      await db.insert(project).values({ id: p.id, organizationId: p.org, slug: p.slug, name: p.slug })
      await db.insert(product).values({ id: p.productId, projectId: p.id, name: 'Main', slug: 'main' })
    }
  })

  afterAll(async () => {
    await db.delete(feedback).where(
      inArray(
        feedback.projectId,
        projects.map((p) => p.id)
      )
    )
    await db.delete(organization).where(inArray(organization.id, [orgId, otherOrgId]))
    await db.delete(user).where(inArray(user.id, createdUserIds))
  })

  it('tombstones the person, nulls imported name/email, keeps links, votes and counts, and spares other orgs', async () => {
    await importInto(projA, doc(email.toUpperCase()))
    await importInto(projB, doc(email))
    await importInto(projX, doc(email))
    const beforeA = await snapshot(projA.id)
    const beforeX = await snapshot(projX.id)
    expect(beforeA.fb['f-1'].authorName).toBe('Ada Lovelace')
    expect(beforeA.fb['f-1'].authorEmail).toBeTruthy()

    const result = await eraseContact(orgId, `  ${email}  `)
    expect(result.importedPeople).toBe(2)

    for (const p of [projA, projB]) {
      const after = await snapshot(p.id)
      const ada = after.people.find((x) => x.externalId === 'p-1')!
      expect(ada).toMatchObject({ name: null, email: null, avatarUrl: null })
      expect(ada.erasedAt).toBeInstanceOf(Date)
      expect(after.people.find((x) => x.externalId === 'p-2')!.erasedAt).toBeNull()
      expect(after.fb['f-1']).toMatchObject({ authorName: null, authorEmail: null, importedPersonId: ada.id })
      expect(after.comments[0]).toMatchObject({ authorName: null, authorEmail: null, importedPersonId: ada.id })
      // Grace's data is untouched
      expect(after.fb['f-2'].authorName).toBe('Grace Hopper')
      // Votes stay, counts unchanged
      expect(after.votes).toHaveLength(3)
      expect(after.fb['f-1'].voteCount).toBe(2)
      expect(after.fb['f-2'].voteCount).toBe(1)
    }
    const afterX = await snapshot(projX.id)
    expect(afterX.people.every((x) => x.erasedAt === null && x.email)).toBe(true)
    expect(afterX.fb['f-1'].authorName).toBe(beforeX.fb['f-1'].authorName)
    expect(afterX.fb['f-1'].authorEmail).toBe(beforeX.fb['f-1'].authorEmail)
    expect(afterX.comments[0].authorName).toBe('Ada Lovelace')
    expect(afterX.votes.filter((v) => v.importedPersonId)).toHaveLength(3)

    expect((await eraseContact(orgId, email)).importedPeople).toBe(0)
  })

  it('also erases a claimed person: nulls imported name/email but keeps authorUserId', async () => {
    const claimEmail = `ier-claimed-${suffix}@example.com`
    const p = mk('c', orgId)
    projects.push(p)
    await db.insert(project).values({ id: p.id, organizationId: orgId, slug: p.slug, name: p.slug })
    await db.insert(product).values({ id: p.productId, projectId: p.id, name: 'Main', slug: 'main' })
    await importInto(p, doc(claimEmail))
    const userId = `ier_u_${randomUUID().slice(0, 8)}`
    await db.insert(user).values({ id: userId, name: 'Ada', email: claimEmail, emailVerified: true })
    createdUserIds.push(userId)
    await claimImportedActivity(userId, claimEmail)
    const before = await snapshot(p.id)
    expect(before.fb['f-1'].authorUserId).toBe(userId)

    expect((await eraseContact(orgId, claimEmail)).importedPeople).toBe(1)
    const after = await snapshot(p.id)
    expect(after.fb['f-1']).toMatchObject({ authorUserId: userId, authorName: null, authorEmail: null })
    expect(after.comments[0]).toMatchObject({ authorUserId: userId, authorName: null, authorEmail: null })
    expect(after.votes.filter((v) => v.voterUserId === userId)).toHaveLength(2)
    expect(after.fb['f-1'].voteCount).toBe(2)
  })

  it('a re-import after erasure brings back no PII, no duplicate votes and no count change; the preview agrees', async () => {
    const e = `ier-reimport-${suffix}@example.com`
    const p = mk('r', orgId)
    projects.push(p)
    await db.insert(project).values({ id: p.id, organizationId: orgId, slug: p.slug, name: p.slug })
    await db.insert(product).values({ id: p.productId, projectId: p.id, name: 'Main', slug: 'main' })
    await importInto(p, doc(e))
    expect((await eraseContact(orgId, e)).importedPeople).toBe(1)
    const before = await snapshot(p.id)

    const runId = await draftRun(p, doc(e))
    const plan = await planImport(runId)
    expect(plan.counts.people).toMatchObject({ create: 0, update: 0, unchanged: 2 })
    expect(plan.counts.votes).toMatchObject({ create: 0 })
    const done = await commitImportRun(runId)
    expect(done.status).toBe('completed')
    expect(done.summary?.counts).toEqual(plan.counts)

    const after = await snapshot(p.id)
    const ada = after.people.find((x) => x.externalId === 'p-1')!
    expect(ada).toMatchObject({ name: null, email: null, avatarUrl: null })
    expect(ada.erasedAt).not.toBeNull()
    expect(after.people).toHaveLength(2)
    expect(after.votes).toHaveLength(before.votes.length)
    expect(after.fb['f-1'].voteCount).toBe(before.fb['f-1'].voteCount)
    expect(after.fb['f-2'].voteCount).toBe(before.fb['f-2'].voteCount)
    expect(after.fb['f-1']).toMatchObject({ authorName: null, authorEmail: null })
    expect(after.comments[0]).toMatchObject({ authorName: null, authorEmail: null })

    // A claim by the address's owner finds nothing: the tombstone has no email.
    const userId = `ier_u2_${randomUUID().slice(0, 8)}`
    await db.insert(user).values({ id: userId, name: 'Ada', email: e, emailVerified: true })
    createdUserIds.push(userId)
    expect((await claimImportedActivity(userId, e)).people).toBe(0)
  })

  it('erasure removes the person from a draft run payload, and finished runs keep no staged batches', async () => {
    const e = `ier-draft-${suffix}@example.com`
    const p = mk('d', orgId)
    projects.push(p)
    await db.insert(project).values({ id: p.id, organizationId: orgId, slug: p.slug, name: p.slug })
    await db.insert(product).values({ id: p.productId, projectId: p.id, name: 'Main', slug: 'main' })
    const draft = await draftRun(p, doc(e.toUpperCase()))
    await eraseContact(orgId, e)
    const [batch] = await db.select().from(importRunBatch).where(eq(importRunBatch.runId, draft))
    expect((batch.payload.people as Array<{ externalId: string }>).map((x) => x.externalId)).toEqual(['p-2'])
    expect(JSON.stringify(batch.payload.people)).not.toContain('Ada')

    // Cancel deletes the batches and keeps the run row
    await cancelImportRun(draft)
    expect(await batchCount(draft)).toBe(0)
    const [canceled] = await db.select().from(importRun).where(eq(importRun.id, draft))
    expect(canceled.status).toBe('canceled')

    // Completion deletes them; a finished run can no longer be previewed
    const completed = await importInto(p, doc(`ier-other-${suffix}@example.com`))
    expect(await batchCount(completed)).toBe(0)
    await expect(planImport(completed)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('a failed commit also drops the staged batches', async () => {
    const p = mk('f', orgId)
    projects.push(p)
    await db.insert(project).values({ id: p.id, organizationId: orgId, slug: p.slug, name: p.slug })
    await db.insert(product).values({ id: p.productId, projectId: p.id, name: 'Main', slug: 'main' })
    const runId = await draftRun(p, doc(`ier-fail-${suffix}@example.com`))
    // A staged feedback record without a title violates NOT NULL, so the commit fails.
    const [staged] = await db.select().from(importRunBatch).where(eq(importRunBatch.runId, runId))
    const payload = staged.payload as { feedback: Array<{ title: unknown }> }
    payload.feedback[0].title = null
    await db.update(importRunBatch).set({ payload }).where(eq(importRunBatch.id, staged.id))
    await commitImportRun(runId).catch(() => null)
    const [row] = await db.select().from(importRun).where(eq(importRun.id, runId))
    expect(row.status).toBe('failed')
    expect(await batchCount(runId)).toBe(0)
  })

  it('new feedback and comments by an erased person imported later carry no author name or email', async () => {
    const e = `ier-new-${suffix}@example.com`
    const p = mk('n', orgId)
    projects.push(p)
    await db.insert(project).values({ id: p.id, organizationId: orgId, slug: p.slug, name: p.slug })
    await db.insert(product).values({ id: p.productId, projectId: p.id, name: 'Main', slug: 'main' })
    await importInto(p, doc(e))
    await eraseContact(orgId, e)

    const again = doc(e)
    again.feedback.push({ externalId: 'f-new', title: 'Brand new', authorExternalId: 'p-1', votes: [] })
    again.comments.push({ externalId: 'c-new', feedbackExternalId: 'f-2', body: 'Later', authorExternalId: 'p-1' })
    await importInto(p, again)

    const after = await snapshot(p.id)
    const ada = after.people.find((x) => x.externalId === 'p-1')!
    expect(ada).toMatchObject({ name: null, email: null })
    expect(after.fb['f-new']).toMatchObject({ authorName: null, authorEmail: null, importedPersonId: ada.id })
    const c = after.comments.find((x) => x.externalId === 'c-new')!
    expect(c).toMatchObject({ authorName: null, authorEmail: null, importedPersonId: ada.id })
  })

  it('erasure scrubs the payload of a committing run too', async () => {
    const e = `ier-committing-${suffix}@example.com`
    const p = mk('m', orgId)
    projects.push(p)
    await db.insert(project).values({ id: p.id, organizationId: orgId, slug: p.slug, name: p.slug })
    await db.insert(product).values({ id: p.productId, projectId: p.id, name: 'Main', slug: 'main' })
    const runId = await draftRun(p, doc(e))
    await db.update(importRun).set({ status: 'committing' }).where(eq(importRun.id, runId))
    await eraseContact(orgId, e)
    const [batch] = await db.select().from(importRunBatch).where(eq(importRunBatch.runId, runId))
    expect((batch.payload.people as Array<{ externalId: string }>).map((x) => x.externalId)).toEqual(['p-2'])
  })
})
