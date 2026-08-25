import { randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
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
  const [settings] = await tx
    .select({ autoLinkFeedback: supportTeamSettings.autoLinkFeedback })
    .from(supportTeamSettings)
    .where(eq(supportTeamSettings.teamId, params.teamId))
    .limit(1)

  if (!settings?.autoLinkFeedback) {
    return { linked: false, contactId: null, reason: 'disabled' }
  }

  if (!params.authorUserId) {
    return { linked: false, contactId: null, reason: 'anonymous' }
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

  return inserted.length
    ? { linked: true, contactId, reason: 'linked' }
    : { linked: false, contactId: null, reason: 'none' }
}
