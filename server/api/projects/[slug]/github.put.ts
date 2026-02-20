import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { githubIntegration } from '~/server/database/schema/feedback'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireProjectCategoryAccess } from '~/server/utils/project-categories'
import { validateBody } from '~/server/utils/validation'

const updateGithubIntegrationSchema = z.object({
  repoFullName: z.string()
    .trim()
    .min(1, 'Repository is required')
    .max(201, 'Repository is too long')
    .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'Repository must be in the format owner/repo'),
  accessToken: z.string().trim().min(1).max(500).optional(),
  syncEnabled: z.boolean().optional(),
  autoCreateIssues: z.boolean().optional(),
  autoSyncStatus: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectCategoryAccess(event)
  const body = await validateBody(event, updateGithubIntegrationSchema)
  const [owner, repo] = body.repoFullName.split('/')

  const [existing] = await db
    .select()
    .from(githubIntegration)
    .where(eq(githubIntegration.projectId, project.id))
    .limit(1)

  const oauthToken = getCookie(event, 'veerify_github_oauth_token')
  const accessToken = body.accessToken || oauthToken || existing?.accessToken || null

  if (!existing && !accessToken) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(
        ErrorCode.VALIDATION_ERROR,
        'Connect GitHub first so Veerify can access your repositories'
      ),
    })
  }

  const now = new Date()

  if (existing) {
    const [conflict] = await db
      .select()
      .from(githubIntegration)
      .where(
        and(
          eq(githubIntegration.owner, owner),
          eq(githubIntegration.repo, repo)
        )
      )
      .limit(1)

    if (conflict && conflict.projectId !== project.id) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(
          ErrorCode.CONFLICT,
          'This GitHub repository is already connected to another project'
        ),
      })
    }

    const [updated] = await db
      .update(githubIntegration)
      .set({
        owner,
        repo,
        ...(accessToken !== null && { accessToken }),
        ...(body.syncEnabled !== undefined && { syncEnabled: body.syncEnabled }),
        ...(body.autoCreateIssues !== undefined && { autoCreateIssues: body.autoCreateIssues }),
        ...(body.autoSyncStatus !== undefined && { autoSyncStatus: body.autoSyncStatus }),
        updatedAt: now,
      })
      .where(eq(githubIntegration.id, existing.id))
      .returning()

    deleteCookie(event, 'veerify_github_oauth_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    })

    return createSuccessResponse({
      id: updated.id,
      owner: updated.owner,
      repo: updated.repo,
      repoFullName: `${updated.owner}/${updated.repo}`,
      syncEnabled: updated.syncEnabled,
      autoCreateIssues: updated.autoCreateIssues,
      autoSyncStatus: updated.autoSyncStatus,
      hasAccessToken: Boolean(updated.accessToken),
      updatedAt: updated.updatedAt,
    })
  }

  const [conflict] = await db
    .select()
    .from(githubIntegration)
    .where(
      and(
        eq(githubIntegration.owner, owner),
        eq(githubIntegration.repo, repo)
      )
    )
    .limit(1)

  if (conflict) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(
        ErrorCode.CONFLICT,
        'This GitHub repository is already connected to another project'
      ),
    })
  }

  const [created] = await db
    .insert(githubIntegration)
    .values({
      id: crypto.randomUUID(),
      projectId: project.id,
      owner,
      repo,
      accessToken: accessToken!,
      syncEnabled: body.syncEnabled ?? true,
      autoCreateIssues: body.autoCreateIssues ?? false,
      autoSyncStatus: body.autoSyncStatus ?? true,
      settings: {},
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  deleteCookie(event, 'veerify_github_oauth_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  })

  return createSuccessResponse({
    id: created.id,
    owner: created.owner,
    repo: created.repo,
    repoFullName: `${created.owner}/${created.repo}`,
    syncEnabled: created.syncEnabled,
    autoCreateIssues: created.autoCreateIssues,
    autoSyncStatus: created.autoSyncStatus,
    hasAccessToken: Boolean(created.accessToken),
    updatedAt: created.updatedAt,
  })
})
