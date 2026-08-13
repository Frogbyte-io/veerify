import type {
  AnalyzeImportInput,
  CanonicalChangelogRecord,
  CanonicalCommentRecord,
  CanonicalFeedbackRecord,
  CanonicalImportIssue,
  CanonicalImportSnapshot,
  CanonicalStatusRecord,
  CanonicalSubscriptionRecord,
} from '../types'
import { createError } from 'h3'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import {
  normalizeCategorySlug,
  normalizeStatusValue,
  pickFirstNumber,
  pickFirstString,
  sanitizeColor,
  toNullableString,
  toOptionalBoolean,
  toOptionalIsoDate,
  unwrapArrayPayload,
} from '../utils'

type JsonRecord = Record<string, any>

function isFeedbackRecord(value: CanonicalFeedbackRecord | null): value is CanonicalFeedbackRecord {
  return value !== null
}

async function fetchEndpointCandidates(baseUrl: string, apiKey: string, candidates: string[]) {
  const headers = {
    accept: 'application/json',
    authorization: `Bearer ${apiKey}`,
    'x-api-key': apiKey,
  }

  for (const candidate of candidates) {
    const url = `${baseUrl.replace(/\/+$/g, '')}/${candidate.replace(/^\/+/g, '')}`
    try {
      const response = await fetch(url, { headers })
      if (!response.ok) continue
      return await response.json()
    } catch {
      continue
    }
  }

  return null
}

function canonicalizeItem(record: JsonRecord, sourceKind: 'feedback' | 'roadmap'): CanonicalFeedbackRecord | null {
  const title = pickFirstString(record, ['title', 'name', 'subject'])
  if (!title) return null

  return {
    externalId: pickFirstString(record, ['id', 'item_id', 'uuid']) || `${sourceKind}:${title}`,
    title,
    body: pickFirstString(record, ['description', 'body', 'text', 'detail']),
    status:
      normalizeStatusValue(
        pickFirstString(record, ['status', 'status_name', 'workflow_status']) || (sourceKind === 'roadmap' ? 'planned' : 'open')
      ) || 'open',
    category:
      pickFirstString(record, ['category', 'category_name']) ||
      pickFirstString(record.category || {}, ['name', 'title']) ||
      null,
    authorName:
      pickFirstString(record, ['author_name', 'username', 'name']) || pickFirstString(record.user || {}, ['name']) || null,
    authorEmail:
      pickFirstString(record, ['author_email', 'email']) ||
      pickFirstString(record.user || {}, ['email']) ||
      null,
    voteCount: pickFirstNumber(record, ['vote_count', 'votes_count', 'votes', 'score']),
    commentCount: pickFirstNumber(record, ['comment_count', 'comments_count', 'comments']),
    createdAt: toOptionalIsoDate(pickFirstString(record, ['created_at', 'created'])),
    updatedAt: toOptionalIsoDate(pickFirstString(record, ['updated_at', 'updated'])),
    sourceKind,
    metadata: {
      rawStatus: toNullableString(record.status),
      sourceKind,
    },
  }
}

export async function analyzeSleekplanImport(input: AnalyzeImportInput): Promise<CanonicalImportSnapshot> {
  const baseUrl = input.sleekplan?.baseUrl?.trim()
  const apiKey = input.sleekplan?.apiKey?.trim()
  if (!baseUrl || !apiKey) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Validation failed',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Sleekplan baseUrl and apiKey are required'),
    })
  }

  const warnings: CanonicalImportIssue[] = []

  const [itemsPayload, commentsPayload, changelogPayload, categoriesPayload, statusesPayload, roadmapPayload, subscriptionsPayload] =
    await Promise.all([
      fetchEndpointCandidates(baseUrl, apiKey, ['api/items', 'items', 'api/feedback/items']),
      fetchEndpointCandidates(baseUrl, apiKey, ['api/comments', 'comments']),
      fetchEndpointCandidates(baseUrl, apiKey, ['api/changelog', 'changelog', 'api/updates']),
      fetchEndpointCandidates(baseUrl, apiKey, ['api/categories', 'categories']),
      fetchEndpointCandidates(baseUrl, apiKey, ['api/statuses', 'statuses', 'api/status-tags']),
      fetchEndpointCandidates(baseUrl, apiKey, ['api/roadmap', 'roadmap', 'api/roadmap-items']),
      fetchEndpointCandidates(baseUrl, apiKey, ['api/subscriptions', 'subscriptions']),
    ])

  if (!itemsPayload) {
    warnings.push({
      severity: 'warning',
      entityType: 'source',
      message: 'Could not load Sleekplan items from the configured API base URL. Verify the base URL and credentials.',
    })
  }

  const categories = unwrapArrayPayload(categoriesPayload).map((record) => {
    const name = pickFirstString(record, ['name', 'title']) || 'Imported category'
    const slug = normalizeCategorySlug(pickFirstString(record, ['slug']) || name)
    return {
      externalId: pickFirstString(record, ['id', 'slug']) || slug,
      name,
      slug,
      color: sanitizeColor(pickFirstString(record, ['color'])),
      description: pickFirstString(record, ['description']),
    }
  })

  const statuses: CanonicalStatusRecord[] = unwrapArrayPayload(statusesPayload).map((record, index) => {
    const name = pickFirstString(record, ['name', 'title']) || `Status ${index + 1}`
    return {
      externalId: pickFirstString(record, ['id', 'slug']) || normalizeStatusValue(name) || `status_${index}`,
      name,
      value: normalizeStatusValue(pickFirstString(record, ['value', 'slug']) || name),
      color: sanitizeColor(pickFirstString(record, ['color'])),
      description: pickFirstString(record, ['description']),
      sortOrder: pickFirstNumber(record, ['sort_order', 'position']) ?? index,
    }
  })

  const feedback = unwrapArrayPayload(itemsPayload)
    .map((record) => canonicalizeItem(record, 'feedback'))
    .filter(isFeedbackRecord)
  const roadmapEntries = unwrapArrayPayload(roadmapPayload)
    .map((record) => canonicalizeItem(record, 'roadmap'))
    .filter(isFeedbackRecord)

  const comments: CanonicalCommentRecord[] = []
  for (const record of unwrapArrayPayload(commentsPayload)) {
    const feedbackExternalId =
      pickFirstString(record, ['feedback_external_id', 'item_id', 'post_id']) ||
      pickFirstString(record.item || {}, ['id']) ||
      null
    const body = pickFirstString(record, ['body', 'text', 'comment'])
    if (!feedbackExternalId || !body) continue
    comments.push({
      externalId: pickFirstString(record, ['id', 'uuid']) || `${feedbackExternalId}:${body.slice(0, 24)}`,
      feedbackExternalId,
      body,
      authorName:
        pickFirstString(record, ['author_name', 'username', 'name']) || pickFirstString(record.user || {}, ['name']),
      authorEmail:
        pickFirstString(record, ['author_email', 'email']) || pickFirstString(record.user || {}, ['email']),
      createdAt: toOptionalIsoDate(pickFirstString(record, ['created_at', 'created'])),
      updatedAt: toOptionalIsoDate(pickFirstString(record, ['updated_at', 'updated'])),
      isInternal: toOptionalBoolean(record.is_internal),
    })
  }

  const changelogEntries: CanonicalChangelogRecord[] = []
  for (const [index, record] of unwrapArrayPayload(changelogPayload).entries()) {
    const title = pickFirstString(record, ['title', 'name'])
    const body = pickFirstString(record, ['body', 'text', 'description'])
    if (!title || !body) continue
    changelogEntries.push({
      externalId: pickFirstString(record, ['id', 'uuid']) || `changelog_${index}_${title}`,
      title,
      body,
      category: pickFirstString(record, ['category', 'category_name']),
      createdAt: toOptionalIsoDate(pickFirstString(record, ['created_at', 'created'])),
      updatedAt: toOptionalIsoDate(pickFirstString(record, ['updated_at', 'updated'])),
      publishedAt: toOptionalIsoDate(pickFirstString(record, ['published_at', 'published'])),
    })
  }

  const subscriptions: CanonicalSubscriptionRecord[] = []
  for (const record of unwrapArrayPayload(subscriptionsPayload)) {
    const feedbackExternalId =
      pickFirstString(record, ['feedback_external_id', 'item_id', 'post_id']) ||
      pickFirstString(record.item || {}, ['id']) ||
      null
    const email = pickFirstString(record, ['email']) || pickFirstString(record.user || {}, ['email']) || null
    if (!feedbackExternalId || !email) continue
    subscriptions.push({
      externalId: pickFirstString(record, ['id', 'uuid']) || `${feedbackExternalId}:${email}`,
      feedbackExternalId,
      email,
      notifyChannel: 'email',
    })
  }

  if (!commentsPayload) {
    warnings.push({
      severity: 'warning',
      entityType: 'comment',
      message: 'Comments could not be fetched from Sleekplan and will be skipped for this run.',
    })
  }
  if (!subscriptionsPayload) {
    warnings.push({
      severity: 'warning',
      entityType: 'subscription',
      message: 'Subscribers could not be fetched from Sleekplan and will be skipped for this run.',
    })
  }

  return {
    sourceType: 'sleekplan',
    sourceMode: 'api',
    categories,
    statuses,
    feedback,
    roadmapEntries,
    changelogEntries,
    comments,
    subscriptions,
    warnings,
  }
}
