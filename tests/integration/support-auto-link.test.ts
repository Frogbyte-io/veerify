import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../../server/database/drizzle'
import { organization, team, user } from '../../server/database/schema/auth'
import { project, feedback } from '../../server/database/schema/feedback'
import { contact, contactLink, supportTeamSettings } from '../../server/database/schema/support'
import { createAutomaticFeedbackLink } from '../../server/utils/support-auto-link'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type ContactMutation = Parameters<typeof db.transaction>[0]

const ids = {
  org: `auto_link_org_${randomUUID()}`,
  team: `auto_link_team_${randomUUID()}`,
  otherTeam: `auto_link_other_team_${randomUUID()}`,
  user: `auto_link_user_${randomUUID()}`,
  otherTeamUser: `auto_link_other_user_${randomUUID()}`,
  project: `auto_link_project_${randomUUID()}`,
}

const now = new Date()

async function addFeedback(authorUserId: string | null = ids.user) {
  const id = `auto_link_feedback_${randomUUID()}`
  await db.insert(feedback).values({
    id,
    projectId: ids.project,
    title: 'Auto-link integration fixture',
    body: 'Fixture',
    authorUserId,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return id
}

async function linkFor(feedbackId: string) {
  const [link] = await db
    .select()
    .from(contactLink)
    .where(and(eq(contactLink.entityType, 'feedback'), eq(contactLink.entityId, feedbackId)))
  return link
}

describe('createAutomaticFeedbackLink (real Postgres)', () => {
  beforeAll(async () => {
    await db.insert(organization).values({
      id: ids.org,
      name: 'Auto-link integration org',
      slug: `auto-link-${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(team).values([
      { id: ids.team, name: 'Auto-link team', slug: `auto-link-team-${randomUUID()}`, organizationId: ids.org, createdAt: now, updatedAt: now },
      { id: ids.otherTeam, name: 'Other team', slug: `auto-link-other-${randomUUID()}`, organizationId: ids.org, createdAt: now, updatedAt: now },
    ])
    await db.insert(user).values([
      { id: ids.user, name: 'Signed-in customer', email: `auto-link-${randomUUID()}@example.com`, createdAt: now, updatedAt: now },
      { id: ids.otherTeamUser, name: 'Other team customer', email: `auto-link-other-${randomUUID()}@example.com`, createdAt: now, updatedAt: now },
    ])
    await db.insert(project).values({
      id: ids.project,
      organizationId: ids.org,
      teamId: ids.team,
      slug: `auto-link-project-${randomUUID()}`,
      name: 'Auto-link project',
      description: 'Fixture',
      createdAt: now,
      updatedAt: now,
    })
  })

  afterAll(async () => {
    await db.delete(contactLink).where(sql`${contactLink.entityId} like ${'auto_link_feedback_%'}`)
    await db.delete(feedback).where(eq(feedback.projectId, ids.project))
    await db.delete(contact).where(sql`${contact.id} like ${'auto_link_contact_%'}`)
    await db.delete(supportTeamSettings).where(eq(supportTeamSettings.teamId, ids.team))
    await db.delete(project).where(eq(project.id, ids.project))
    await db.delete(user).where(sql`${user.id} in (${ids.user}, ${ids.otherTeamUser})`)
    await db.delete(organization).where(eq(organization.id, ids.org))
  })

  beforeEach(async () => {
    await db.delete(contactLink).where(sql`${contactLink.entityId} like ${'auto_link_feedback_%'}`)
    await db.delete(feedback).where(eq(feedback.projectId, ids.project))
    await db.delete(contact).where(sql`${contact.id} like ${'auto_link_contact_%'}`)
    await db.delete(supportTeamSettings).where(eq(supportTeamSettings.teamId, ids.team))
  })

  async function createContact(values: Partial<typeof contact.$inferInsert> = {}) {
    const id = `auto_link_contact_${randomUUID()}`
    const [created] = await db
      .insert(contact)
      .values({ id, teamId: ids.team, name: 'Fixture contact', createdAt: now, updatedAt: now, ...values })
      .returning()
    return created
  }

  async function setEnabled(enabled: boolean) {
    await db
      .insert(supportTeamSettings)
      .values({ teamId: ids.team, autoLinkFeedback: enabled, createdAt: now, updatedAt: new Date() })
      .onConflictDoUpdate({ target: supportTeamSettings.teamId, set: { autoLinkFeedback: enabled, updatedAt: new Date() } })
  }

  async function run(feedbackId: string, authorUserId: string | null = ids.user) {
    return db.transaction((tx: Tx) =>
      createAutomaticFeedbackLink(tx, { teamId: ids.team, feedbackId, authorUserId, createdAt: new Date() })
    )
  }

  async function expectLinkToWaitForMutation(
    feedbackId: string,
    mutate: ContactMutation,
    expected: Pick<Awaited<ReturnType<typeof run>>, 'linked' | 'reason'>
  ) {
    let releaseMutation!: () => void
    let mutationReady!: () => void
    const mutationReleased = new Promise<void>((resolve) => {
      releaseMutation = resolve
    })
    const mutationStarted = new Promise<void>((resolve) => {
      mutationReady = resolve
    })
    const mutation = db.transaction(async (tx: Tx) => {
      await mutate(tx)
      mutationReady()
      await mutationReleased
    })
    await mutationStarted

    const linkAttempt = run(feedbackId)
    try {
      await expect(
        Promise.race([
          linkAttempt.then(() => 'completed'),
          new Promise<'waiting'>((resolve) => setTimeout(() => resolve('waiting'), 100)),
        ])
      ).resolves.toBe('waiting')
    } finally {
      releaseMutation()
      await mutation
    }
    await expect(linkAttempt).resolves.toMatchObject(expected)
    return linkAttempt
  }

  it('links only the exact one active same-team user contact', async () => {
    await setEnabled(true)
    const active = await createContact({ userId: ids.user })
    const id = await addFeedback()
    await expect(run(id)).resolves.toMatchObject({ linked: true, contactId: active.id, reason: 'linked' })
    await expect(linkFor(id)).resolves.toMatchObject({
      contactId: active.id,
      entityType: 'feedback',
      entityId: id,
      source: 'auto',
      createdByUserId: null,
    })
  })

  it.each([
    ['zero matches', [], 'none'],
    ['email-only contact', [{ email: 'same@example.com' }], 'none'],
    ['anonymous feedback', [{ userId: ids.user }], 'anonymous'],
  ])('does not link for %s', async (_label, contacts, reason) => {
    await setEnabled(true)
    const created = contacts.map((values) => createContact(values as Partial<typeof contact.$inferInsert>))
    await Promise.all(created)
    const id = await addFeedback(_label === 'anonymous feedback' ? null : ids.user)
    await expect(run(id, _label === 'anonymous feedback' ? null : ids.user)).resolves.toMatchObject({
      linked: false,
      reason,
    })
    await expect(linkFor(id)).resolves.toBeUndefined()
  })

  it('returns anonymous without consulting a disabled policy', async () => {
    const id = await addFeedback(null)
    await expect(run(id, null)).resolves.toMatchObject({ linked: false, reason: 'anonymous' })
    await expect(linkFor(id)).resolves.toBeUndefined()
  })

  it.each([
    ['blocked contact', { blockedAt: new Date() }],
    ['merged contact', { mergedIntoContactId: 'survivor' }],
  ])('ignores a single %s', async (_label, values) => {
    await setEnabled(true)
    let contactValues = values as Partial<typeof contact.$inferInsert>
    if (_label === 'merged contact') {
      const survivor = await createContact({ userId: null })
      contactValues = { mergedIntoContactId: survivor.id, userId: ids.user }
    } else {
      contactValues = { ...contactValues, userId: ids.user }
    }
    await createContact(contactValues)
    const id = await addFeedback()
    await expect(run(id)).resolves.toMatchObject({ linked: false, reason: 'none' })
    await expect(linkFor(id)).resolves.toBeUndefined()
  })

  it('does not link ambiguous active matches', async () => {
    await setEnabled(true)
    await createContact({ userId: ids.user })
    await createContact({ userId: ids.user })
    const id = await addFeedback()
    await expect(run(id)).resolves.toMatchObject({ linked: false, reason: 'ambiguous' })
    await expect(linkFor(id)).resolves.toBeUndefined()
  })

  it('does not link a contact that exists only in another team', async () => {
    await setEnabled(true)
    await db.insert(contact).values({
      id: `auto_link_contact_${randomUUID()}`,
      teamId: ids.otherTeam,
      userId: ids.otherTeamUser,
      name: 'Cross-team only',
      createdAt: now,
      updatedAt: now,
    })
    const id = await addFeedback(ids.otherTeamUser)
    await expect(run(id, ids.otherTeamUser)).resolves.toMatchObject({ linked: false, reason: 'none' })
    await expect(linkFor(id)).resolves.toBeUndefined()
  })

  it('returns disabled and never backfills or deletes links when settings change', async () => {
    await setEnabled(false)
    const active = await createContact({ userId: ids.user })
    const id = await addFeedback()
    await expect(run(id)).resolves.toMatchObject({ linked: false, reason: 'disabled' })
    await setEnabled(true)
    await expect(linkFor(id)).resolves.toBeUndefined()
    const linkedFeedbackId = await addFeedback()
    await expect(run(linkedFeedbackId)).resolves.toMatchObject({ linked: true, contactId: active.id })
    await setEnabled(false)
    await expect(linkFor(linkedFeedbackId)).resolves.toMatchObject({ contactId: active.id })
    await db.delete(contactLink).where(eq(contactLink.entityId, linkedFeedbackId))
    await expect(linkFor(linkedFeedbackId)).resolves.toBeUndefined()
  })

  it('is conflict-safe under concurrent duplicate attempts', async () => {
    await setEnabled(true)
    const active = await createContact({ userId: ids.user })
    const id = await addFeedback()
    const results = await Promise.all(Array.from({ length: 2 }, () => run(id)))
    expect(results).toHaveLength(2)
    expect(results).toEqual([
      { linked: true, contactId: active.id, reason: 'linked' },
      { linked: true, contactId: active.id, reason: 'linked' },
    ])
    expect(await db.select().from(contactLink).where(and(eq(contactLink.contactId, active.id), eq(contactLink.entityId, id)))).toHaveLength(1)
  })

  it('waits for a concurrent block before linking a contact', async () => {
    await setEnabled(true)
    const active = await createContact({ userId: ids.user })
    const id = await addFeedback()
    await expectLinkToWaitForMutation(
      id,
      (tx) => tx.update(contact).set({ blockedAt: new Date() }).where(eq(contact.id, active.id)),
      { linked: false, reason: 'none' }
    )
    await expect(linkFor(id)).resolves.toBeUndefined()
  })

  it('waits for a concurrent merge before linking a contact', async () => {
    await setEnabled(true)
    const survivor = await createContact({ userId: null })
    const active = await createContact({ userId: ids.user })
    const id = await addFeedback()
    await expectLinkToWaitForMutation(
      id,
      (tx) => tx.update(contact).set({ mergedIntoContactId: survivor.id }).where(eq(contact.id, active.id)),
      { linked: false, reason: 'none' }
    )
    await expect(linkFor(id)).resolves.toBeUndefined()
  })

  it('waits for a concurrent delete before linking a contact', async () => {
    await setEnabled(true)
    const active = await createContact({ userId: ids.user })
    const id = await addFeedback()
    await expectLinkToWaitForMutation(
      id,
      (tx) => tx.delete(contact).where(eq(contact.id, active.id)),
      { linked: false, reason: 'none' }
    )
    await expect(linkFor(id)).resolves.toBeUndefined()
  })

  it('waits for a concurrent second contact before linking an ambiguous candidate set', async () => {
    await setEnabled(true)
    const active = await createContact({ userId: ids.user })
    const id = await addFeedback()
    await expectLinkToWaitForMutation(
      id,
      (tx) => tx.insert(contact).values({
        id: `auto_link_contact_${randomUUID()}`,
        teamId: ids.team,
        userId: ids.user,
        name: 'Concurrent second match',
        createdAt: now,
        updatedAt: now,
      }),
      { linked: false, reason: 'ambiguous' }
    )
    await expect(linkFor(id)).resolves.toBeUndefined()
    expect(active.id).toBeTruthy()
  })
})
