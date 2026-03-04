/**
 * Search GitHub Issues Endpoint
 * Searches GitHub issues in a repository linked to a project integration
 *
 * @openapi
 * /api/github/issues:
 *   get:
 *     tags: [GitHub]
 *     summary: Search GitHub issues
 *     description: Searches for issues in a GitHub repository linked to a project
 *     operationId: searchGitHubIssues
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: projectId
 *         in: query
 *         description: Project ID whose GitHub integration to use
 *         required: true
 *         schema:
 *           type: string
 *       - name: repo
 *         in: query
 *         description: GitHub repository in format "owner/repo"
 *         required: true
 *         schema:
 *           type: string
 *           example: facebook/react
 *       - name: query
 *         in: query
 *         description: Search query
 *         schema:
 *           type: string
 *       - name: state
 *         in: query
 *         description: Issue state filter
 *         schema:
 *           type: string
 *           enum: [open, closed, all]
 *           default: open
 *       - name: page
 *         in: query
 *         description: Page number
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *       - name: per_page
 *         in: query
 *         description: Results per page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 30
 *     responses:
 *       200:
 *         description: List of GitHub issues
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     issues:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           number:
 *                             type: integer
 *                           title:
 *                             type: string
 *                           state:
 *                             type: string
 *                           html_url:
 *                             type: string
 *                           created_at:
 *                             type: string
 *                             format: date-time
 *                     total_count:
 *                       type: integer
 *       400:
 *         description: Invalid parameters or no integration found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: No access to project
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */

import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { validateQuery } from '~/server/utils/validation'
import { requireRateLimit, rateLimits } from '~/server/utils/rate-limit'
import { requireProjectAccess } from '~/server/utils/project-access'
import { db } from '~/server/database/drizzle'
import { githubIntegration } from '~/server/database/schema/feedback'
import { parseRepoFullName } from '~/server/utils/github'

const searchIssuesQuerySchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'Repository must be in format "owner/repo"'),
  query: z.string().optional(),
  state: z.enum(['open', 'closed', 'all']).default('open'),
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().positive().max(100).default(30),
})

interface GitHubIssue {
  number: number
  title: string
  state: string
  html_url: string
  created_at: string
  body: string | null
  labels: Array<{ name: string }>
}

interface GitHubSearchResponse {
  total_count: number
  items: GitHubIssue[]
}

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  await requireRateLimit(event, rateLimits.standard)

  const { projectId, repo, query, state, page, per_page } = validateQuery(event, searchIssuesQuerySchema)
  const { owner, repo: repoName } = parseRepoFullName(repo)

  // Verify the user has access to this project
  await requireProjectAccess(projectId, session.user.id)

  // Look up the GitHub integration for this project and repo
  const [integration] = await db
    .select()
    .from(githubIntegration)
    .where(
      and(
        eq(githubIntegration.projectId, projectId),
        eq(githubIntegration.owner, owner),
        eq(githubIntegration.repo, repoName)
      )
    )
    .limit(1)

  if (!integration) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(
        ErrorCode.VALIDATION_ERROR,
        'No GitHub integration found for this project and repository'
      ),
    })
  }

  if (!integration.accessToken) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'GitHub access token is missing for this integration'),
    })
  }

  const headers = {
    Authorization: `Bearer ${integration.accessToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Veerify',
  }

  let issues: GitHubIssue[]
  let totalCount: number

  if (query?.trim()) {
    // Use the GitHub search API when a text query is provided
    const searchParams = new URLSearchParams({
      q: `${query.trim()} repo:${owner}/${repoName}${state !== 'all' ? ` state:${state}` : ''}`,
      page: String(page),
      per_page: String(per_page),
    })

    const response = await fetch(`https://api.github.com/search/issues?${searchParams}`, { headers })

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as { message?: string } | null
      throw createError({
        statusCode: response.status,
        statusMessage: 'GitHub API error',
        data: createErrorResponse(ErrorCode.INTERNAL_ERROR, errorBody?.message || 'Failed to search GitHub issues'),
      })
    }

    const data = (await response.json()) as GitHubSearchResponse
    issues = data.items
    totalCount = data.total_count
  } else {
    // Use the repo issues list API when no text query is given
    const listParams = new URLSearchParams({
      state,
      page: String(page),
      per_page: String(per_page),
      sort: 'created',
      direction: 'desc',
    })

    const response = await fetch(`https://api.github.com/repos/${owner}/${repoName}/issues?${listParams}`, { headers })

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as { message?: string } | null
      throw createError({
        statusCode: response.status,
        statusMessage: 'GitHub API error',
        data: createErrorResponse(ErrorCode.INTERNAL_ERROR, errorBody?.message || 'Failed to fetch GitHub issues'),
      })
    }

    const data = (await response.json()) as GitHubIssue[]
    // The list API does not return pull requests in the same endpoint but may include them;
    // filter to issues only (pull requests have a pull_request key in the full response).
    issues = data.filter((item: any) => !item.pull_request)
    // The list API does not return a total count — use the Link header pagination approach,
    // but for simplicity we expose the count of returned items for this page.
    totalCount = issues.length < per_page ? (page - 1) * per_page + issues.length : -1
  }

  return createSuccessResponse({
    issues: issues.map((issue) => ({
      number: issue.number,
      title: issue.title,
      state: issue.state,
      html_url: issue.html_url,
      created_at: issue.created_at,
      labels: issue.labels.map((l) => l.name),
    })),
    total_count: totalCount,
    page,
    per_page,
  })
})
