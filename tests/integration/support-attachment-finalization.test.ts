import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../../server/database/drizzle'
import { organization, team, user } from '../../server/database/schema/auth'
import {
  contact,
  conversation,
  conversationAttachment,
  conversationMessage,
  supportAttachmentUpload,
  supportInbox,
  supportInboxMember,
  supportOutboundDelivery,
} from '../../server/database/schema/support'
import {
  commitMessageWithAttachments,
  markAttachmentCleanupRequired,
  reserveAttachmentFinalization,
  type AttachmentFinalizationReservation,
} from '../../server/utils/support-attachment-finalization'
import type { StorageObjectMetadata, StorageProvider } from '../../server/utils/storage/types'

const orgId = `finalization_org_${randomUUID()}`
const teamId = `finalization_team_${randomUUID()}`
const inboxId = `finalization_inbox_${randomUUID()}`
const userId = `finalization_user_${randomUUID()}`
const otherUserId = `finalization_other_user_${randomUUID()}`
const contactId = `finalization_contact_${randomUUID()}`
const conversationId = `finalization_conversation_${randomUUID()}`
const now = new Date('2026-08-27T10:00:00.000Z')

type StoredObject = StorageObjectMetadata & { key: string }

class FakeStorage implements StorageProvider {
  driver: 'local' | 's3' = 'local'
  readonly directUploadConstraints = 'proxy-required' as const
  readonly objects = new Map<string, StoredObject>()
  readonly copies: Array<{ source: string; destination: string; ifMatch: string; contentType: string }> = []
  beforeCopy?: () => Promise<void>
  copyAttempts = 0
  failCopyAt: number | null = null
  destinationMetadataOverride?: Partial<StorageObjectMetadata>

  add(key: string, metadata: Omit<StoredObject, 'key'>) {
    this.objects.set(key, { key, ...metadata })
  }

  async getPresignedUploadTarget() {
    return { uploadUrl: '/unused', method: 'PUT' as const, headers: {} }
  }

  async putObject() {}

  async headObject(key: string) {
    const object = this.objects.get(key)
    if (!object) throw new Error('object missing')
    return object
  }

  async copyObject(sourceKey: string, destinationKey: string, options: { contentType: string; ifMatch: string }) {
    await this.beforeCopy?.()
    this.copyAttempts++
    if (this.failCopyAt === this.copyAttempts) throw new Error('copy failed')
    const source = await this.headObject(sourceKey)
    if (source.objectVersion !== options.ifMatch) throw new Error('conditional copy rejected')
    this.copies.push({
      source: sourceKey,
      destination: destinationKey,
      ifMatch: options.ifMatch,
      contentType: options.contentType,
    })
    const copied = {
      key: destinationKey,
      sizeBytes: source.sizeBytes,
      contentType: options.contentType,
      objectVersion: `final-${source.objectVersion}`,
      ...this.destinationMetadataOverride,
    }
    this.objects.set(destinationKey, copied)
    return copied
  }

  async getObject() {
    return Buffer.from('unused')
  }
  async deleteObject(key: string) {
    this.objects.delete(key)
  }
  getPublicUrl(key: string) {
    return `/objects/${key}`
  }
}

const storage = new FakeStorage()

beforeAll(async () => {
  await db
    .insert(organization)
    .values({
      id: orgId,
      name: 'Finalization Org',
      slug: `finalization-${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
    })
  await db
    .insert(team)
    .values({
      id: teamId,
      name: 'Finalization Team',
      slug: `finalization-team-${randomUUID()}`,
      organizationId: orgId,
      createdAt: now,
      updatedAt: now,
    })
  await db.insert(user).values([
    {
      id: userId,
      name: 'Agent',
      email: `finalization-agent-${randomUUID()}@example.com`,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: otherUserId,
      name: 'Other Agent',
      email: `finalization-other-${randomUUID()}@example.com`,
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db
    .insert(supportInbox)
    .values({
      id: inboxId,
      teamId,
      name: 'Finalization Inbox',
      slug: `finalization-inbox-${randomUUID()}`,
      emailAddress: 'support@example.com',
      createdAt: now,
      updatedAt: now,
    })
  await db
    .insert(supportInboxMember)
    .values({ id: `finalization_member_${randomUUID()}`, inboxId, userId, role: 'agent', createdAt: now })
  await db
    .insert(contact)
    .values({ id: contactId, teamId, name: 'Customer', email: 'customer@example.com', createdAt: now, updatedAt: now })
  await db
    .insert(conversation)
    .values({
      id: conversationId,
      inboxId,
      teamId,
      contactId,
      displayId: 9901,
      subject: 'Finalization',
      status: 'open',
      createdAt: now,
      updatedAt: now,
    })
})

afterAll(async () => {
  await db.delete(organization).where(eq(organization.id, orgId))
  await db.delete(user).where(inArray(user.id, [userId, otherUserId]))
})

beforeEach(() => {
  storage.driver = 'local'
  storage.beforeCopy = undefined
  storage.copyAttempts = 0
  storage.failCopyAt = null
  storage.destinationMetadataOverride = undefined
  storage.copies.length = 0
})

async function createUpload(overrides: Partial<typeof supportAttachmentUpload.$inferInsert> = {}) {
  const id = overrides.id ?? `upload_${randomUUID()}`
  const tempStorageKey = overrides.tempStorageKey ?? `support/attachments/uploads/${id}/file.txt`
  const version = overrides.objectVersion ?? `version-${id}`
  const sizeBytes = overrides.actualSizeBytes ?? overrides.requestedSizeBytes ?? 10
  storage.add(tempStorageKey, { sizeBytes, contentType: 'text/plain', objectVersion: version })
  await db.insert(supportAttachmentUpload).values({
    id,
    conversationId,
    userId,
    tempStorageKey,
    fileName: 'file.txt',
    requestedContentType: 'text/plain',
    requestedSizeBytes: sizeBytes,
    storedContentType: 'text/plain',
    actualSizeBytes: sizeBytes,
    objectVersion: version,
    status: 'uploaded',
    expiresAt: new Date(now.getTime() + 60_000),
    uploadedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  })
  return id
}

function outgoing(id: string) {
  return {
    channelMessageId: `message-${id}`,
    inReplyTo: null,
    referencesForStorage: null,
    deliveryPayload: {
      to: 'customer@example.com',
      subject: 'Re: Finalization',
      text: 'Reply',
      attachments: [{ filename: 'client-name.txt', contentType: 'text/plain', storageKey: 'client-controlled-key' }],
    },
  }
}

async function commit(
  reservation: AttachmentFinalizationReservation[],
  id = `message_${randomUUID()}`,
  outgoingReply = outgoing(id),
  commitAt: Date | null = now
) {
  const [existing] = await db.select().from(conversation).where(eq(conversation.id, conversationId))
  return commitMessageWithAttachments({
    reservation,
    conversationId,
    userId,
    ...(commitAt ? { now: commitAt } : {}),
    existingConversation: existing,
    outgoing: outgoingReply,
    message: {
      id,
      kind: 'outgoing',
      body: 'Reply',
      bodyHtml: null,
      isPrivate: false,
      channelMessageId: `message-${id}`,
      inReplyTo: null,
      channelHeaders: null,
      deliveryStatus: 'pending',
    },
  })
}

describe('durable support attachment finalization (real Postgres)', () => {
  it('reserves before copy, conditionally copies, and atomically consumes canonical references', async () => {
    const uploadId = await createUpload()
    storage.beforeCopy = async () => {
      const [row] = await db
        .select({ status: supportAttachmentUpload.status })
        .from(supportAttachmentUpload)
        .where(eq(supportAttachmentUpload.id, uploadId))
      expect(row.status).toBe('finalizing')
    }
    const reservation = await reserveAttachmentFinalization({
      uploadIds: [uploadId],
      conversationId,
      userId,
      now,
      storage,
    })
    storage.beforeCopy = undefined
    const message = await commit(reservation)
    const [upload] = await db.select().from(supportAttachmentUpload).where(eq(supportAttachmentUpload.id, uploadId))
    const [attachment] = await db
      .select()
      .from(conversationAttachment)
      .where(eq(conversationAttachment.messageId, message.id))
    const [delivery] = await db
      .select()
      .from(supportOutboundDelivery)
      .where(eq(supportOutboundDelivery.messageId, message.id))
    expect(upload.status).toBe('consumed')
    expect(upload.messageId).toBe(message.id)
    expect(attachment.storageKey).toBe(upload.finalStorageKey)
    expect(delivery.payload).not.toHaveProperty('bytes')
    expect(JSON.stringify(delivery.payload)).not.toContain(upload.tempStorageKey)
    expect((delivery.payload as { attachments: Array<{ storageKey: string }> }).attachments[0].storageKey).toBe(
      upload.finalStorageKey
    )
    expect(JSON.stringify(delivery.payload)).not.toContain('client-controlled-key')
    expect(storage.copies).toEqual([
      {
        source: upload.tempStorageKey,
        destination: upload.finalStorageKey,
        ifMatch: upload.objectVersion,
        contentType: upload.storedContentType,
      },
    ])
  })

  it('rejects duplicate, foreign, unavailable, missing metadata, and over-total reservations without disclosing uploads', async () => {
    const duplicate = await createUpload()
    await expect(
      reserveAttachmentFinalization({ uploadIds: [duplicate, duplicate], conversationId, userId, now, storage })
    ).rejects.toMatchObject({ statusCode: 400 })
    const foreign = await createUpload({ userId: otherUserId })
    await expect(
      reserveAttachmentFinalization({ uploadIds: [foreign], conversationId, userId, now, storage })
    ).rejects.toMatchObject({ statusCode: 404 })
    const wrongConversation = await createUpload()
    await expect(
      reserveAttachmentFinalization({
        uploadIds: [wrongConversation],
        conversationId: 'another-conversation',
        userId,
        now,
        storage,
      })
    ).rejects.toMatchObject({ statusCode: 404 })
    const pending = await createUpload({
      status: 'pending',
      storedContentType: null,
      actualSizeBytes: null,
      objectVersion: null,
    })
    await expect(
      reserveAttachmentFinalization({ uploadIds: [pending], conversationId, userId, now, storage })
    ).rejects.toMatchObject({ statusCode: 409 })
    const expired = await createUpload({ expiresAt: new Date(now.getTime() - 1) })
    await expect(
      reserveAttachmentFinalization({ uploadIds: [expired], conversationId, userId, now, storage })
    ).rejects.toMatchObject({ statusCode: 409 })
    for (const status of ['consumed', 'cleanup_required', 'finalizing'] as const) {
      const unavailable = await createUpload({
        status,
        finalizeLeaseExpiresAt: status === 'finalizing' ? new Date(now.getTime() + 60_000) : null,
      })
      await expect(
        reserveAttachmentFinalization({ uploadIds: [unavailable], conversationId, userId, now, storage })
      ).rejects.toMatchObject({ statusCode: 409 })
    }
    const staleFinalizing = await createUpload({
      status: 'finalizing',
      finalStorageKey: 'support/attachments/outbound/stale/file.txt',
      finalizeLeaseExpiresAt: new Date(now.getTime() - 1),
    })
    await expect(
      reserveAttachmentFinalization({ uploadIds: [staleFinalizing], conversationId, userId, now, storage })
    ).rejects.toMatchObject({ statusCode: 409 })
    const oversized = await createUpload({ actualSizeBytes: 10 * 1024 * 1024 + 1 })
    await expect(
      reserveAttachmentFinalization({ uploadIds: [oversized], conversationId, userId, now, storage })
    ).rejects.toMatchObject({ statusCode: 409 })
    const missingMetadata = await createUpload({ storedContentType: null, actualSizeBytes: null, objectVersion: null })
    await expect(
      reserveAttachmentFinalization({ uploadIds: [missingMetadata], conversationId, userId, now, storage })
    ).rejects.toMatchObject({ statusCode: 409 })
    const total = await Promise.all([
      createUpload({ actualSizeBytes: 10 * 1024 * 1024 }),
      createUpload({ actualSizeBytes: 10 * 1024 * 1024 }),
      createUpload({ actualSizeBytes: 6 * 1024 * 1024 }),
    ])
    await expect(
      reserveAttachmentFinalization({ uploadIds: total, conversationId, userId, now, storage })
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('fails closed on changed source or partial copy and durably requires cleanup', async () => {
    const changed = await createUpload()
    storage.objects.get(`support/attachments/uploads/${changed}/file.txt`)!.objectVersion = 'changed'
    await expect(
      reserveAttachmentFinalization({ uploadIds: [changed], conversationId, userId, now, storage })
    ).rejects.toThrow('Attachment source changed')
    const [changedRow] = await db.select().from(supportAttachmentUpload).where(eq(supportAttachmentUpload.id, changed))
    expect(changedRow.status).toBe('cleanup_required')

    const localWithoutHeadType = await createUpload()
    storage.objects.get(`support/attachments/uploads/${localWithoutHeadType}/file.txt`)!.contentType = null
    const localReservation = await reserveAttachmentFinalization({
      uploadIds: [localWithoutHeadType],
      conversationId,
      userId,
      now,
      storage,
    })
    await markAttachmentCleanupRequired(localReservation, 'test cleanup')

    const s3WithoutHeadType = await createUpload()
    storage.objects.get(`support/attachments/uploads/${s3WithoutHeadType}/file.txt`)!.contentType = null
    storage.driver = 's3'
    await expect(
      reserveAttachmentFinalization({ uploadIds: [s3WithoutHeadType], conversationId, userId, now, storage })
    ).rejects.toThrow('Attachment source changed')
    storage.driver = 'local'
    const [s3WithoutHeadTypeRow] = await db
      .select()
      .from(supportAttachmentUpload)
      .where(eq(supportAttachmentUpload.id, s3WithoutHeadType))
    expect(s3WithoutHeadTypeRow.status).toBe('cleanup_required')

    const missing = await createUpload()
    storage.objects.delete(`support/attachments/uploads/${missing}/file.txt`)
    await expect(
      reserveAttachmentFinalization({ uploadIds: [missing], conversationId, userId, now, storage })
    ).rejects.toThrow('Attachment source is unavailable')
    const [missingRow] = await db.select().from(supportAttachmentUpload).where(eq(supportAttachmentUpload.id, missing))
    expect(missingRow.status).toBe('cleanup_required')

    const badDestination = await createUpload()
    storage.destinationMetadataOverride = { contentType: 'application/pdf' }
    await expect(
      reserveAttachmentFinalization({ uploadIds: [badDestination], conversationId, userId, now, storage })
    ).rejects.toThrow('Attachment destination metadata is invalid')
    storage.destinationMetadataOverride = undefined
    const [badDestinationRow] = await db
      .select()
      .from(supportAttachmentUpload)
      .where(eq(supportAttachmentUpload.id, badDestination))
    expect(badDestinationRow.status).toBe('cleanup_required')

    const partialA = await createUpload()
    const partialB = await createUpload()
    storage.copyAttempts = 0
    storage.failCopyAt = 2
    await expect(
      reserveAttachmentFinalization({ uploadIds: [partialA, partialB], conversationId, userId, now, storage })
    ).rejects.toThrow('copy failed')
    storage.failCopyAt = null
    const rows = await db
      .select()
      .from(supportAttachmentUpload)
      .where(inArray(supportAttachmentUpload.id, [partialA, partialB]))
    expect(rows.every((row) => row.status === 'cleanup_required')).toBe(true)
    const byId = new Map(rows.map((row) => [row.id, row]))
    expect(storage.objects.has(byId.get(partialA)!.finalStorageKey!)).toBe(true)
    expect(storage.objects.has(byId.get(partialB)!.finalStorageKey!)).toBe(false)
    expect(await db.select().from(conversationMessage).where(eq(conversationMessage.id, 'never-created'))).toHaveLength(
      0
    )
  })

  it('allows reuse only after cleanup explicitly restores an unexpired upload', async () => {
    const uploadId = await createUpload()
    await db
      .update(supportAttachmentUpload)
      .set({ status: 'cleanup_required', finalizeLeaseExpiresAt: null })
      .where(eq(supportAttachmentUpload.id, uploadId))
    await expect(
      reserveAttachmentFinalization({ uploadIds: [uploadId], conversationId, userId, now, storage })
    ).rejects.toMatchObject({ statusCode: 409 })
    await db
      .update(supportAttachmentUpload)
      .set({ status: 'uploaded', finalStorageKey: null, tempDeletedAt: null, updatedAt: now })
      .where(eq(supportAttachmentUpload.id, uploadId))
    const reservation = await reserveAttachmentFinalization({
      uploadIds: [uploadId],
      conversationId,
      userId,
      now,
      storage,
    })
    expect(reservation).toHaveLength(1)
    await markAttachmentCleanupRequired(reservation, 'test cleanup')
  })

  it('serializes concurrent reuse of one uploaded row so only one request can reserve it', async () => {
    const uploadId = await createUpload()
    const results = await Promise.allSettled([
      reserveAttachmentFinalization({ uploadIds: [uploadId], conversationId, userId, now, storage }),
      reserveAttachmentFinalization({ uploadIds: [uploadId], conversationId, userId, now, storage }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const winner = results.find(
      (result): result is PromiseFulfilledResult<AttachmentFinalizationReservation[]> => result.status === 'fulfilled'
    )!
    await markAttachmentCleanupRequired(winner.value, 'test cleanup')
  })

  it('uses one stable lock order for reversed overlapping upload sets', async () => {
    const first = await createUpload()
    const second = await createUpload()
    const results = await Promise.allSettled([
      reserveAttachmentFinalization({ uploadIds: [first, second], conversationId, userId, now, storage }),
      reserveAttachmentFinalization({ uploadIds: [second, first], conversationId, userId, now, storage }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const winner = results.find(
      (result): result is PromiseFulfilledResult<AttachmentFinalizationReservation[]> => result.status === 'fulfilled'
    )!
    await markAttachmentCleanupRequired(winner.value, 'test cleanup')
  })

  it('rechecks upload expiry after waiting for the reservation row lock', async () => {
    const uploadId = await createUpload({ expiresAt: new Date(Date.now() + 150) })
    let releaseLock!: () => void
    let reportLocked!: () => void
    const release = new Promise<void>((resolve) => { releaseLock = resolve })
    const locked = new Promise<void>((resolve) => { reportLocked = resolve })
    const blocker = db.transaction(async (tx) => {
      await tx.select().from(supportAttachmentUpload).where(eq(supportAttachmentUpload.id, uploadId)).for('update')
      reportLocked()
      await release
    })
    await locked

    const attempt = reserveAttachmentFinalization({ uploadIds: [uploadId], conversationId, userId, storage })
    await new Promise((resolve) => setTimeout(resolve, 250))
    releaseLock()
    await blocker

    await expect(attempt).rejects.toMatchObject({ statusCode: 409 })
  })

  it('does not commit with an expired finalization lease and preserves cleanup state on rollback', async () => {
    const uploadId = await createUpload()
    const reservation = await reserveAttachmentFinalization({
      uploadIds: [uploadId],
      conversationId,
      userId,
      now,
      storage,
    })
    await db
      .update(supportAttachmentUpload)
      .set({ finalizeLeaseExpiresAt: new Date(now.getTime() - 1) })
      .where(eq(supportAttachmentUpload.id, uploadId))
    await expect(commit(reservation, 'rollback-message')).rejects.toMatchObject({ statusCode: 409 })
    const [upload] = await db.select().from(supportAttachmentUpload).where(eq(supportAttachmentUpload.id, uploadId))
    expect(upload.status).toBe('cleanup_required')
    expect(
      await db.select().from(conversationMessage).where(eq(conversationMessage.id, 'rollback-message'))
    ).toHaveLength(0)
  })

  it('rechecks the finalization lease after waiting for the commit row lock', async () => {
    const uploadId = await createUpload({ expiresAt: new Date(Date.now() + 60_000) })
    const reservation = await reserveAttachmentFinalization({ uploadIds: [uploadId], conversationId, userId, storage })
    const shortLease = new Date(Date.now() + 150)
    reservation[0].leaseExpiresAt = shortLease
    await db
      .update(supportAttachmentUpload)
      .set({ finalizeLeaseExpiresAt: shortLease })
      .where(eq(supportAttachmentUpload.id, uploadId))

    let releaseLock!: () => void
    let reportLocked!: () => void
    const release = new Promise<void>((resolve) => { releaseLock = resolve })
    const locked = new Promise<void>((resolve) => { reportLocked = resolve })
    const blocker = db.transaction(async (tx) => {
      await tx.select().from(supportAttachmentUpload).where(eq(supportAttachmentUpload.id, uploadId)).for('update')
      reportLocked()
      await release
    })
    await locked

    const messageId = `lease_wait_${randomUUID()}`
    const attempt = commit(reservation, messageId, outgoing(messageId), null)
    await new Promise((resolve) => setTimeout(resolve, 250))
    releaseLock()
    await blocker

    await expect(attempt).rejects.toMatchObject({ statusCode: 409 })
    expect(await db.select().from(conversationMessage).where(eq(conversationMessage.id, messageId))).toHaveLength(0)
    const [upload] = await db.select().from(supportAttachmentUpload).where(eq(supportAttachmentUpload.id, uploadId))
    expect(upload.status).toBe('cleanup_required')
  })

  it('rolls back message, attachments, and outbox when a late transaction write fails', async () => {
    const uploadId = await createUpload()
    const reservation = await reserveAttachmentFinalization({ uploadIds: [uploadId], conversationId, userId, now, storage })
    const messageId = `rollback_late_${randomUUID()}`
    const invalidOutgoing = outgoing(messageId)
    ;(invalidOutgoing.deliveryPayload as Record<string, unknown>).unserializable = 1n

    await expect(commit(reservation, messageId, invalidOutgoing)).rejects.toThrow()
    expect(await db.select().from(conversationMessage).where(eq(conversationMessage.id, messageId))).toHaveLength(0)
    expect(await db.select().from(conversationAttachment).where(eq(conversationAttachment.messageId, messageId))).toHaveLength(0)
    expect(await db.select().from(supportOutboundDelivery).where(eq(supportOutboundDelivery.messageId, messageId))).toHaveLength(0)
    const [upload] = await db.select().from(supportAttachmentUpload).where(eq(supportAttachmentUpload.id, uploadId))
    expect(upload.status).toBe('cleanup_required')
    expect(upload.finalStorageKey).toBe(reservation[0].finalStorageKey)
  })
})
