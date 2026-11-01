import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { changelogEntry } from '~/server/database/schema/changelog'
import { feedback, feedbackComment, feedbackStatus, importedPerson, vote } from '~/server/database/schema/feedback'
import { importRun, importRunBatch } from '~/server/database/schema/imports'
import { CHANGELOG_LABELS } from '~/server/services/changelog/entries'
import { toCategorySlug } from '~/server/utils/project-categories'
import { SYSTEM_STATUSES } from '~/server/utils/project-statuses'
import { ErrorCode } from '~/server/utils/response'
import type {
  ImportBatch,
  ImportChangelog,
  ImportComment,
  ImportFeedback,
  ImportPerson,
  ImportVote,
  IssueInput,
} from './format'
import { commentKey } from './format'
import { DELETED_IN_VEERIFY, loadTombstones } from './tombstones'
import { importHttpError, listImportIssues } from './runs'
import { organizationOfProject, suppressedEmails } from './suppression'
import { resolveFeedbackStatus, resolveTaxonomy, type TaxonomyResolution } from './taxonomy'

/** Veerify field names synced from the source. The commit engine uses the same lists. */
export const SYNC_FIELDS = {
  feedback: ['title', 'body', 'status', 'categoryId', 'isPinned', 'isLocked', 'isHidden'],
  comment: ['body', 'isInternal'],
  changelog: ['title', 'body', 'labels', 'status', 'publishedAt'],
} as const

/** People have no snapshot column: the stored row is its own snapshot, so source changes always apply. */
export const PERSON_SYNC_FIELDS = ['name', 'email', 'avatarUrl'] as const

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/

function normalize(value: unknown): unknown {
  if (value === undefined) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' && ISO_DATETIME.test(value)) {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? value : d.toISOString()
  }
  return value
}

/** Value equality for synced fields: Date ≡ ISO string, arrays elementwise, null ≡ undefined. */
export function deepEqual(a: unknown, b: unknown): boolean {
  const x = normalize(a)
  const y = normalize(b)
  if (Array.isArray(x) || Array.isArray(y)) {
    if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length) return false
    return x.every((v, i) => deepEqual(v, y[i]))
  }
  if (x && y && typeof x === 'object' && typeof y === 'object') {
    const kx = Object.keys(x)
    const ky = Object.keys(y)
    if (kx.length !== ky.length) return false
    return kx.every((k) => deepEqual((x as any)[k], (y as any)[k]))
  }
  return x === y
}

export interface FieldSyncPlan {
  apply: Record<string, unknown>
  kept: string[]
  nextSnapshot: Record<string, unknown>
}

/**
 * Veerify-wins field sync. A field in `incoming` is applied only when its current value still equals the snapshot
 * (nobody edited it in Veerify); otherwise it is kept and the old snapshot value retained. A null snapshot (record
 * imported before snapshots existed) applies everything. Incoming values equal to the current value are neither
 * applied nor kept; the snapshot takes the incoming value.
 *
 * Snapshot contract: on insert, `importSnapshot` must hold the stored row's value for EVERY field in
 * `SYNC_FIELDS[entity]` (use `snapshotFor(entity, insertedRow)`), not only the incoming keys. A field missing from the
 * snapshot compares as null, so a defaulted column (status `open`, `isPinned: false`) would otherwise read as edited
 * and be kept forever. On update, store `nextSnapshot` (it carries over every key of the previous snapshot).
 */
export function planFieldSync(
  current: Record<string, unknown>,
  snapshot: Record<string, unknown> | null,
  incoming: Record<string, unknown>,
  fields: readonly string[]
): FieldSyncPlan {
  const apply: Record<string, unknown> = {}
  const kept: string[] = []
  const nextSnapshot: Record<string, unknown> = { ...(snapshot ?? {}) }
  for (const f of fields) {
    if (!Object.prototype.hasOwnProperty.call(incoming, f)) continue
    const value = incoming[f]
    if (deepEqual(current[f], value)) {
      nextSnapshot[f] = value
    } else if (snapshot === null || deepEqual(current[f], snapshot[f])) {
      apply[f] = value
      nextSnapshot[f] = value
    } else {
      kept.push(f)
      nextSnapshot[f] = snapshot[f]
    }
  }
  return { apply, kept, nextSnapshot }
}

/** The insert-time snapshot: every synced field of the stored row, dates as ISO strings, missing values as null. */
export function snapshotFor(entity: keyof typeof SYNC_FIELDS, row: Record<string, unknown>): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {}
  for (const f of SYNC_FIELDS[entity]) {
    const value = row[f]
    snapshot[f] = value instanceof Date ? value.toISOString() : (value ?? null)
  }
  return snapshot
}

/** Statuses a feedback record may take after taxonomy resolution (existing or system, plus to-be-created). */
export async function effectiveStatusValues(projectId: string, taxonomy: TaxonomyResolution): Promise<Set<string>> {
  const rows = await db
    .select({ value: feedbackStatus.value })
    .from(feedbackStatus)
    .where(eq(feedbackStatus.projectId, projectId))
  const values = new Set<string>(rows.length ? rows.map((r) => r.value) : SYSTEM_STATUSES.map((s) => s.value))
  for (const s of taxonomy.toCreate.statuses) values.add(s.value)
  return values
}

/** Incoming feedback values under Veerify field names. Fields the source omitted are absent. */
export function feedbackIncoming(
  rec: ImportFeedback,
  taxonomy: Pick<TaxonomyResolution, 'statusValueByExternalId' | 'defaultStatusValue' | 'categoryIdByExternalId'>,
  effective: Set<string>
): { incoming: Record<string, unknown>; issues: IssueInput[] } {
  const incoming: Record<string, unknown> = { title: rec.title }
  const issues: IssueInput[] = []
  if (rec.body !== undefined) incoming.body = rec.body
  if (rec.status !== undefined) {
    const resolved = resolveFeedbackStatus(rec.status, taxonomy, effective)
    incoming.status = resolved.value
    if (resolved.issue) issues.push({ ...resolved.issue, externalId: rec.externalId })
  }
  if (rec.category !== undefined) {
    const id = taxonomy.categoryIdByExternalId.get(rec.category)
    if (id) incoming.categoryId = id
    else if (!taxonomy.categoryIdByExternalId.has(rec.category))
      issues.push({
        severity: 'warning',
        entityType: 'feedback',
        externalId: rec.externalId,
        message: `Unknown category "${rec.category}"; category left unchanged`,
      })
  }
  for (const flag of ['isPinned', 'isLocked', 'isHidden'] as const) {
    if (rec[flag] !== undefined) incoming[flag] = rec[flag]
  }
  return { incoming, issues }
}

export function commentIncoming(rec: ImportComment): Record<string, unknown> {
  const incoming: Record<string, unknown> = { body: rec.body }
  if (rec.isInternal !== undefined) incoming.isInternal = rec.isInternal
  return incoming
}

export function changelogIncoming(rec: ImportChangelog): { incoming: Record<string, unknown>; issues: IssueInput[] } {
  const incoming: Record<string, unknown> = { title: rec.title, body: rec.body }
  const issues: IssueInput[] = []
  if (rec.labels !== undefined) {
    const allowed = new Set<string>(CHANGELOG_LABELS)
    incoming.labels = rec.labels.filter((l) => allowed.has(l))
    for (const l of rec.labels.filter((l) => !allowed.has(l)))
      issues.push({
        severity: 'warning',
        entityType: 'changelog',
        externalId: rec.externalId,
        message: `Label "${l}" is not a changelog label (${CHANGELOG_LABELS.join(', ')}); dropped`,
      })
  }
  // Same derivation as on insert: a publishedAt without a status means published.
  if (rec.status !== undefined) incoming.status = rec.status
  else if (rec.publishedAt !== undefined) incoming.status = 'published'
  if (rec.publishedAt !== undefined) incoming.publishedAt = rec.publishedAt
  return { incoming, issues }
}

export function personIncoming(rec: ImportPerson): Record<string, unknown> {
  const incoming: Record<string, unknown> = {}
  for (const f of PERSON_SYNC_FIELDS) if (rec[f] !== undefined) incoming[f] = rec[f]
  return incoming
}

export type ImportSection = 'statuses' | 'categories' | 'people' | 'feedback' | 'votes' | 'comments' | 'changelog'
export type SectionCounts = { create: number; update: number; unchanged: number; skip: number }

export const IMPORT_SECTIONS: readonly ImportSection[] = [
  'statuses',
  'categories',
  'people',
  'feedback',
  'votes',
  'comments',
  'changelog',
]

export function emptyCounts(): Record<ImportSection, SectionCounts> {
  return Object.fromEntries(IMPORT_SECTIONS.map((s) => [s, { create: 0, update: 0, unchanged: 0, skip: 0 }])) as Record<
    ImportSection,
    SectionCounts
  >
}

// Shared decisions: the preview (planImport) and the commit engine (committer.ts) call the same helpers, so a commit
// creates, skips and warns exactly where the preview said it would.

/** Warning for a feedback/comment whose author is not a known person (still imported, without a person). */
export function unknownAuthorIssue(
  entityType: 'feedback' | 'comment',
  rec: { externalId: string; authorExternalId?: string },
  knownPeople: ReadonlySet<string>
): IssueInput | null {
  if (rec.authorExternalId === undefined || knownPeople.has(rec.authorExternalId)) return null
  return {
    severity: 'warning',
    entityType,
    externalId: rec.externalId,
    message: `Unknown author "${rec.authorExternalId}"; imported without a person`,
  }
}

/** Splits a feedback record's listed votes into importable ones and skips (unknown person, duplicate person). */
export function voteDecisions(
  rec: Pick<ImportFeedback, 'externalId' | 'votes'>,
  knownPeople: ReadonlySet<string>
): { valid: ImportVote[]; skipped: IssueInput[] } {
  const valid: ImportVote[] = []
  const skipped: IssueInput[] = []
  const seen = new Set<string>()
  for (const v of rec.votes ?? []) {
    let message: string | null = null
    if (!knownPeople.has(v.personExternalId)) message = `Vote by unknown person "${v.personExternalId}" skipped`
    else if (seen.has(v.personExternalId)) message = `Duplicate vote by "${v.personExternalId}" skipped`
    if (message) {
      skipped.push({ severity: 'skipped', entityType: 'vote', externalId: rec.externalId, message })
      continue
    }
    seen.add(v.personExternalId)
    valid.push(v)
  }
  return { valid, skipped }
}

/** Skip issue for the listed votes of a feedback record that does not exist (deleted in Veerify). */
export function feedbackGoneVoteIssue(feedbackExternalId: string): IssueInput {
  return {
    severity: 'skipped',
    entityType: 'vote',
    externalId: feedbackExternalId,
    message: `Feedback "${feedbackExternalId}" no longer exists; its votes were skipped`,
  }
}

/** Net value of votes: upvotes minus downvotes (a missing type is an upvote). */
export function netVotes(votes: readonly { type?: string | null }[]): number {
  return votes.reduce((n, v) => n + (v.type === 'downvote' ? -1 : 1), 0)
}

/**
 * Imported vote baseline: the part of the source's voteCount not represented by listed votes. Null when the source
 * gave no voteCount: the stored baseline is kept (a re-import never removes what the source stopped sending).
 */
export function voteBaseline(voteCount: number | undefined, netListed: number): number | null {
  return voteCount === undefined ? null : Math.max(0, voteCount - netListed)
}

export { commentKey }

/**
 * Skip reason per comment (`commentKey` → reason, null = importable): deleted in Veerify (tombstoned), unknown
 * feedback, unknown parent (not in the run on the same feedback and not already imported), or a parent that is itself
 * skipped. Cycles count as unknown.
 */
export function commentSkipReasons(
  comments: readonly ImportComment[],
  knownFeedback: ReadonlySet<string>,
  existingCommentKeys: ReadonlySet<string>,
  tombstoned: ReadonlySet<string> = new Set()
): Map<string, string | null> {
  const runComments = new Map(comments.map((c) => [commentKey(c.feedbackExternalId, c.externalId), c]))
  const validity = new Map<string, string | null>()
  const resolve = (rec: ImportComment, trail: Set<string>): string | null => {
    const key = commentKey(rec.feedbackExternalId, rec.externalId)
    const cached = validity.get(key)
    if (cached !== undefined) return cached
    let reason: string | null = null
    if (tombstoned.has(key)) {
      reason = DELETED_IN_VEERIFY
    } else if (!knownFeedback.has(rec.feedbackExternalId)) {
      reason = `Comment on unknown feedback "${rec.feedbackExternalId}" skipped`
    } else if (rec.parentExternalId !== undefined) {
      const parentKey = commentKey(rec.feedbackExternalId, rec.parentExternalId)
      const parent = runComments.get(parentKey)
      if (parent && !trail.has(parentKey)) {
        trail.add(key)
        if (resolve(parent, trail) !== null && !existingCommentKeys.has(parentKey))
          reason = `Comment with skipped parent "${rec.parentExternalId}" skipped`
      } else if (!existingCommentKeys.has(parentKey)) {
        reason = `Comment with unknown parent "${rec.parentExternalId}" skipped`
      }
    }
    validity.set(key, reason)
    return reason
  }
  for (const rec of comments) resolve(rec, new Set())
  return validity
}

/** Warnings for changelog links to feedback that is neither in the run nor previously imported. */
export function changelogLinkIssues(rec: ImportChangelog, knownFeedback: ReadonlySet<string>): IssueInput[] {
  return (rec.feedbackExternalIds ?? [])
    .filter((fid) => !knownFeedback.has(fid))
    .map((fid) => ({
      severity: 'warning' as const,
      entityType: 'changelog',
      externalId: rec.externalId,
      message: `Linked feedback "${fid}" is unknown; link skipped`,
    }))
}

export interface ImportPlan {
  counts: Record<ImportSection, SectionCounts>
  kept: { entity: 'feedback' | 'comment' | 'changelog' | 'person'; externalId: string; fields: string[] }[]
  taxonomy: TaxonomyResolution['toCreate']
  issues: IssueInput[]
}

export const MAX_PLAN_KEPT = 200
export const MAX_PLAN_ISSUES = 500
const CHUNK = 5000

function chunks<T>(list: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK))
  return out
}

/** Merges staged batches (ordered by seq) into one batch. */
export async function loadRunBatch(runId: string): Promise<ImportBatch> {
  const rows = await db
    .select({ seq: importRunBatch.seq, payload: importRunBatch.payload })
    .from(importRunBatch)
    .where(eq(importRunBatch.runId, runId))
    .orderBy(asc(importRunBatch.seq))
  const merged: ImportBatch = { statuses: [], categories: [], people: [], feedback: [], comments: [], changelog: [] }
  for (const row of rows) {
    for (const section of Object.keys(merged) as (keyof ImportBatch)[]) {
      ;(merged[section] as unknown[]).push(...((row.payload?.[section] as unknown[] | undefined) ?? []))
    }
  }
  return merged
}

/** Dry run of a staged import: what a commit would create, update, keep and skip. Writes nothing. */
export async function planImport(runId: string): Promise<ImportPlan> {
  const [run] = await db.select().from(importRun).where(eq(importRun.id, runId)).limit(1)
  if (!run) importHttpError(404, 'Not Found', ErrorCode.NOT_FOUND, 'Import run not found')
  // The staged records are deleted once a run finishes (they hold personal data), so only drafts can be previewed.
  if (run.status !== 'draft') {
    importHttpError(409, 'Conflict', ErrorCode.CONFLICT, 'Preview is only available before commit')
  }
  const { projectId, source } = run
  const sync = run.onExisting !== 'skip'

  const batch = await loadRunBatch(runId)
  const staged = await listImportIssues(runId, MAX_PLAN_ISSUES)
  const taxonomy = await resolveTaxonomy(projectId, batch, { apply: false })
  const effective = await effectiveStatusValues(projectId, taxonomy)

  const counts = emptyCounts()
  const kept: ImportPlan['kept'] = []
  const issues: IssueInput[] = [
    ...staged.map((i) => ({
      severity: (i.severity ?? 'warning') as IssueInput['severity'],
      entityType: i.entityType ?? '',
      ...(i.externalId ? { externalId: i.externalId } : {}),
      message: i.message,
    })),
    ...taxonomy.issues,
  ]
  const noteKept = (entity: ImportPlan['kept'][number]['entity'], externalId: string, fields: string[]) => {
    if (fields.length && kept.length < MAX_PLAN_KEPT) kept.push({ entity, externalId, fields })
  }
  const tally = (section: ImportSection, plan: FieldSyncPlan) => {
    counts[section][Object.keys(plan.apply).length ? 'update' : 'unchanged']++
  }

  // Taxonomy
  // System statuses saved alongside a new one already exist in effect; only imported statuses count as created.
  const createdStatusValues = new Set(taxonomy.toCreate.statuses.filter((s) => !s.systemDefault).map((s) => s.value))
  counts.statuses.create = createdStatusValues.size
  for (const s of batch.statuses) {
    const value = taxonomy.statusValueByExternalId.get(s.externalId)
    if (value === undefined) counts.statuses.skip++
    else if (!createdStatusValues.has(value)) counts.statuses.unchanged++
  }
  const pendingSlugs = new Set(taxonomy.toCreate.categories.map((c) => c.slug))
  counts.categories.create = taxonomy.toCreate.categories.length
  // Categories to be created have no id yet; a placeholder lets the preview see the change.
  const categoryIdByExternalId = new Map(taxonomy.categoryIdByExternalId)
  for (const c of batch.categories) {
    if (categoryIdByExternalId.get(c.externalId)) counts.categories.unchanged++
    else if (pendingSlugs.has(toCategorySlug(c.name))) {
      categoryIdByExternalId.set(c.externalId, `new:${toCategorySlug(c.name)}`)
    } else counts.categories.skip++
  }

  // People
  const personRows = await db
    .select()
    .from(importedPerson)
    .where(and(eq(importedPerson.projectId, projectId), eq(importedPerson.source, source)))
  const personByExternalId = new Map(personRows.map((p) => [p.externalId, p]))
  const knownPeople = new Set([...personByExternalId.keys(), ...batch.people.map((p) => p.externalId)])
  // Same check as the commit: a suppressed (erased) address is created tombstoned and never synced onto a person.
  const suppressed = await suppressedEmails(
    await organizationOfProject(projectId),
    batch.people.map((p) => p.email)
  )
  for (const rec of batch.people) {
    const row = personByExternalId.get(rec.externalId)
    if (!row) counts.people.create++
    else if (!sync || row.erasedAt || (rec.email && suppressed.has(rec.email.trim().toLowerCase())))
      counts.people.unchanged++
    else tally('people', planFieldSync(row, row, personIncoming(rec), PERSON_SYNC_FIELDS))
  }

  // Feedback
  const feedbackRows = await db
    .select()
    .from(feedback)
    .where(and(eq(feedback.projectId, projectId), eq(feedback.externalSource, source)))
  const feedbackByExternalId = new Map(feedbackRows.filter((f) => f.externalId).map((f) => [f.externalId!, f]))
  const feedbackExternalIdById = new Map(feedbackRows.map((f) => [f.id, f.externalId]))
  // Feedback the team deleted in Veerify is skipped (the commit does the same), so it is not "known" either.
  const deletedFeedback = await loadTombstones(projectId, source, 'feedback')
  const isDeleted = (externalId: string) => deletedFeedback.has(externalId)
  const knownFeedback = new Set([
    ...feedbackByExternalId.keys(),
    ...batch.feedback.map((f) => f.externalId).filter((id) => !isDeleted(id)),
  ])
  for (const rec of batch.feedback) {
    if (isDeleted(rec.externalId)) {
      counts.feedback.skip++
      issues.push({
        severity: 'skipped',
        entityType: 'feedback',
        externalId: rec.externalId,
        message: DELETED_IN_VEERIFY,
      })
      continue
    }
    const { incoming, issues: recIssues } = feedbackIncoming(rec, { ...taxonomy, categoryIdByExternalId }, effective)
    issues.push(...recIssues)
    const authorIssue = unknownAuthorIssue('feedback', rec, knownPeople)
    if (authorIssue) issues.push(authorIssue)
    const row = feedbackByExternalId.get(rec.externalId)
    if (!row) counts.feedback.create++
    else if (!sync) counts.feedback.unchanged++
    else {
      const plan = planFieldSync(row, row.importSnapshot ?? null, incoming, SYNC_FIELDS.feedback)
      tally('feedback', plan)
      noteKept('feedback', rec.externalId, plan.kept)
    }
  }

  // Votes
  const existingFeedbackIds = feedbackRows.map((f) => f.id)
  const votePairs = new Set<string>()
  for (const ids of chunks(existingFeedbackIds)) {
    const rows = await db
      .select({ feedbackId: vote.feedbackId, importedPersonId: vote.importedPersonId })
      .from(vote)
      .where(and(inArray(vote.feedbackId, ids), isNotNull(vote.importedPersonId)))
    for (const v of rows) if (v.importedPersonId) votePairs.add(`${v.feedbackId}\u0000${v.importedPersonId}`)
  }
  // A claimed person votes as the claiming user; the commit skips the vote when that user already voted on the post.
  const claimingUsers = [...new Set(personRows.map((p) => p.claimedByUserId).filter((u): u is string => !!u))]
  const userVotePairs = new Set<string>()
  if (claimingUsers.length) {
    for (const ids of chunks(existingFeedbackIds)) {
      const rows = await db
        .select({ feedbackId: vote.feedbackId, voterUserId: vote.voterUserId })
        .from(vote)
        .where(and(inArray(vote.feedbackId, ids), inArray(vote.voterUserId, claimingUsers)))
      for (const v of rows) userVotePairs.add(`${v.feedbackId}\u0000${v.voterUserId}`)
    }
  }
  for (const rec of batch.feedback) {
    const fbRow = feedbackByExternalId.get(rec.externalId)
    const fbKey = fbRow?.id ?? `new:${rec.externalId}`
    const { valid, skipped } = voteDecisions(rec, knownPeople)
    counts.votes.skip += skipped.length
    issues.push(...skipped)
    if (isDeleted(rec.externalId)) {
      counts.votes.skip += valid.length
      if (valid.length) issues.push(feedbackGoneVoteIssue(rec.externalId))
      continue
    }
    for (const v of valid) {
      const person = personByExternalId.get(v.personExternalId)
      const claimedBy = person?.claimedByUserId ?? null
      const exists =
        (!!fbRow && !!person && votePairs.has(`${fbRow.id}\u0000${person.id}`)) ||
        (!!claimedBy && userVotePairs.has(`${fbKey}\u0000${claimedBy}`))
      // Within the run, a second person claimed by the same user on the same post also hits the user's vote.
      if (!exists && claimedBy) userVotePairs.add(`${fbKey}\u0000${claimedBy}`)
      counts.votes[exists ? 'unchanged' : 'create']++
    }
  }

  // Comments
  const commentRows: (typeof feedbackComment.$inferSelect)[] = []
  for (const ids of chunks(existingFeedbackIds)) {
    commentRows.push(
      ...(await db
        .select()
        .from(feedbackComment)
        .where(and(inArray(feedbackComment.feedbackId, ids), eq(feedbackComment.externalSource, source))))
    )
  }
  const existingComments = new Map<string, typeof feedbackComment.$inferSelect>()
  for (const c of commentRows) {
    const fbExternalId = feedbackExternalIdById.get(c.feedbackId)
    if (fbExternalId && c.externalId) existingComments.set(commentKey(fbExternalId, c.externalId), c)
  }
  const skipReasons = commentSkipReasons(
    batch.comments,
    knownFeedback,
    new Set(existingComments.keys()),
    await loadTombstones(projectId, source, 'comment')
  )
  for (const rec of batch.comments) {
    const reason = skipReasons.get(commentKey(rec.feedbackExternalId, rec.externalId)) ?? null
    if (reason !== null) {
      counts.comments.skip++
      issues.push({ severity: 'skipped', entityType: 'comment', externalId: rec.externalId, message: reason })
      continue
    }
    const authorIssue = unknownAuthorIssue('comment', rec, knownPeople)
    if (authorIssue) issues.push(authorIssue)
    const row = existingComments.get(commentKey(rec.feedbackExternalId, rec.externalId))
    if (!row) counts.comments.create++
    else if (!sync) counts.comments.unchanged++
    else {
      const plan = planFieldSync(row, row.importSnapshot ?? null, commentIncoming(rec), SYNC_FIELDS.comment)
      tally('comments', plan)
      noteKept('comment', rec.externalId, plan.kept)
    }
  }

  // Changelog
  const changelogRows = await db
    .select()
    .from(changelogEntry)
    .where(and(eq(changelogEntry.projectId, projectId), eq(changelogEntry.externalSource, source)))
  const changelogByExternalId = new Map(changelogRows.filter((c) => c.externalId).map((c) => [c.externalId!, c]))
  for (const rec of batch.changelog) {
    const { incoming, issues: recIssues } = changelogIncoming(rec)
    issues.push(...recIssues, ...changelogLinkIssues(rec, knownFeedback))
    const row = changelogByExternalId.get(rec.externalId)
    if (!row) counts.changelog.create++
    else if (!sync) counts.changelog.unchanged++
    else {
      const plan = planFieldSync(row, row.importSnapshot ?? null, incoming, SYNC_FIELDS.changelog)
      tally('changelog', plan)
      noteKept('changelog', rec.externalId, plan.kept)
    }
  }

  return { counts, kept, taxonomy: taxonomy.toCreate, issues: issues.slice(0, MAX_PLAN_ISSUES) }
}
