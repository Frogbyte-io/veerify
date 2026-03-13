import { auth } from '~/lib/auth'
import { db } from '~/server/database/drizzle'
import { invitation, member, user } from '~/server/database/schema/index'
import { and, eq } from 'drizzle-orm'
import { getAuthHeaders } from '~/server/utils/auth-headers'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({
    headers: getAuthHeaders(event),
  })
  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const body = await readBody(event)
  const { email, role, organizationId, teamId, resend } = body

  if (!email || !organizationId) {
    throw createError({ statusCode: 400, statusMessage: 'Email and organizationId are required' })
  }

  const normalizedEmail = email.trim().toLowerCase()

  const [existingInvitation] = await db
    .select({
      id: invitation.id,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      teamId: invitation.teamId,
    })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, organizationId),
        eq(invitation.email, normalizedEmail),
        eq(invitation.status, 'pending')
      )
    )
    .limit(1)

  if (existingInvitation && !resend) {
    throw createError({
      statusCode: 409,
      statusMessage: 'This person is already invited.',
      data: {
        code: 'INVITATION_ALREADY_EXISTS',
        invitationId: existingInvitation.id,
        expiresAt: existingInvitation.expiresAt,
        teamId: existingInvitation.teamId,
        recommendedSteps: ['Use "Send reminder" to resend the invitation or revoke the existing invite first.'],
      },
    })
  }

  // Check whether this email is already a member of any organization
  const [existingUser] = await db.select({ id: user.id }).from(user).where(eq(user.email, normalizedEmail)).limit(1)

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
    headers: getAuthHeaders(event),
    body: {
      organizationId,
      email: normalizedEmail,
      role: role || 'member',
      ...(resend ? { resend: true } : {}),
      ...(teamId ? { teamId } : {}),
    },
  })

  return result
})
