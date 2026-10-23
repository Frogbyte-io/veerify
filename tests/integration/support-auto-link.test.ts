import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../../server/database/drizzle'
import { member, organization, user } from '../../server/database/schema/auth'
import { project, projectMember, product, feedback } from '../../server/database/schema/feedback'
import { contact, contactLink, supportProjectSettings } from '../../server/database/schema/support'
import { lockContactProject } from '../../server/utils/contact-lock'
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
  project: `auto_link_project_${randomUUID()}`,
  otherProject: `auto_link_other_project_${randomUUID()}`,
  user: `auto_link_user_${randomUUID()}`,
  otherProjectUser: `auto_link_other_user_${randomUUID()}`,
  product: `auto_link_product_${randomUUID()}`,
  otherProduct: `auto_link_other_product_${randomUUID()}`,
}

const now = new Date()

async function addFeedback(authorUserId: string | null = ids.user, projectId = ids.project) {
  const id = `auto_link_feedback_${randomUUID()}`
  await db.insert(feedback).values({
    id,
    projectId,
    productId: projectId === ids.otherProject ? ids.otherProduct : ids.product,
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
      blocker_project_lock: boolean
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
                 WHERE held.pid = ANY(pg_blocking_pids(a.pid))
                   AND held.locktype = 'advisory'
                   AND held.granted
               ) AS blocker_project_lock
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

async function waitForHeldProjectLock(client: Client, pid: number, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await client.query<{ held: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM pg_locks held
          WHERE held.pid = $1
            AND held.locktype = 'advisory'
            AND held.granted
        ) AS held
      `,
      [pid]
    )
    if (result.rows[0]?.held) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  throw new Error(`backend ${pid} did not hold the contact advisory lock within ${timeoutMs}ms`)
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
    await db.insert(project).values([
      {
        id: ids.project,
        name: 'Auto-link project',
        slug: `auto-link-project-${randomUUID()}`,
        organizationId: ids.org,
        // Restricted: only explicit project members may open it, so the other
        // project's user is a genuine outsider.
        accessMode: 'restricted',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ids.otherProject,
        name: 'Other project',
        slug: `auto-link-other-${randomUUID()}`,
        organizationId: ids.org,
        accessMode: 'restricted',
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
        id: ids.otherProjectUser,
        name: 'Other project customer',
        email: `auto-link-other-${randomUUID()}@example.com`,
        createdAt: now,
        updatedAt: now,
      },
    ])
    await db.insert(member).values([
      { id: `auto_link_org_member_${randomUUID()}`, organizationId: ids.org, userId: ids.user, role: 'member' },
      {
        id: `auto_link_org_member_${randomUUID()}`,
        organizationId: ids.org,
        userId: ids.otherProjectUser,
        role: 'member',
      },
    ])
    await db.insert(projectMember).values([
      {
        id: `auto_link_member_${randomUUID()}`,
        projectId: ids.project,
        userId: ids.user,
        role: 'member',
        createdAt: now,
      },
      {
        id: `auto_link_member_${randomUUID()}`,
        projectId: ids.otherProject,
        userId: ids.otherProjectUser,
        role: 'member',
        createdAt: now,
      },
    ])
    await db.insert(product).values([
      {
        id: ids.product,
        projectId: ids.project,
        name: 'Auto-link product',
        slug: 'main',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ids.otherProduct,
        projectId: ids.otherProject,
        name: 'Other auto-link product',
        slug: 'main',
        createdAt: now,
        updatedAt: now,
      },
    ])
  })

  afterAll(async () => {
    await db.delete(contactLink).where(sql`${contactLink.entityId} like ${'auto_link_feedback_%'}`)
    await db.delete(feedback).where(sql`${feedback.projectId} in (${ids.project}, ${ids.otherProject})`)
    await db.delete(contact).where(sql`${contact.id} like ${'auto_link_contact_%'}`)
    await db.delete(supportProjectSettings).where(eq(supportProjectSettings.projectId, ids.project))
    await db.delete(supportProjectSettings).where(eq(supportProjectSettings.projectId, ids.otherProject))
    await db.delete(project).where(eq(project.id, ids.project))
    await db.delete(project).where(eq(project.id, ids.otherProject))
    await db.delete(projectMember).where(sql`${projectMember.userId} in (${ids.user}, ${ids.otherProjectUser})`)
    await db.delete(user).where(sql`${user.id} in (${ids.user}, ${ids.otherProjectUser})`)
    await db.delete(organization).where(eq(organization.id, ids.org))
  })

  beforeEach(async () => {
    await db.delete(contactLink).where(sql`${contactLink.entityId} like ${'auto_link_feedback_%'}`)
    await db.delete(feedback).where(sql`${feedback.projectId} in (${ids.project}, ${ids.otherProject})`)
    await db.delete(contact).where(sql`${contact.id} like ${'auto_link_contact_%'}`)
    await db.delete(supportProjectSettings).where(eq(supportProjectSettings.projectId, ids.project))
    await db.delete(supportProjectSettings).where(eq(supportProjectSettings.projectId, ids.otherProject))
  })

  async function createContact(values: Partial<typeof contact.$inferInsert> = {}) {
    const id = `auto_link_contact_${randomUUID()}`
    const [created] = await db
      .insert(contact)
      .values({ id, projectId: ids.project, name: 'Fixture contact', createdAt: now, updatedAt: now, ...values })
      .returning()
    return created
  }

  async function setEnabled(enabled: boolean) {
    await db
      .insert(supportProjectSettings)
      .values({ projectId: ids.project, autoLinkFeedback: enabled, createdAt: now, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: supportProjectSettings.projectId,
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
      return createAutomaticFeedbackLink(tx, {
        projectId: ids.project,
        feedbackId,
        authorUserId,
        createdAt: new Date(),
      })
    })
  }

  async function runForProject(
    projectId: string,
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
      const result = await createAutomaticFeedbackLink(tx, {
        projectId,
        feedbackId,
        authorUserId,
        createdAt: new Date(),
      })
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
      await lockContactProject(tx, ids.project)
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
        wait_event: 'advisory',
        blocker_project_lock: true,
      })
    } finally {
      releaseMutation()
      await mutation
      await observer.end()
    }
    await expect(linkAttempt).resolves.toMatchObject(expected)
  }

  it('links only the exact one active same-project user contact', async () => {
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

  it('does not link a contact that exists only in another project', async () => {
    await setEnabled(true)
    await db.insert(contact).values({
      id: `auto_link_contact_${randomUUID()}`,
      projectId: ids.otherProject,
      userId: ids.otherProjectUser,
      name: 'Cross-project only',
      createdAt: now,
      updatedAt: now,
    })
    const id = await addFeedback(ids.otherProjectUser)
    await expect(run(id, ids.otherProjectUser)).resolves.toMatchObject({ linked: false, reason: 'none' })
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

  it('lets an auto-link holding the project lock yield cleanly to a concurrent merge', async () => {
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
      await waitForHeldProjectLock(observer, linkPid)

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
        wait_event: 'advisory',
        blocker_project_lock: true,
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
        projectId: ids.project,
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
        wait_event: 'advisory',
        blocker_project_lock: true,
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
        wait_event: 'advisory',
        blocker_project_lock: true,
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
      db.transaction((tx) => deleteContactLinkInTransaction(tx, active.id, link.id, ids.otherProjectUser))
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
          projectId: ids.project,
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
          .update(supportProjectSettings)
          .set({ autoLinkFeedback: false, updatedAt: new Date() })
          .where(eq(supportProjectSettings.projectId, ids.project)),
      { linked: false, reason: 'disabled' }
    )

    await expect(linkFor(id)).resolves.toBeUndefined()
    expect(active.id).toBeTruthy()
  })

  it('does not block auto-link work in an unrelated project while this project is locked', async () => {
    await setEnabled(true)
    const projectContact = await createContact({ userId: null })
    await db
      .insert(supportProjectSettings)
      .values({ projectId: ids.otherProject, autoLinkFeedback: true, createdAt: now, updatedAt: now })
    const active = await db
      .insert(contact)
      .values({
        id: `auto_link_contact_${randomUUID()}`,
        projectId: ids.otherProject,
        userId: ids.otherProjectUser,
        name: 'Other project contact',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    const id = await addFeedback(ids.otherProjectUser, ids.otherProject)

    let releaseProject!: () => void
    let projectLockReady!: () => void
    /* eslint-disable no-unused-vars */
    let projectLockPidReady!: (value: number) => void
    /* eslint-enable no-unused-vars */
    const projectReleased = new Promise<void>((resolve) => {
      releaseProject = resolve
    })
    const projectStarted = new Promise<void>((resolve) => {
      projectLockReady = resolve
    })
    const projectPid = new Promise<number>((resolve) => {
      projectLockPidReady = resolve
    })
    const projectLock = db.transaction(async (tx: Tx) => {
      const result = await tx.execute(sql`select pg_backend_pid() as pid`)
      projectLockPidReady(Number(result.rows[0]?.pid))
      await lockContactProject(tx, ids.project)
      await tx.update(contact).set({ updatedAt: new Date() }).where(eq(contact.id, projectContact.id))
      projectLockReady()
      await projectReleased
    })
    await projectStarted
    const projectLockPid = await projectPid

    let releaseOther!: () => void
    const otherReleased = new Promise<void>((resolve) => {
      releaseOther = resolve
    })
    let otherAttempt!: ReturnType<typeof runForProject>
    let otherCompleted = false
    const otherPidReady = new Promise<number>((resolve) => {
      otherAttempt = runForProject(
        ids.otherProject,
        id,
        ids.otherProjectUser,
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
      await waitForHeldProjectLock(observer, projectLockPid)
      await waitForHeldContactWriteLock(observer, projectLockPid)
      await waitForHeldProjectLock(observer, otherPid)
      await waitForCompletionOrLock(observer, otherPid, () => otherCompleted)
      releaseOther()
      await expect(otherAttempt).resolves.toMatchObject({ linked: true, contactId: active[0].id })
    } finally {
      releaseOther()
      releaseProject()
      await Promise.allSettled([projectLock, otherAttempt])
      await observer.end()
    }
    await expect(linkFor(id)).resolves.toMatchObject({ contactId: active[0].id })
  })
})
