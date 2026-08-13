import type {
  AnalyzeImportInput,
  CanonicalChangelogRecord,
  CanonicalCommentRecord,
  CanonicalFeedbackRecord,
  CanonicalImportIssue,
  CanonicalImportSnapshot,
  CanonicalStatusRecord,
  CanonicalSubscriptionRecord,
  CsvFileEntry,
} from '../types'
import { createError } from 'h3'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import {
  buildImportContentHash,
  csvRowsToObjects,
  normalizeCategorySlug,
  normalizeStatusValue,
  parseCsv,
  pickFirstNumber,
  pickFirstString,
  sanitizeColor,
  toOptionalBoolean,
  toOptionalIsoDate,
  normalizeCsvHeader,
} from '../utils'

function recordTypeForRow(row: Record<string, string>) {
  const explicit = (row.record_type || row.type || '').trim().toLowerCase()
  if (explicit) return explicit
  if (row.feedback_external_id && row.email && !row.title) return 'subscription'
  if (row.feedback_external_id && row.body && !row.title) return 'comment'
  return 'feedback'
}

function canonicalExternalId(prefix: string, provided: string | null, fallbackSeed: string) {
  return provided || `${prefix}_${buildImportContentHash({ sourceType: prefix, title: fallbackSeed })}`
}

type SleekplanCsvKind = 'feedback' | 'comments' | 'votes' | 'users' | 'unknown'

function detectSleekplanCsvKind(content: string): SleekplanCsvKind {
  const rows = parseCsv(content)
  if (rows.length === 0) return 'unknown'
  const headers = new Set(rows[0].map((h) => normalizeCsvHeader(h)))

  if (headers.has('title') && headers.has('description') && headers.has('status_name')) return 'feedback'
  if (headers.has('comment_id') && headers.has('comment')) return 'comments'
  if (headers.has('vote') && !headers.has('comment_id') && !headers.has('title')) return 'votes'
  if (headers.has('data_mail') && headers.has('product_id') && !headers.has('title')) return 'users'
  return 'unknown'
}

function analyzeSleekplanMultiCsv(files: CsvFileEntry[]): CanonicalImportSnapshot {
  const classified = files.map((f) => ({ ...f, kind: detectSleekplanCsvKind(f.content) }))
  const byKind = (kind: SleekplanCsvKind) => classified.filter((f) => f.kind === kind)

  const categories = new Map<string, { externalId: string; name: string; slug?: string | null; color?: string | null }>()
  const statuses = new Map<string, CanonicalStatusRecord>()
  const feedback: CanonicalFeedbackRecord[] = []
  const comments: CanonicalCommentRecord[] = []
  const subscriptions: CanonicalSubscriptionRecord[] = []
  const warnings: CanonicalImportIssue[] = []

  // Track vote counts per feedback_id from votes CSV
  const voteCounts = new Map<string, number>()
  for (const file of byKind('votes')) {
    const rows = csvRowsToObjects(file.content)
    for (const row of rows) {
      const feedbackId = row.feedback_id?.trim()
      if (!feedbackId) continue
      voteCounts.set(feedbackId, (voteCounts.get(feedbackId) || 0) + 1)
    }
  }

  // Parse feedback CSVs
  for (const file of byKind('feedback')) {
    const rows = csvRowsToObjects(file.content)
    rows.forEach((row, index) => {
      const lineNumber = index + 2
      const feedbackId = row.feedback_id?.trim() || null
      const title = row.title?.trim() || null
      const body = row.description?.trim() || null
      const statusName = row.status_name?.trim() || null
      const typeName = row.type_name?.trim() || null

      if (statusName) {
        const key = normalizeStatusValue(statusName) || statusName.toLowerCase()
        if (!statuses.has(key)) {
          statuses.set(key, { externalId: key, name: statusName, value: key })
        }
      }

      if (typeName) {
        const key = normalizeCategorySlug(typeName) || typeName.toLowerCase()
        if (!categories.has(key)) {
          categories.set(key, { externalId: key, name: typeName, slug: key })
        }
      }

      if (!title) {
        warnings.push({
          severity: 'warning',
          entityType: 'feedback',
          externalId: feedbackId,
          message: `Skipped feedback row ${lineNumber} because title is missing`,
          details: { lineNumber, file: file.filename },
        })
        return
      }

      const voteCount = voteCounts.get(feedbackId || '') ?? pickFirstNumber(row, ['total_up', 'total_sum']) ?? null

      feedback.push({
        externalId: canonicalExternalId('feedback', feedbackId, `${title}:${lineNumber}`),
        title,
        body,
        status: normalizeStatusValue(statusName || 'open') || 'open',
        category: typeName,
        authorName: null,
        authorEmail: null,
        voteCount,
        commentCount: pickFirstNumber(row, ['total_comments']),
        createdAt: toOptionalIsoDate(row.created),
        updatedAt: toOptionalIsoDate(row.updated),
        sourceKind: 'feedback',
      })
    })
  }

  // Parse comments CSVs
  for (const file of byKind('comments')) {
    const rows = csvRowsToObjects(file.content)
    rows.forEach((row, index) => {
      const lineNumber = index + 2
      const feedbackId = row.feedback_id?.trim() || null
      const commentId = row.comment_id?.trim() || null
      const body = row.comment?.trim() || null

      if (!feedbackId || !body) {
        warnings.push({
          severity: 'warning',
          entityType: 'comment',
          externalId: commentId,
          message: `Skipped comment row ${lineNumber} because feedback_id or comment body is missing`,
          details: { lineNumber, file: file.filename },
        })
        return
      }

      comments.push({
        externalId: canonicalExternalId('comment', commentId, `${feedbackId}:${lineNumber}`),
        feedbackExternalId: feedbackId,
        body,
        authorName: row.user_full_name?.trim() || row.user_name?.trim() || null,
        authorEmail: row.user_mail?.trim() || null,
        createdAt: toOptionalIsoDate(row.created),
        isInternal: toOptionalBoolean(row.public) === false ? true : null,
      })
    })
  }

  // Parse users CSVs → subscriptions
  for (const file of byKind('users')) {
    const rows = csvRowsToObjects(file.content)
    rows.forEach((row, index) => {
      const lineNumber = index + 2
      const userId = row.user_id?.trim() || null
      const email = row.data_mail?.trim() || null

      if (!email || email.endsWith('@anonymous.dummy')) return

      subscriptions.push({
        externalId: canonicalExternalId('subscription', userId, `user:${email}`),
        feedbackExternalId: '*',
        email,
        notifyChannel: 'email',
      })
    })
  }

  // Warn about unrecognized files
  for (const file of byKind('unknown')) {
    warnings.push({
      severity: 'warning',
      entityType: 'file',
      message: `Could not detect CSV type for "${file.filename || 'unknown file'}" — skipped`,
      details: { filename: file.filename },
    })
  }

  return {
    sourceType: 'csv',
    sourceMode: 'file',
    categories: [...categories.values()],
    statuses: [...statuses.values()],
    feedback,
    roadmapEntries: [],
    changelogEntries: [],
    comments,
    subscriptions,
    warnings,
  }
}

export async function analyzeCsvImport(input: AnalyzeImportInput): Promise<CanonicalImportSnapshot> {
  // Multi-file mode: merge multiple CSVs into one snapshot
  if (input.csvFiles && input.csvFiles.length > 0) {
    const validFiles = input.csvFiles.filter((f) => f.content?.trim())
    if (validFiles.length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Validation failed',
        data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'At least one CSV file with content is required'),
      })
    }
    return analyzeSleekplanMultiCsv(validFiles)
  }

  // Single-file mode (legacy): parse one CSV
  const csvContent = input.csvContent?.trim()
  if (!csvContent) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Validation failed',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'CSV content is required'),
    })
  }

  const rows = csvRowsToObjects(csvContent)
  const categories = new Map<string, { externalId: string; name: string; slug?: string | null; color?: string | null }>()
  const statuses = new Map<string, CanonicalStatusRecord>()
  const feedback: CanonicalFeedbackRecord[] = []
  const roadmapEntries: CanonicalFeedbackRecord[] = []
  const changelogEntries: CanonicalChangelogRecord[] = []
  const comments: CanonicalCommentRecord[] = []
  const subscriptions: CanonicalSubscriptionRecord[] = []
  const warnings: CanonicalImportIssue[] = []

  rows.forEach((row, index) => {
    const recordType = recordTypeForRow(row)
    const lineNumber = index + 2
    const externalId = pickFirstString(row, ['external_id', 'id', 'source_id'])
    const title = pickFirstString(row, ['title', 'name'])
    const body = pickFirstString(row, ['body', 'description', 'text', 'detail'])
    const categoryName = pickFirstString(row, ['category', 'category_name'])
    const statusName = pickFirstString(row, ['status', 'status_name'])

    if (categoryName) {
      const key = normalizeCategorySlug(categoryName) || categoryName.toLowerCase()
      if (!categories.has(key)) {
        categories.set(key, {
          externalId: key,
          name: categoryName,
          slug: key,
          color: sanitizeColor(pickFirstString(row, ['category_color', 'color'])),
        })
      }
    }

    if (statusName) {
      const key = normalizeStatusValue(statusName) || statusName.toLowerCase()
      if (!statuses.has(key)) {
        statuses.set(key, {
          externalId: key,
          name: statusName,
          value: key,
          color: sanitizeColor(pickFirstString(row, ['status_color'])),
        })
      }
    }

    if (recordType === 'changelog') {
      if (!title || !body) {
        warnings.push({
          severity: 'warning',
          entityType: 'changelog',
          externalId,
          message: `Skipped CSV changelog row ${lineNumber} because title or body is missing`,
          details: { lineNumber },
        })
        return
      }

      changelogEntries.push({
        externalId: canonicalExternalId('changelog', externalId, `${title}:${lineNumber}`),
        title,
        body,
        category: categoryName,
        createdAt: toOptionalIsoDate(pickFirstString(row, ['created_at', 'created'])),
        updatedAt: toOptionalIsoDate(pickFirstString(row, ['updated_at', 'updated'])),
        publishedAt: toOptionalIsoDate(pickFirstString(row, ['published_at', 'published'])),
      })
      return
    }

    if (recordType === 'comment') {
      const feedbackExternalId = pickFirstString(row, ['feedback_external_id', 'parent_external_id', 'item_external_id'])
      if (!feedbackExternalId || !body) {
        warnings.push({
          severity: 'warning',
          entityType: 'comment',
          externalId,
          message: `Skipped CSV comment row ${lineNumber} because feedback_external_id or body is missing`,
          details: { lineNumber },
        })
        return
      }

      comments.push({
        externalId: canonicalExternalId('comment', externalId, `${feedbackExternalId}:${lineNumber}`),
        feedbackExternalId,
        body,
        authorName: pickFirstString(row, ['author_name', 'username', 'name']),
        authorEmail: pickFirstString(row, ['author_email', 'email']),
        createdAt: toOptionalIsoDate(pickFirstString(row, ['created_at', 'created'])),
        updatedAt: toOptionalIsoDate(pickFirstString(row, ['updated_at', 'updated'])),
        isInternal: toOptionalBoolean(row.is_internal),
      })
      return
    }

    if (recordType === 'subscription') {
      const feedbackExternalId = pickFirstString(row, ['feedback_external_id', 'parent_external_id', 'item_external_id'])
      const email = pickFirstString(row, ['email', 'subscriber_email'])
      if (!feedbackExternalId || !email) {
        warnings.push({
          severity: 'warning',
          entityType: 'subscription',
          externalId,
          message: `Skipped CSV subscription row ${lineNumber} because feedback_external_id or email is missing`,
          details: { lineNumber },
        })
        return
      }

      subscriptions.push({
        externalId: canonicalExternalId('subscription', externalId, `${feedbackExternalId}:${email}`),
        feedbackExternalId,
        email,
        notifyChannel: (pickFirstString(row, ['notify_channel', 'channel']) as 'email' | 'app' | 'both' | null) || 'email',
      })
      return
    }

    if (!title) {
      warnings.push({
        severity: 'warning',
        entityType: recordType === 'roadmap' ? 'roadmap' : 'feedback',
        externalId,
        message: `Skipped CSV row ${lineNumber} because title is missing`,
        details: { lineNumber },
      })
      return
    }

    const record: CanonicalFeedbackRecord = {
      externalId: canonicalExternalId(recordType === 'roadmap' ? 'roadmap' : 'feedback', externalId, `${title}:${lineNumber}`),
      title,
      body,
      status: normalizeStatusValue(statusName || (recordType === 'roadmap' ? 'planned' : 'open')) || 'open',
      category: categoryName,
      authorName: pickFirstString(row, ['author_name', 'username', 'name']),
      authorEmail: pickFirstString(row, ['author_email', 'email']),
      voteCount: pickFirstNumber(row, ['vote_count', 'votes', 'score']),
      commentCount: pickFirstNumber(row, ['comment_count', 'comments']),
      createdAt: toOptionalIsoDate(pickFirstString(row, ['created_at', 'created'])),
      updatedAt: toOptionalIsoDate(pickFirstString(row, ['updated_at', 'updated'])),
      sourceKind: recordType === 'roadmap' ? 'roadmap' : 'feedback',
    }

    if (recordType === 'roadmap') {
      roadmapEntries.push(record)
    } else {
      feedback.push(record)
    }
  })

  return {
    sourceType: 'csv',
    sourceMode: 'file',
    categories: [...categories.values()],
    statuses: [...statuses.values()],
    feedback,
    roadmapEntries,
    changelogEntries,
    comments,
    subscriptions,
    warnings,
  }
}
