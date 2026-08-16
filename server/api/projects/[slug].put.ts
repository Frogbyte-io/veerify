import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import { createSuccessResponse, createErrorResponse, ErrorCode } from '~/server/utils/response'
import { validateBody, commonSchemas } from '~/server/utils/validation'
import { requireProjectCategoryAccess } from '~/server/utils/project-categories'
import { sendCustomDomainConnectedEmail } from '~/lib/email'
import { getStorageProvider } from '~/server/utils/storage'
import {
  buildDomainSettingsPatch,
  normalizeCustomDomainInput,
  normalizeDomainSettings,
  registerProjectCustomDomain,
  removeProjectCustomDomain,
} from '~/server/services/domains/domain-service'
import {
  buildFinalObjectKey,
  transformImageForKind,
  validateImageUploadInput,
  type UploadAssetKind,
} from '~/server/utils/storage/media'
import { verifyUploadToken } from '~/server/utils/upload-token'
import { createLogger } from '~/server/utils/logger'

const logger = createLogger('projects')

const projectSettingsSchema = z
  .object({
    accentColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Invalid color')
      .optional(),
    logoUrl: z.string().max(2000).optional().nullable(),
    bannerUrl: z.string().max(2000).optional().nullable(),
    logoAssetKey: z.string().max(500).optional().nullable(),
    bannerAssetKey: z.string().max(500).optional().nullable(),
    logoUploadId: z.string().max(3000).optional(),
    bannerUploadId: z.string().max(3000).optional(),
    showPoweredBy: z.boolean().optional(),
    showGithubFooter: z.boolean().optional(),
    themeMode: z.enum(['system', 'light', 'dark']).optional(),
    customFooterEnabled: z.boolean().optional(),
    customFooterBranding: z.string().max(120).optional().nullable(),
    customFooterText: z.string().max(500).optional().nullable(),
    customFooterPrimaryLabel: z.string().max(80).optional().nullable(),
    customFooterPrimaryUrl: z.string().url().max(500).optional().nullable(),
    customFooterSecondaryLabel: z.string().max(80).optional().nullable(),
    customFooterSecondaryUrl: z.string().url().max(500).optional().nullable(),
    voteStyle: z.enum(['arrows', 'thumbs', 'rockets', 'hearts', 'stars', 'zap', 'plusminus']).optional(),
  })
  .passthrough()
  .nullable()
  .optional()

const updateProjectSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long').optional(),
  slug: commonSchemas.slug.optional(),
  description: z.string().max(1000, 'Description too long').nullable().optional(),
  isPublic: z.boolean().optional(),
  customDomain: z
    .string()
    .max(253, 'Domain too long')
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/, 'Invalid domain format')
    .nullable()
    .optional(),
  settings: projectSettingsSchema,
})

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

async function consumeUploadAsset(input: {
  uploadId: string
  kind: UploadAssetKind
  projectId: string
  userId: string
  getStorage: () => ReturnType<typeof getStorageProvider>
}) {
  const payload = verifyUploadToken(input.uploadId)

  if (payload.projectId !== input.projectId) {
    validationError('Upload does not belong to this project')
  }
  if (payload.userId !== input.userId) {
    validationError('Upload does not belong to the current user')
  }
  if (payload.kind !== input.kind) {
    validationError(`Upload kind mismatch. Expected ${input.kind}`)
  }

  const storage = input.getStorage()
  let sourceBuffer: Buffer
  try {
    sourceBuffer = await storage.getObject(payload.tempKey)
  } catch {
    validationError('Uploaded file was not found or has expired')
  }

  validateImageUploadInput(payload.kind, payload.contentType, sourceBuffer.byteLength)
  const transformed = await transformImageForKind(sourceBuffer, payload.kind)
  const finalAssetKey = buildFinalObjectKey(input.projectId, input.kind)
  await storage.putObject({
    key: finalAssetKey,
    buffer: transformed.buffer,
    contentType: transformed.contentType,
    cacheControl: 'public, max-age=31536000, immutable',
  })

  storage.deleteObject(payload.tempKey).catch((err) => {
    logger.error('Failed to delete temporary uploaded asset', { error: err instanceof Error ? err.message : err })
  })

  return {
    assetKey: finalAssetKey,
    url: storage.getPublicUrl(finalAssetKey),
  }
}

export default defineEventHandler(async (event) => {
  const { project: currentProject, session } = await requireProjectCategoryAccess(event)
  const body = await validateBody(event, updateProjectSchema)
  const currentSettings = normalizeDomainSettings(currentProject.settings)
  const requestedDomain =
    body.customDomain !== undefined ? normalizeCustomDomainInput(body.customDomain || null) : undefined
  const domainChanged = requestedDomain !== undefined && requestedDomain !== (currentProject.customDomain || null)
  const shouldNotifyConnected = Boolean(
    domainChanged &&
    requestedDomain &&
    session?.user?.email &&
    currentSettings.domainConnectedEmailSentFor !== requestedDomain
  )

  let storageProvider: ReturnType<typeof getStorageProvider> | null = null
  const getStorage = () => {
    if (!storageProvider) {
      storageProvider = getStorageProvider()
    }
    return storageProvider
  }

  const previousManagedLogoKey = isManagedAssetKey(currentSettings.logoAssetKey) ? currentSettings.logoAssetKey : null
  const previousManagedBannerKey = isManagedAssetKey(currentSettings.bannerAssetKey)
    ? currentSettings.bannerAssetKey
    : null
  const pendingDeletes = new Set<string>()

  let nextSettings =
    body.settings === undefined
      ? { ...currentSettings }
      : body.settings === null
        ? null
        : normalizeDomainSettings(body.settings)

  if (nextSettings === null) {
    if (previousManagedLogoKey) pendingDeletes.add(previousManagedLogoKey)
    if (previousManagedBannerKey) pendingDeletes.add(previousManagedBannerKey)
  }

  if (nextSettings && typeof nextSettings === 'object') {
    const logoUploadId = typeof nextSettings.logoUploadId === 'string' ? nextSettings.logoUploadId.trim() : ''
    const bannerUploadId = typeof nextSettings.bannerUploadId === 'string' ? nextSettings.bannerUploadId.trim() : ''

    if (logoUploadId) {
      const processedLogo = await consumeUploadAsset({
        uploadId: logoUploadId,
        kind: 'logo',
        projectId: currentProject.id,
        userId: session.user.id,
        getStorage,
      })
      nextSettings.logoAssetKey = processedLogo.assetKey
      nextSettings.logoUrl = processedLogo.url
      if (previousManagedLogoKey && previousManagedLogoKey !== processedLogo.assetKey) {
        pendingDeletes.add(previousManagedLogoKey)
      }
    }

    if (bannerUploadId) {
      const processedBanner = await consumeUploadAsset({
        uploadId: bannerUploadId,
        kind: 'banner',
        projectId: currentProject.id,
        userId: session.user.id,
        getStorage,
      })
      nextSettings.bannerAssetKey = processedBanner.assetKey
      nextSettings.bannerUrl = processedBanner.url
      if (previousManagedBannerKey && previousManagedBannerKey !== processedBanner.assetKey) {
        pendingDeletes.add(previousManagedBannerKey)
      }
    }

    if (nextSettings.logoUrl === null) {
      nextSettings.logoAssetKey = null
      if (previousManagedLogoKey) {
        pendingDeletes.add(previousManagedLogoKey)
      }
    }
    if (nextSettings.bannerUrl === null) {
      nextSettings.bannerAssetKey = null
      if (previousManagedBannerKey) {
        pendingDeletes.add(previousManagedBannerKey)
      }
    }

    delete nextSettings.logoUploadId
    delete nextSettings.bannerUploadId
  }

  if (domainChanged) {
    if (requestedDomain) {
      const domainRegistration = await registerProjectCustomDomain(requestedDomain)
      const domainSettingsBase = nextSettings === null ? {} : nextSettings
      nextSettings = buildDomainSettingsPatch(domainSettingsBase, domainRegistration)
    } else {
      if (currentProject.customDomain) {
        await removeProjectCustomDomain(currentProject.customDomain)
      }
      const domainSettingsBase = nextSettings === null ? {} : nextSettings
      nextSettings = buildDomainSettingsPatch(domainSettingsBase, null)
    }
  }

  const notifySettingsBase = nextSettings && typeof nextSettings === 'object' ? nextSettings : {}
  const settingsForUpdate = shouldNotifyConnected
    ? {
        ...notifySettingsBase,
        domainConnectedEmailSentFor: requestedDomain,
        domainConnectedEmailSentAt: new Date().toISOString(),
      }
    : nextSettings

  if (body.slug && body.slug !== currentProject.slug) {
    const [conflict] = await db
      .select()
      .from(project)
      .where(and(eq(project.teamId, currentProject.teamId), eq(project.slug, body.slug)))
      .limit(1)

    if (conflict) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(ErrorCode.CONFLICT, 'A project with this slug already exists in this team'),
      })
    }
  }

  const [updated] = await db
    .update(project)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.slug !== undefined && { slug: body.slug }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.isPublic !== undefined && { isPublic: body.isPublic }),
      ...(body.customDomain !== undefined && { customDomain: requestedDomain }),
      ...((body.settings !== undefined || shouldNotifyConnected || domainChanged) && { settings: settingsForUpdate }),
      updatedAt: new Date(),
    })
    .where(eq(project.id, currentProject.id))
    .returning()

  if (shouldNotifyConnected) {
    sendCustomDomainConnectedEmail({
      to: session.user.email,
      name: session.user.name || 'there',
      projectName: updated.name,
      domain: requestedDomain!,
    }).catch((err) => {
      logger.error('Failed to send custom domain connected email', {
        projectName: updated.name,
        error: err instanceof Error ? err.message : err,
      })
    })
  }

  if (pendingDeletes.size > 0) {
    const storage = getStorage()
    for (const key of pendingDeletes) {
      storage.deleteObject(key).catch((err) => {
        logger.error('Failed to delete replaced asset', { key, error: err instanceof Error ? err.message : err })
      })
    }
  }

  return createSuccessResponse(updated)
})
