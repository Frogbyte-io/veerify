/**
 * @openapi
 * /api/public/o/{orgSlug}/{projectSlug}/changelog/{slug}:
 *   get:
 *     tags: [Public]
 *     summary: One published changelog entry of a public project
 *     operationId: getPublicChangelogEntry
 *     parameters:
 *       - { in: path, name: orgSlug, required: true, schema: { type: string } }
 *       - { in: path, name: projectSlug, required: true, schema: { type: string } }
 *       - { in: path, name: slug, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Entry with sanitised `html` }
 *       404: { description: Not found, a draft, or Changelog disabled }
 */
import { createSuccessResponse } from '~/server/utils/response'
import { findPublishedEntryBySlug, resolvePublicChangelogProject } from '~/server/services/changelog/public'

export default defineEventHandler(async (event) => {
  const orgSlug = getRouterParam(event, 'orgSlug')
  const projectSlug = getRouterParam(event, 'projectSlug')
  const slug = getRouterParam(event, 'slug')
  const { project } = await resolvePublicChangelogProject(orgSlug!, projectSlug!)

  setHeader(event, 'Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  return createSuccessResponse(await findPublishedEntryBySlug(project.id, slug!))
})
