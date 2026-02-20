/**
 * Create GitHub Issue Endpoint
 * Creates a GitHub issue from a feedback item
 *
 * @openapi
 * /api/github/issues:
 *   post:
 *     tags: [GitHub]
 *     summary: Create GitHub issue from feedback
 *     description: Creates a new GitHub issue and links it to a feedback item
 *     operationId: createGitHubIssue
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - feedbackId
 *               - repo
 *             properties:
 *               feedbackId:
 *                 type: string
 *                 description: ID of the feedback item to create issue from
 *               repo:
 *                 type: string
 *                 description: GitHub repository in format "owner/repo"
 *                 example: facebook/react
 *               title:
 *                 type: string
 *                 description: Issue title (defaults to feedback title)
 *                 nullable: true
 *               body:
 *                 type: string
 *                 description: Issue body (defaults to feedback description with link)
 *                 nullable: true
 *               labels:
 *                 type: array
 *                 description: Issue labels
 *                 items:
 *                   type: string
 *                 example: [feature, user-feedback]
 *     responses:
 *       201:
 *         description: GitHub issue created successfully
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
 *                     issue:
 *                       type: object
 *                       properties:
 *                         number:
 *                           type: integer
 *                         title:
 *                           type: string
 *                         html_url:
 *                           type: string
 *                           format: uri
 *                     feedback:
 *                       $ref: '#/components/schemas/Feedback'
 *       400:
 *         description: Validation error
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
 *         description: Insufficient permissions
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Feedback not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       501:
 *         description: Not implemented
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */

import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { validateBody } from '~/server/utils/validation'
import { requireRateLimit, rateLimits } from '~/server/utils/rate-limit'
import { requireFeedbackAccess } from '~/server/utils/project-access'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackCategory, githubIntegration, githubIssueLink } from '~/server/database/schema/feedback'
import { parseRepoFullName, buildIssueLabels } from '~/server/utils/github'

const createGitHubIssueSchema = z.object({
  feedbackId: z.string().min(1, 'Feedback ID is required'),
  repo: z.string().regex(/^[\w-]+\/[\w-]+$/, 'Repository must be in format "owner/repo"'),
  title: z.string().optional().nullable(),
  body: z.string().optional().nullable(),
  labels: z.array(z.string()).optional().default([]),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  await requireRateLimit(event, rateLimits.standard)
  const body = await validateBody(event, createGitHubIssueSchema)
  const { owner, repo } = parseRepoFullName(body.repo)

  const { feedback: selectedFeedback, project } = await requireFeedbackAccess(body.feedbackId, session.user.id)

  const [existingLink] = await db
    .select()
    .from(githubIssueLink)
    .where(eq(githubIssueLink.feedbackId, selectedFeedback.id))
    .limit(1)

  if (existingLink) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(ErrorCode.CONFLICT, 'A GitHub issue is already linked to this feedback'),
    })
  }

  const [integration] = await db
    .select()
    .from(githubIntegration)
    .where(
      and(
        eq(githubIntegration.projectId, project.id),
        eq(githubIntegration.owner, owner),
        eq(githubIntegration.repo, repo)
      )
    )
    .limit(1)

  if (!integration) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'The selected repository is not connected to this project'),
    })
  }

  if (!integration.accessToken) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'GitHub access token is missing for this integration'),
    })
  }

  let categoryLabel: string | null = null
  if (selectedFeedback.categoryId) {
    const [category] = await db
      .select()
      .from(feedbackCategory)
      .where(eq(feedbackCategory.id, selectedFeedback.categoryId))
      .limit(1)
    categoryLabel = category?.name?.trim() || null
  }

  const labels = buildIssueLabels({
    explicitLabels: body.labels,
    categoryLabel,
    feedbackStatus: selectedFeedback.status,
  })

  const issueTitle = body.title?.trim() || selectedFeedback.title
  const issueBody =
    body.body?.trim() ||
    [
      selectedFeedback.body?.trim() || '*No description provided*',
      '',
      `Source feedback ID: ${selectedFeedback.id}`,
    ].join('\n')

  const githubResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${integration.accessToken}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Veerify',
    },
    body: JSON.stringify({
      title: issueTitle,
      body: issueBody,
      labels,
    }),
  })

  if (!githubResponse.ok) {
    const errorBody = (await githubResponse.json().catch(() => null)) as { message?: string } | null
    throw createError({
      statusCode: githubResponse.status,
      statusMessage: 'GitHub API error',
      data: createErrorResponse(ErrorCode.INTERNAL_ERROR, errorBody?.message || 'Failed to create issue in GitHub'),
    })
  }

  const createdIssue = (await githubResponse.json()) as {
    number: number
    title: string
    html_url: string
    state: string
  }

  const now = new Date()
  const [createdLink] = await db
    .insert(githubIssueLink)
    .values({
      id: crypto.randomUUID(),
      feedbackId: selectedFeedback.id,
      githubIntegrationId: integration.id,
      issueNumber: createdIssue.number,
      issueUrl: createdIssue.html_url,
      issueState: createdIssue.state,
      lastSyncAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  const [updatedFeedback] = await db
    .update(feedback)
    .set({
      status: 'in_progress',
      updatedAt: now,
    })
    .where(eq(feedback.id, selectedFeedback.id))
    .returning()

  setResponseStatus(event, 201)
  return createSuccessResponse({
    issue: {
      number: createdIssue.number,
      title: createdIssue.title,
      html_url: createdIssue.html_url,
      state: createdIssue.state,
    },
    feedback: updatedFeedback,
    link: createdLink,
  })
})
