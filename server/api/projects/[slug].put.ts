/**
 * @openapi
 * /api/projects/{slug}:
 *   put:
 *     tags: [Projects]
 *     summary: Update project
 *     description: >
 *       Updates project fields. Project admins only. Every field is optional. The project is looked up by slug in the active workspace (override with the `X-Veerify-Organization` header when using an API key). Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *       `settings` REPLACES the stored settings object, it is not merged: send the complete object (including the module flags) or omitted keys fall back to their defaults. `settings: null` clears all settings and deletes uploaded logo and banner assets. Unknown keys are accepted and stored as-is.
 *       Tools are switched per project with the module flags in `settings`: feedbackEnabled (default true), roadmapEnabled, changelogEnabled, supportEnabled, marketingEnabled (default false). Set `customDomain` to a hostname to connect it, or null/empty to disconnect.
 *     operationId: updateProject
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         description: "Project slug"
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string, minLength: 1, maxLength: 100 }
 *               slug: { type: string, minLength: 1, maxLength: 100, pattern: "^[a-z0-9-]+$" }
 *               description: { type: string, maxLength: 1000, nullable: true }
 *               isPublic: { type: boolean }
 *               accessMode: { type: string, enum: [workspace, restricted] }
 *               customDomain: { type: string, maxLength: 253, nullable: true }
 *               settings:
 *                 type: object
 *                 nullable: true
 *                 additionalProperties: true
 *                 description: "Replaces the whole settings object; null clears it"
 *                 properties:
 *                   feedbackEnabled: { type: boolean, description: "Feedback tool (default true)" }
 *                   roadmapEnabled: { type: boolean, description: "Roadmap tool (default false)" }
 *                   changelogEnabled: { type: boolean, description: "Changelog tool (default false)" }
 *                   supportEnabled: { type: boolean, description: "Support tool (default false)" }
 *                   marketingEnabled: { type: boolean, description: "Marketing tool (default false)" }
 *                   accentColor: { type: string, pattern: "^#[0-9a-fA-F]{6}$" }
 *                   logoUrl: { type: string, maxLength: 2000, nullable: true }
 *                   bannerUrl: { type: string, maxLength: 2000, nullable: true }
 *                   logoAssetKey: { type: string, maxLength: 500, nullable: true }
 *                   bannerAssetKey: { type: string, maxLength: 500, nullable: true }
 *                   logoUploadId: { type: string, maxLength: 3000, description: "uploadId from POST /api/projects/{slug}/assets/presign (kind logo)" }
 *                   bannerUploadId: { type: string, maxLength: 3000, description: "uploadId from POST /api/projects/{slug}/assets/presign (kind banner)" }
 *                   showPoweredBy: { type: boolean }
 *                   showGithubFooter: { type: boolean }
 *                   themeMode: { type: string, enum: [system, light, dark] }
 *                   customFooterEnabled: { type: boolean }
 *                   customFooterBranding: { type: string, maxLength: 120, nullable: true }
 *                   customFooterText: { type: string, maxLength: 500, nullable: true }
 *                   customFooterPrimaryLabel: { type: string, maxLength: 80, nullable: true }
 *                   customFooterPrimaryUrl: { type: string, format: uri, maxLength: 500, nullable: true }
 *                   customFooterSecondaryLabel: { type: string, maxLength: 80, nullable: true }
 *                   customFooterSecondaryUrl: { type: string, format: uri, maxLength: 500, nullable: true }
 *                   voteStyle: { type: string, enum: [arrows, thumbs, rockets, hearts, stars, zap, plusminus] }
 *     responses:
 *       200: { description: "Updated project row" }
 *       400: { description: "Validation failed, invalid upload or invalid domain" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Caller is not a project admin" }
 *       404: { description: "Project not found in the active workspace" }
 *       409: { description: "Slug or custom domain already in use" }
 */
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import { createSuccessResponse, createErrorResponse, ErrorCode } from '~/server/utils/response'
import { validateBody, commonSchemas } from '~/server/utils/validation'
import { requireProjectCategoryAccess } from '~/server/utils/project-categories'
import { assertProjectSlugAllowed } from '~/server/utils/product-rules'
import { sendCustomDomainConnectedEmail } from '~/lib/email'
import { getStorageProvider } from '~/server/utils/storage'
import {
  buildDomainSettingsPatch,
  normalizeDomainSettings,
  registerProjectCustomDomain,
  removeProjectCustomDomain,
  validateProjectCustomDomain,
} from '~/server/services/domains/domain-service'
import {
  assertProjectDomainAvailable,
  detachProjectDomain,
  getStoredProviderDomain,
  persistProjectDomainResult,
} from '~/server/services/domains/domain-repository'
import {
  buildFinalObjectKey,
  transformImageForKind,
  validateImageUploadInput,
  type UploadAssetKind,
} from '~/server/utils/storage/media'
import { verifyUploadToken } from '~/server/utils/upload-token'
import { createLogger } from '~/server/utils/logger'
import type { DomainProviderResult } from '~/server/services/domains/provider'

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
  accessMode: z.enum(['workspace', 'restricted']).optional(),
  customDomain: z.string().max(253, 'Domain too long').nullable().optional(),
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
  const { project: currentProject, session } = await requireProjectCategoryAccess(event, { admin: true })
  const body = await validateBody(event, updateProjectSchema)
  const currentSettings = normalizeDomainSettings(currentProject.settings)
  const requestedDomain =
    body.customDomain === undefined
      ? undefined
      : body.customDomain?.trim()
        ? validateProjectCustomDomain(body.customDomain)
        : null
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
  let domainRegistration: DomainProviderResult | null = null

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
      await assertProjectDomainAvailable(requestedDomain, currentProject.id)
      domainRegistration = await registerProjectCustomDomain(requestedDomain)
      const domainSettingsBase = nextSettings === null ? {} : nextSettings
      nextSettings = buildDomainSettingsPatch(domainSettingsBase, domainRegistration)
    } else {
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
    assertProjectSlugAllowed(body.slug)
    const [conflict] = await db
      .select()
      .from(project)
      .where(and(eq(project.organizationId, currentProject.organizationId), eq(project.slug, body.slug)))
      .limit(1)

    if (conflict) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(ErrorCode.CONFLICT, 'A project with this slug already exists in this workspace'),
      })
    }
  }

  const previousDomainRef =
    domainChanged && currentProject.customDomain && currentProject.customDomain !== requestedDomain
      ? await getStoredProviderDomain(currentProject.customDomain)
      : null

  const updated = await db.transaction(async (tx) => {
    const [updatedProject] = await tx
      .update(project)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.slug !== undefined && { slug: body.slug }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.isPublic !== undefined && { isPublic: body.isPublic }),
        ...(body.accessMode !== undefined && { accessMode: body.accessMode }),
        ...(body.customDomain !== undefined && { customDomain: requestedDomain }),
        ...((body.settings !== undefined || shouldNotifyConnected || domainChanged) && { settings: settingsForUpdate }),
        updatedAt: new Date(),
      })
      .where(eq(project.id, currentProject.id))
      .returning()

    if (domainChanged) {
      if (currentProject.customDomain && currentProject.customDomain !== requestedDomain) {
        await detachProjectDomain(currentProject.id, currentProject.customDomain, tx)
      }
      if (domainRegistration) {
        await persistProjectDomainResult(currentProject.id, domainRegistration, tx)
      }
    }

    return updatedProject
  })

  if (domainChanged && currentProject.customDomain && currentProject.customDomain !== requestedDomain) {
    try {
      await removeProjectCustomDomain(currentProject.customDomain, {
        providerDomainId: previousDomainRef?.providerDomainId,
      })
    } catch (err) {
      logger.error('Failed to detach previous custom domain from provider', {
        domain: currentProject.customDomain,
        projectId: currentProject.id,
        error: err instanceof Error ? err.message : err,
      })
    }
  }

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
