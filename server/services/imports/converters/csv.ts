import { csvRowsToObjects } from './csv-parse'
import {
  ImportBuilder,
  pickFirstNumber,
  pickFirstString,
  sanitizeColor,
  stableId,
  toOptionalBoolean,
  voteCountOf,
  type ConverterOptions,
  type ConverterResult,
} from './builder'
import { convertSleekplanCsvFiles, isSleekplanExport, type CsvFile } from './sleekplan-csv'

function recordTypeForRow(row: Record<string, string>) {
  const explicit = (row.record_type || row.type || '').trim().toLowerCase()
  if (explicit) return explicit
  if (row.feedback_external_id && row.email && !row.title) return 'subscription'
  if (row.feedback_external_id && row.body && !row.title) return 'comment'
  return 'feedback'
}

function convertGenericCsv(file: CsvFile, b: ImportBuilder) {
  csvRowsToObjects(file.text).forEach((row, index) => {
    const recordType = recordTypeForRow(row)
    const line = index + 2
    const context = `${file.name} row ${line}`
    const externalId = pickFirstString(row, ['external_id', 'id', 'source_id'])
    const title = pickFirstString(row, ['title', 'name'])
    const body = pickFirstString(row, ['body', 'description', 'text', 'detail'])
    const categoryName = pickFirstString(row, ['category', 'category_name'])
    const statusName = pickFirstString(row, ['status', 'status_name'])
    const created = () => b.date(pickFirstString(row, ['created_at', 'created']), context)
    const updated = () => b.date(pickFirstString(row, ['updated_at', 'updated']), context)

    const category = b.category(categoryName, sanitizeColor(pickFirstString(row, ['category_color', 'color'])))
    const status = b.status(statusName, sanitizeColor(pickFirstString(row, ['status_color'])))

    if (recordType === 'changelog') {
      if (!title || !body) {
        b.warn(`${context}: skipped changelog because title or body is missing`)
        return
      }
      const publishedAt = b.date(pickFirstString(row, ['published_at', 'published']), context)
      b.changelog.push({
        externalId: externalId || stableId('changelog', `${title}:${line}`),
        title: b.title(title, context),
        body: b.body(body, context)!,
        labels: categoryName ? [categoryName.slice(0, 100)] : undefined,
        publishedAt,
        status: publishedAt ? 'published' : undefined,
      })
      return
    }

    if (recordType === 'comment') {
      const feedbackExternalId = pickFirstString(row, [
        'feedback_external_id',
        'parent_external_id',
        'item_external_id',
      ])
      if (!feedbackExternalId || !body) {
        b.warn(`${context}: skipped comment because feedback_external_id or body is missing`)
        return
      }
      b.comments.push({
        externalId: externalId || stableId('comment', `${feedbackExternalId}:${line}`),
        feedbackExternalId,
        body: b.body(body, context)!,
        authorExternalId: b.person(
          pickFirstString(row, ['author_name', 'username', 'name']),
          pickFirstString(row, ['author_email', 'email']),
          context
        ),
        isInternal: toOptionalBoolean(row.is_internal) ?? undefined,
        createdAt: created(),
      })
      return
    }

    if (recordType === 'subscription') {
      b.dropSubscription()
      if (!pickFirstString(row, ['feedback_external_id', 'parent_external_id', 'item_external_id'])) {
        b.warn(`${context}: subscription row has no feedback_external_id`)
      }
      return
    }

    if (!title) {
      b.warn(`${context}: skipped ${recordType === 'roadmap' ? 'roadmap' : 'feedback'} row because title is missing`)
      return
    }

    // Roadmap entries are plain feedback with a status in the veerify-import format.
    b.feedback.push({
      externalId: externalId || stableId(recordType === 'roadmap' ? 'roadmap' : 'feedback', `${title}:${line}`),
      title: b.title(title, context),
      body: b.body(body, context),
      status: status ?? b.status(recordType === 'roadmap' ? 'Planned' : 'Open'),
      category,
      authorExternalId: b.person(
        pickFirstString(row, ['author_name', 'username', 'name']),
        pickFirstString(row, ['author_email', 'email']),
        context
      ),
      voteCount: voteCountOf(pickFirstNumber(row, ['vote_count', 'votes', 'score'])),
      createdAt: created(),
      updatedAt: updated(),
    })
  })
}

/**
 * Converts one or more CSV files to a veerify-import/1 document. A Sleekplan multi-file export
 * (feedback / comments / votes / users) is detected by header; anything else is read as a generic CSV.
 */
export function convertCsvToImport(files: CsvFile[], opts: ConverterOptions = {}): ConverterResult {
  const b = new ImportBuilder({ source: 'csv', sourceLabel: 'CSV' }, opts)
  const nonEmpty = files.filter((f) => f.text?.trim())
  if (nonEmpty.length === 0) b.warn('No CSV file with content was provided')
  else if (isSleekplanExport(nonEmpty)) convertSleekplanCsvFiles(nonEmpty, b)
  else for (const file of nonEmpty) convertGenericCsv(file, b)
  return b.build()
}
