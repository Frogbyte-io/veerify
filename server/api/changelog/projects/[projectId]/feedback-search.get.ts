/**
 * @openapi
 * /api/changelog/projects/{projectId}/feedback-search:
 *   get:
 *     tags: [Changelog]
 *     summary: Search the product's feedback titles for linking to an entry
 *     operationId: searchChangelogFeedback
 *     parameters:
 *       - { in: path, name: projectId, required: true, schema: { type: string } }
 *       - { in: query, name: q, schema: { type: string } }
 *     responses:
 *       200: { description: "Up to 20 matching feedback items (id, title, status)" }
 */
import { and, desc, eq, ilike } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { feedback } from '~/server/database/schema/feedback'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireChangelogAccess } from '~/server/utils/changelog-access'
import { createSuccessResponse } from '~/server/utils/response'
import { validateQuery } from '~/server/utils/validation'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { searchQuerySchema } from '~/server/services/changelog/schemas'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = requireRouteParam(event, 'projectId')
  await requireChangelogAccess(projectId, session.user.id)
  const { q } = validateQuery(event, searchQuerySchema)

  const conditions = [eq(feedback.projectId, projectId)]
  if (q) {
    // Escape LIKE wildcards so user input matches literally
    conditions.push(ilike(feedback.title, `%${q.replace(/[\\%_]/g, '\\$&')}%`))
  }

  const rows = await db
    .select({ id: feedback.id, title: feedback.title, status: feedback.status })
    .from(feedback)
    .where(and(...conditions))
    .orderBy(desc(feedback.createdAt))
    .limit(20)

  return createSuccessResponse({ results: rows })
})
