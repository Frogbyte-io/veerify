import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { db } from '~/server/database/drizzle'
import { contact, contactIdentity, conversationParticipant } from '~/server/database/schema/support'
import type { InboundAddress } from '~/server/services/support-channels/types'

/**
 * Contact and CC-participant resolution for inbound mail (SUP-03-11).
 *
 * Identity, not the `contact.email` column, is the lookup key: `contactIdentity`
 * is unique on `(teamId, kind, value)` and is what Stage 01 built so a contact
 * can be known by several addresses. Matching on `contact.email` instead would
 * open a second ticket for someone who wrote from their alias.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** How many tombstones to follow before giving up. Chains are one deep in practice. */
const MAX_MERGE_DEPTH = 10

/**
 * Follow `mergedIntoContactId` to the surviving contact.
 *
 * Contact merge tombstones the loser rather than deleting it, so an identity
 * row can still point at a merged-away contact. Landing mail on the tombstone
 * would file it under a contact the agent UI treats as gone. Bounded because a
 * cycle here would otherwise hang the request.
 */
async function resolveSurvivor(tx: Tx, contactId: string): Promise<string> {
  let current = contactId

  for (let depth = 0; depth < MAX_MERGE_DEPTH; depth++) {
    const [row] = await tx
      .select({ mergedIntoContactId: contact.mergedIntoContactId })
      .from(contact)
      .where(eq(contact.id, current))
      .limit(1)

    if (!row?.mergedIntoContactId) return current
    current = row.mergedIntoContactId
  }

  return current
}

/**
 * Find the contact behind an inbound address, creating one if this is the
 * first time the team has heard from them.
 *
 * Runs inside the caller's transaction so a partially-created contact cannot
 * outlive a failed message insert.
 */
export async function resolveOrCreateContact(
  tx: Tx,
  teamId: string,
  address: InboundAddress
): Promise<{ contactId: string; created: boolean }> {
  const email = address.address.trim().toLowerCase()

  const [identity] = await tx
    .select({ contactId: contactIdentity.contactId })
    .from(contactIdentity)
    .where(and(eq(contactIdentity.teamId, teamId), eq(contactIdentity.kind, 'email'), eq(contactIdentity.value, email)))
    .limit(1)

  if (identity) {
    return { contactId: await resolveSurvivor(tx, identity.contactId), created: false }
  }

  const contactId = randomUUID()
  const now = new Date()
  const name = address.name?.trim() || null

  await tx.insert(contact).values({
    id: contactId,
    teamId,
    name,
    email,
    createdAt: now,
    updatedAt: now,
  })

  await tx.insert(contactIdentity).values({
    id: randomUUID(),
    contactId,
    teamId,
    kind: 'email',
    value: email,
    // Deliberately not verified: the From header is trivially forgeable, and
    // Stage 01 uses `verifiedAt` to mean the address was actually proven.
    createdAt: now,
  })

  return { contactId, created: true }
}

/**
 * Add the CC'd addresses of an inbound message as conversation participants.
 *
 * `ownAddresses` are the inbox's own receiving addresses, which must be
 * excluded — a support address CC'd on its own thread would otherwise become a
 * "customer" contact and then appear as a participant on every conversation.
 *
 * The sender is excluded too: they are the conversation's contact, not a CC.
 */
export async function resolveCcParticipants(
  tx: Tx,
  input: {
    conversationId: string
    teamId: string
    cc: InboundAddress[]
    senderContactId: string
    ownAddresses: Set<string>
  }
): Promise<string[]> {
  const seen = new Set<string>()
  const added: string[] = []

  for (const address of input.cc) {
    const email = address.address.trim().toLowerCase()
    if (!email || seen.has(email) || input.ownAddresses.has(email)) continue
    seen.add(email)

    const { contactId } = await resolveOrCreateContact(tx, input.teamId, { ...address, address: email })
    if (contactId === input.senderContactId) continue

    // `conversationParticipant` is unique on (conversationId, contactId), so a
    // repeated CC across a thread is absorbed here rather than erroring.
    const inserted = await tx
      .insert(conversationParticipant)
      .values({
        id: randomUUID(),
        conversationId: input.conversationId,
        contactId,
        userId: null,
        role: 'cc',
        createdAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: conversationParticipant.id })

    if (inserted.length > 0) added.push(contactId)
  }

  return added
}
