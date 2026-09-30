import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { organization } from '~/server/database/schema/auth'
import { requireAuth } from '~/server/utils/auth-middleware'
import {
  assertOrganizationSlugAvailable,
  getOrganizationDetails,
  requireOrganizationRoleBySlug,
} from '~/server/utils/organization-access'
import { requireRateLimit, rateLimits } from '~/server/utils/rate-limit'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { validateBody, commonSchemas } from '~/server/utils/validation'
import { getStorageProvider } from '~/server/utils/storage'
import { buildFinalObjectKey, transformImageForKind, validateImageUploadInput } from '~/server/utils/storage/media'
import { createLogger } from '~/server/utils/logger'
import { verifyUploadToken } from '~/server/utils/upload-token'

const logger = createLogger('orgs')

const updateOrganizationSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    slug: commonSchemas.slug.optional(),
    logo: commonSchemas.url.nullable().optional(),
    logoUploadId: z.string().max(3000).optional(),
    settings: z
      .object({
        billingCcEmails: z.array(z.string().trim().email()).max(10).optional(),
      })
      .strict()
      .optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.slug !== undefined ||
      value.logo !== undefined ||
      value.logoUploadId !== undefined ||
      value.settings !== undefined,
    {
      message: 'At least one field must be provided',
      path: ['name'],
    }
  )

function normalizeSettings(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return { ...(value as Record<string, any>) }
}

function validationError(message: string): never {
  throw createError({
    statusCode: 400,
    statusMessage: 'Validation failed',
    data: createErrorResponse(ErrorCode.VALIDATION_ERROR, message),
  })
}

function isManagedAssetKey(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('projects/')
}

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
  const previousSettings = normalizeSettings(org.settings)
  const previousManagedLogoKey = isManagedAssetKey(previousSettings.logoAssetKey) ? previousSettings.logoAssetKey : null
  const pendingDeletes = new Set<string>()
  let nextLogo = body.logo === undefined ? org.logo : body.logo
  const nextSettings = body.settings === undefined ? previousSettings : { ...previousSettings, ...body.settings }

  if (body.slug && body.slug !== org.slug) {
    await assertOrganizationSlugAvailable(body.slug, org.id)
  }

  if (body.settings?.billingCcEmails !== undefined) {
    nextSettings.billingCcEmails = Array.from(
      new Set(body.settings.billingCcEmails.map((email) => email.trim().toLowerCase()))
    )
  }

  if (body.logoUploadId && body.logoUploadId.trim()) {
    const uploadPayload = verifyUploadToken(body.logoUploadId.trim())
    if (uploadPayload.projectId !== org.id) {
      validationError('Upload does not belong to this organization')
    }
    if (uploadPayload.userId !== session.user.id) {
      validationError('Upload does not belong to the current user')
    }
    if (uploadPayload.kind !== 'logo') {
      validationError('Upload kind mismatch. Expected logo')
    }

    const storage = getStorageProvider()
    let sourceBuffer: Buffer
    try {
      sourceBuffer = await storage.getObject(uploadPayload.tempKey)
    } catch {
      validationError('Uploaded file was not found or has expired')
    }

    validateImageUploadInput('logo', uploadPayload.contentType, sourceBuffer.byteLength)
    const transformed = await transformImageForKind(sourceBuffer, 'logo')
    const finalAssetKey = buildFinalObjectKey(org.id, 'logo')
    await storage.putObject({
      key: finalAssetKey,
      buffer: transformed.buffer,
      contentType: transformed.contentType,
      cacheControl: 'public, max-age=31536000, immutable',
    })

    storage.deleteObject(uploadPayload.tempKey).catch((err) => {
      logger.error('Failed to delete temporary uploaded organization logo', {
        error: err instanceof Error ? err.message : err,
      })
    })

    nextLogo = storage.getPublicUrl(finalAssetKey)
    nextSettings.logoAssetKey = finalAssetKey

    if (previousManagedLogoKey && previousManagedLogoKey !== finalAssetKey) {
      pendingDeletes.add(previousManagedLogoKey)
    }
  } else if (body.logo === null) {
    nextSettings.logoAssetKey = null
    if (previousManagedLogoKey) {
      pendingDeletes.add(previousManagedLogoKey)
    }
  } else if (body.logo !== undefined && previousManagedLogoKey) {
    nextSettings.logoAssetKey = null
    pendingDeletes.add(previousManagedLogoKey)
  }

  const [updatedOrg] = await db
    .update(organization)
    .set({
      name: body.name?.trim() ?? org.name,
      slug: body.slug ?? org.slug,
      logo: nextLogo,
      settings: nextSettings,
      updatedAt: new Date(),
    })
    .where(eq(organization.id, org.id))
    .returning()

  if (pendingDeletes.size > 0) {
    const storage = getStorageProvider()
    for (const key of pendingDeletes) {
      storage.deleteObject(key).catch((err) => {
        logger.error('Failed to delete replaced organization logo', {
          key,
          error: err instanceof Error ? err.message : err,
        })
      })
    }
  }

  const data = await getOrganizationDetails(updatedOrg.id, session.user.id)
  return createSuccessResponse(data)
})
