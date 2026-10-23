/**
 * @openapi
 * /api/marketing/projects/{projectId}/competitors/settings:
 *   patch:
 *     tags: [Marketing]
 *     summary: Turn AI summaries of competitor changes on or off
 *     description: >
 *       Marketing admin only. Summaries use the workspace's own LLM key and its monthly budget.
 *       Stored in the product settings (no extra table).
 *     operationId: updateMarketingCompetitorSettings
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [summarize]
 *             properties:
 *               summarize: { type: boolean }
 *     responses:
 *       200: { description: Setting saved }
 *       400: { description: Validation failed }
 *       403: { description: Not a marketing admin, or Marketing is off }
 */
import { eq, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import { SUMMARY_SETTING_KEY } from '~/server/services/marketing/competitors/checker'
import { requireMarketingAdmin } from '~/server/utils/marketing-access'
import { settingsSchema } from '~/server/utils/marketing-competitors'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { validateBody } from '~/server/utils/validation'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = requireRouteParam(event, 'projectId')
  await requireMarketingAdmin(projectId, session.user.id)
  const body = await validateBody(event, settingsSchema)

  // Merge one key so concurrent edits to other product settings are not overwritten.
  await db
    .update(project)
    .set({
      settings: sql`coalesce(${project.settings}, '{}'::jsonb) || jsonb_build_object(${SUMMARY_SETTING_KEY}::text, ${body.summarize}::boolean)`,
    })
    .where(eq(project.id, projectId))

  return createSuccessResponse({ summariesEnabled: body.summarize })
})
