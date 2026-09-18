import { and, eq } from 'drizzle-orm'
import { sendStatusChangeNotificationEmail } from '~/lib/email'
import { db } from '~/server/database/drizzle'
import { contact, contactLink } from '~/server/database/schema/support'
import { notifyUser } from '~/server/utils/notifications'
import { createLogger } from '~/server/utils/logger'

const logger = createLogger('feedback-support-notifications')

/**
 * Notify each distinct support contact when feedback linked to their
 * conversation ships. Contact links are deliberately queried separately from
 * feedback subscriptions: subscriptions belong to board viewers, while a
 * support contact may never have visited the board. The actual email and
 * in-app dispatchers remain the existing feedback notification machinery.
 */
export async function notifyLinkedFeedbackContacts(params: {
  feedbackId: string
  feedbackTitle: string
  projectId: string
  status: string
  subscribedEmails?: ReadonlySet<string>
  actorUserId: string | null
  actorName: string | null
}) {
  if (params.status !== 'completed') return

  try {
    const links = await db
      .select({ contactId: contact.id, email: contact.email, userId: contact.userId })
      .from(contactLink)
      .innerJoin(contact, eq(contact.id, contactLink.contactId))
      .where(and(eq(contactLink.entityType, 'feedback'), eq(contactLink.entityId, params.feedbackId)))

    const contacts = new Map<string, { email: string | null; userId: string | null }>()
    for (const link of links) {
      if (!contacts.has(link.contactId)) contacts.set(link.contactId, { email: link.email, userId: link.userId })
    }

    const baseUrl = process.env.BETTER_AUTH_URL || 'http://localhost:3000'
    await Promise.allSettled(
      [...contacts.values()].map(async (linkedContact) => {
        const notification = {
          title: `Feedback shipped: ${params.feedbackTitle}`,
          body: params.feedbackTitle,
          link: `/feedback/${params.feedbackId}`,
          feedbackId: params.feedbackId,
          projectId: params.projectId,
          actorUserId: params.actorUserId || undefined,
          actorName: params.actorName || undefined,
        }

        const deliveries: Promise<unknown>[] = []
        if (linkedContact.userId) {
          deliveries.push(
            notifyUser(linkedContact.userId, {
              type: 'status_change',
              ...notification,
            })
          )
        }
        if (linkedContact.email && !params.subscribedEmails?.has(linkedContact.email.trim().toLowerCase())) {
          deliveries.push(
            sendStatusChangeNotificationEmail({
              to: linkedContact.email,
              feedbackTitle: params.feedbackTitle,
              newStatus: params.status,
              boardUrl: baseUrl,
              unsubscribeUrl: null,
            })
          )
        }
        await Promise.allSettled(deliveries)
      })
    )
  } catch (error) {
    logger.error('Failed to notify contacts linked to feedback', {
      feedbackId: params.feedbackId,
      error: error instanceof Error ? error.message : error,
    })
  }
}
