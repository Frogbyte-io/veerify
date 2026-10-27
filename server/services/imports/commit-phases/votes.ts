import { randomUUID } from 'node:crypto'
import { and, eq, ne, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { feedback, vote } from '~/server/database/schema/feedback'
import type { ImportFeedback } from '../format'
import { netVotes, voteBaseline, voteDecisions } from '../planner'
import {
  loadFeedback,
  loadPeople,
  lockPersonClaims,
  sourceDate,
  type CommitPhase,
  type FeedbackRef,
  type PersonRef,
} from './context'

type VoteState = { people: Map<string, PersonRef>; feedback: Map<string, FeedbackRef> }

/**
 * Votes, per feedback record, in one transaction with the counter they move:
 * - listed votes become rows keyed (feedbackId, importedPersonId), ON CONFLICT DO NOTHING (claimed votes keep their
 *   importedPersonId, so they are found too);
 * - a person already claimed by a user (Task 7) votes as that user: the row gets voterUserId = claimedByUserId as well,
 *   and if that user already voted on the feedback, the (feedbackId, voterUserId) index makes it a no-op (counted
 *   unchanged, like the planner's preview) so a vote is never counted twice;
 * - newBaseline = max(0, voteCount − netListed); without a voteCount the stored baseline is kept;
 * - voteCount = voteCount + (newBaseline − oldBaseline) + net(inserted rows), as one SQL expression (never
 *   read-modify-write). The counter is a signed net sum, like the vote route keeps it, so it is never clamped.
 * Under onExisting 'skip', votes are still added to existing feedback, but the baseline of feedback this run did not
 * create is left alone.
 */
export const votesPhase: CommitPhase<VoteState, ImportFeedback> = {
  name: 'votes',
  items: (ctx) => ctx.batch.feedback,
  load: async (ctx) => ({ people: await loadPeople(ctx), feedback: await loadFeedback(ctx) }),
  async apply(ctx, state, rec) {
    const { valid, skipped } = voteDecisions(rec, new Set(state.people.keys()))
    ctx.counts.votes.skip += skipped.length
    skipped.forEach(ctx.issue)

    const fb = state.feedback.get(rec.externalId)
    if (!fb) {
      // The feedback phase inserts every record, so this only happens if it was deleted meanwhile.
      ctx.counts.votes.skip += valid.length
      if (valid.length)
        ctx.issue({
          severity: 'skipped',
          entityType: 'vote',
          externalId: rec.externalId,
          message: `Feedback "${rec.externalId}" no longer exists; its votes were skipped`,
        })
      return
    }
    const ownsBaseline = ctx.sync || fb.importRunId === ctx.run.id
    // null: the source sent no voteCount, keep the stored baseline
    const newBaseline = voteBaseline(rec.voteCount, netVotes(valid))
    const now = ctx.now()

    const inserted = await db.transaction(async (tx) => {
      const personIds = valid.map((v) => state.people.get(v.personExternalId)!.id)
      const claimedBy = await lockPersonClaims(tx, personIds)
      // No conflict target: besides (feedbackId, importedPersonId), a claimed person's vote also hits the
      // (feedbackId, voterUserId) index when that user already voted, and is then skipped.
      const rows = valid.length
        ? await tx
            .insert(vote)
            .values(
              valid.map((v, i) => ({
                id: randomUUID(),
                feedbackId: fb.id,
                importedPersonId: personIds[i],
                voterUserId: claimedBy.get(personIds[i]) ?? null,
                type: v.type ?? 'upvote',
                createdAt: sourceDate(v.createdAt, now),
              }))
            )
            .onConflictDoNothing()
            .returning({ type: vote.type })
        : []
      const insertedNet = netVotes(rows)
      if (ownsBaseline && newBaseline !== null) {
        await tx
          .update(feedback)
          .set({
            voteCount: sql`${feedback.voteCount} + ${newBaseline} - ${feedback.importedVoteBaseline} + ${insertedNet}`,
            importedVoteBaseline: newBaseline,
          })
          .where(
            insertedNet !== 0
              ? eq(feedback.id, fb.id)
              : and(eq(feedback.id, fb.id), ne(feedback.importedVoteBaseline, newBaseline))
          )
      } else if (insertedNet !== 0) {
        await tx
          .update(feedback)
          .set({ voteCount: sql`${feedback.voteCount} + ${insertedNet}` })
          .where(eq(feedback.id, fb.id))
      }
      return rows.length
    })
    ctx.counts.votes.create += inserted
    ctx.counts.votes.unchanged += valid.length - inserted
  },
}
