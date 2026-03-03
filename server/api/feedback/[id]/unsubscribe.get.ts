import { eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { feedbackSubscription } from '~/server/database/schema/feedback'

export default defineEventHandler(async (event) => {
  const token = getQuery(event).token as string | undefined

  if (!token) {
    throw createError({ statusCode: 400, statusMessage: 'Missing token' })
  }

  const [sub] = await db
    .select()
    .from(feedbackSubscription)
    .where(eq(feedbackSubscription.token, token))
    .limit(1)

  if (!sub) {
    // Already removed or invalid — still show a friendly message
    return sendRedirect(event, '/?unsubscribed=1', 302)
  }

  await db.delete(feedbackSubscription).where(eq(feedbackSubscription.id, sub.id))

  return sendRedirect(event, '/?unsubscribed=1', 302)
})
