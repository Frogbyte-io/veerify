import { asc, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { feedbackStatus, project } from '~/server/database/schema/feedback'
import { reviewRequest, type ReviewPlatform, reviewRequestSettings } from '~/server/database/schema/marketing'
import { SYSTEM_STATUSES } from './project-statuses'
import { createErrorResponse, ErrorCode } from './response'

export const MAX_REVIEW_PLATFORMS = 6

/** The statuses a product's feedback can be in: its custom statuses, or the system defaults. */
export async function listProductStatuses(projectId: string): Promise<Array<{ value: string; name: string }>> {
  const custom = await db
    .select({ value: feedbackStatus.value, name: feedbackStatus.name })
    .from(feedbackStatus)
    .where(eq(feedbackStatus.projectId, projectId))
    .orderBy(asc(feedbackStatus.sortOrder))
  if (custom.length > 0) return custom
  return SYSTEM_STATUSES.map((s) => ({ value: s.value, name: s.name }))
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

const platformSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-z0-9_-]{1,40}$/, 'Platform id must be lowercase letters, digits, - or _')
    .optional(),
  label: z.string().trim().min(1, 'Label is required').max(40, 'Label must be 40 characters or fewer'),
  url: z
    .string()
    .trim()
    .max(500, 'URL must be 500 characters or fewer')
    .refine(isHttpsUrl, 'URL must start with https://'),
})

export const reviewSettingsSchema = z
  .object({
    enabled: z.boolean(),
    platforms: z.array(platformSchema).max(MAX_REVIEW_PLATFORMS, `At most ${MAX_REVIEW_PLATFORMS} platforms`),
    askForTestimonial: z.boolean(),
    csatTrigger: z.boolean(),
    csatMinRating: z.number().int().min(0).max(10).nullable(),
    shippedTrigger: z.boolean(),
    shippedStatusValues: z.array(z.string().trim().min(1).max(100)).max(30),
    cooldownDays: z.number().int().min(1).max(730),
  })
  .refine((value) => !value.enabled || value.platforms.length > 0 || value.askForTestimonial, {
    message: 'Add at least one platform or turn on testimonial requests before enabling',
    path: ['platforms'],
  })

export type ReviewSettingsInput = z.infer<typeof reviewSettingsSchema>

export function validationError(message: string): never {
  throw createError({
    statusCode: 400,
    statusMessage: 'Bad Request',
    data: createErrorResponse(ErrorCode.VALIDATION_ERROR, message),
  })
}

export function notFound(message: string): never {
  throw createError({
    statusCode: 404,
    statusMessage: 'Not Found',
    data: createErrorResponse(ErrorCode.NOT_FOUND, message),
  })
}

/** Token lookups are exact matches on an unguessable 43-character token. */
export async function findReviewRequestByToken(token: string) {
  if (!token || token.length < 32 || token.length > 128) return null
  const [row] = await db
    .select({
      id: reviewRequest.id,
      projectId: reviewRequest.projectId,
      teamId: reviewRequest.teamId,
      email: reviewRequest.email,
      name: reviewRequest.name,
      clickedAt: reviewRequest.clickedAt,
      projectName: project.name,
      platforms: reviewRequestSettings.platforms,
      askForTestimonial: reviewRequestSettings.askForTestimonial,
    })
    .from(reviewRequest)
    .innerJoin(project, eq(project.id, reviewRequest.projectId))
    .leftJoin(reviewRequestSettings, eq(reviewRequestSettings.projectId, reviewRequest.projectId))
    .where(eq(reviewRequest.token, token))
    .limit(1)
  if (!row) return null
  return { ...row, platforms: (row.platforms ?? []) as ReviewPlatform[] }
}

export function firstNameOf(name: string | null): string | null {
  const first = name?.trim().split(/\s+/)[0]
  return first ? first.slice(0, 40) : null
}
