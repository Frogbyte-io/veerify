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
import type { ImportBatch } from '../../server/services/imports/format'

/** Contact erasure covers imported people (authors and voters), org-scoped, case-insensitive, counts intact. */

vi.mock('~/lib/email', async (orig) => {
  const mod = (await orig()) as Record<string, unknown>
  return Object.fromEntries(
    Object.entries(mod).map(([k, v]) => [k, typeof v === 'function' ? vi.fn(async () => {}) : v])
  )
})

const { createImportRun, addImportBatch } = await import('../../server/services/imports/runs')
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
}

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

  it('removes the person, nulls imported name/email, keeps votes and counts, and spares other orgs', async () => {
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
      expect(after.people.map((x) => x.externalId)).toEqual(['p-2'])
      expect(after.fb['f-1']).toMatchObject({ authorName: null, authorEmail: null, importedPersonId: null })
      expect(after.comments[0]).toMatchObject({ authorName: null, authorEmail: null, importedPersonId: null })
      // Grace's data is untouched
      expect(after.fb['f-2'].authorName).toBe('Grace Hopper')
      // Votes stay, counts unchanged
      expect(after.votes).toHaveLength(3)
      expect(after.fb['f-1'].voteCount).toBe(2)
      expect(after.fb['f-2'].voteCount).toBe(1)
    }
    const afterX = await snapshot(projX.id)
    expect(afterX.people).toHaveLength(2)
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
})
