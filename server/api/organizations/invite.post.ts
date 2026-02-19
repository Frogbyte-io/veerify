import { auth } from '~/lib/auth'
import { db } from '~/server/database/drizzle'
import { user, member } from '~/server/database/schema/index'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({
    headers: event.node.req.headers as any,
  })
  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const body = await readBody(event)
  const { email, role, organizationId, teamId } = body

  if (!email || !organizationId) {
    throw createError({ statusCode: 400, statusMessage: 'Email and organizationId are required' })
  }

  const normalizedEmail = email.trim().toLowerCase()

  // Check whether this email is already a member of any organization
  const [existingUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, normalizedEmail))
    .limit(1)

  if (existingUser) {
    const [existingMembership] = await db
      .select({ id: member.id, organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, existingUser.id))
      .limit(1)

    if (existingMembership) {
      throw createError({
        statusCode: 409,
        statusMessage: 'This email is already a member of another workspace.',
        data: {
          code: 'EMAIL_ALREADY_IN_ORG',
          recommendedSteps: [
            'Ask the person to leave their current workspace before accepting this invitation.',
            'Or have their workspace admin remove them from the other workspace first.',
            'Once removed, you can re-send the invitation.',
          ],
        },
      })
    }
  }

  // Delegate to Better-Auth
  const result = await auth.api.createInvitation({
    headers: event.node.req.headers as any,
    body: {
      organizationId,
      email: normalizedEmail,
      role: role || 'member',
      ...(teamId ? { teamId } : {}),
    },
  })

  return result
})
