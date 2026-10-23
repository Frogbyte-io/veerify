/**
 * @openapi
 * /api/public/o/{orgSlug}/{projectSlug}/changelog:
 *   get:
 *     tags: [Public]
 *     summary: Published changelog entries of a public project
 *     description: 404 when the project's Changelog tool is off; 403 when the project is private. Entries tagged only with private products are excluded.
 *     operationId: getPublicChangelog
 *     parameters:
 *       - { in: path, name: orgSlug, required: true, schema: { type: string } }
 *       - { in: path, name: projectSlug, required: true, schema: { type: string } }
 *       - { in: query, name: product, description: Product slug; entries tagged with it or untagged, schema: { type: string } }
 *       - { in: query, name: cursor, schema: { type: string } }
 *     responses:
 *       200: { description: "`{ entries, nextCursor }`, newest first, with sanitised `html`" }
 *       404: { description: Not found or Changelog disabled }
 */
import { createSuccessResponse } from '~/server/utils/response'
import { validateQuery } from '~/server/utils/validation'
import {
  listPublishedEntries,
  resolvePublicChangelogProductFilter,
  resolvePublicChangelogProject,
} from '~/server/services/changelog/public'
import { publicListQuerySchema } from '~/server/services/changelog/schemas'

export default defineEventHandler(async (event) => {
  const orgSlug = getRouterParam(event, 'orgSlug')
  const projectSlug = getRouterParam(event, 'projectSlug')
  const { project } = await resolvePublicChangelogProject(orgSlug!, projectSlug!)
  const { cursor, product } = validateQuery(event, publicListQuerySchema)
  const productId = await resolvePublicChangelogProductFilter(project, product)

  const { entries, nextCursor } = await listPublishedEntries(project.id, { cursor, productId })
  setHeader(event, 'Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  return createSuccessResponse({ entries, nextCursor })
})
