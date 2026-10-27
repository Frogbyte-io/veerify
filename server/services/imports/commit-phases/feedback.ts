import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { feedback } from '~/server/database/schema/feedback'
import type { ImportFeedback } from '../format'
import { SYNC_FIELDS, deepEqual, feedbackIncoming, planFieldSync, snapshotFor, unknownAuthorIssue } from '../planner'
import { resolveFeedbackStatus } from '../taxonomy'
import { DELETED_IN_VEERIFY, isTombstoned, loadTombstones } from '../tombstones'
import { loadPeople, lockPeople, sourceDate, type CommitPhase, type PersonRef } from './context'

type FeedbackState = { people: Map<string, PersonRef>; deleted: Set<string> }

/**
 * Feedback: insert on (projectId, externalSource, externalId), else Veerify-wins sync of SYNC_FIELDS.feedback.
 * Votes and their counter are applied in the votes phase, so inserts start at voteCount 0 / baseline 0. Author
 * fields come from the imported person. authorUserId is only set on insert, to the user who already claimed that
 * person (never from a matching email); rows inserted before a claim are re-pointed by the claim itself.
 * Feedback the team deleted in Veerify (an import tombstone) is skipped, never re-created.
 */
export const feedbackPhase: CommitPhase<FeedbackState, ImportFeedback> = {
  name: 'feedback',
  items: (ctx) => ctx.batch.feedback,
  load: async (ctx) => ({
    people: await loadPeople(ctx),
    deleted: await loadTombstones(ctx.run.projectId, ctx.run.source, 'feedback'),
  }),
  async apply(ctx, { people, deleted }, rec) {
    const { run } = ctx
    const skipDeleted = () => {
      ctx.counts.feedback.skip++
      ctx.issue({
        severity: 'skipped',
        entityType: 'feedback',
        externalId: rec.externalId,
        message: DELETED_IN_VEERIFY,
      })
    }
    if (deleted.has(rec.externalId)) return skipDeleted()
    const taxonomy = ctx.taxonomy!
    const now = ctx.now()
    const { incoming, issues } = feedbackIncoming(rec, taxonomy, ctx.effectiveStatuses)
    issues.forEach(ctx.issue)
    const authorIssue = unknownAuthorIssue('feedback', rec, new Set(people.keys()))
    if (authorIssue) ctx.issue(authorIssue)
    const person = rec.authorExternalId !== undefined ? people.get(rec.authorExternalId) : undefined

    const createdAt = sourceDate(rec.createdAt, now)
    const values = {
      id: randomUUID(),
      projectId: run.projectId,
      productId: run.productId,
      title: rec.title,
      body: rec.body ?? null,
      status: resolveFeedbackStatus(rec.status, taxonomy, ctx.effectiveStatuses).value,
      categoryId: (incoming.categoryId as string | undefined) ?? null,
      isPinned: rec.isPinned ?? false,
      isLocked: rec.isLocked ?? false,
      isHidden: rec.isHidden ?? false,
      authorName: person?.name ?? null,
      authorEmail: person?.email ?? null,
      importedPersonId: person?.id ?? null,
      sourceLabel: run.sourceLabel,
      metadata: { ...(rec.metadata ?? {}), import: { runId: run.id, url: rec.url ?? null } },
      externalSource: run.source,
      externalId: rec.externalId,
      voteCount: 0,
      commentCount: 0,
      importedVoteBaseline: 0,
      createdAt,
      updatedAt: sourceDate(rec.updatedAt, createdAt),
    }

    const outcome = await db.transaction(async (tx) => {
      // Deleted while this run was committing (the delete route writes the tombstone with the delete).
      const tombstone = { projectId: run.projectId, entity: 'feedback' as const, source: run.source }
      if (await isTombstoned(tx, { ...tombstone, externalId: rec.externalId })) {
        return { result: 'deleted' as const, kept: false }
      }
      const locked = person ? (await lockPeople(tx, [person.id])).get(person.id) : undefined
      const claimedBy = locked?.claimedByUserId ?? null
      const [inserted] = await tx
        .insert(feedback)
        .values({
          ...values,
          authorName: locked?.name ?? null,
          authorEmail: locked?.email ?? null,
          authorUserId: claimedBy,
          importSnapshot: snapshotFor('feedback', values),
        })
        .onConflictDoNothing({ target: [feedback.projectId, feedback.externalSource, feedback.externalId] })
        .returning({ id: feedback.id })
      if (inserted) return { result: 'create' as const, kept: false }
      if (!ctx.sync) return { result: 'unchanged' as const, kept: false }

      const [row] = await tx
        .select()
        .from(feedback)
        .where(
          and(
            eq(feedback.projectId, run.projectId),
            eq(feedback.externalSource, run.source),
            eq(feedback.externalId, rec.externalId)
          )
        )
        .for('update')
        .limit(1)
      if (!row) return { result: 'unchanged' as const, kept: false }
      const plan = planFieldSync(row, row.importSnapshot ?? null, incoming, SYNC_FIELDS.feedback)
      const applied = Object.keys(plan.apply).length > 0
      const set: Partial<typeof feedback.$inferInsert> = applied ? { ...plan.apply, updatedAt: now } : {}
      if (!deepEqual(plan.nextSnapshot, row.importSnapshot)) set.importSnapshot = plan.nextSnapshot
      if (Object.keys(set).length) await tx.update(feedback).set(set).where(eq(feedback.id, row.id))
      return { result: applied ? ('update' as const) : ('unchanged' as const), kept: plan.kept.length > 0 }
    })
    if (outcome.result === 'deleted') return skipDeleted()
    ctx.counts.feedback[outcome.result]++
    if (outcome.kept) ctx.kept++
  },
}
