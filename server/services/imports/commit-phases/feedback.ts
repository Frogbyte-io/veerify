import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { feedback } from '~/server/database/schema/feedback'
import type { ImportFeedback } from '../format'
import { SYNC_FIELDS, deepEqual, feedbackIncoming, planFieldSync, snapshotFor, unknownAuthorIssue } from '../planner'
import { resolveFeedbackStatus } from '../taxonomy'
import { loadPeople, lockPersonClaims, sourceDate, type CommitPhase, type PersonRef } from './context'

/**
 * Feedback: insert on (projectId, externalSource, externalId), else Veerify-wins sync of SYNC_FIELDS.feedback.
 * Votes and their counter are applied in the votes phase, so inserts start at voteCount 0 / baseline 0. Author
 * fields come from the imported person. authorUserId is only set on insert, to the user who already claimed that
 * person (never from a matching email); rows inserted before a claim are re-pointed by the claim itself.
 */
export const feedbackPhase: CommitPhase<Map<string, PersonRef>, ImportFeedback> = {
  name: 'feedback',
  items: (ctx) => ctx.batch.feedback,
  load: loadPeople,
  async apply(ctx, people, rec) {
    const { run } = ctx
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
      const claimedBy = person ? ((await lockPersonClaims(tx, [person.id])).get(person.id) ?? null) : null
      const [inserted] = await tx
        .insert(feedback)
        .values({ ...values, authorUserId: claimedBy, importSnapshot: snapshotFor('feedback', values) })
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
    ctx.counts.feedback[outcome.result]++
    if (outcome.kept) ctx.kept++
  },
}
