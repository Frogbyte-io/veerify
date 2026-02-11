import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { organization } from '~/server/database/schema/auth'
import { requireAuth } from '~/server/utils/auth-middleware'
import { assertOrganizationSlugAvailable, getOrganizationDetails, requireOrganizationRoleBySlug } from '~/server/utils/organization-access'
import { requireRateLimit, rateLimits } from '~/server/utils/rate-limit'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { validateBody, commonSchemas } from '~/server/utils/validation'

const updateOrganizationSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    slug: commonSchemas.slug.optional(),
    logo: commonSchemas.url.nullable().optional(),
  })
  .refine((value) => value.name !== undefined || value.slug !== undefined || value.logo !== undefined, {
    message: 'At least one field must be provided',
    path: ['name'],
  })

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  await requireRateLimit(event, rateLimits.standard)

  const slug = getRouterParam(event, 'slug')
  if (!slug) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Organization slug is required'),
    })
  }

  const body = await validateBody(event, updateOrganizationSchema)
  const { org } = await requireOrganizationRoleBySlug(session, slug, ['owner', 'admin'])

  if (body.slug && body.slug !== org.slug) {
    await assertOrganizationSlugAvailable(body.slug, org.id)
  }

  const [updatedOrg] = await db
    .update(organization)
    .set({
      name: body.name?.trim() ?? org.name,
      slug: body.slug ?? org.slug,
      logo: body.logo === undefined ? org.logo : body.logo,
      updatedAt: new Date(),
    })
    .where(eq(organization.id, org.id))
    .returning()

  const data = await getOrganizationDetails(updatedOrg.id, session.user.id)
  return createSuccessResponse(data)
})
