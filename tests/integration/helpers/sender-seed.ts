import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'

import { db } from '../../../server/database/drizzle'
import { organization, user } from '../../../server/database/schema/auth'
import { project } from '../../../server/database/schema/feedback'
import {
  contact,
  conversation,
  conversationMessage,
  supportInbox,
  supportOutboundDelivery,
  supportSendingDomain,
} from '../../../server/database/schema/support'

/**
 * Seed helpers for the sender-enforcement integration suites. Every row is
 * reachable from one organization, so a single delete in `afterAll` cascades.
 */

export interface SeededProject {
  orgId: string
  projectId: string
  projectSlug: string
  userId: string
  inboxId: string
  inboxSlug: string
  contactId: string
  conversationId: string
  emailAddress: string
}

export async function seedOrganization(label: string): Promise<string> {
  const orgId = `${label}_org_${randomUUID()}`
  await db.insert(organization).values({
    id: orgId,
    name: `${label} org`,
    slug: `${label}-${randomUUID()}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return orgId
}

export async function seedProjectWithInbox(orgId: string, label: string, emailAddress: string): Promise<SeededProject> {
  const now = new Date()
  const projectId = `${label}_project_${randomUUID()}`
  const projectSlug = `${label}-${randomUUID().slice(0, 8)}`
  const userId = `${label}_user_${randomUUID()}`
  const inboxId = `${label}_inbox_${randomUUID()}`
  const inboxSlug = `${label}-inbox`
  const contactId = `${label}_contact_${randomUUID()}`
  const conversationId = `${label}_conv_${randomUUID()}`

  await db.insert(project).values({ id: projectId, name: `${label} project`, slug: projectSlug, organizationId: orgId })
  await db.insert(user).values({
    id: userId,
    name: `${label} agent`,
    email: `${label}-${randomUUID()}@example.com`,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(supportInbox).values({
    id: inboxId,
    projectId,
    name: `${label} inbox`,
    slug: inboxSlug,
    emailAddress,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(contact).values({
    id: contactId,
    projectId,
    name: 'Customer',
    email: `customer-${randomUUID()}@example.org`,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(conversation).values({
    id: conversationId,
    inboxId,
    projectId,
    contactId,
    displayId: 1,
    status: 'open',
    createdAt: now,
    updatedAt: now,
  })

  return { orgId, projectId, projectSlug, userId, inboxId, inboxSlug, contactId, conversationId, emailAddress }
}

/** Insert a claim. `verified` by default, matching the provider named in the options. */
export async function seedSendingDomain(input: {
  projectId: string
  domain: string
  status?: string
  provider?: string
  providerAccountKey?: string
  receivesViaProvider?: boolean
}) {
  const id = `sd_${randomUUID()}`
  await db.insert(supportSendingDomain).values({
    id,
    projectId: input.projectId,
    domain: input.domain,
    registrableDomain: input.domain.split('.').slice(-2).join('.'),
    status: input.status ?? 'verified',
    provider: input.provider ?? 'mailgun',
    providerAccountKey: input.providerAccountKey ?? 'acct',
    providerOwnership: 'created',
    providerState: input.status === 'verified' || input.status === undefined ? 'active' : 'unverified',
    receivesViaProvider: input.receivesViaProvider ?? false,
    ownershipToken: randomUUID(),
    ownershipVerifiedAt: input.status === 'verified' || input.status === undefined ? new Date() : null,
    verifiedAt: input.status === 'verified' || input.status === undefined ? new Date() : null,
  })
  return id
}

/** An outgoing message with a claimed outbox row (attempt 1, live lease), as the worker sees it. */
export async function seedQueuedDelivery(seed: SeededProject, from: string) {
  const messageId = `msg_${randomUUID()}`
  const deliveryId = `del_${randomUUID()}`
  const now = new Date()

  await db.insert(conversationMessage).values({
    id: messageId,
    conversationId: seed.conversationId,
    kind: 'outgoing',
    body: 'Hello',
    senderKind: 'agent',
    senderUserId: seed.userId,
    isPrivate: false,
    deliveryStatus: 'pending',
    createdAt: now,
  })
  await db.insert(supportOutboundDelivery).values({
    id: deliveryId,
    messageId,
    kind: 'email',
    payload: { to: 'customer@example.org', subject: 'Re: Hi', text: 'Hello', from: { address: from } },
    idempotencyKey: `idem_${randomUUID()}`,
    // As if claimed by the worker: the outcome update requires a live lease.
    attemptCount: 1,
    leaseExpiresAt: new Date(now.getTime() + 5 * 60_000),
    createdAt: now,
    updatedAt: now,
  })

  return {
    messageId,
    deliveryId,
    claim: {
      id: deliveryId,
      messageId,
      kind: 'email',
      payload: { to: 'customer@example.org', subject: 'Re: Hi', text: 'Hello', from: { address: from } },
      idempotencyKey: `idem_${randomUUID()}`,
      attemptCount: 1,
      provider: 'mailgun',
      providerAccountKey: 'acct',
    },
  }
}

export async function deleteOrganization(orgId: string) {
  await db.delete(organization).where(eq(organization.id, orgId))
}
