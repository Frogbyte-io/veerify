import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../../server/database/drizzle'
import { organization, team, teamMember, user } from '../../server/database/schema/auth'
import { project, feedback } from '../../server/database/schema/feedback'
import { contact, contactLink, supportTeamSettings } from '../../server/database/schema/support'
import { lockContactTeam } from '../../server/utils/contact-lock'
import { deleteContactLinkInTransaction } from '../../server/utils/contact-link-transaction'
import { mergeContactsInTransaction } from '../../server/utils/contact-merge-transaction'
import { createAutomaticFeedbackLink } from '../../server/utils/support-auto-link'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type ContactMutation = Parameters<typeof db.transaction>[0]

/* eslint-disable no-unused-vars */
type BackendPidObserver = (pid: number) => Promise<void>
/* eslint-enable no-unused-vars */

function makePgClient() {
  if (process.env.DATABASE_URL) {
    return new Client({ connectionString: process.env.DATABASE_URL })
  }

  return new Client({
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT) || 5432,
    user: process.env.PGUSER || 'veerify',
    password: process.env.PGPASSWORD || 'veerifypassword',
    database: process.env.PGDATABASE || 'veerifydb',
    ssl: false,
  })
}

const ids = {
  org: `auto_link_org_${randomUUID()}`,
  team: `auto_link_team_${randomUUID()}`,
  otherTeam: `auto_link_other_team_${randomUUID()}`,
  user: `auto_link_user_${randomUUID()}`,
  otherTeamUser: `auto_link_other_user_${randomUUID()}`,
  project: `auto_link_project_${randomUUID()}`,
  otherProject: `auto_link_other_project_${randomUUID()}`,
}

const now = new Date()

async function addFeedback(authorUserId: string | null = ids.user, projectId = ids.project) {
  const id = `auto_link_feedback_${randomUUID()}`
  await db.insert(feedback).values({
    id,
    projectId,
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

async function waitForBackendLock(client: Client, pid: number, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await client.query<{
      wait_event_type: string | null
      wait_event: string | null
      waiting_on_lock: boolean
      blocking_pids: number[]
      blocker_team_lock: boolean
    }>(
      `
        SELECT a.wait_event_type, a.wait_event,
               EXISTS (
                 SELECT 1 FROM pg_locks waiting
                 WHERE waiting.pid = a.pid AND NOT waiting.granted
               ) AS waiting_on_lock,
               pg_blocking_pids(a.pid) AS blocking_pids,
               EXISTS (
                 SELECT 1
                 FROM pg_locks held
                 JOIN pg_class relation ON relation.oid = held.relation
                 WHERE held.pid = ANY(pg_blocking_pids(a.pid))
                   AND relation.relname = 'team'
                   AND held.mode = 'RowShareLock'
                   AND held.granted
               ) AS blocker_team_lock
        FROM pg_stat_activity a
        WHERE a.pid = $1
      `,
      [pid]
    )
    const state = result.rows[0]
    if (state?.wait_event_type === 'Lock' && state.waiting_on_lock && state.blocking_pids.length > 0) return state
    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  throw new Error(`backend ${pid} did not reach a PostgreSQL lock wait within ${timeoutMs}ms`)
}

async function waitForHeldTeamLock(client: Client, pid: number, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await client.query<{ held: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM pg_locks held
          JOIN pg_class relation ON relation.oid = held.relation
          WHERE held.pid = $1
            AND relation.relname = 'team'
            AND held.mode = 'RowShareLock'
            AND held.granted
        ) AS held
      `,
      [pid]
    )
    if (result.rows[0]?.held) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  throw new Error(`backend ${pid} did not hold the team row lock within ${timeoutMs}ms`)
}

async function waitForHeldContactWriteLock(client: Client, pid: number, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await client.query<{ held: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM pg_locks held
          JOIN pg_class relation ON relation.oid = held.relation
          WHERE held.pid = $1
            AND relation.relname = 'contact'
            AND held.mode = 'RowExclusiveLock'
            AND held.granted
        ) AS held
      `,
      [pid]
    )
    if (result.rows[0]?.held) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  throw new Error(`backend ${pid} did not hold the contact write lock within ${timeoutMs}ms`)
}

async function waitForCompletionOrLock(client: Client, pid: number, isComplete: () => boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (isComplete()) return

    const result = await client.query<{
      wait_event_type: string | null
      wait_event: string | null
      waiting_on_lock: boolean
      blocking_pids: number[]
    }>(
      `
        SELECT a.wait_event_type, a.wait_event,
               EXISTS (
                 SELECT 1 FROM pg_locks waiting
                 WHERE waiting.pid = a.pid AND NOT waiting.granted
               ) AS waiting_on_lock,
               pg_blocking_pids(a.pid) AS blocking_pids
        FROM pg_stat_activity a
        WHERE a.pid = $1
      `,
      [pid]
    )
    const state = result.rows[0]
    if (state?.wait_event_type === 'Lock' && state.waiting_on_lock && state.blocking_pids.length > 0) {
      throw new Error(`backend ${pid} is blocked by PostgreSQL lock ${state.wait_event ?? 'unknown'}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  throw new Error(`backend ${pid} neither completed nor reached a PostgreSQL lock wait within ${timeoutMs}ms`)
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
      {
        id: ids.team,
        name: 'Auto-link team',
        slug: `auto-link-team-${randomUUID()}`,
        organizationId: ids.org,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ids.otherTeam,
        name: 'Other team',
        slug: `auto-link-other-${randomUUID()}`,
        organizationId: ids.org,
        createdAt: now,
        updatedAt: now,
      },
    ])
    await db.insert(user).values([
      {
        id: ids.user,
        name: 'Signed-in customer',
        email: `auto-link-${randomUUID()}@example.com`,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ids.otherTeamUser,
        name: 'Other team customer',
        email: `auto-link-other-${randomUUID()}@example.com`,
        createdAt: now,
        updatedAt: now,
      },
    ])
    await db.insert(teamMember).values([
      { id: `auto_link_member_${randomUUID()}`, teamId: ids.team, userId: ids.user, role: 'member', createdAt: now },
      {
        id: `auto_link_member_${randomUUID()}`,
        teamId: ids.otherTeam,
        userId: ids.otherTeamUser,
        role: 'member',
        createdAt: now,
      },
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
    await db.insert(project).values({
      id: ids.otherProject,
      organizationId: ids.org,
      teamId: ids.otherTeam,
      slug: `auto-link-other-project-${randomUUID()}`,
      name: 'Other auto-link project',
      description: 'Fixture',
      createdAt: now,
      updatedAt: now,
    })
  })

  afterAll(async () => {
    await db.delete(contactLink).where(sql`${contactLink.entityId} like ${'auto_link_feedback_%'}`)
    await db.delete(feedback).where(sql`${feedback.projectId} in (${ids.project}, ${ids.otherProject})`)
    await db.delete(contact).where(sql`${contact.id} like ${'auto_link_contact_%'}`)
    await db.delete(supportTeamSettings).where(eq(supportTeamSettings.teamId, ids.team))
    await db.delete(supportTeamSettings).where(eq(supportTeamSettings.teamId, ids.otherTeam))
    await db.delete(project).where(eq(project.id, ids.project))
    await db.delete(project).where(eq(project.id, ids.otherProject))
    await db.delete(teamMember).where(sql`${teamMember.userId} in (${ids.user}, ${ids.otherTeamUser})`)
    await db.delete(user).where(sql`${user.id} in (${ids.user}, ${ids.otherTeamUser})`)
    await db.delete(organization).where(eq(organization.id, ids.org))
  })

  beforeEach(async () => {
    await db.delete(contactLink).where(sql`${contactLink.entityId} like ${'auto_link_feedback_%'}`)
    await db.delete(feedback).where(sql`${feedback.projectId} in (${ids.project}, ${ids.otherProject})`)
    await db.delete(contact).where(sql`${contact.id} like ${'auto_link_contact_%'}`)
    await db.delete(supportTeamSettings).where(eq(supportTeamSettings.teamId, ids.team))
    await db.delete(supportTeamSettings).where(eq(supportTeamSettings.teamId, ids.otherTeam))
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
      .onConflictDoUpdate({
        target: supportTeamSettings.teamId,
        set: { autoLinkFeedback: enabled, updatedAt: new Date() },
      })
  }

  async function run(
    feedbackId: string,
    authorUserId: string | null = ids.user,
    observeBackendPid?: BackendPidObserver
  ) {
    return db.transaction(async (tx: Tx) => {
      if (observeBackendPid) {
        const result = await tx.execute(sql`select pg_backend_pid() as pid`)
        await observeBackendPid(Number(result.rows[0]?.pid))
      }
      return createAutomaticFeedbackLink(tx, { teamId: ids.team, feedbackId, authorUserId, createdAt: new Date() })
    })
  }

  async function runForTeam(
    teamId: string,
    feedbackId: string,
    authorUserId: string | null,
    observeBackendPid?: BackendPidObserver,
    holdAfterLink?: Promise<void>,
    onCompleted?: () => void
  ) {
    return db.transaction(async (tx: Tx) => {
      if (observeBackendPid) {
        const result = await tx.execute(sql`select pg_backend_pid() as pid`)
        await observeBackendPid(Number(result.rows[0]?.pid))
      }
      const result = await createAutomaticFeedbackLink(tx, { teamId, feedbackId, authorUserId, createdAt: new Date() })
      onCompleted?.()
      if (holdAfterLink) await holdAfterLink
      return result
    })
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
      await lockContactTeam(tx, ids.team)
      await mutate(tx)
      mutationReady()
      await mutationReleased
    })
    await mutationStarted

    let linkAttempt!: ReturnType<typeof run>
    const helperStarted = new Promise<number>((resolve) => {
      linkAttempt = run(feedbackId, ids.user, async (pid) => resolve(pid))
    })
    const helperPid = await helperStarted
    const observer = makePgClient()
    await observer.connect()
    try {
      await expect(waitForBackendLock(observer, helperPid)).resolves.toMatchObject({
        wait_event_type: 'Lock',
        blocker_team_lock: true,
      })
    } finally {
      releaseMutation()
      await mutation
      await observer.end()
    }
    await expect(linkAttempt).resolves.toMatchObject(expected)
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
    expect(
      await db
        .select()
        .from(contactLink)
        .where(and(eq(contactLink.contactId, active.id), eq(contactLink.entityId, id)))
    ).toHaveLength(1)
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

  it('serializes auto-link against the actual merge transaction without deadlock', async () => {
    await setEnabled(true)
    const survivor = await createContact({ userId: null })
    const active = await createContact({ userId: ids.user })
    const id = await addFeedback()

    await expectLinkToWaitForMutation(
      id,
      (tx) => mergeContactsInTransaction(tx, survivor.id, active.id).then(() => undefined),
      { linked: false, reason: 'none' }
    )

    const [mergedLoser] = await db
      .select({ mergedIntoContactId: contact.mergedIntoContactId })
      .from(contact)
      .where(eq(contact.id, active.id))
    expect(mergedLoser?.mergedIntoContactId).toBe(survivor.id)
    await expect(linkFor(id)).resolves.toBeUndefined()
  })

  it('lets an auto-link holding the team lock yield cleanly to a concurrent merge', async () => {
    await setEnabled(true)
    const survivor = await createContact({ userId: null })
    const active = await createContact({ userId: ids.user })
    const id = await addFeedback()

    let releaseConflict!: () => void
    let conflictReady!: () => void
    const conflictReleased = new Promise<void>((resolve) => {
      releaseConflict = resolve
    })
    const blockerReady = new Promise<void>((resolve) => {
      conflictReady = resolve
    })
    const blocker = db.transaction(async (tx: Tx) => {
      await tx.insert(contactLink).values({
        id: randomUUID(),
        contactId: active.id,
        entityType: 'feedback',
        entityId: id,
        source: 'agent',
        createdByUserId: null,
        createdAt: new Date(),
      })
      conflictReady()
      await conflictReleased
    })
    await blockerReady

    let linkAttempt!: ReturnType<typeof run>
    let mergeAttempt!: Promise<unknown>
    const observer = makePgClient()
    await observer.connect()
    try {
      const linkPidReady = new Promise<number>((resolve) => {
        linkAttempt = run(id, ids.user, async (pid) => resolve(pid))
      })
      const linkPid = await linkPidReady
      await waitForHeldTeamLock(observer, linkPid)

      /* eslint-disable no-unused-vars */
      let mergePidReady!: (value: number) => void
      /* eslint-enable no-unused-vars */
      const mergePidPromise = new Promise<number>((resolve) => {
        mergePidReady = resolve
      })
      mergeAttempt = db.transaction(async (tx: Tx) => {
        const result = await tx.execute(sql`select pg_backend_pid() as pid`)
        mergePidReady(Number(result.rows[0]?.pid))
        return mergeContactsInTransaction(tx, survivor.id, active.id)
      })
      const mergePid = await mergePidPromise
      await expect(waitForBackendLock(observer, mergePid)).resolves.toMatchObject({
        wait_event_type: 'Lock',
        blocker_team_lock: true,
      })

      releaseConflict()
    } finally {
      releaseConflict()
      await Promise.allSettled([blocker, linkAttempt, mergeAttempt])
      await observer.end()
    }

    await expect(linkAttempt).resolves.toMatchObject({ linked: true, contactId: active.id, reason: 'linked' })
    await expect(mergeAttempt).resolves.toMatchObject({ loser: { id: active.id } })
    await expect(linkFor(id)).resolves.toMatchObject({ contactId: survivor.id })
  })

  it('serializes unlink behind an auto-link transaction', async () => {
    await setEnabled(true)
    const active = await createContact({ userId: ids.user })
    const id = await addFeedback()
    const [existingLink] = await db
      .insert(contactLink)
      .values({
        id: randomUUID(),
        contactId: active.id,
        entityType: 'feedback',
        entityId: id,
        source: 'agent',
        createdByUserId: ids.user,
        createdAt: new Date(),
      })
      .returning({ id: contactLink.id })

    let releaseAutoLink!: () => void
    let autoLinkReady!: () => void
    const autoLinkReleased = new Promise<void>((resolve) => {
      releaseAutoLink = resolve
    })
    const autoLinkStarted = new Promise<void>((resolve) => {
      autoLinkReady = resolve
    })
    const autoLinkAttempt = db.transaction(async (tx: Tx) => {
      const result = await createAutomaticFeedbackLink(tx, {
        teamId: ids.team,
        feedbackId: id,
        authorUserId: ids.user,
        createdAt: new Date(),
      })
      autoLinkReady()
      await autoLinkReleased
      return result
    })
    await autoLinkStarted

    expect(existingLink).toBeTruthy()

    let unlinkAttempt!: Promise<unknown>
    const unlinkPidReady = new Promise<number>((resolve) => {
      unlinkAttempt = db.transaction(async (tx: Tx) => {
        const result = await tx.execute(sql`select pg_backend_pid() as pid`)
        resolve(Number(result.rows[0]?.pid))
        return deleteContactLinkInTransaction(tx, active.id, existingLink.id, ids.user)
      })
    })
    const unlinkPid = await unlinkPidReady
    const observer = makePgClient()
    await observer.connect()
    try {
      await expect(waitForBackendLock(observer, unlinkPid)).resolves.toMatchObject({
        wait_event_type: 'Lock',
        blocker_team_lock: true,
      })
    } finally {
      releaseAutoLink()
      await Promise.allSettled([autoLinkAttempt, unlinkAttempt])
      await observer.end()
    }

    await expect(unlinkAttempt).resolves.toMatchObject({ deleted: true })
    await expect(autoLinkAttempt).resolves.toMatchObject({ linked: true, contactId: active.id })
    await expect(linkFor(id)).resolves.toBeUndefined()
  })

  it('does not delete a link repointed by a concurrent merge', async () => {
    await setEnabled(true)
    const survivor = await createContact({ userId: null })
    const loser = await createContact({ userId: ids.user })
    const id = await addFeedback()
    const [existingLink] = await db
      .insert(contactLink)
      .values({
        id: randomUUID(),
        contactId: loser.id,
        entityType: 'feedback',
        entityId: id,
        source: 'agent',
        createdByUserId: ids.user,
        createdAt: new Date(),
      })
      .returning({ id: contactLink.id })

    let releaseMerge!: () => void
    let mergeReady!: () => void
    const mergeReleased = new Promise<void>((resolve) => {
      releaseMerge = resolve
    })
    const mergeStarted = new Promise<void>((resolve) => {
      mergeReady = resolve
    })
    const mergeAttempt = db.transaction(async (tx: Tx) => {
      const result = await mergeContactsInTransaction(tx, survivor.id, loser.id)
      mergeReady()
      await mergeReleased
      return result
    })
    await mergeStarted

    let unlinkAttempt!: Promise<unknown>
    const unlinkPidReady = new Promise<number>((resolve) => {
      unlinkAttempt = db.transaction(async (tx: Tx) => {
        const result = await tx.execute(sql`select pg_backend_pid() as pid`)
        resolve(Number(result.rows[0]?.pid))
        return deleteContactLinkInTransaction(tx, loser.id, existingLink.id, ids.user)
      })
    })
    const unlinkPid = await unlinkPidReady
    const observer = makePgClient()
    await observer.connect()
    try {
      await expect(waitForBackendLock(observer, unlinkPid)).resolves.toMatchObject({
        wait_event_type: 'Lock',
        blocker_team_lock: true,
      })
    } finally {
      releaseMerge()
      await Promise.allSettled([mergeAttempt, unlinkAttempt])
      await observer.end()
    }

    await expect(unlinkAttempt).rejects.toMatchObject({ statusCode: 404 })
    await expect(mergeAttempt).resolves.toMatchObject({ loser: { id: loser.id } })
    await expect(linkFor(id)).resolves.toMatchObject({ contactId: survivor.id })
  })

  it('preserves contact and link 404/403 semantics during unlink authorization', async () => {
    const active = await createContact({ userId: ids.user })
    const id = await addFeedback()
    const [link] = await db
      .insert(contactLink)
      .values({
        id: randomUUID(),
        contactId: active.id,
        entityType: 'feedback',
        entityId: id,
        source: 'agent',
        createdByUserId: ids.user,
        createdAt: new Date(),
      })
      .returning({ id: contactLink.id })

    await expect(
      db.transaction((tx) => deleteContactLinkInTransaction(tx, active.id, link.id, ids.otherTeamUser))
    ).rejects.toMatchObject({ statusCode: 403 })
    await expect(
      db.transaction((tx) => deleteContactLinkInTransaction(tx, 'missing-contact', link.id, ids.user))
    ).rejects.toMatchObject({ statusCode: 404 })
    await expect(linkFor(id)).resolves.toMatchObject({ id: link.id })
  })

  it('waits for a concurrent delete before linking a contact', async () => {
    await setEnabled(true)
    const active = await createContact({ userId: ids.user })
    const id = await addFeedback()
    await expectLinkToWaitForMutation(id, (tx) => tx.delete(contact).where(eq(contact.id, active.id)), {
      linked: false,
      reason: 'none',
    })
    await expect(linkFor(id)).resolves.toBeUndefined()
  })

  it('waits for a concurrent second contact before linking an ambiguous candidate set', async () => {
    await setEnabled(true)
    const active = await createContact({ userId: ids.user })
    const id = await addFeedback()
    await expectLinkToWaitForMutation(
      id,
      (tx) =>
        tx.insert(contact).values({
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

  it('observes a committed settings disable before a waiting auto-link can link', async () => {
    await setEnabled(true)
    const active = await createContact({ userId: ids.user })
    const id = await addFeedback()

    await expectLinkToWaitForMutation(
      id,
      (tx) =>
        tx
          .update(supportTeamSettings)
          .set({ autoLinkFeedback: false, updatedAt: new Date() })
          .where(eq(supportTeamSettings.teamId, ids.team)),
      { linked: false, reason: 'disabled' }
    )

    await expect(linkFor(id)).resolves.toBeUndefined()
    expect(active.id).toBeTruthy()
  })

  it('does not block auto-link work in an unrelated team while this team is locked', async () => {
    await setEnabled(true)
    const teamContact = await createContact({ userId: null })
    await db
      .insert(supportTeamSettings)
      .values({ teamId: ids.otherTeam, autoLinkFeedback: true, createdAt: now, updatedAt: now })
    const active = await db
      .insert(contact)
      .values({
        id: `auto_link_contact_${randomUUID()}`,
        teamId: ids.otherTeam,
        userId: ids.otherTeamUser,
        name: 'Other team contact',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    const id = await addFeedback(ids.otherTeamUser, ids.otherProject)

    let releaseTeam!: () => void
    let teamLockReady!: () => void
    /* eslint-disable no-unused-vars */
    let teamLockPidReady!: (value: number) => void
    /* eslint-enable no-unused-vars */
    const teamReleased = new Promise<void>((resolve) => {
      releaseTeam = resolve
    })
    const teamStarted = new Promise<void>((resolve) => {
      teamLockReady = resolve
    })
    const teamPid = new Promise<number>((resolve) => {
      teamLockPidReady = resolve
    })
    const teamLock = db.transaction(async (tx: Tx) => {
      const result = await tx.execute(sql`select pg_backend_pid() as pid`)
      teamLockPidReady(Number(result.rows[0]?.pid))
      await lockContactTeam(tx, ids.team)
      await tx.update(contact).set({ updatedAt: new Date() }).where(eq(contact.id, teamContact.id))
      teamLockReady()
      await teamReleased
    })
    await teamStarted
    const teamLockPid = await teamPid

    let releaseOther!: () => void
    const otherReleased = new Promise<void>((resolve) => {
      releaseOther = resolve
    })
    let otherAttempt!: ReturnType<typeof runForTeam>
    let otherCompleted = false
    const otherPidReady = new Promise<number>((resolve) => {
      otherAttempt = runForTeam(
        ids.otherTeam,
        id,
        ids.otherTeamUser,
        async (pid) => resolve(pid),
        otherReleased,
        () => {
          otherCompleted = true
        }
      )
    })
    const otherPid = await otherPidReady
    const observer = makePgClient()
    await observer.connect()
    try {
      await waitForHeldTeamLock(observer, teamLockPid)
      await waitForHeldContactWriteLock(observer, teamLockPid)
      await waitForHeldTeamLock(observer, otherPid)
      await waitForCompletionOrLock(observer, otherPid, () => otherCompleted)
      releaseOther()
      await expect(otherAttempt).resolves.toMatchObject({ linked: true, contactId: active[0].id })
    } finally {
      releaseOther()
      releaseTeam()
      await Promise.allSettled([teamLock, otherAttempt])
      await observer.end()
    }
    await expect(linkFor(id)).resolves.toMatchObject({ contactId: active[0].id })
  })
})
