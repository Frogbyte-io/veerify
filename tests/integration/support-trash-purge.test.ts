import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { db } from '../../server/database/drizzle'
import { organization, user } from '../../server/database/schema/auth'
import { project } from '../../server/database/schema/feedback'
import {
  contact,
  conversation,
  conversationAttachment,
  conversationMessage,
  supportAttachmentUpload,
  supportInbox,
} from '../../server/database/schema/support'
import { runTrashPurge } from '../../server/utils/support-trash'
import type { StorageObjectMetadata, StorageProvider } from '../../server/utils/storage/types'

const run = randomUUID()
const ids = {
  org: `purge_org_${run}`,
  project: `purge_project_${run}`,
  inbox: `purge_inbox_${run}`,
  user: `purge_user_${run}`,
  contact: `purge_contact_${run}`,
}
const now = new Date('2026-10-29T10:00:00.000Z')
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
let displayId = 700000

class FakeStorage implements StorageProvider {
  driver = 'local' as const
  readonly directUploadConstraints = 'proxy-required' as const
  readonly failed = new Set<string>()
  deletes: string[] = []
  async getPresignedUploadTarget() {
    return { uploadUrl: '/unused', method: 'PUT' as const, headers: {} }
  }
  async putObject() {}
  async headObject(): Promise<StorageObjectMetadata> {
    return { sizeBytes: 1, contentType: 'text/plain', objectVersion: 'v1' }
  }
  async copyObject(): Promise<StorageObjectMetadata> {
    return { sizeBytes: 1, contentType: 'text/plain', objectVersion: 'v1' }
  }
  async getObject() {
    return Buffer.from('unused')
  }
  async deleteObject(key: string) {
    this.deletes.push(key)
    if (this.failed.has(key)) throw new Error('provider unavailable')
  }
  getPublicUrl(key: string) {
    return `/objects/${key}`
  }
}

const created: string[] = []

async function makeConversation(overrides: Partial<typeof conversation.$inferInsert> = {}) {
  const id = `purge_conversation_${randomUUID()}`
  created.push(id)
  await db.insert(conversation).values({
    id,
    inboxId: ids.inbox,
    projectId: ids.project,
    contactId: ids.contact,
    displayId: displayId++,
    subject: 'Purge',
    status: 'open',
    ...overrides,
  })
  return id
}

async function exists(id: string) {
  const rows = await db.select({ id: conversation.id }).from(conversation).where(eq(conversation.id, id))
  return rows.length === 1
}

beforeAll(async () => {
  await db.insert(organization).values({ id: ids.org, name: 'Purge Org', slug: `purge-${run}` })
  await db.insert(project).values({
    id: ids.project,
    name: 'Purge Project',
    slug: `purge-project-${run}`,
    organizationId: ids.org,
  })
  await db.insert(user).values({ id: ids.user, name: 'Purge Agent', email: `purge-${run}@example.com` })
  await db.insert(supportInbox).values({
    id: ids.inbox,
    projectId: ids.project,
    name: 'Purge Inbox',
    slug: `purge-inbox-${run}`,
    emailAddress: `purge-${run}@example.com`,
  })
  await db.insert(contact).values({
    id: ids.contact,
    projectId: ids.project,
    name: 'Purge Customer',
    email: `purge-customer-${run}@example.com`,
  })
})

afterAll(async () => {
  await db.delete(conversation).where(inArray(conversation.id, created))
  await db.delete(organization).where(eq(organization.id, ids.org))
  await db.delete(user).where(eq(user.id, ids.user))
})

describe('support trash purge (real Postgres)', () => {
  it('deletes only conversations trashed more than 30 days ago, with their messages and storage objects', async () => {
    const storage = new FakeStorage()
    const old = await makeConversation({ deletedAt: daysAgo(31) })
    const recent = await makeConversation({ deletedAt: daysAgo(29) })
    const live = await makeConversation()
    const spamOnly = await makeConversation({ spamAt: daysAgo(90) })

    const messageId = `purge_message_${randomUUID()}`
    await db.insert(conversationMessage).values({
      id: messageId,
      conversationId: old,
      kind: 'message',
      body: 'hello',
      senderKind: 'contact',
      createdAt: daysAgo(40),
    })
    const attachmentKey = `support/attachments/${randomUUID()}/report.pdf`
    await db.insert(conversationAttachment).values({
      id: `purge_attachment_${randomUUID()}`,
      messageId,
      storageKey: attachmentKey,
      fileName: 'report.pdf',
    })
    const tempKey = `support/attachments/uploads/${randomUUID()}/file.txt`
    const finalKey = `support/attachments/${randomUUID()}/file.txt`
    await db.insert(supportAttachmentUpload).values({
      id: `purge_upload_${randomUUID()}`,
      conversationId: old,
      userId: ids.user,
      tempStorageKey: tempKey,
      finalStorageKey: finalKey,
      fileName: 'file.txt',
      requestedContentType: 'text/plain',
      requestedSizeBytes: 1,
      status: 'consumed',
      expiresAt: daysAgo(40),
    })

    const result = await runTrashPurge({ now, storage })

    expect(result).toMatchObject({ purged: 1, retried: 0, objectsDeleted: 3 })
    expect(storage.deletes.sort()).toEqual([attachmentKey, finalKey, tempKey].sort())
    expect(await exists(old)).toBe(false)
    expect(await exists(recent)).toBe(true)
    expect(await exists(live)).toBe(true)
    expect(await exists(spamOnly)).toBe(true)
    const messages = await db.select().from(conversationMessage).where(eq(conversationMessage.conversationId, old))
    expect(messages).toEqual([])
    const attachments = await db
      .select()
      .from(conversationAttachment)
      .where(eq(conversationAttachment.messageId, messageId))
    expect(attachments).toEqual([])
  })

  it('keeps a conversation, and its attachment keys, when an object cannot be deleted', async () => {
    const storage = new FakeStorage()
    const stuck = await makeConversation({ deletedAt: daysAgo(45) })
    const messageId = `purge_message_${randomUUID()}`
    await db.insert(conversationMessage).values({
      id: messageId,
      conversationId: stuck,
      kind: 'message',
      body: 'hello',
      senderKind: 'contact',
    })
    const key = `support/attachments/${randomUUID()}/stuck.pdf`
    await db.insert(conversationAttachment).values({
      id: `purge_attachment_${randomUUID()}`,
      messageId,
      storageKey: key,
      fileName: 'stuck.pdf',
    })
    storage.failed.add(key)

    const failed = await runTrashPurge({ now, storage })
    expect(failed).toMatchObject({ purged: 0, retried: 1 })
    expect(await exists(stuck)).toBe(true)

    storage.failed.clear()
    const retried = await runTrashPurge({ now, storage })
    expect(retried.purged).toBe(1)
    expect(await exists(stuck)).toBe(false)
  })

  it('works in batches', async () => {
    const storage = new FakeStorage()
    const batch = [
      await makeConversation({ deletedAt: daysAgo(50) }),
      await makeConversation({ deletedAt: daysAgo(51) }),
      await makeConversation({ deletedAt: daysAgo(52) }),
    ]
    const first = await runTrashPurge({ now, storage, maxBatch: 2 })
    expect(first).toMatchObject({ claimed: 2, purged: 2 })
    const second = await runTrashPurge({ now, storage, maxBatch: 2 })
    expect(second).toMatchObject({ claimed: 1, purged: 1 })
    for (const id of batch) expect(await exists(id)).toBe(false)
  })
})
