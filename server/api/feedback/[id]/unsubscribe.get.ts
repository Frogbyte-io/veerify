/**
 * @openapi
 * /api/feedback/{id}/unsubscribe:
 *   get:
 *     tags: [Feedback]
 *     summary: Unsubscribe via emailed link
 *     description: >
 *       Token-based; no session needed. Deletes the subscription that owns the token and redirects (302) to `/?unsubscribed=1`. Unknown tokens also redirect. Intended for email links, not for programmatic use.
 *     operationId: unsubscribeFeedbackByToken
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Feedback id
 *         schema: { type: string }
 *       - in: query
 *         name: token
 *         required: true
 *         description: Subscription token from the notification email
 *         schema: { type: string }
 *     responses:
 *       302: { description: "Redirect to /?unsubscribed=1" }
 *       400: { description: "Missing token" }
 */
import { eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { feedbackSubscription } from '~/server/database/schema/feedback'

export default defineEventHandler(async (event) => {
  const token = getQuery(event).token as string | undefined

  if (!token) {
    throw createError({ statusCode: 400, statusMessage: 'Missing token' })
  }

  const [sub] = await db.select().from(feedbackSubscription).where(eq(feedbackSubscription.token, token)).limit(1)

  if (!sub) {
    // Already removed or invalid — still show a friendly message
    return sendRedirect(event, '/?unsubscribed=1', 302)
  }

  await db.delete(feedbackSubscription).where(eq(feedbackSubscription.id, sub.id))

  return sendRedirect(event, '/?unsubscribed=1', 302)
})
