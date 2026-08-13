import { randomUUID, createHash } from 'node:crypto'
import { and, asc, desc, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '~/server/database/drizzle'
import {
  feedback,
  feedbackCategory,
  feedbackComment,
  feedbackStatus,
  feedbackSubscription,
  project,
} from '~/server/database/schema/feedback'
import { changelogPost } from '~/server/database/schema/changelog'
import { importRun, importRunIssue } from '~/server/database/schema/imports'
import { getStorageProvider } from '~/server/utils/storage'
import { SYSTEM_STATUSES } from '~/server/utils/project-statuses'
import { toCategorySlug } from '~/server/utils/project-categories'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import { analyzeCsvImport } from './providers/csv'
import { analyzeSleekplanImport } from './providers/sleekplan'
import type {
  AnalyzeImportInput,
  CanonicalChangelogRecord,
  CanonicalCommentRecord,
  CanonicalFeedbackRecord,
  CanonicalImportIssue,
  CanonicalImportSnapshot,
  CategoryMapping,
  DuplicatePolicy,
  ImportAnalysisResult,
  ImportAnalysisSummary,
  ImportContentScope,
  ImportMappingConfig,
  StatusMapping,
} from './types'
import { buildImportContentHash, normalizeCategorySlug, normalizeStatusValue } from './utils'

const IMPORT_SNAPSHOT_CONTENT_TYPE = 'application/json; charset=utf-8'
const IMPORT_BATCH_SIZE = 25

const DEFAULT_CONTENT_SCOPE: ImportContentScope = {
  feedback: true,
  roadmap: true,
  changelog: true,
  comments: true,
  subscriptions: true,
}

function createNotFoundError(message: string): never {
  throw createError({
    statusCode: 404,
    statusMessage: 'Not Found',
    data: createErrorResponse(ErrorCode.NOT_FOUND, message),
  })
}

function createConflictError(message: string): never {
  throw createError({
    statusCode: 409,
    statusMessage: 'Conflict',
    data: createErrorResponse(ErrorCode.CONFLICT, message),
  })
}

function mergeContentScope(scope?: Partial<ImportContentScope> | null): ImportContentScope {
  return {
    ...DEFAULT_CONTENT_SCOPE,
    ...(scope || {}),
  }
}

function snapshotStorageKey(projectId: string, runId: string) {
  return `imports/${projectId}/${runId}/snapshot.json`
}

function extractImportMeta(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object') return null
  const importSource = (metadata as Record<string, any>).importSource
  if (!importSource || typeof importSource !== 'object') return null
  return importSource as Record<string, any>
}

function sourceKey(provider: string, externalId?: string | null) {
  return externalId ? `${provider}:${externalId}` : null
}

function buildSourceMetadata(params: {
  provider: string
  externalId: string
  importRunId: string
  contentHash: string
  sourceKind?: string | null
  extra?: Record<string, any> | null
}) {
  return {
    importSource: {
      provider: params.provider,
      externalId: params.externalId,
      importRunId: params.importRunId,
      contentHash: params.contentHash,
      ...(params.sourceKind ? { sourceKind: params.sourceKind } : {}),
      ...(params.extra || {}),
    },
  }
}

function mergeMetadata(existing: unknown, next: Record<string, any>) {
  const current = existing && typeof existing === 'object' ? (existing as Record<string, any>) : {}
  return {
    ...current,
    ...next,
  }
}

function buildFeedbackHash(sourceType: string, record: CanonicalFeedbackRecord) {
  return buildImportContentHash({
    sourceType,
    title: record.title,
    body: record.body,
    createdAt: record.createdAt,
  })
}

function buildChangelogHash(sourceType: string, record: CanonicalChangelogRecord) {
  return buildImportContentHash({
    sourceType,
    title: record.title,
    body: record.body,
    createdAt: record.createdAt,
  })
}

function buildCommentHash(record: CanonicalCommentRecord) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        feedbackExternalId: record.feedbackExternalId,
        body: record.body,
        authorName: record.authorName || null,
        authorEmail: record.authorEmail || null,
        createdAt: record.createdAt || null,
      })
    )
    .digest('hex')
}

function buildCategoryMappings(snapshot: CanonicalImportSnapshot, existingCategories: Array<typeof feedbackCategory.$inferSelect>) {
  const existingBySlug = new Map(existingCategories.map((category) => [normalizeCategorySlug(category.slug || category.name), category]))
  const mappings: Record<string, CategoryMapping> = {}

  for (const category of snapshot.categories) {
    const sourceKeyValue = normalizeCategorySlug(category.slug || category.name) || category.externalId
    const existing = existingBySlug.get(sourceKeyValue)
    mappings[sourceKeyValue] = existing
      ? {
          sourceKey: sourceKeyValue,
          sourceName: category.name,
          mode: 'existing',
          targetId: existing.id,
          targetName: existing.name,
        }
      : {
          sourceKey: sourceKeyValue,
          sourceName: category.name,
          mode: 'create',
          targetName: category.name,
        }
  }

  return mappings
}

function buildStatusMappings(
  snapshot: CanonicalImportSnapshot,
  existingStatuses: Array<{ id?: string; name: string; value: string; color?: string | null }>
) {
  const statusByValue = new Map(existingStatuses.map((status) => [normalizeStatusValue(status.value || status.name), status]))
  const mappings: Record<string, StatusMapping> = {}

  for (const status of snapshot.statuses) {
    const sourceKeyValue = normalizeStatusValue(status.value || status.name) || status.externalId
    const existing = statusByValue.get(sourceKeyValue)
    if (existing) {
      const mode = 'id' in existing ? 'existing' : 'system'
      mappings[sourceKeyValue] = {
        sourceKey: sourceKeyValue,
        sourceName: status.name,
        mode,
        targetValue: existing.value,
        targetName: existing.name,
      }
      continue
    }

    mappings[sourceKeyValue] = {
      sourceKey: sourceKeyValue,
      sourceName: status.name,
      mode: 'create',
      targetValue: sourceKeyValue,
      targetName: status.name,
    }
  }

  return mappings
}

async function persistSnapshot(projectId: string, runId: string, snapshot: CanonicalImportSnapshot) {
  const storage = getStorageProvider()
  const key = snapshotStorageKey(projectId, runId)
  await storage.putObject({
    key,
    buffer: Buffer.from(JSON.stringify(snapshot)),
    contentType: IMPORT_SNAPSHOT_CONTENT_TYPE,
  })
  return key
}

async function loadSnapshot(projectId: string, runId: string): Promise<CanonicalImportSnapshot> {
  const storage = getStorageProvider()
  const buffer = await storage.getObject(snapshotStorageKey(projectId, runId))
  return JSON.parse(buffer.toString('utf8')) as CanonicalImportSnapshot
}

function buildSummary(snapshot: CanonicalImportSnapshot, duplicates: { feedback: number; changelog: number }): ImportAnalysisSummary {
  return {
    counts: {
      categories: snapshot.categories.length,
      statuses: snapshot.statuses.length,
      feedback: snapshot.feedback.length,
      roadmapEntries: snapshot.roadmapEntries.length,
      changelogEntries: snapshot.changelogEntries.length,
      comments: snapshot.comments.length,
      subscriptions: snapshot.subscriptions.length,
    },
    duplicates,
    warnings: snapshot.warnings.length,
  }
}

async function buildDuplicateSummary(projectId: string, snapshot: CanonicalImportSnapshot) {
  const existingFeedback = await db.select().from(feedback).where(eq(feedback.projectId, projectId))
  const existingChangelog = await db.select().from(changelogPost).where(eq(changelogPost.projectId, projectId))

  const feedbackKeys = new Set(
    existingFeedback.flatMap((item) => {
      const meta = extractImportMeta(item.metadata)
      const keys = []
      const externalKey = sourceKey(snapshot.sourceType, typeof meta?.externalId === 'string' ? meta.externalId : null)
      if (externalKey) keys.push(externalKey)
      const hash = typeof meta?.contentHash === 'string' ? meta.contentHash : null
      if (hash) keys.push(`hash:${hash}`)
      return keys
    })
  )

  const changelogKeys = new Set(
    existingChangelog.flatMap((item) => {
      const meta = extractImportMeta(item.metadata)
      const keys = []
      const externalKey = sourceKey(snapshot.sourceType, typeof meta?.externalId === 'string' ? meta.externalId : null)
      if (externalKey) keys.push(externalKey)
      const hash = typeof meta?.contentHash === 'string' ? meta.contentHash : null
      if (hash) keys.push(`hash:${hash}`)
      return keys
    })
  )

  let feedbackDuplicateCount = 0
  for (const record of [...snapshot.feedback, ...snapshot.roadmapEntries]) {
    if (feedbackKeys.has(sourceKey(snapshot.sourceType, record.externalId) || '')) {
      feedbackDuplicateCount += 1
      continue
    }
    if (feedbackKeys.has(`hash:${buildFeedbackHash(snapshot.sourceType, record)}`)) {
      feedbackDuplicateCount += 1
    }
  }

  let changelogDuplicateCount = 0
  for (const record of snapshot.changelogEntries) {
    if (changelogKeys.has(sourceKey(snapshot.sourceType, record.externalId) || '')) {
      changelogDuplicateCount += 1
      continue
    }
    if (changelogKeys.has(`hash:${buildChangelogHash(snapshot.sourceType, record)}`)) {
      changelogDuplicateCount += 1
    }
  }

  return {
    feedback: feedbackDuplicateCount,
    changelog: changelogDuplicateCount,
  }
}

async function insertRunIssues(runId: string, issues: CanonicalImportIssue[]) {
  if (!issues.length) return

  await db.insert(importRunIssue).values(
    issues.map((issue) => ({
      id: randomUUID(),
      runId,
      severity: issue.severity,
      entityType: issue.entityType,
      externalId: issue.externalId || null,
      message: issue.message,
      details: issue.details || null,
      createdAt: new Date(),
    }))
  )
}

function serializeRun(record: typeof importRun.$inferSelect, issues: Array<typeof importRunIssue.$inferSelect>) {
  const progressTotal = record.progressTotal || 0
  const progressCompleted = record.progressCompleted || 0
  return {
    ...record,
    progressPercent: progressTotal > 0 ? Math.min(100, Math.round((progressCompleted / progressTotal) * 100)) : 0,
    issues,
  }
}

export async function listImportRuns(projectId: string) {
  return db.select().from(importRun).where(eq(importRun.projectId, projectId)).orderBy(desc(importRun.createdAt))
}

export async function getImportRunDetail(projectId: string, runId: string) {
  const [runRecord] = await db
    .select()
    .from(importRun)
    .where(and(eq(importRun.id, runId), eq(importRun.projectId, projectId)))
    .limit(1)

  if (!runRecord) {
    createNotFoundError('Import run not found')
  }

  const issues = await db.select().from(importRunIssue).where(eq(importRunIssue.runId, runId)).orderBy(asc(importRunIssue.createdAt))
  return serializeRun(runRecord, issues)
}

async function analyzeBySource(input: AnalyzeImportInput) {
  if (input.sourceType === 'sleekplan') {
    return analyzeSleekplanImport(input)
  }
  return analyzeCsvImport(input)
}

export async function analyzeImportForProject(params: {
  projectId: string
  createdByUserId: string
  input: AnalyzeImportInput
}): Promise<ImportAnalysisResult & { runId: string }> {
  const snapshot = await analyzeBySource(params.input)
  const contentScope = mergeContentScope(params.input.contentScope)
  const filteredSnapshot: CanonicalImportSnapshot = {
    ...snapshot,
    feedback: contentScope.feedback ? snapshot.feedback : [],
    roadmapEntries: contentScope.roadmap ? snapshot.roadmapEntries : [],
    changelogEntries: contentScope.changelog ? snapshot.changelogEntries : [],
    comments: contentScope.comments ? snapshot.comments : [],
    subscriptions: contentScope.subscriptions ? snapshot.subscriptions : [],
  }

  const [existingCategories, existingCustomStatuses] = await Promise.all([
    db.select().from(feedbackCategory).where(eq(feedbackCategory.projectId, params.projectId)).orderBy(feedbackCategory.sortOrder),
    db.select().from(feedbackStatus).where(eq(feedbackStatus.projectId, params.projectId)).orderBy(feedbackStatus.sortOrder),
  ])

  const duplicateSummary = await buildDuplicateSummary(params.projectId, filteredSnapshot)
  const mappingConfig: ImportMappingConfig = {
    duplicatePolicy: 'skip_existing',
    contentScope,
    categoryMappings: buildCategoryMappings(filteredSnapshot, existingCategories),
    statusMappings: buildStatusMappings(filteredSnapshot, existingCustomStatuses.length > 0 ? existingCustomStatuses : SYSTEM_STATUSES),
  }
  const summary = buildSummary(filteredSnapshot, duplicateSummary)

  const runId = randomUUID()
  const snapshotKey = await persistSnapshot(params.projectId, runId, filteredSnapshot)
  const now = new Date()

  await db.insert(importRun).values({
    id: runId,
    projectId: params.projectId,
    createdByUserId: params.createdByUserId,
    sourceType: filteredSnapshot.sourceType,
    sourceMode: filteredSnapshot.sourceMode,
    status: 'ready',
    contentScope,
    mappingConfig,
    summary,
    progressCompleted: 0,
    progressTotal:
      filteredSnapshot.feedback.length +
      filteredSnapshot.roadmapEntries.length +
      filteredSnapshot.comments.length +
      filteredSnapshot.subscriptions.length +
      filteredSnapshot.changelogEntries.length,
    snapshotKey,
    createdAt: now,
    updatedAt: now,
  })

  await insertRunIssues(runId, filteredSnapshot.warnings)

  return {
    runId,
    snapshot: filteredSnapshot,
    summary,
    mappingConfig,
    issues: filteredSnapshot.warnings,
  }
}

type ExistingFeedbackCache = {
  byExternal: Map<string, typeof feedback.$inferSelect>
  byHash: Map<string, typeof feedback.$inferSelect>
}

type ExistingChangelogCache = {
  byExternal: Map<string, typeof changelogPost.$inferSelect>
  byHash: Map<string, typeof changelogPost.$inferSelect>
}

async function loadFeedbackCache(projectId: string, provider: string): Promise<ExistingFeedbackCache> {
  const items = await db.select().from(feedback).where(eq(feedback.projectId, projectId))
  const byExternal = new Map<string, typeof feedback.$inferSelect>()
  const byHash = new Map<string, typeof feedback.$inferSelect>()
  for (const item of items) {
    const meta = extractImportMeta(item.metadata)
    const externalKey = sourceKey(provider, typeof meta?.externalId === 'string' ? meta.externalId : null)
    if (externalKey) byExternal.set(externalKey, item)
    const hash = typeof meta?.contentHash === 'string' ? meta.contentHash : null
    if (hash) byHash.set(hash, item)
  }
  return { byExternal, byHash }
}

async function loadChangelogCache(projectId: string, provider: string): Promise<ExistingChangelogCache> {
  const items = await db.select().from(changelogPost).where(eq(changelogPost.projectId, projectId))
  const byExternal = new Map<string, typeof changelogPost.$inferSelect>()
  const byHash = new Map<string, typeof changelogPost.$inferSelect>()
  for (const item of items) {
    const meta = extractImportMeta(item.metadata)
    const externalKey = sourceKey(provider, typeof meta?.externalId === 'string' ? meta.externalId : null)
    if (externalKey) byExternal.set(externalKey, item)
    const hash = typeof meta?.contentHash === 'string' ? meta.contentHash : null
    if (hash) byHash.set(hash, item)
  }
  return { byExternal, byHash }
}

async function ensureCategoryTargets(projectId: string, mappingConfig: ImportMappingConfig) {
  const existingCategories = await db
    .select()
    .from(feedbackCategory)
    .where(eq(feedbackCategory.projectId, projectId))
    .orderBy(feedbackCategory.sortOrder)

  const byId = new Map(existingCategories.map((item) => [item.id, item]))
  const bySlug = new Map(existingCategories.map((item) => [normalizeCategorySlug(item.slug || item.name), item]))
  const categoryIds = new Map<string, string>()
  let nextSortOrder = existingCategories.length

  for (const [sourceKeyValue, mapping] of Object.entries(mappingConfig.categoryMappings)) {
    if (mapping.mode === 'existing' && mapping.targetId && byId.has(mapping.targetId)) {
      categoryIds.set(sourceKeyValue, mapping.targetId)
      continue
    }

    const existing = bySlug.get(normalizeCategorySlug(mapping.targetName))
    if (existing) {
      categoryIds.set(sourceKeyValue, existing.id)
      continue
    }

    const createdId = randomUUID()
    const createdAt = new Date()
    await db.insert(feedbackCategory).values({
      id: createdId,
      projectId,
      name: mapping.targetName,
      slug: toCategorySlug(mapping.targetName),
      icon: null,
      color: '#6b7280',
      description: `Imported from ${mapping.sourceName}`,
      sortOrder: nextSortOrder,
      isDefault: false,
      createdAt,
    })
    nextSortOrder += 1
    categoryIds.set(sourceKeyValue, createdId)
  }

  return categoryIds
}

async function ensureStatusTargets(projectId: string, mappingConfig: ImportMappingConfig) {
  const existingStatuses = await db
    .select()
    .from(feedbackStatus)
    .where(eq(feedbackStatus.projectId, projectId))
    .orderBy(feedbackStatus.sortOrder)

  const byValue = new Map(existingStatuses.map((item) => [normalizeStatusValue(item.value || item.name), item]))
  let nextSortOrder = existingStatuses.length

  for (const mapping of Object.values(mappingConfig.statusMappings)) {
    const targetValue = normalizeStatusValue(mapping.targetValue)
    if (byValue.has(targetValue)) continue

    const systemStatus = SYSTEM_STATUSES.find((status) => normalizeStatusValue(status.value) === targetValue)
    const createdAt = new Date()
    const created = {
      id: randomUUID(),
      projectId,
      name: mapping.targetName || systemStatus?.name || mapping.sourceName,
      value: targetValue,
      color: systemStatus?.color || '#6b7280',
      description: systemStatus?.description || `Imported from ${mapping.sourceName}`,
      sortOrder: nextSortOrder,
      isDefault: false,
      createdAt,
    }
    await db.insert(feedbackStatus).values(created)
    byValue.set(targetValue, created)
    nextSortOrder += 1
  }

  return byValue
}

function findCategoryId(record: CanonicalFeedbackRecord, mappingConfig: ImportMappingConfig, categoryIds: Map<string, string>) {
  const sourceKeyValue = normalizeCategorySlug(record.category || '')
  if (!sourceKeyValue) return null
  const mapped = mappingConfig.categoryMappings[sourceKeyValue]
  if (!mapped) return null
  return categoryIds.get(mapped.sourceKey) || null
}

function resolveStatusValue(record: CanonicalFeedbackRecord, mappingConfig: ImportMappingConfig) {
  const sourceKeyValue = normalizeStatusValue(record.status || '')
  const mapped = mappingConfig.statusMappings[sourceKeyValue]
  return mapped?.targetValue || sourceKeyValue || 'open'
}

async function ensureProjectFeatureFlags(projectRecord: typeof project.$inferSelect, snapshot: CanonicalImportSnapshot) {
  const currentSettings = (projectRecord.settings && typeof projectRecord.settings === 'object'
    ? (projectRecord.settings as Record<string, any>)
    : {}) || {}

  const nextSettings = {
    ...currentSettings,
    changelogEnabled: currentSettings.changelogEnabled === true || snapshot.changelogEntries.length > 0,
    roadmapEnabled: currentSettings.roadmapEnabled === true || snapshot.roadmapEntries.length > 0,
  }

  if (
    nextSettings.changelogEnabled !== currentSettings.changelogEnabled ||
    nextSettings.roadmapEnabled !== currentSettings.roadmapEnabled
  ) {
    await db.update(project).set({ settings: nextSettings, updatedAt: new Date() }).where(eq(project.id, projectRecord.id))
  }
}

async function upsertFeedbackRecord(params: {
  projectId: string
  runId: string
  provider: string
  record: CanonicalFeedbackRecord
  duplicatePolicy: DuplicatePolicy
  mappingConfig: ImportMappingConfig
  categoryIds: Map<string, string>
  feedbackCache: ExistingFeedbackCache
}) {
  const externalKey = sourceKey(params.provider, params.record.externalId)
  const contentHash = buildFeedbackHash(params.provider, params.record)
  const existing =
    (externalKey ? params.feedbackCache.byExternal.get(externalKey) : null) || params.feedbackCache.byHash.get(contentHash) || null

  const payload = {
    projectId: params.projectId,
    categoryId: findCategoryId(params.record, params.mappingConfig, params.categoryIds),
    title: params.record.title,
    body: params.record.body || null,
    status: resolveStatusValue(params.record, params.mappingConfig),
    authorUserId: null,
    authorSessionId: null,
    authorName: params.record.authorName || null,
    authorEmail: params.record.authorEmail || null,
    voteCount: params.record.voteCount ?? 0,
    commentCount: params.record.commentCount ?? 0,
    metadata: buildSourceMetadata({
      provider: params.provider,
      externalId: params.record.externalId,
      importRunId: params.runId,
      contentHash,
      sourceKind: params.record.sourceKind || null,
      extra: params.record.metadata || null,
    }),
    updatedAt: params.record.updatedAt ? new Date(params.record.updatedAt) : new Date(),
  }

  if (existing) {
    if (params.duplicatePolicy === 'skip_existing') {
      return {
        item: existing,
        issue: {
          severity: 'skipped' as const,
          entityType: params.record.sourceKind || 'feedback',
          externalId: params.record.externalId,
          message: `Skipped duplicate ${params.record.sourceKind || 'feedback'} "${params.record.title}"`,
        },
      }
    }

    const [updated] = await db
      .update(feedback)
      .set({
        ...payload,
        metadata: mergeMetadata(existing.metadata, payload.metadata),
      })
      .where(eq(feedback.id, existing.id))
      .returning()
    if (externalKey) params.feedbackCache.byExternal.set(externalKey, updated)
    params.feedbackCache.byHash.set(contentHash, updated)
    return { item: updated, issue: null }
  }

  const createdAt = params.record.createdAt ? new Date(params.record.createdAt) : new Date()
  const [created] = await db
    .insert(feedback)
    .values({
      id: randomUUID(),
      ...payload,
      isPinned: false,
      isLocked: false,
      isHidden: false,
      createdAt,
    })
    .returning()

  if (externalKey) params.feedbackCache.byExternal.set(externalKey, created)
  params.feedbackCache.byHash.set(contentHash, created)
  return { item: created, issue: null }
}

async function upsertChangelogRecord(params: {
  projectId: string
  runId: string
  provider: string
  record: CanonicalChangelogRecord
  duplicatePolicy: DuplicatePolicy
  changelogCache: ExistingChangelogCache
}) {
  const externalKey = sourceKey(params.provider, params.record.externalId)
  const contentHash = buildChangelogHash(params.provider, params.record)
  const existing =
    (externalKey ? params.changelogCache.byExternal.get(externalKey) : null) ||
    params.changelogCache.byHash.get(contentHash) ||
    null

  const payload = {
    projectId: params.projectId,
    title: params.record.title,
    body: params.record.body,
    category: params.record.category || null,
    isDraft: true,
    publishedAt: null,
    metadata: buildSourceMetadata({
      provider: params.provider,
      externalId: params.record.externalId,
      importRunId: params.runId,
      contentHash,
      extra: params.record.metadata || null,
    }),
    updatedAt: params.record.updatedAt ? new Date(params.record.updatedAt) : new Date(),
  }

  if (existing) {
    if (params.duplicatePolicy === 'skip_existing') {
      return {
        item: existing,
        issue: {
          severity: 'skipped' as const,
          entityType: 'changelog',
          externalId: params.record.externalId,
          message: `Skipped duplicate changelog entry "${params.record.title}"`,
        },
      }
    }

    const [updated] = await db
      .update(changelogPost)
      .set({
        ...payload,
        metadata: mergeMetadata(existing.metadata, payload.metadata),
      })
      .where(eq(changelogPost.id, existing.id))
      .returning()
    if (externalKey) params.changelogCache.byExternal.set(externalKey, updated)
    params.changelogCache.byHash.set(contentHash, updated)
    return { item: updated, issue: null }
  }

  const createdAt = params.record.createdAt ? new Date(params.record.createdAt) : new Date()
  const [created] = await db
    .insert(changelogPost)
    .values({
      id: randomUUID(),
      ...payload,
      createdAt,
    })
    .returning()

  if (externalKey) params.changelogCache.byExternal.set(externalKey, created)
  params.changelogCache.byHash.set(contentHash, created)
  return { item: created, issue: null }
}

async function upsertCommentRecord(params: {
  feedbackId: string
  record: CanonicalCommentRecord
  duplicatePolicy: DuplicatePolicy
}) {
  const existingComments = await db
    .select()
    .from(feedbackComment)
    .where(eq(feedbackComment.feedbackId, params.feedbackId))
    .orderBy(asc(feedbackComment.createdAt))

  const commentHash = buildCommentHash(params.record)
  const existing = existingComments.find((item) => {
    const candidateHash = createHash('sha256')
      .update(
        JSON.stringify({
          feedbackExternalId: params.record.feedbackExternalId,
          body: item.body,
          authorName: item.authorName || null,
          authorEmail: item.authorEmail || null,
          createdAt: item.createdAt ? new Date(item.createdAt).toISOString() : null,
        })
      )
      .digest('hex')
    return candidateHash === commentHash
  })

  if (existing) {
    if (params.duplicatePolicy === 'update_existing') {
      await db
        .update(feedbackComment)
        .set({
          body: params.record.body,
          authorName: params.record.authorName || null,
          authorEmail: params.record.authorEmail || null,
          isInternal: params.record.isInternal === true,
          updatedAt: params.record.updatedAt ? new Date(params.record.updatedAt) : new Date(),
        })
        .where(eq(feedbackComment.id, existing.id))
    }
    return
  }

  await db.insert(feedbackComment).values({
    id: randomUUID(),
    feedbackId: params.feedbackId,
    parentCommentId: null,
    body: params.record.body,
    authorUserId: null,
    authorSessionId: null,
    authorName: params.record.authorName || null,
    authorEmail: params.record.authorEmail || null,
    isInternal: params.record.isInternal === true,
    createdAt: params.record.createdAt ? new Date(params.record.createdAt) : new Date(),
    updatedAt: params.record.updatedAt ? new Date(params.record.updatedAt) : new Date(),
  })
}

async function upsertSubscriptionRecord(params: { feedbackId: string; record: { email: string; notifyChannel?: 'email' | 'app' | 'both' | null } }) {
  const [existing] = await db
    .select()
    .from(feedbackSubscription)
    .where(and(eq(feedbackSubscription.feedbackId, params.feedbackId), eq(feedbackSubscription.email, params.record.email)))
    .limit(1)

  if (existing) return

  await db.insert(feedbackSubscription).values({
    id: randomUUID(),
    feedbackId: params.feedbackId,
    email: params.record.email,
    userId: null,
    notifyChannel: params.record.notifyChannel || 'email',
    token: randomUUID(),
    createdAt: new Date(),
  })
}

type WorkItem =
  | { type: 'feedback'; record: CanonicalFeedbackRecord }
  | { type: 'roadmap'; record: CanonicalFeedbackRecord }
  | { type: 'comment'; record: CanonicalCommentRecord }
  | { type: 'subscription'; record: { feedbackExternalId: string; email: string; notifyChannel?: 'email' | 'app' | 'both' | null } }
  | { type: 'changelog'; record: CanonicalChangelogRecord }

function buildWorkQueue(snapshot: CanonicalImportSnapshot, scope: ImportContentScope): WorkItem[] {
  const items: WorkItem[] = []
  if (scope.feedback) {
    items.push(...snapshot.feedback.map((record) => ({ type: 'feedback' as const, record })))
  }
  if (scope.roadmap) {
    items.push(...snapshot.roadmapEntries.map((record) => ({ type: 'roadmap' as const, record })))
  }
  if (scope.comments) {
    items.push(...snapshot.comments.map((record) => ({ type: 'comment' as const, record })))
  }
  if (scope.subscriptions) {
    items.push(
      ...snapshot.subscriptions.map((record) => ({
        type: 'subscription' as const,
        record: {
          feedbackExternalId: record.feedbackExternalId,
          email: record.email,
          notifyChannel: record.notifyChannel || 'email',
        },
      }))
    )
  }
  if (scope.changelog) {
    items.push(...snapshot.changelogEntries.map((record) => ({ type: 'changelog' as const, record })))
  }
  return items
}

export async function cancelImportRun(projectId: string, runId: string) {
  const [runRecord] = await db
    .select()
    .from(importRun)
    .where(and(eq(importRun.id, runId), eq(importRun.projectId, projectId)))
    .limit(1)
  if (!runRecord) createNotFoundError('Import run not found')
  if (['completed', 'failed', 'canceled'].includes(runRecord.status)) {
    return getImportRunDetail(projectId, runId)
  }
  await db.update(importRun).set({ status: 'canceled', updatedAt: new Date(), completedAt: new Date() }).where(eq(importRun.id, runId))
  return getImportRunDetail(projectId, runId)
}

export async function startImportRun(params: {
  projectRecord: typeof project.$inferSelect
  runId: string
  mappingConfig: ImportMappingConfig
}) {
  const [runRecord] = await db
    .select()
    .from(importRun)
    .where(and(eq(importRun.id, params.runId), eq(importRun.projectId, params.projectRecord.id)))
    .limit(1)
  if (!runRecord) createNotFoundError('Import run not found')
  if (!['ready', 'draft', 'failed'].includes(runRecord.status)) {
    createConflictError(`Import run cannot be started from status "${runRecord.status}"`)
  }

  const snapshot = await loadSnapshot(params.projectRecord.id, runRecord.id)
  await ensureProjectFeatureFlags(params.projectRecord, snapshot)
  await ensureCategoryTargets(params.projectRecord.id, params.mappingConfig)
  await ensureStatusTargets(params.projectRecord.id, params.mappingConfig)

  await db
    .update(importRun)
    .set({
      mappingConfig: params.mappingConfig,
      contentScope: params.mappingConfig.contentScope,
      status: 'importing',
      progressCompleted: 0,
      progressTotal: buildWorkQueue(snapshot, params.mappingConfig.contentScope).length,
      startedAt: runRecord.startedAt || new Date(),
      completedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(importRun.id, runRecord.id))

  return advanceImportRun({ projectRecord: params.projectRecord, runId: params.runId })
}

export async function advanceImportRun(params: { projectRecord: typeof project.$inferSelect; runId: string }) {
  const [runRecord] = await db
    .select()
    .from(importRun)
    .where(and(eq(importRun.id, params.runId), eq(importRun.projectId, params.projectRecord.id)))
    .limit(1)
  if (!runRecord) createNotFoundError('Import run not found')
  if (runRecord.status !== 'importing') {
    return getImportRunDetail(params.projectRecord.id, params.runId)
  }

  const mappingConfig = (runRecord.mappingConfig || {}) as ImportMappingConfig
  const contentScope = mergeContentScope((runRecord.contentScope || {}) as Partial<ImportContentScope>)
  const snapshot = await loadSnapshot(params.projectRecord.id, runRecord.id)
  const workQueue = buildWorkQueue(snapshot, contentScope)

  const categoryIds = await ensureCategoryTargets(params.projectRecord.id, mappingConfig)
  await ensureStatusTargets(params.projectRecord.id, mappingConfig)
  const feedbackCache = await loadFeedbackCache(params.projectRecord.id, snapshot.sourceType)
  const changelogCache = await loadChangelogCache(params.projectRecord.id, snapshot.sourceType)

  const slice = workQueue.slice(runRecord.progressCompleted, runRecord.progressCompleted + IMPORT_BATCH_SIZE)
  const runIssues: CanonicalImportIssue[] = []

  for (const task of slice) {
    if (task.type === 'feedback' || task.type === 'roadmap') {
      const result = await upsertFeedbackRecord({
        projectId: params.projectRecord.id,
        runId: runRecord.id,
        provider: snapshot.sourceType,
        record: task.record,
        duplicatePolicy: mappingConfig.duplicatePolicy,
        mappingConfig,
        categoryIds,
        feedbackCache,
      })
      if (result.issue) runIssues.push(result.issue)
      continue
    }

    if (task.type === 'comment') {
      const linkedFeedback =
        feedbackCache.byExternal.get(sourceKey(snapshot.sourceType, task.record.feedbackExternalId) || '') || null
      if (!linkedFeedback) {
        runIssues.push({
          severity: 'skipped',
          entityType: 'comment',
          externalId: task.record.externalId,
          message: `Skipped comment because linked feedback "${task.record.feedbackExternalId}" was not imported`,
        })
        continue
      }

      await upsertCommentRecord({
        feedbackId: linkedFeedback.id,
        record: task.record,
        duplicatePolicy: mappingConfig.duplicatePolicy,
      })
      continue
    }

    if (task.type === 'subscription') {
      const linkedFeedback =
        feedbackCache.byExternal.get(sourceKey(snapshot.sourceType, task.record.feedbackExternalId) || '') || null
      if (!linkedFeedback) {
        runIssues.push({
          severity: 'skipped',
          entityType: 'subscription',
          externalId: task.record.feedbackExternalId,
          message: `Skipped subscriber because linked feedback "${task.record.feedbackExternalId}" was not imported`,
        })
        continue
      }

      await upsertSubscriptionRecord({
        feedbackId: linkedFeedback.id,
        record: task.record,
      })
      continue
    }

    if (task.type === 'changelog') {
      const result = await upsertChangelogRecord({
        projectId: params.projectRecord.id,
        runId: runRecord.id,
        provider: snapshot.sourceType,
        record: task.record,
        duplicatePolicy: mappingConfig.duplicatePolicy,
        changelogCache,
      })
      if (result.issue) runIssues.push(result.issue)
    }
  }

  if (runIssues.length > 0) {
    await insertRunIssues(runRecord.id, runIssues)
  }

  const nextCompleted = Math.min(workQueue.length, runRecord.progressCompleted + slice.length)
  const isCompleted = nextCompleted >= workQueue.length

  await db
    .update(importRun)
    .set({
      progressCompleted: nextCompleted,
      progressTotal: workQueue.length,
      status: isCompleted ? 'completed' : 'importing',
      completedAt: isCompleted ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(importRun.id, runRecord.id))

  return getImportRunDetail(params.projectRecord.id, runRecord.id)
}
