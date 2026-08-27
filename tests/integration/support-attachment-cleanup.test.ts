import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../../server/database/drizzle'
import { organization, team, user } from '../../server/database/schema/auth'
import { contact, conversation, supportAttachmentUpload, supportInbox } from '../../server/database/schema/support'
import { runAttachmentCleanup } from '../../server/utils/support-attachment-cleanup'
import { reserveAttachmentFinalization } from '../../server/utils/support-attachment-finalization'
import type { StorageObjectMetadata, StorageProvider } from '../../server/utils/storage/types'

const ids = {
  org: `cleanup_org_${randomUUID()}`,
  team: `cleanup_team_${randomUUID()}`,
  inbox: `cleanup_inbox_${randomUUID()}`,
  user: `cleanup_user_${randomUUID()}`,
  contact: `cleanup_contact_${randomUUID()}`,
  conversation: `cleanup_conversation_${randomUUID()}`,
}
const now = new Date('2026-08-27T10:00:00.000Z')

class FakeStorage implements StorageProvider {
  driver = 'local' as const
  readonly directUploadConstraints = 'proxy-required' as const
  readonly objects = new Set<string>()
  readonly failed = new Set<string>()
  deletes: string[] = []
  async getPresignedUploadTarget() { return { uploadUrl: '/unused', method: 'PUT' as const, headers: {} } }
  async putObject() {}
  async headObject(key: string): Promise<StorageObjectMetadata> {
    if (!this.objects.has(key)) throw Object.assign(new Error('Object not found'), { code: 'OBJECT_NOT_FOUND' })
    return { sizeBytes: 1, contentType: 'text/plain', objectVersion: 'v1' }
  }
  async copyObject(sourceKey: string, destinationKey: string): Promise<StorageObjectMetadata> {
    if (!this.objects.has(sourceKey)) {
      throw Object.assign(new Error('Object not found'), { code: 'OBJECT_NOT_FOUND' })
    }
    this.objects.add(destinationKey)
    return { sizeBytes: 1, contentType: 'text/plain', objectVersion: 'v1' }
  }
  async getObject() { return Buffer.from('unused') }
  async deleteObject(key: string) {
    this.deletes.push(key)
    if (this.failed.has(key)) throw new Error('provider unavailable')
    this.objects.delete(key)
  }
  getPublicUrl(key: string) { return `/objects/${key}` }
}

const storage = new FakeStorage()

beforeAll(async () => {
  await db.insert(organization).values({ id: ids.org, name: 'Cleanup Org', slug: `cleanup-${randomUUID()}` })
  await db.insert(team).values({ id: ids.team, name: 'Cleanup Team', slug: `cleanup-team-${randomUUID()}`, organizationId: ids.org })
  await db.insert(user).values({ id: ids.user, name: 'Cleanup Agent', email: `cleanup-${randomUUID()}@example.com` })
  await db.insert(supportInbox).values({ id: ids.inbox, teamId: ids.team, name: 'Cleanup Inbox', slug: `cleanup-inbox-${randomUUID()}`, emailAddress: `cleanup-${randomUUID()}@example.com` })
  await db.insert(contact).values({ id: ids.contact, teamId: ids.team, name: 'Cleanup Customer', email: `cleanup-customer-${randomUUID()}@example.com` })
  await db.insert(conversation).values({ id: ids.conversation, inboxId: ids.inbox, teamId: ids.team, contactId: ids.contact, displayId: 987654, subject: 'Cleanup', status: 'open' })
})

afterAll(async () => {
  await db.delete(organization).where(eq(organization.id, ids.org))
  await db.delete(user).where(eq(user.id, ids.user))
})

beforeEach(async () => {
  await db
    .delete(supportAttachmentUpload)
    .where(eq(supportAttachmentUpload.conversationId, ids.conversation))
  storage.objects.clear()
  storage.failed.clear()
  storage.deletes = []
})

async function upload(status: string, overrides: Partial<typeof supportAttachmentUpload.$inferInsert> = {}) {
  const id = overrides.id ?? `upload_${randomUUID()}`
  const temp = overrides.tempStorageKey ?? `support/attachments/uploads/${id}/file.txt`
  storage.objects.add(temp)
  if (overrides.finalStorageKey) storage.objects.add(overrides.finalStorageKey)
  await db.insert(supportAttachmentUpload).values({
    id,
    conversationId: ids.conversation,
    userId: ids.user,
    tempStorageKey: temp,
    fileName: 'file.txt',
    requestedContentType: 'text/plain',
    requestedSizeBytes: 1,
    status,
    expiresAt: new Date(now.getTime() - 1),
    finalStorageKey: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  })
  return id
}

describe('support attachment cleanup (real Postgres)', () => {
  it('expires pending and uploaded sessions after deleting their temporary objects', async () => {
    const pending = await upload('pending')
    const uploaded = await upload('uploaded', { expiresAt: new Date(now.getTime() - 1) })
    const result = await runAttachmentCleanup({ now, storage, maxBatch: 10 })
    expect(result.claimed).toBe(2)
    expect(result.expired).toBe(2)
    expect(storage.deletes).toEqual(expect.arrayContaining([
      `support/attachments/uploads/${pending}/file.txt`,
      `support/attachments/uploads/${uploaded}/file.txt`,
    ]))
    const rows = await db.select().from(supportAttachmentUpload).where(inArray(supportAttachmentUpload.id, [pending, uploaded]))
    expect(rows.every((row) => row.status === 'expired' && row.tempDeletedAt)).toBe(true)
  })

  it('cleans consumed temporary objects while retaining the consumed final object', async () => {
    const temp = `support/attachments/uploads/consumed/file.txt`
    const final = `support/attachments/outbound/consumed/file.txt`
    const id = await upload('consumed', { tempStorageKey: temp, finalStorageKey: final, expiresAt: new Date(now.getTime() + 60_000), consumedAt: now })
    const result = await runAttachmentCleanup({ now, storage, maxBatch: 10 })
    expect(result.consumedTempDeleted).toBe(1)
    const [row] = await db.select().from(supportAttachmentUpload).where(eq(supportAttachmentUpload.id, id))
    expect(row.status).toBe('consumed')
    expect(row.finalStorageKey).toBe(final)
    expect(row.tempDeletedAt).toBeTruthy()
    expect(storage.objects.has(final)).toBe(true)
  })

  it('recovers a stale finalizing row and restores an unexpired upload after deleting the final orphan', async () => {
    const id = await upload('finalizing', {
      finalStorageKey: `support/attachments/outbound/stale/file.txt`,
      expiresAt: new Date(now.getTime() + 60_000),
      finalizeLeaseExpiresAt: new Date(now.getTime() - 1),
    })
    const result = await runAttachmentCleanup({ now, storage, maxBatch: 10 })
    expect(result.restored).toBe(1)
    const [row] = await db.select().from(supportAttachmentUpload).where(eq(supportAttachmentUpload.id, id))
    expect(row.status).toBe('uploaded')
    expect(row.finalStorageKey).toBeNull()
    expect(row.tempDeletedAt).toBeNull()
  })

  it('keeps cleanup-required uploads unavailable until cleanup restores them for reuse', async () => {
    const id = await upload('cleanup_required', {
      finalStorageKey: 'support/attachments/outbound/reuse/file.txt',
      expiresAt: new Date(now.getTime() + 60_000),
      storedContentType: 'text/plain',
      actualSizeBytes: 1,
      objectVersion: 'v1',
      uploadedAt: now,
    })

    await expect(
      reserveAttachmentFinalization({ uploadIds: [id], conversationId: ids.conversation, userId: ids.user, now, storage })
    ).rejects.toMatchObject({
      statusCode: 409,
      data: {
        error: {
          message: 'Attachment cleanup is still in progress. Please retry shortly.',
        },
      },
    })

    await expect(runAttachmentCleanup({ now, storage, maxBatch: 1 })).resolves.toMatchObject({ restored: 1 })
    await expect(
      reserveAttachmentFinalization({ uploadIds: [id], conversationId: ids.conversation, userId: ids.user, now, storage })
    ).resolves.toMatchObject([{ uploadId: id }])
  })

  it('ignores an active finalization lease', async () => {
    const id = await upload('finalizing', {
      finalStorageKey: `support/attachments/outbound/active/file.txt`,
      expiresAt: new Date(now.getTime() + 60_000),
      finalizeLeaseExpiresAt: new Date(now.getTime() + 60_000),
    })
    const result = await runAttachmentCleanup({ now, storage, maxBatch: 10 })
    expect(result.claimed).toBe(0)
    const [row] = await db.select().from(supportAttachmentUpload).where(eq(supportAttachmentUpload.id, id))
    expect(row.status).toBe('finalizing')
  })

  it('treats missing final and temporary objects as successful deletion', async () => {
    const id = await upload('cleanup_required', {
      finalStorageKey: `support/attachments/outbound/missing/file.txt`,
      expiresAt: new Date(now.getTime() - 1),
    })
    storage.objects.clear()
    const result = await runAttachmentCleanup({ now, storage, maxBatch: 10 })
    expect(result.expired).toBe(1)
    const [row] = await db.select().from(supportAttachmentUpload).where(eq(supportAttachmentUpload.id, id))
    expect(row.status).toBe('expired')
    expect(row.finalStorageKey).toBeNull()
    expect(row.tempDeletedAt).toBeTruthy()
  })

  it('retains the key and records a retry when provider deletion fails', async () => {
    const final = `support/attachments/outbound/retry/file.txt`
    const id = await upload('cleanup_required', { finalStorageKey: final, expiresAt: new Date(now.getTime() + 60_000) })
    storage.failed.add(final)
    const result = await runAttachmentCleanup({ now, storage, maxBatch: 10 })
    expect(result.retried).toBe(1)
    const [row] = await db.select().from(supportAttachmentUpload).where(eq(supportAttachmentUpload.id, id))
    expect(row.status).toBe('cleanup_required')
    expect(row.finalStorageKey).toBe(final)
    expect(row.cleanupAttemptCount).toBe(1)
    expect(row.cleanupLastError).toBe('STORAGE_DELETE_FAILED')
    expect(row.finalizeLeaseExpiresAt).toBeNull()
  })

  it('keeps a partial multi-object failure retryable while completing the other row', async () => {
    const failedFinal = `support/attachments/outbound/partial-failed/file.txt`
    const succeededFinal = `support/attachments/outbound/partial-ok/file.txt`
    const failed = await upload('cleanup_required', { finalStorageKey: failedFinal, expiresAt: new Date(now.getTime() + 60_000) })
    const succeeded = await upload('cleanup_required', { finalStorageKey: succeededFinal, expiresAt: new Date(now.getTime() + 60_000) })
    storage.failed.add(failedFinal)
    const result = await runAttachmentCleanup({ now, storage, maxBatch: 10 })
    expect(result.retried).toBeGreaterThanOrEqual(1)
    expect(result.restored).toBeGreaterThanOrEqual(1)
    const rows = await db.select().from(supportAttachmentUpload).where(inArray(supportAttachmentUpload.id, [failed, succeeded]))
    expect(rows.find((row) => row.id === failed)?.finalStorageKey).toBe(failedFinal)
    expect(rows.find((row) => row.id === succeeded)?.status).toBe('uploaded')
  })

  it('retries one expired row safely when final deletion succeeds before temporary deletion fails', async () => {
    const final = 'support/attachments/outbound/partial-row/file.txt'
    const id = await upload('cleanup_required', { finalStorageKey: final })
    const temp = `support/attachments/uploads/${id}/file.txt`
    storage.failed.add(temp)

    const failed = await runAttachmentCleanup({ now, storage, maxBatch: 1 })
    expect(failed).toMatchObject({ claimed: 1, expired: 0, retried: 1 })
    const [failedRow] = await db.select().from(supportAttachmentUpload).where(eq(supportAttachmentUpload.id, id))
    expect(failedRow.status).toBe('cleanup_required')
    expect(failedRow.finalStorageKey).toBe(final)
    expect(storage.objects.has(final)).toBe(false)

    storage.failed.delete(temp)
    const recovered = await runAttachmentCleanup({ now, storage, maxBatch: 1 })
    expect(recovered).toMatchObject({ claimed: 1, expired: 1, retried: 0 })
    const [recoveredRow] = await db.select().from(supportAttachmentUpload).where(eq(supportAttachmentUpload.id, id))
    expect(recoveredRow.status).toBe('expired')
    expect(recoveredRow.finalStorageKey).toBeNull()
    expect(recoveredRow.tempDeletedAt).toBeTruthy()
    expect(recoveredRow.cleanupLastError).toBeNull()
  })

  it('does not let an expired worker complete after a newer claim', async () => {
    const id = await upload('pending')
    let release!: () => void
    let started!: () => void
    const paused = new Promise<void>((resolve) => { release = resolve })
    const deleteStarted = new Promise<void>((resolve) => { started = resolve })
    const originalDelete = storage.deleteObject.bind(storage)
    storage.deleteObject = async (key: string) => { started(); await paused; return originalDelete(key) }
    const run = runAttachmentCleanup({ now, storage, maxBatch: 1 })
    await deleteStarted
    await db.update(supportAttachmentUpload).set({ finalizeLeaseExpiresAt: new Date(now.getTime() + 120_000) }).where(eq(supportAttachmentUpload.id, id))
    release()
    const result = await run
    storage.deleteObject = originalDelete
    expect(result.expired).toBe(0)
    const [row] = await db.select().from(supportAttachmentUpload).where(eq(supportAttachmentUpload.id, id))
    expect(row.status).toBe('pending')
    expect(row.finalizeLeaseExpiresAt).not.toBeNull()
  })

  it('never double-claims concurrent cleanup passes', async () => {
    const id = await upload('pending')
    await Promise.all([
      runAttachmentCleanup({ now, storage, maxBatch: 1 }),
      runAttachmentCleanup({ now, storage, maxBatch: 1 }),
    ])
    expect(storage.deletes.filter((key) => key.includes(id)).length).toBe(1)
  })

  it('never claims more than the configured batch', async () => {
    await Promise.all([upload('pending'), upload('pending'), upload('pending')])
    const result = await runAttachmentCleanup({ now, storage, maxBatch: 2 })
    expect(result.claimed).toBe(2)
    const remaining = await db
      .select()
      .from(supportAttachmentUpload)
      .where(
        and(
          eq(supportAttachmentUpload.conversationId, ids.conversation),
          eq(supportAttachmentUpload.status, 'pending')
        )
      )
    expect(remaining).toHaveLength(1)
  })
})
