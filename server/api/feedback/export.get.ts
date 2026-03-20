import { z } from 'zod'
import { eq, and, desc, asc, count, inArray, or, ilike } from 'drizzle-orm'
import { requireAuth } from '~/server/utils/auth-middleware'
import { validateQuery } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackCategory, githubIssueLink, project } from '~/server/database/schema/feedback'

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
    status: z.enum(['open', 'in_progress', 'planned', 'completed', 'closed', 'declined']).optional(),
    categoryId: z.string().optional(),
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
  await requireAuth(event)
  const query = validateQuery(event, exportQuerySchema)
  const requestedProjectIds = query.projectIds.length > 0 ? query.projectIds : query.projectId ? [query.projectId] : []

  const conditions = []
  if (requestedProjectIds.length === 1) {
    conditions.push(eq(feedback.projectId, requestedProjectIds[0]))
  } else {
    conditions.push(inArray(feedback.projectId, requestedProjectIds))
  }
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
      githubIssue: {
        issueNumber: githubIssueLink.issueNumber,
        issueUrl: githubIssueLink.issueUrl,
        issueState: githubIssueLink.issueState,
      },
    })
    .from(feedback)
    .leftJoin(feedbackCategory, eq(feedback.categoryId, feedbackCategory.id))
    .leftJoin(project, eq(feedback.projectId, project.id))
    .leftJoin(githubIssueLink, eq(githubIssueLink.feedbackId, feedback.id))
    .where(whereClause)
    .orderBy(desc(feedback.isPinned), orderFn(sortColumn))

  const headers = ['Title', 'Status', 'Category', 'Product', 'Votes', 'Comments', 'Author', 'Author Email', 'Pinned', 'GitHub Issue', 'Created', 'Updated']
  const rows = items.map((item) => [
    escapeCsvField(item.feedback.title),
    escapeCsvField(item.feedback.status),
    escapeCsvField(item.category?.name),
    escapeCsvField(item.project?.name),
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
