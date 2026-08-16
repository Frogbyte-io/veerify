import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { optionalAuth } from '~/server/utils/auth-middleware'
import { getOrCreateAnonSession } from '~/server/utils/anonymous-session'
import { validateBody, optionalTrimmedEmail, optionalTrimmedString } from '~/server/utils/validation'
import { requirePublicProject, requireProjectAccess } from '~/server/utils/project-access'
import { requireRateLimit, rateLimits } from '~/server/utils/rate-limit'
import { db } from '~/server/database/drizzle'
import {
  feedback,
  project,
  feedbackCategory,
  vote,
  githubIntegration,
  githubIssueLink,
} from '~/server/database/schema/feedback'
import { sendFeedbackConfirmationEmail } from '~/lib/email'
import { buildIssueLabels, ensureGitHubLabels } from '~/server/utils/github'
import { createLogger } from '~/server/utils/logger'
import { notifyProjectTeam } from '~/server/utils/notifications'

const logger = createLogger('feedback')

const createFeedbackSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  body: z.string().min(1, 'Description is required').max(5000, 'Description too long'),
  projectId: z.string().min(1, 'Project ID is required'),
  categoryId: z.string().optional().nullable(),
  feedbackType: z.enum(['feature_request', 'bug_report', 'improvement', 'question', 'other']).optional(),
  authorName: optionalTrimmedString(100),
  authorEmail: optionalTrimmedEmail(),
})

function createGitHubHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Veerify',
  }
}

async function rollbackCreatedGitHubIssue(params: {
  owner: string
  repo: string
  issueNumber: number
  accessToken: string
}) {
  const response = await fetch(
    `https://api.github.com/repos/${params.owner}/${params.repo}/issues/${params.issueNumber}`,
    {
      method: 'PATCH',
      headers: createGitHubHeaders(params.accessToken),
      body: JSON.stringify({
        state: 'closed',
        state_reason: 'not_planned',
      }),
    }
  )

  if (!response.ok) {
    const rollbackError = (await response.json().catch(() => null)) as { message?: string } | null
    logger.error('Failed to rollback auto-created GitHub issue', {
      error: rollbackError?.message || response.statusText,
    })
  }
}

export default defineEventHandler(async (event) => {
  // Optional auth — allows anonymous submissions
  const session = await optionalAuth(event)

  // Anonymous submissions are rate-limited strictly (5/min) to prevent spam;
  // authenticated users get the standard limit (60/min).
  await requireRateLimit(event, {
    ...(session?.user ? rateLimits.standard : rateLimits.strict),
    identifier: session?.user ? 'feedback-post-auth' : 'feedback-post-anon',
  })

  const body = await validateBody(event, createFeedbackSchema)

  // For authenticated users submitting to private projects, verify team access
  if (session?.user) {
    await requireProjectAccess(body.projectId, session.user.id)
  } else {
    // Anonymous user - project must be public
    await requirePublicProject(body.projectId)
  }

  // Fetch project for category validation (already verified access above)
  const [proj] = await db.select().from(project).where(eq(project.id, body.projectId)).limit(1)
  if (!proj) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Project not found'),
    })
  }

  // Verify category if provided
  let categoryName: string | null = null
  if (body.categoryId) {
    const [cat] = await db.select().from(feedbackCategory).where(eq(feedbackCategory.id, body.categoryId)).limit(1)
    if (!cat || cat.projectId !== proj.id) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Invalid category for this project'),
      })
    }
    categoryName = cat.name
  }

  // For anonymous submissions, require name
  if (!session?.user && !body.authorName) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Name is required for anonymous submissions'),
    })
  }

  // For anonymous users, get or create an anonymous session
  let anonSessionId: string | null = null
  if (!session?.user) {
    const anonSession = await getOrCreateAnonSession(event)
    anonSessionId = anonSession.id
  }

  // Generate a tokenized edit link for the submitter
  const editToken = crypto.randomUUID()
  const editTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const now = new Date()
  const feedbackId = crypto.randomUUID()

  const [integration] = await db
    .select()
    .from(githubIntegration)
    .where(eq(githubIntegration.projectId, body.projectId))
    .limit(1)

  let createdIssue: {
    number: number
    html_url: string
    state: string
  } | null = null

  if (integration?.autoCreateIssues && integration.syncEnabled && integration.accessToken) {
    const labels = buildIssueLabels({
      categoryLabel: categoryName,
      feedbackStatus: 'open',
    })

    const feedbackUrl = `${getRequestURL(event).origin}/feedback/${feedbackId}`

    try {
      await ensureGitHubLabels(integration.owner, integration.repo, labels, integration.accessToken)

      const issueResponse = await fetch(
        `https://api.github.com/repos/${integration.owner}/${integration.repo}/issues`,
        {
          method: 'POST',
          headers: createGitHubHeaders(integration.accessToken),
          body: JSON.stringify({
            title: body.title,
            body: [
              body.body?.trim() || '*No description provided*',
              '',
              `[View feedback on Veerify](${feedbackUrl})`,
            ].join('\n'),
            labels,
          }),
        }
      )

      if (!issueResponse.ok) {
        const issueError = (await issueResponse.json().catch(() => null)) as { message?: string } | null
        logger.error('Failed to auto-create GitHub issue', {
          feedbackId,
          projectId: body.projectId,
          error: issueError?.message || issueResponse.statusText,
        })
      } else {
        createdIssue = (await issueResponse.json()) as {
          number: number
          html_url: string
          state: string
        }
      }
    } catch (error) {
      logger.error('Auto-create GitHub issue failed', {
        feedbackId,
        projectId: body.projectId,
        error: error instanceof Error ? error.message : error,
      })
    }
  }

  const transactionResult = await (async () => {
    try {
      return await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(feedback)
          .values({
            id: feedbackId,
            projectId: body.projectId,
            categoryId: body.categoryId || null,
            title: body.title,
            body: body.body,
            status: createdIssue ? 'in_progress' : 'open',
            authorUserId: session?.user?.id || null,
            authorSessionId: anonSessionId,
            authorName: session?.user ? session.user.name : body.authorName || null,
            authorEmail: session?.user ? session.user.email : body.authorEmail || null,
            voteCount: 1,
            commentCount: 0,
            isPinned: false,
            isLocked: false,
            metadata: {
              editToken,
              editTokenExpiry,
              feedbackType: body.feedbackType || null,
            },
            createdAt: now,
            updatedAt: now,
          })
          .returning()

        // Auto-upvote by the submitter so the item appears ranked without a second click
        await tx.insert(vote).values({
          id: crypto.randomUUID(),
          feedbackId: created.id,
          voterUserId: session?.user?.id || null,
          voterSessionId: anonSessionId,
          createdAt: now,
        })

        if (createdIssue && integration) {
          await tx.insert(githubIssueLink).values({
            id: crypto.randomUUID(),
            feedbackId: created.id,
            githubIntegrationId: integration.id,
            issueNumber: createdIssue.number,
            issueUrl: createdIssue.html_url,
            issueState: createdIssue.state,
            lastSyncAt: now,
            createdAt: now,
            updatedAt: now,
          })
        }

        return {
          createdFeedback: created,
          responseFeedback: created,
        }
      })
    } catch (error) {
      if (createdIssue && integration?.accessToken) {
        try {
          await rollbackCreatedGitHubIssue({
            owner: integration.owner,
            repo: integration.repo,
            issueNumber: createdIssue.number,
            accessToken: integration.accessToken,
          })
        } catch (rollbackError) {
          logger.error('GitHub issue rollback request failed', {
            feedbackId,
            error: rollbackError instanceof Error ? rollbackError.message : rollbackError,
          })
        }
      }

      throw error
    }
  })()

  const { createdFeedback, responseFeedback } = transactionResult

  // Send confirmation email if the submitter provided an email address
  const recipientEmail = session?.user ? session.user.email : body.authorEmail
  const recipientName = session?.user ? session.user.name : body.authorName

  if (recipientEmail && recipientName) {
    const origin = getRequestURL(event).origin
    const editUrl = `${origin}/feedback/${createdFeedback.id}/edit?token=${editToken}`

    sendFeedbackConfirmationEmail({
      to: recipientEmail,
      authorName: recipientName,
      feedbackTitle: createdFeedback.title,
      projectName: proj.name,
      editUrl,
    }).catch((err) =>
      logger.error('Failed to send feedback confirmation email', {
        feedbackId: createdFeedback.id,
        error: err instanceof Error ? err.message : err,
      })
    )
  }

  // Create in-app notifications for team members about the new feedback
  const authorName = createdFeedback.authorName || session?.user?.name || 'Someone'
  notifyProjectTeam(createdFeedback.projectId, session?.user?.id || null, {
    type: 'new_feedback',
    title: `New feedback: "${createdFeedback.title}"`,
    body: `Submitted by ${authorName}`,
    link: `/feedback?id=${createdFeedback.id}`,
    feedbackId: createdFeedback.id,
    actorUserId: session?.user?.id,
    actorName: authorName,
  })

  setResponseStatus(event, 201)
  return createSuccessResponse(responseFeedback)
})
