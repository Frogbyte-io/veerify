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

type JsonRecord = Record<string, any>

export type SleekplanPayloads = {
  items?: unknown
  roadmap?: unknown
  comments?: unknown
  changelog?: unknown
  categories?: unknown
  statuses?: unknown
  subscriptions?: unknown
}

export function unwrapArrayPayload(payload: unknown): JsonRecord[] {
  const isObj = (x: unknown) => !!x && typeof x === 'object'
  if (Array.isArray(payload)) return payload.filter(isObj)
  if (isObj(payload)) {
    const typed = payload as Record<string, any>
    for (const key of ['data', 'items', 'results', 'records']) {
      if (Array.isArray(typed[key])) return typed[key].filter(isObj)
    }
  }
  return []
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' ? (value as JsonRecord) : {}
}

function convertItem(b: ImportBuilder, record: JsonRecord, kind: 'feedback' | 'roadmap', index: number) {
  const title = pickFirstString(record, ['title', 'name', 'subject'])
  const context = `${kind} item ${index + 1}`
  if (!title) {
    b.warn(`${context}: skipped because title is missing`)
    return
  }
  const user = asRecord(record.user)
  const categoryName =
    pickFirstString(record, ['category', 'category_name']) ||
    pickFirstString(asRecord(record.category), ['name', 'title'])
  const rawStatus = pickFirstString(record, ['status', 'status_name', 'workflow_status'])
  b.feedback.push({
    externalId: pickFirstString(record, ['id', 'item_id', 'uuid']) || stableId(kind, `${index}:${title}`),
    title: b.title(title, context),
    body: b.body(pickFirstString(record, ['description', 'body', 'text', 'detail']), context),
    status: b.status(rawStatus || (kind === 'roadmap' ? 'Planned' : 'Open')),
    category: b.category(categoryName),
    authorExternalId: b.person(
      pickFirstString(record, ['author_name', 'username', 'name']) || pickFirstString(user, ['name']),
      pickFirstString(record, ['author_email', 'email']) || pickFirstString(user, ['email']),
      context
    ),
    voteCount: voteCountOf(pickFirstNumber(record, ['vote_count', 'votes_count', 'votes', 'score'])),
    createdAt: b.date(pickFirstString(record, ['created_at', 'created']), context),
    updatedAt: b.date(pickFirstString(record, ['updated_at', 'updated']), context),
  })
}

/** Converts already-fetched Sleekplan API payloads. Pure: fetching them is the caller's job. */
export function convertSleekplanApiToImport(payloads: SleekplanPayloads, opts: ConverterOptions = {}): ConverterResult {
  const b = new ImportBuilder({ source: 'sleekplan', sourceLabel: 'Sleekplan' }, opts)

  if (!payloads.items) b.warn('Sleekplan items are missing; no feedback will be imported')
  if (!payloads.comments) b.warn('Sleekplan comments are missing and will be skipped')
  if (!payloads.subscriptions) b.warn('Sleekplan subscribers are missing and will be skipped')

  // Explicit statuses/categories first so their names and colors win over implicit ones.
  for (const record of unwrapArrayPayload(payloads.categories)) {
    b.category(
      pickFirstString(record, ['name', 'title']) || 'Imported category',
      sanitizeColor(pickFirstString(record, ['color']))
    )
  }
  unwrapArrayPayload(payloads.statuses).forEach((record, index) => {
    b.status(
      pickFirstString(record, ['name', 'title']) || `Status ${index + 1}`,
      sanitizeColor(pickFirstString(record, ['color']))
    )
  })

  unwrapArrayPayload(payloads.items).forEach((r, i) => convertItem(b, r, 'feedback', i))
  unwrapArrayPayload(payloads.roadmap).forEach((r, i) => convertItem(b, r, 'roadmap', i))

  unwrapArrayPayload(payloads.comments).forEach((record, index) => {
    const feedbackExternalId =
      pickFirstString(record, ['feedback_external_id', 'item_id', 'post_id']) ||
      pickFirstString(asRecord(record.item), ['id'])
    const body = pickFirstString(record, ['body', 'text', 'comment'])
    const context = `comment ${index + 1}`
    if (!feedbackExternalId || !body) {
      b.warn(`${context}: skipped because feedback id or body is missing`)
      return
    }
    const user = asRecord(record.user)
    b.comments.push({
      externalId:
        pickFirstString(record, ['id', 'uuid']) ||
        stableId('comment', `${index}:${feedbackExternalId}:${body.slice(0, 24)}`),
      feedbackExternalId,
      body: b.body(body, context)!,
      authorExternalId: b.person(
        pickFirstString(record, ['author_name', 'username', 'name']) || pickFirstString(user, ['name']),
        pickFirstString(record, ['author_email', 'email']) || pickFirstString(user, ['email']),
        context
      ),
      isInternal: toOptionalBoolean(record.is_internal) ?? undefined,
      createdAt: b.date(pickFirstString(record, ['created_at', 'created']), context),
    })
  })

  unwrapArrayPayload(payloads.changelog).forEach((record, index) => {
    const title = pickFirstString(record, ['title', 'name'])
    const body = pickFirstString(record, ['body', 'text', 'description'])
    const context = `changelog ${index + 1}`
    if (!title || !body) {
      b.warn(`${context}: skipped because title or body is missing`)
      return
    }
    const category = pickFirstString(record, ['category', 'category_name'])
    const publishedAt = b.date(pickFirstString(record, ['published_at', 'published']), context)
    b.changelog.push({
      externalId: pickFirstString(record, ['id', 'uuid']) || stableId('changelog', `${index}:${title}`),
      title: b.title(title, context),
      body: b.body(body, context)!,
      labels: category ? [category.slice(0, 100)] : undefined,
      publishedAt,
      status: publishedAt ? 'published' : undefined,
    })
  })

  for (const record of unwrapArrayPayload(payloads.subscriptions)) {
    if (pickFirstString(record, ['email']) || pickFirstString(asRecord(record.user), ['email'])) b.dropSubscription()
  }

  return b.build()
}
