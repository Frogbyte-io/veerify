/**
 * @openapi
 * /api/feedback/export:
 *   get:
 *     tags: [Feedback]
 *     summary: Export feedback as CSV
 *     description: >
 *       Returns a CSV file (text/csv) with columns Title, Status, Category, Project, Product, Votes, Comments, Author, Author Email, Pinned, GitHub Issue, Created, Updated. Includes author emails, so project members only. Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: exportFeedback
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: projectId
 *         description: "Project id. Either projectId or projectIds is required"
 *         schema: { type: string, minLength: 1 }
 *       - in: query
 *         name: projectIds
 *         description: "Comma-separated project ids. Either projectId or projectIds is required"
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         description: "A status value of the project (system or custom)"
 *         schema: { type: string, minLength: 1, maxLength: 80 }
 *       - in: query
 *         name: categoryId
 *         schema: { type: string }
 *       - in: query
 *         name: productId
 *         schema: { type: string, minLength: 1 }
 *       - in: query
 *         name: search
 *         description: "Case-insensitive match on title or body"
 *         schema: { type: string }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [createdAt, updatedAt, voteCount, title], default: createdAt }
 *       - in: query
 *         name: sortOrder
 *         schema: { type: string, enum: [asc, desc], default: desc }
 *     responses:
 *       200: { description: "CSV attachment (text/csv; charset=utf-8)" }
 *       400: { description: "Validation failed (for example neither projectId nor projectIds given)" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Not a member of a requested project" }
 */
import { z } from 'zod'
import { eq, and, desc, asc, or, ilike } from 'drizzle-orm'
import { requireAuth } from '~/server/utils/auth-middleware'
import { validateQuery } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackCategory, githubIssueLink, product, project } from '~/server/database/schema/feedback'
import { resolveFeedbackListScope } from '~/server/utils/feedback-access'

const exportQuerySchema = z
  .object({
    projectId: z.string().min(1).optional(),
    projectIds: z
      .string()
      .optional()
      .transform((value) =>
        value
          ? value
              .split(',')
              .map((id) => id.trim())
              .filter(Boolean)
          : []
      ),
    status: z.string().trim().min(1).max(80).optional(),
    categoryId: z.string().optional(),
    productId: z.string().min(1).optional(),
    search: z.string().optional(),
    sortBy: z.enum(['createdAt', 'updatedAt', 'voteCount', 'title']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine((data) => Boolean(data.projectId) || data.projectIds.length > 0, {
    message: 'Project ID is required',
    path: ['projectId'],
  })

function escapeCsvField(value: string | null | undefined): string {
  if (value == null) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const query = validateQuery(event, exportQuerySchema)
  const requestedProjectIds = query.projectIds.length > 0 ? query.projectIds : query.projectId ? [query.projectId] : []

  // Export contains author emails: project members only (no public view).
  const { condition: scopeCondition } = await resolveFeedbackListScope(requestedProjectIds, session.user.id, {
    membersOnly: true,
  })

  const conditions = [scopeCondition]
  if (query.productId) conditions.push(eq(feedback.productId, query.productId))
  if (query.status) conditions.push(eq(feedback.status, query.status))
  if (query.categoryId) conditions.push(eq(feedback.categoryId, query.categoryId))
  if (query.search) {
    const term = `%${query.search}%`
    conditions.push(or(ilike(feedback.title, term), ilike(feedback.body, term))!)
  }

  const whereClause = and(...conditions)

  const sortColumn = {
    createdAt: feedback.createdAt,
    updatedAt: feedback.updatedAt,
    voteCount: feedback.voteCount,
    title: feedback.title,
  }[query.sortBy]
  const orderFn = query.sortOrder === 'asc' ? asc : desc

  const items = await db
    .select({
      feedback: feedback,
      category: feedbackCategory,
      project: {
        id: project.id,
        name: project.name,
        slug: project.slug,
      },
      product: {
        id: product.id,
        name: product.name,
        slug: product.slug,
      },
      githubIssue: {
        issueNumber: githubIssueLink.issueNumber,
        issueUrl: githubIssueLink.issueUrl,
        issueState: githubIssueLink.issueState,
      },
    })
    .from(feedback)
    .leftJoin(feedbackCategory, eq(feedback.categoryId, feedbackCategory.id))
    .leftJoin(project, eq(feedback.projectId, project.id))
    .leftJoin(product, eq(feedback.productId, product.id))
    .leftJoin(githubIssueLink, eq(githubIssueLink.feedbackId, feedback.id))
    .where(whereClause)
    .orderBy(desc(feedback.isPinned), orderFn(sortColumn))

  const headers = [
    'Title',
    'Status',
    'Category',
    'Project',
    'Product',
    'Votes',
    'Comments',
    'Author',
    'Author Email',
    'Pinned',
    'GitHub Issue',
    'Created',
    'Updated',
  ]
  const rows = items.map((item) => [
    escapeCsvField(item.feedback.title),
    escapeCsvField(item.feedback.status),
    escapeCsvField(item.category?.name),
    escapeCsvField(item.project?.name),
    escapeCsvField(item.product?.name),
    String(item.feedback.voteCount ?? 0),
    String(item.feedback.commentCount ?? 0),
    escapeCsvField(item.feedback.authorName),
    escapeCsvField(item.feedback.authorEmail),
    item.feedback.isPinned ? 'Yes' : 'No',
    escapeCsvField(item.githubIssue?.issueUrl),
    item.feedback.createdAt ? new Date(item.feedback.createdAt).toISOString() : '',
    item.feedback.updatedAt ? new Date(item.feedback.updatedAt).toISOString() : '',
  ])

  const csv = [headers.join(','), ...rows.map((row) => row.join(','))].join('\r\n')

  setResponseHeaders(event, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="feedback-export-${new Date().toISOString().slice(0, 10)}.csv"`,
  })

  return csv
})
