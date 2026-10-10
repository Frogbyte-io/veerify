/**
 * @openapi
 * /api/public/t/{teamSlug}/{projectSlug}/changelog:
 *   get:
 *     tags: [Public]
 *     summary: Published changelog entries of a public product
 *     description: 404 when the product's Changelog toggle is off; 403 when the product is private.
 *     operationId: getPublicChangelog
 *     parameters:
 *       - { in: path, name: teamSlug, required: true, schema: { type: string } }
 *       - { in: path, name: projectSlug, required: true, schema: { type: string } }
 *       - { in: query, name: cursor, schema: { type: string } }
 *     responses:
 *       200: { description: "`{ entries, nextCursor }`, newest first, with sanitised `html`" }
 *       404: { description: Not found or Changelog disabled }
 */
import { createSuccessResponse } from '~/server/utils/response'
import { validateQuery } from '~/server/utils/validation'
import { listPublishedEntries, resolvePublicChangelogProject } from '~/server/services/changelog/public'
import { publicListQuerySchema } from '~/server/services/changelog/schemas'

export default defineEventHandler(async (event) => {
  const teamSlug = getRouterParam(event, 'teamSlug')
  const projectSlug = getRouterParam(event, 'projectSlug')
  const { project } = await resolvePublicChangelogProject(teamSlug!, projectSlug!)
  const { cursor } = validateQuery(event, publicListQuerySchema)

  const { entries, nextCursor } = await listPublishedEntries(project.id, { cursor })
  return createSuccessResponse({ entries, nextCursor })
})
