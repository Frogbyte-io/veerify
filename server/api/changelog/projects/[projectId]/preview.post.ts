/**
 * @openapi
 * /api/changelog/projects/{projectId}/preview:
 *   post:
 *     tags: [Changelog]
 *     summary: Render changelog markdown to sanitised HTML
 *     operationId: previewChangelogMarkdown
 *     parameters:
 *       - { in: path, name: projectId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [body]
 *             properties:
 *               body: { type: string, maxLength: 50000 }
 *     responses:
 *       200: { description: "`{ html }`, sanitised server-side" }
 *       400: { description: Validation failed }
 */
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { requireChangelogAccess } from '~/server/utils/changelog-access'
import { createSuccessResponse } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { renderMarkdown } from '~/server/utils/markdown'
import { previewSchema } from '~/server/services/changelog/schemas'

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const projectId = requireRouteParam(event, 'projectId')
  await requireChangelogAccess(projectId, session.user.id)
  const { body } = await validateBody(event, previewSchema)

  return createSuccessResponse({ html: renderMarkdown(body) })
})
