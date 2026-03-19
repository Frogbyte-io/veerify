/**
 * GitHub Webhook Endpoint
 * Receives and processes GitHub webhook events (issues, pull requests, etc.)
 *
 * @openapi
 * /api/github/webhook:
 *   post:
 *     tags: [GitHub]
 *     summary: GitHub webhook receiver
 *     description: Receives GitHub webhook events and syncs issue status with feedback items
 *     operationId: githubWebhook
 *     parameters:
 *       - name: X-GitHub-Event
 *         in: header
 *         description: GitHub event type
 *         required: true
 *         schema:
 *           type: string
 *           example: issues
 *       - name: X-Hub-Signature-256
 *         in: header
 *         description: HMAC signature for payload verification
 *         required: true
 *         schema:
 *           type: string
 *       - name: X-GitHub-Delivery
 *         in: header
 *         description: Unique delivery ID
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: GitHub webhook payload (varies by event type)
 *     responses:
 *       200:
 *         description: Webhook processed successfully
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
 *                     processed:
 *                       type: boolean
 *                       description: Whether the event was processed
 *                     event:
 *                       type: string
 *                       description: Event type that was processed
 *       400:
 *         description: Invalid payload or signature
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

import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireRateLimit, rateLimits } from '~/server/utils/rate-limit'
import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { feedback, githubIntegration, githubIssueLink } from '~/server/database/schema/feedback'
import {
  mergeMissingLabel,
  resolveStatusFromCloseReason,
  resolveStatusLabel,
  verifyGithubWebhookSignature,
} from '~/server/utils/github-webhook'
import { createLogger } from '~/server/utils/logger'

const logger = createLogger('github')

interface GithubWebhookPayload {
  action?: string
  repository?: {
    full_name?: string
    owner?: { login?: string }
    name?: string
  }
  issue?: {
    number?: number
    state_reason?: string | null
    labels?: Array<{ name?: string }>
  }
}

export default defineEventHandler(async (event) => {
  // Rate limiting (high limit for webhooks)
  await requireRateLimit(event, {
    ...rateLimits.webhook,
    identifier: 'github-webhook',
  })

  // Get GitHub webhook headers
  const githubEvent = getHeader(event, 'X-GitHub-Event')
  const signature = getHeader(event, 'X-Hub-Signature-256')
  const deliveryId = getHeader(event, 'X-GitHub-Delivery')

  if (!githubEvent || !signature) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Missing required GitHub webhook headers'),
    })
  }

  const rawPayload = await readRawBody(event, 'utf8')
  if (!rawPayload) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Missing GitHub webhook payload'),
    })
  }

  let payload: GithubWebhookPayload
  try {
    payload = JSON.parse(rawPayload) as GithubWebhookPayload
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Invalid GitHub webhook payload JSON'),
    })
  }

  if (githubEvent !== 'issues') {
    return createSuccessResponse({
      processed: false,
      event: githubEvent,
      deliveryId,
      reason: 'unsupported_event',
    })
  }

  if (payload.action !== 'closed') {
    return createSuccessResponse({
      processed: false,
      event: githubEvent,
      deliveryId,
      action: payload.action || null,
      reason: 'unsupported_action',
    })
  }

  const repoFullName =
    payload.repository?.full_name ||
    (payload.repository?.owner?.login && payload.repository?.name
      ? `${payload.repository.owner.login}/${payload.repository.name}`
      : null)

  if (!repoFullName?.includes('/')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Missing repository information in webhook payload'),
    })
  }

  const [owner, repo] = repoFullName.split('/')

  const [integration] = await db
    .select()
    .from(githubIntegration)
    .where(and(eq(githubIntegration.owner, owner), eq(githubIntegration.repo, repo)))
    .limit(1)

  if (!integration) {
    return createSuccessResponse({
      processed: false,
      event: githubEvent,
      deliveryId,
      reason: 'integration_not_found',
      repository: repoFullName,
    })
  }

  if (integration.webhookSecret?.trim()) {
    const signatureValid = verifyGithubWebhookSignature(rawPayload, signature, integration.webhookSecret)
    if (!signatureValid) {
      throw createError({
        statusCode: 401,
        statusMessage: 'Unauthorized',
        data: createErrorResponse(ErrorCode.UNAUTHORIZED, 'Invalid GitHub webhook signature'),
      })
    }
  }

  if (!integration.syncEnabled || !integration.autoSyncStatus) {
    return createSuccessResponse({
      processed: false,
      event: githubEvent,
      deliveryId,
      reason: 'sync_disabled',
      repository: repoFullName,
    })
  }

  const issueNumber = Number(payload.issue?.number)
  if (!Number.isInteger(issueNumber) || issueNumber < 1) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Missing issue number in webhook payload'),
    })
  }

  const [link] = await db
    .select()
    .from(githubIssueLink)
    .where(and(eq(githubIssueLink.githubIntegrationId, integration.id), eq(githubIssueLink.issueNumber, issueNumber)))
    .limit(1)

  if (!link) {
    return createSuccessResponse({
      processed: false,
      event: githubEvent,
      deliveryId,
      reason: 'feedback_link_not_found',
      repository: repoFullName,
      issueNumber,
    })
  }

  const feedbackStatus = resolveStatusFromCloseReason(payload.issue?.state_reason)

  const now = new Date()
  await db
    .update(githubIssueLink)
    .set({
      issueState: 'closed',
      lastSyncAt: now,
      updatedAt: now,
    })
    .where(eq(githubIssueLink.id, link.id))

  const [updatedFeedback] = await db
    .update(feedback)
    .set({
      status: feedbackStatus,
      updatedAt: now,
    })
    .where(eq(feedback.id, link.feedbackId))
    .returning()

  const statusLabel = resolveStatusLabel(feedbackStatus, integration.settings)
  const existingLabels = (payload.issue?.labels || [])
    .map((label) => label?.name?.trim())
    .filter((label): label is string => Boolean(label))
  const targetLabels = mergeMissingLabel(existingLabels, statusLabel)

  let labelPatched = false
  if (integration.accessToken && targetLabels.length !== existingLabels.length) {
    const patchResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${integration.accessToken}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Veerify',
      },
      body: JSON.stringify({
        labels: targetLabels,
      }),
    })

    labelPatched = patchResponse.ok
    if (!patchResponse.ok) {
      const errorBody = (await patchResponse.json().catch(() => null)) as { message?: string } | null
      logger.error('Failed to patch GitHub issue labels', { error: errorBody?.message || patchResponse.statusText })
    }
  }

  return createSuccessResponse({
    processed: true,
    event: githubEvent,
    deliveryId,
    action: payload.action,
    repository: repoFullName,
    issueNumber,
    stateReason: payload.issue?.state_reason ?? null,
    feedbackId: updatedFeedback?.id || link.feedbackId,
    feedbackStatus: updatedFeedback?.status || feedbackStatus,
    label: statusLabel,
    labelPatched,
  })
})
