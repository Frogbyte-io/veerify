import { randomUUID } from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackComment } from '~/server/database/schema/feedback'
import type { ImportComment } from '../format'
import {
  SYNC_FIELDS,
  commentIncoming,
  commentKey,
  commentSkipReasons,
  deepEqual,
  planFieldSync,
  snapshotFor,
  unknownAuthorIssue,
} from '../planner'
import {
  loadFeedback,
  loadPeople,
  lockPeople,
  sourceDate,
  type CommitContext,
  type CommitPhase,
  type FeedbackRef,
  type PersonRef,
} from './context'

type CommentState = {
  people: Map<string, PersonRef>
  feedback: Map<string, FeedbackRef>
  skipReasons: Map<string, string | null>
}

const CHUNK = 5000

/** Comments ordered so every parent in the run comes before its replies (stable within a depth). */
export function orderParentsFirst(comments: readonly ImportComment[]): ImportComment[] {
  const byKey = new Map(comments.map((c) => [commentKey(c.feedbackExternalId, c.externalId), c]))
  const depth = new Map<string, number>()
  const depthOf = (c: ImportComment, trail: Set<string>): number => {
    const key = commentKey(c.feedbackExternalId, c.externalId)
    const cached = depth.get(key)
    if (cached !== undefined) return cached
    let d = 0
    if (c.parentExternalId !== undefined) {
      const parentKey = commentKey(c.feedbackExternalId, c.parentExternalId)
      const parent = byKey.get(parentKey)
      if (parent && !trail.has(parentKey)) d = depthOf(parent, trail.add(key)) + 1
    }
    depth.set(key, d)
    return d
  }
  return comments
    .map((c, i) => ({ c, i, d: depthOf(c, new Set()) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((x) => x.c)
}

async function existingCommentKeys(ctx: CommitContext, fb: Map<string, FeedbackRef>): Promise<Set<string>> {
  const externalIdById = new Map([...fb].map(([externalId, ref]) => [ref.id, externalId]))
  const ids = [...externalIdById.keys()]
  const keys = new Set<string>()
  for (let i = 0; i < ids.length; i += CHUNK) {
    const rows = await db
      .select({ feedbackId: feedbackComment.feedbackId, externalId: feedbackComment.externalId })
      .from(feedbackComment)
      .where(
        and(
          inArray(feedbackComment.feedbackId, ids.slice(i, i + CHUNK)),
          eq(feedbackComment.externalSource, ctx.run.source)
        )
      )
    for (const r of rows) {
      const fbExternalId = externalIdById.get(r.feedbackId)
      if (fbExternalId && r.externalId) keys.add(commentKey(fbExternalId, r.externalId))
    }
  }
  return keys
}

/**
 * Comments, parents before replies. Insert on (feedbackId, externalSource, externalId) and bump
 * feedback.commentCount in the same transaction; existing comments get the Veerify-wins sync.
 */
export const commentsPhase: CommitPhase<CommentState, ImportComment> = {
  name: 'comments',
  items: (ctx) => orderParentsFirst(ctx.batch.comments),
  async load(ctx) {
    const fb = await loadFeedback(ctx)
    const skipReasons = commentSkipReasons(ctx.batch.comments, new Set(fb.keys()), await existingCommentKeys(ctx, fb))
    return { people: await loadPeople(ctx), feedback: fb, skipReasons }
  },
  async apply(ctx, state, rec) {
    const { run } = ctx
    const skip = (message: string) => {
      ctx.counts.comments.skip++
      ctx.issue({ severity: 'skipped', entityType: 'comment', externalId: rec.externalId, message })
    }
    const reason = state.skipReasons.get(commentKey(rec.feedbackExternalId, rec.externalId)) ?? null
    if (reason !== null) return skip(reason)
    const fb = state.feedback.get(rec.feedbackExternalId)
    if (!fb) return skip(`Comment on unknown feedback "${rec.feedbackExternalId}" skipped`)
    const authorIssue = unknownAuthorIssue('comment', rec, new Set(state.people.keys()))
    if (authorIssue) ctx.issue(authorIssue)
    const person = rec.authorExternalId !== undefined ? state.people.get(rec.authorExternalId) : undefined
    const now = ctx.now()
    const createdAt = sourceDate(rec.createdAt, now)
    const byExternalId = (externalId: string) =>
      and(
        eq(feedbackComment.feedbackId, fb.id),
        eq(feedbackComment.externalSource, run.source),
        eq(feedbackComment.externalId, externalId)
      )

    const outcome = await db.transaction(async (tx) => {
      // Attributed only to the user who already claimed the person (see lockPersonClaims).
      const locked = person ? (await lockPeople(tx, [person.id])).get(person.id) : undefined
      const claimedBy = locked?.claimedByUserId ?? null
      let parentCommentId: string | null = null
      if (rec.parentExternalId !== undefined) {
        const [parent] = await tx
          .select({ id: feedbackComment.id })
          .from(feedbackComment)
          .where(byExternalId(rec.parentExternalId))
          .limit(1)
        if (!parent) return { result: 'missing-parent' as const, kept: false }
        parentCommentId = parent.id
      }
      const values = {
        id: randomUUID(),
        feedbackId: fb.id,
        parentCommentId,
        body: rec.body,
        isInternal: rec.isInternal ?? false,
        authorName: locked?.name ?? null,
        authorEmail: locked?.email ?? null,
        importedPersonId: person?.id ?? null,
        externalSource: run.source,
        externalId: rec.externalId,
        createdAt,
        updatedAt: createdAt,
      }
      const [inserted] = await tx
        .insert(feedbackComment)
        .values({ ...values, authorUserId: claimedBy, importSnapshot: snapshotFor('comment', values) })
        .onConflictDoNothing({
          target: [feedbackComment.feedbackId, feedbackComment.externalSource, feedbackComment.externalId],
        })
        .returning({ id: feedbackComment.id })
      if (inserted) {
        await tx
          .update(feedback)
          .set({ commentCount: sql`${feedback.commentCount} + 1` })
          .where(eq(feedback.id, fb.id))
        return { result: 'create' as const, kept: false }
      }
      if (!ctx.sync) return { result: 'unchanged' as const, kept: false }

      const [row] = await tx.select().from(feedbackComment).where(byExternalId(rec.externalId)).for('update').limit(1)
      if (!row) return { result: 'unchanged' as const, kept: false }
      const plan = planFieldSync(row, row.importSnapshot ?? null, commentIncoming(rec), SYNC_FIELDS.comment)
      const applied = Object.keys(plan.apply).length > 0
      const set: Partial<typeof feedbackComment.$inferInsert> = applied ? { ...plan.apply, updatedAt: now } : {}
      if (!deepEqual(plan.nextSnapshot, row.importSnapshot)) set.importSnapshot = plan.nextSnapshot
      if (Object.keys(set).length) await tx.update(feedbackComment).set(set).where(eq(feedbackComment.id, row.id))
      return { result: applied ? ('update' as const) : ('unchanged' as const), kept: plan.kept.length > 0 }
    })
    if (outcome.result === 'missing-parent') return skip(`Parent comment "${rec.parentExternalId}" not found; skipped`)
    ctx.counts.comments[outcome.result]++
    if (outcome.kept) ctx.kept++
  },
}
