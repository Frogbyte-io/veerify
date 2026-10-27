import { csvRowsToObjects, normalizeCsvHeader, parseCsv } from './csv-parse'
import { ImportBuilder, pickFirstNumber, stableId, toOptionalBoolean, voteCountOf } from './builder'

export type SleekplanCsvKind = 'feedback' | 'comments' | 'votes' | 'users' | 'unknown'
export type CsvFile = { name: string; text: string }

export function detectSleekplanCsvKind(content: string): SleekplanCsvKind {
  const rows = parseCsv(content)
  if (rows.length === 0) return 'unknown'
  const headers = new Set(rows[0].map((h) => normalizeCsvHeader(h)))
  if (headers.has('title') && headers.has('description') && headers.has('status_name')) return 'feedback'
  if (headers.has('comment_id') && headers.has('comment')) return 'comments'
  if (headers.has('vote') && !headers.has('comment_id') && !headers.has('title')) return 'votes'
  if (headers.has('data_mail') && headers.has('product_id') && !headers.has('title')) return 'users'
  return 'unknown'
}

export function isSleekplanExport(files: CsvFile[]): boolean {
  return files.some((f) => detectSleekplanCsvKind(f.text) !== 'unknown')
}

export function convertSleekplanCsvFiles(files: CsvFile[], b: ImportBuilder) {
  const classified = files.map((f) => ({ ...f, kind: detectSleekplanCsvKind(f.text) }))
  const byKind = (kind: SleekplanCsvKind) => classified.filter((f) => f.kind === kind)

  const voteCounts = new Map<string, number>()
  for (const file of byKind('votes')) {
    for (const row of csvRowsToObjects(file.text)) {
      const feedbackId = row.feedback_id?.trim()
      if (feedbackId) voteCounts.set(feedbackId, (voteCounts.get(feedbackId) || 0) + 1)
    }
  }

  for (const file of byKind('feedback')) {
    csvRowsToObjects(file.text).forEach((row, index) => {
      const line = index + 2
      const context = `${file.name} row ${line}`
      const feedbackId = row.feedback_id?.trim() || null
      const title = row.title?.trim() || null
      const status = b.status(row.status_name)
      const category = b.category(row.type_name)
      if (!title) {
        b.warn(`${context}: skipped feedback because title is missing`)
        return
      }
      b.feedback.push({
        externalId: feedbackId || stableId('feedback', `${title}:${line}`),
        title: b.title(title, context),
        body: b.body(row.description?.trim(), context),
        status: status ?? b.status('Open'),
        category,
        voteCount: voteCountOf(voteCounts.get(feedbackId || '') ?? pickFirstNumber(row, ['total_up', 'total_sum'])),
        createdAt: b.date(row.created, context),
        updatedAt: b.date(row.updated, context),
      })
    })
  }

  for (const file of byKind('comments')) {
    csvRowsToObjects(file.text).forEach((row, index) => {
      const line = index + 2
      const context = `${file.name} row ${line}`
      const feedbackId = row.feedback_id?.trim() || null
      const commentId = row.comment_id?.trim() || null
      const body = row.comment?.trim() || null
      if (!feedbackId || !body) {
        b.warn(`${context}: skipped comment because feedback_id or comment body is missing`)
        return
      }
      b.comments.push({
        externalId: commentId || stableId('comment', `${feedbackId}:${line}`),
        feedbackExternalId: feedbackId,
        body: b.body(body, context)!,
        authorExternalId: b.person(row.user_full_name || row.user_name, row.user_mail, context),
        isInternal: toOptionalBoolean(row.public) === false ? true : undefined,
        createdAt: b.date(row.created, context),
      })
    })
  }

  for (const file of byKind('users')) {
    for (const row of csvRowsToObjects(file.text)) {
      const email = row.data_mail?.trim()
      if (email && !email.endsWith('@anonymous.dummy')) b.dropSubscription()
    }
  }

  for (const file of byKind('unknown')) {
    b.warn(`Could not detect CSV type for "${file.name || 'unknown file'}"; skipped`)
  }
}
