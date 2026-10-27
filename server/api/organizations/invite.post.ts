/**
 * @openapi
 * /api/organizations/invite:
 *   post:
 *     tags: [Organizations]
 *     summary: Invite member to organization
 *     description: >
 *       Invites an email address to an organization by delegating to Better-Auth. Requires a signed-in browser session; personal API keys are not supported yet (Better-Auth only accepts the session cookie, so a key request fails with 401).
 *       A person who is already a member of any workspace, or who already has a pending invitation (unless `resend` is true), is rejected with 409 and a machine-readable `data.code`.
 *     operationId: inviteOrganizationMember
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, organizationId]
 *             properties:
 *               email: { type: string, format: email }
 *               organizationId: { type: string }
 *               role: { type: string, enum: [member, admin, owner], default: member }
 *               resend: { type: boolean, description: "Resend an existing pending invitation instead of failing with 409" }
 *     responses:
 *       200: { description: "The Better-Auth invitation record" }
 *       400: { description: "email and organizationId are required" }
 *       401: { description: "No browser session (API keys are not supported)" }
 *       403: { description: "Caller may not invite to this organization" }
 *       409: { description: "INVITATION_ALREADY_EXISTS or EMAIL_ALREADY_IN_ORG (see data.code)" }
 */
import { auth } from '~/lib/auth'
import { db } from '~/server/database/drizzle'
import { invitation, member, user } from '~/server/database/schema/index'
import { and, eq } from 'drizzle-orm'
import { getAuthHeaders } from '~/server/utils/auth-headers'
import { requireAuth } from '~/server/utils/auth-middleware'

export default defineEventHandler(async (event) => {
  await requireAuth(event)

  const body = await readBody(event)
  const { email, role, organizationId, resend } = body

  if (!email || !organizationId) {
    throw createError({ statusCode: 400, statusMessage: 'Email and organizationId are required' })
  }

  const normalizedEmail = email.trim().toLowerCase()

  const [existingInvitation] = await db
    .select({
      id: invitation.id,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
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
    },
  })

  return result
})
