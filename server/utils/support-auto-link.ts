import { randomUUID } from 'node:crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { contact, contactLink, supportTeamSettings } from '~/server/database/schema/support'
import { feedback, project } from '~/server/database/schema/feedback'

type Transaction = Parameters<Parameters<typeof import('~/server/database/drizzle').db.transaction>[0]>[0]

export type AutomaticFeedbackLinkResult = {
  linked: boolean
  contactId: string | null
  reason: 'disabled' | 'anonymous' | 'none' | 'ambiguous' | 'linked'
}

export async function createAutomaticFeedbackLink(
  tx: Transaction,
  params: { teamId: string; feedbackId: string; authorUserId: string | null; createdAt: Date }
): Promise<AutomaticFeedbackLinkResult> {
  // Anonymous writes do not participate in automatic linking. Keep this
  // short-circuit before the policy read for direct callers as well as routes.
  if (!params.authorUserId) {
    return { linked: false, contactId: null, reason: 'anonymous' }
  }

  const [settings] = await tx
    .select({ autoLinkFeedback: supportTeamSettings.autoLinkFeedback })
    .from(supportTeamSettings)
    .where(eq(supportTeamSettings.teamId, params.teamId))
    .limit(1)

  if (!settings?.autoLinkFeedback) {
    return { linked: false, contactId: null, reason: 'disabled' }
  }

  const [feedbackInTeam] = await tx
    .select({ id: feedback.id })
    .from(feedback)
    .innerJoin(project, eq(project.id, feedback.projectId))
    .where(and(eq(feedback.id, params.feedbackId), eq(project.teamId, params.teamId)))
    .limit(1)

  if (!feedbackInTeam) {
    return { linked: false, contactId: null, reason: 'none' }
  }

  // Contact writes take ROW EXCLUSIVE table locks. A SHARE table lock makes
  // the candidate query and the link insert one serialized lifecycle: a
  // block, merge, delete, or new matching contact that already started waits
  // for this transaction, rather than changing the decision after the query.
  // Concurrent auto-link reads remain compatible because SHARE locks coexist.
  await tx.execute(sql`LOCK TABLE "contact" IN SHARE MODE`)

  const matches = await tx
    .select({ id: contact.id })
    .from(contact)
    .where(
      and(
        eq(contact.teamId, params.teamId),
        eq(contact.userId, params.authorUserId),
        isNull(contact.blockedAt),
        isNull(contact.mergedIntoContactId)
      )
    )
    .limit(2)

  if (matches.length === 0) {
    return { linked: false, contactId: null, reason: 'none' }
  }

  if (matches.length > 1) {
    return { linked: false, contactId: null, reason: 'ambiguous' }
  }

  const contactId = matches[0].id
  const inserted = await tx
    .insert(contactLink)
    .values({
      id: randomUUID(),
      contactId,
      entityType: 'feedback',
      entityId: params.feedbackId,
      source: 'auto',
      createdByUserId: null,
      createdAt: params.createdAt,
    })
    .onConflictDoNothing({ target: [contactLink.contactId, contactLink.entityType, contactLink.entityId] })
    .returning({ id: contactLink.id })

  if (inserted.length) return { linked: true, contactId, reason: 'linked' }

  // Another transaction may have won the unique insert. Report the resulting
  // state honestly: this attempt still resolves to the same linked contact.
  const [existing] = await tx
    .select({ contactId: contactLink.contactId })
    .from(contactLink)
    .where(
      and(
        eq(contactLink.contactId, contactId),
        eq(contactLink.entityType, 'feedback'),
        eq(contactLink.entityId, params.feedbackId)
      )
    )
    .limit(1)

  return existing
    ? { linked: true, contactId: existing.contactId, reason: 'linked' }
    : { linked: false, contactId: null, reason: 'none' }
}
