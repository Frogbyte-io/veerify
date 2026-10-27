import { randomUUID } from 'node:crypto'
import { eq, inArray, sql } from 'drizzle-orm'
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
import type { ImportBatch } from '../../server/services/imports/format'

/**
 * Claiming imported activity (Review Focus 4, claiming half) against a real Postgres: only verified emails claim,
 * matching is case-insensitive, import links are kept, a double vote keeps the imported row and corrects voteCount
 * exactly once, re-imports and repeated claims change nothing, and concurrent claims do not double-decrement.
 */

type FakeEvent = { session: { user: { id: string; email: string } }; body: unknown }

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('readBody', async (event: FakeEvent) => event.body)
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string; data?: unknown }) =>
  Object.assign(new Error(input.statusMessage), input)
)
vi.mock('~/server/utils/auth-middleware', () => ({
  requireAuth: async (event: FakeEvent) => event.session,
  isCredentialPrincipal: () => false,
}))
// lib/auth sends a verification mail on sign-up; keep the suite offline.
vi.mock('~/lib/email', async (orig) => {
  const mod = (await orig()) as Record<string, unknown>
  return Object.fromEntries(
    Object.entries(mod).map(([k, v]) => [k, typeof v === 'function' ? vi.fn(async () => {}) : v])
  )
})

const { createImportRun, addImportBatch } = await import('../../server/services/imports/runs')
const { commitImportRun } = await import('../../server/services/imports/committer')
const { claimImportedActivity } = await import('../../server/services/imports/claim')
const { auth } = await import('../../lib/auth')
const { planImport } = await import('../../server/services/imports/planner')
const { sendEmailVerificationEmail } = await import('~/lib/email')
const profilePut = (await import('../../server/api/user/profile.put')).default as unknown as (
  e: FakeEvent
) => Promise<{ success: boolean }>

const suffix = randomUUID().slice(0, 8)
const orgId = `icl_org_${suffix}`
const ownerId = `icl_owner_${suffix}`
const SOURCE = 'canny'
const projects = ['a', 'b', 'c'].map((k) => ({
  id: `icl_p${k}_${suffix}`,
  slug: `icl-${k}-${suffix}`,
  productId: `icl_pr${k}_${suffix}`,
}))
const [projA, projB, projC] = projects
const createdUserIds: string[] = [ownerId]

/** One claimable person (`claimEmail`) with a post, a comment, an upvote on f-1 and a downvote on f-2. */
function doc(claimEmail: string): ImportBatch {
  return {
    statuses: [],
    categories: [],
    people: [
      { externalId: 'p-1', name: 'Ada Lovelace', email: claimEmail },
      { externalId: 'p-2', name: 'Grace Hopper', email: `icl-grace-${suffix}@example.com` },
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
        title: 'Export to CSV',
        authorExternalId: 'p-2',
        votes: [
          { personExternalId: 'p-1', type: 'downvote' },
          { personExternalId: 'p-2', type: 'upvote' },
        ],
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
    source: SOURCE,
    sourceLabel: 'Canny',
  })
  await addImportBatch(run.id, batch)
  const preview = await planImport(run.id)
  const done = await commitImportRun(run.id)
  expect(done.status).toBe('completed')
  // Preview and commit agree, including votes skipped because the claiming user already voted.
  expect(done.summary?.counts).toEqual(preview.counts)
  return preview.counts
}

async function newProject(key: string) {
  const p = { id: `icl_p${key}_${suffix}`, slug: `icl-${key}-${suffix}`, productId: `icl_pr${key}_${suffix}` }
  await db.insert(project).values({ id: p.id, organizationId: orgId, slug: p.slug, name: p.slug })
  await db.insert(product).values({ id: p.productId, projectId: p.id, name: 'Main', slug: 'main' })
  projects.push(p)
  return p
}

async function state(projectId: string) {
  const fbRows = await db.select().from(feedback).where(eq(feedback.projectId, projectId))
  const fb = Object.fromEntries(fbRows.map((r) => [r.externalId!, r]))
  const ids = fbRows.map((r) => r.id)
  const votes = await db.select().from(vote).where(inArray(vote.feedbackId, ids))
  const comments = await db.select().from(feedbackComment).where(inArray(feedbackComment.feedbackId, ids))
  const people = await db.select().from(importedPerson).where(eq(importedPerson.projectId, projectId))
  const ada = people.find((p) => p.externalId === 'p-1')!
  return {
    fb,
    votes,
    comments,
    ada,
    adaVotes: votes.filter((v) => v.importedPersonId === ada.id),
    voteCounts: Object.fromEntries(fbRows.map((r) => [r.externalId!, r.voteCount])),
  }
}

/** A real vote by a Veerify user, counted the way the vote route counts it. */
async function castUserVote(userId: string, feedbackId: string, type: 'upvote' | 'downvote') {
  await db.insert(vote).values({ id: randomUUID(), feedbackId, voterUserId: userId, type })
  await db
    .update(feedback)
    .set({ voteCount: sql`${feedback.voteCount} + ${type === 'upvote' ? 1 : -1}` })
    .where(eq(feedback.id, feedbackId))
}

async function insertUser(email: string, emailVerified: boolean) {
  const id = `icl_u_${randomUUID().slice(0, 8)}`
  await db.insert(user).values({ id, name: 'User', email, emailVerified })
  createdUserIds.push(id)
  return id
}

describe('claiming imported activity (real Postgres)', () => {
  beforeAll(async () => {
    await db.insert(organization).values({ id: orgId, name: 'ICL Org', slug: `icl-org-${suffix}` })
    await db
      .insert(user)
      .values({ id: ownerId, name: 'Owner', email: `icl-owner-${suffix}@example.com`, emailVerified: true })
    await db.insert(member).values({ id: `${ownerId}_m`, organizationId: orgId, userId: ownerId, role: 'owner' })
    for (const p of projects) {
      await db.insert(project).values({ id: p.id, organizationId: orgId, slug: p.slug, name: p.slug })
      await db.insert(product).values({ id: p.productId, projectId: p.id, name: 'Main', slug: 'main' })
    }
  })

  afterAll(async () => {
    const projectIds = projects.map((p) => p.id)
    await db.delete(feedback).where(inArray(feedback.projectId, projectIds))
    await db.delete(organization).where(eq(organization.id, orgId))
    await db.delete(user).where(inArray(user.id, createdUserIds))
  })

  it('claims nothing until the email is verified, then re-points posts, comments and votes via the auth hook', async () => {
    // Imported with a mixed-case address; the user signs up with it in lower case.
    const importedEmail = `ICL-Ada-${suffix}@Example.com`
    await importInto(projA, doc(importedEmail))
    const before = await state(projA.id)
    expect(before.voteCounts).toEqual({ 'f-1': 2, 'f-2': 0 })

    const ctx = await auth.$context
    const created = await ctx.internalAdapter.createUser({
      name: 'Ada',
      email: importedEmail.toLowerCase(),
      emailVerified: false,
    })
    createdUserIds.push(created.id)

    // Unverified: neither the create hook nor a direct call claims anything.
    expect(await claimImportedActivity(created.id, importedEmail)).toEqual({
      people: 0,
      feedback: 0,
      comments: 0,
      votes: 0,
    })
    await new Promise((r) => setTimeout(r, 200))
    const unverified = await state(projA.id)
    expect(unverified.fb['f-1'].authorUserId).toBeNull()
    expect(unverified.ada.claimedByUserId).toBeNull()
    expect(unverified.adaVotes.every((v) => v.voterUserId === null)).toBe(true)

    // Verifying the email (user.update.after) claims in the background.
    await ctx.internalAdapter.updateUser(created.id, { emailVerified: true })
    await vi.waitFor(
      async () => {
        const s = await state(projA.id)
        expect(s.ada.claimedByUserId).toBe(created.id)
      },
      { timeout: 5_000, interval: 50 }
    )

    const after = await state(projA.id)
    expect(after.fb['f-1'].authorUserId).toBe(created.id)
    expect(after.fb['f-1'].importedPersonId).toBe(after.ada.id)
    expect(after.fb['f-2'].authorUserId).toBeNull() // Grace's post
    const comment = after.comments.find((c) => c.externalId === 'c-1')!
    expect(comment.authorUserId).toBe(created.id)
    expect(comment.importedPersonId).toBe(after.ada.id)
    expect(after.adaVotes).toHaveLength(2)
    expect(after.adaVotes.every((v) => v.voterUserId === created.id && v.importedPersonId === after.ada.id)).toBe(true)
    // Re-pointing a vote does not change any counter.
    expect(after.voteCounts).toEqual(before.voteCounts)

    // A second claim finds nothing left to do.
    expect(await claimImportedActivity(created.id, importedEmail)).toEqual({
      people: 0,
      feedback: 0,
      comments: 0,
      votes: 0,
    })

    // Re-importing the same document finds the claimed rows by importedPersonId: nothing new, nothing moved back.
    await importInto(projA, doc(importedEmail))
    const reimported = await state(projA.id)
    expect(reimported.votes).toHaveLength(after.votes.length)
    expect(reimported.comments).toHaveLength(after.comments.length)
    expect(reimported.voteCounts).toEqual(before.voteCounts)
    expect(reimported.fb['f-1'].authorUserId).toBe(created.id)
    expect(reimported.adaVotes.every((v) => v.voterUserId === created.id)).toBe(true)
  })

  it('claims on sign-up when the email is already verified (user.create.after)', async () => {
    const email = `icl-social-${suffix}@example.com`
    await importInto(projC, doc(email))
    const ctx = await auth.$context
    const created = await ctx.internalAdapter.createUser({ name: 'Social', email, emailVerified: true })
    createdUserIds.push(created.id)
    await vi.waitFor(
      async () => {
        const s = await state(projC.id)
        expect(s.ada.claimedByUserId).toBe(created.id)
        expect(s.fb['f-1'].authorUserId).toBe(created.id)
      },
      { timeout: 5_000, interval: 50 }
    )
  })

  it('merges a double vote: keeps the imported row, corrects voteCount once, and stays stable on re-import', async () => {
    const email = `icl-double-${suffix}@example.com`
    await importInto(projB, doc(email))
    const userId = await insertUser(email, true)
    const seeded = await state(projB.id)
    // The user already voted on both posts before claiming: up on f-1 (imported: up), up on f-2 (imported: down).
    await castUserVote(userId, seeded.fb['f-1'].id, 'upvote')
    await castUserVote(userId, seeded.fb['f-2'].id, 'upvote')
    const before = await state(projB.id)
    expect(before.voteCounts).toEqual({ 'f-1': 3, 'f-2': 1 })

    const result = await claimImportedActivity(userId, email.toUpperCase())
    expect(result).toEqual({ people: 1, feedback: 1, comments: 1, votes: 2 })

    const after = await state(projB.id)
    // f-1 loses the imported upvote (−1); f-2 loses the imported downvote (+1).
    expect(after.voteCounts).toEqual({ 'f-1': 2, 'f-2': 2 })
    // The imported rows stay, still unclaimed, so a re-import does not insert and count them again.
    expect(after.adaVotes).toHaveLength(2)
    expect(after.adaVotes.every((v) => v.voterUserId === null)).toBe(true)
    const userVotes = after.votes.filter((v) => v.voterUserId === userId)
    expect(userVotes).toHaveLength(2)
    expect(after.ada.claimedByUserId).toBe(userId)

    expect(await claimImportedActivity(userId, email)).toEqual({ people: 0, feedback: 0, comments: 0, votes: 0 })
    expect((await state(projB.id)).voteCounts).toEqual(after.voteCounts)

    await importInto(projB, doc(email))
    const reimported = await state(projB.id)
    expect(reimported.votes).toHaveLength(after.votes.length)
    expect(reimported.voteCounts).toEqual(after.voteCounts)
  })

  it('serializes concurrent claims so a double vote is subtracted once', async () => {
    const email = `icl-race-${suffix}@example.com`
    const p = { id: `icl_pd_${suffix}`, slug: `icl-d-${suffix}`, productId: `icl_prd_${suffix}` }
    await db.insert(project).values({ id: p.id, organizationId: orgId, slug: p.slug, name: p.slug })
    await db.insert(product).values({ id: p.productId, projectId: p.id, name: 'Main', slug: 'main' })
    projects.push(p)
    await importInto(p, doc(email))
    const userId = await insertUser(email, true)
    const seeded = await state(p.id)
    await castUserVote(userId, seeded.fb['f-1'].id, 'upvote')

    // Hold f-1 locked so every claim has started (and read the person as unclaimed) before any can finish;
    // without the person lock, each would then subtract the double vote again.
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let locked!: () => void
    const isLocked = new Promise<void>((r) => (locked = r))
    const holder = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM feedback WHERE id = ${seeded.fb['f-1'].id} FOR UPDATE`)
      locked()
      await gate
    })
    await isLocked
    const claims = [1, 2, 3].map(() => claimImportedActivity(userId, email))
    await new Promise((r) => setTimeout(r, 300))
    release()
    await holder
    const results = await Promise.all(claims)
    expect(results.reduce((n, r) => n + r.people, 0)).toBe(1)
    expect(results.reduce((n, r) => n + r.votes, 0)).toBe(2)

    const after = await state(p.id)
    // f-1: 2 imported + 1 user − 1 merged = 2; f-2: claimed (not doubled), unchanged at 0.
    expect(after.voteCounts).toEqual({ 'f-1': 2, 'f-2': 0 })
    expect(after.adaVotes.find((v) => v.feedbackId === seeded.fb['f-2'].id)!.voterUserId).toBe(userId)
    expect(after.adaVotes.find((v) => v.feedbackId === seeded.fb['f-1'].id)!.voterUserId).toBeNull()
  })

  it('ignores a user whose email is not verified, and a mismatched email', async () => {
    const email = `icl-unverified-${suffix}@example.com`
    const p = { id: `icl_pe_${suffix}`, slug: `icl-e-${suffix}`, productId: `icl_pre_${suffix}` }
    await db.insert(project).values({ id: p.id, organizationId: orgId, slug: p.slug, name: p.slug })
    await db.insert(product).values({ id: p.productId, projectId: p.id, name: 'Main', slug: 'main' })
    projects.push(p)
    await importInto(p, doc(email))
    const unverified = await insertUser(email, false)
    const other = await insertUser(`icl-other-${suffix}@example.com`, true)

    const zero = { people: 0, feedback: 0, comments: 0, votes: 0 }
    expect(await claimImportedActivity(unverified, email)).toEqual(zero)
    // A verified user cannot claim an address that is not theirs.
    expect(await claimImportedActivity(other, email)).toEqual(zero)
    const s = await state(p.id)
    expect(s.ada.claimedByUserId).toBeNull()
    expect(s.fb['f-1'].authorUserId).toBeNull()
  })
  it('keeps voteCount a signed net sum when merging a double vote (no clamp at zero)', async () => {
    const email = `icl-negative-${suffix}@example.com`
    const p = await newProject('neg')
    await importInto(p, doc(email))
    const userId = await insertUser(email, true)
    const seeded = await state(p.id)
    await castUserVote(userId, seeded.fb['f-1'].id, 'upvote')
    // Live downvotes have pulled the net counter below zero.
    await db.update(feedback).set({ voteCount: -4 }).where(eq(feedback.id, seeded.fb['f-1'].id))

    await claimImportedActivity(userId, email)
    // The merged imported upvote comes off the signed sum: −4 − 1.
    expect((await state(p.id)).voteCounts['f-1']).toBe(-5)
  })

  it('attributes activity imported after the claim to the claiming user, skipping a vote they already cast', async () => {
    const email = `icl-later-${suffix}@example.com`
    const p = await newProject('later')
    const people = [
      { externalId: 'p-1', name: 'Ada Lovelace', email },
      { externalId: 'p-2', name: 'Grace Hopper', email: `icl-grace-${suffix}@example.com` },
    ]
    const first: ImportBatch = {
      statuses: [],
      categories: [],
      people,
      feedback: [
        {
          externalId: 'f-1',
          title: 'Dark mode',
          authorExternalId: 'p-2',
          votes: [{ personExternalId: 'p-2', type: 'upvote' }],
        },
      ],
      comments: [],
      changelog: [],
    }
    await importInto(p, first)
    const userId = await insertUser(email, true)
    expect(await claimImportedActivity(userId, email)).toEqual({ people: 1, feedback: 0, comments: 0, votes: 0 })
    const f1 = (await state(p.id)).fb['f-1']
    await castUserVote(userId, f1.id, 'upvote')
    expect((await state(p.id)).voteCounts['f-1']).toBe(2)

    const second: ImportBatch = {
      ...first,
      feedback: [
        {
          externalId: 'f-1',
          title: 'Dark mode',
          authorExternalId: 'p-2',
          // p-1 is the claiming user, who already voted on f-1 in Veerify
          votes: [
            { personExternalId: 'p-2', type: 'upvote' },
            { personExternalId: 'p-1', type: 'upvote' },
          ],
        },
        {
          externalId: 'f-new',
          title: 'Offline mode',
          authorExternalId: 'p-1',
          votes: [{ personExternalId: 'p-1', type: 'upvote' }],
        },
      ],
      comments: [{ externalId: 'c-new', feedbackExternalId: 'f-1', body: 'Please', authorExternalId: 'p-1' }],
    }
    const counts = await importInto(p, second)
    expect(counts.votes).toMatchObject({ create: 1, unchanged: 2, skip: 0 })

    const after = await state(p.id)
    expect(after.fb['f-new']).toMatchObject({ authorUserId: userId, importedPersonId: after.ada.id, voteCount: 1 })
    const newVote = after.votes.find((v) => v.feedbackId === after.fb['f-new'].id)!
    expect(newVote).toMatchObject({ voterUserId: userId, importedPersonId: after.ada.id })
    expect(after.comments.find((c) => c.externalId === 'c-new')).toMatchObject({
      authorUserId: userId,
      importedPersonId: after.ada.id,
    })
    // No imported row for the vote the user already cast, and the counter is untouched.
    expect(after.votes.filter((v) => v.feedbackId === f1.id && v.importedPersonId === after.ada.id)).toHaveLength(0)
    expect(after.voteCounts).toEqual({ 'f-1': 2, 'f-new': 1 })

    const again = await importInto(p, second)
    expect(again.votes).toMatchObject({ create: 0, unchanged: 3 })
    const reimported = await state(p.id)
    expect(reimported.votes).toHaveLength(after.votes.length)
    expect(reimported.voteCounts).toEqual(after.voteCounts)
  })

  it('profile.put: an email change drops verification, so the new address claims nothing until verified', async () => {
    const oldEmail = `icl-old-${suffix}@example.com`
    const newEmail = `icl-victim-${suffix}@example.com`
    const p = await newProject('takeover')
    await importInto(p, doc(newEmail))
    const ctx = await auth.$context
    const created = await ctx.internalAdapter.createUser({ name: 'Mallory', email: oldEmail, emailVerified: true })
    createdUserIds.push(created.id)
    vi.mocked(sendEmailVerificationEmail).mockClear()

    const event = (email: string): FakeEvent => ({
      session: { user: { id: created.id, email: oldEmail } },
      body: { name: 'Mallory', email },
    })
    expect((await profilePut(event(newEmail.toUpperCase()))).success).toBe(true)

    const [row] = await db.select().from(user).where(eq(user.id, created.id))
    expect(row).toMatchObject({ email: newEmail, emailVerified: false })
    // A verification mail goes to the new address so the owner can re-verify.
    await vi.waitFor(() =>
      expect(sendEmailVerificationEmail).toHaveBeenCalledWith(expect.objectContaining({ to: newEmail }))
    )

    // Neither a direct claim nor an unrelated Better-Auth update (update.after) claims for the unverified address.
    const zero = { people: 0, feedback: 0, comments: 0, votes: 0 }
    expect(await claimImportedActivity(created.id, newEmail)).toEqual(zero)
    await ctx.internalAdapter.updateUser(created.id, { name: 'Renamed' })
    await new Promise((r) => setTimeout(r, 200))
    const s = await state(p.id)
    expect(s.ada.claimedByUserId).toBeNull()
    expect(s.fb['f-1'].authorUserId).toBeNull()

    // Verifying the new address claims; re-saving it in another case keeps it verified.
    await ctx.internalAdapter.updateUser(created.id, { emailVerified: true })
    await vi.waitFor(async () => expect((await state(p.id)).ada.claimedByUserId).toBe(created.id), {
      timeout: 5_000,
      interval: 50,
    })
    await profilePut({ ...event(newEmail.toUpperCase()), session: { user: { id: created.id, email: newEmail } } })
    const [kept] = await db.select().from(user).where(eq(user.id, created.id))
    expect(kept.emailVerified).toBe(true)
  })
})
