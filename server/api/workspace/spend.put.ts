/**
 * @openapi
 * /api/workspace/spend:
 *   put:
 *     tags: [Marketing]
 *     summary: Set or clear the workspace's monthly AI spend cap
 *     description: >
 *       Workspace owners and admins only. Caps total AI spend across every provider for the calendar
 *       month (UTC), on top of each key's own budget. Null removes the cap.
 *     operationId: putWorkspaceSpendCap
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [monthlyCapCents]
 *             properties:
 *               monthlyCapCents: { type: integer, nullable: true }
 *     responses:
 *       200: { description: "`{ workspaceCapCents }`" }
 *       400: { description: Invalid cap }
 *       403: { description: Workspace owner or admin required }
 */
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { organization } from '~/server/database/schema/auth'
import { requireAuthWithOrganization } from '~/server/utils/project-context'
import { createSuccessResponse } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { requireCredentialAdmin } from '~/server/utils/marketing-credential-routes'
import { WORKSPACE_SPEND_CAP_SETTING } from '~/server/services/marketing/llm-budget'

const bodySchema = z.object({
  monthlyCapCents: z.number().int().min(0).max(100_000_000).nullable(),
})

export default defineEventHandler(async (event) => {
  const { session, organizationId } = await requireAuthWithOrganization(event)
  await requireCredentialAdmin(organizationId, session.user.id)
  const body = await validateBody(event, bodySchema)

  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ settings: organization.settings })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .for('update')
      .limit(1)
    const current = (row?.settings as Record<string, unknown> | null) ?? {}
    const settings = Object.fromEntries(Object.entries(current).filter(([key]) => key !== WORKSPACE_SPEND_CAP_SETTING))
    if (body.monthlyCapCents != null) settings[WORKSPACE_SPEND_CAP_SETTING] = body.monthlyCapCents
    await tx.update(organization).set({ settings, updatedAt: new Date() }).where(eq(organization.id, organizationId))
  })

  return createSuccessResponse({ workspaceCapCents: body.monthlyCapCents })
})
