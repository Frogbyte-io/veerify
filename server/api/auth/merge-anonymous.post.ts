/**
 * POST /api/auth/merge-anonymous
 *
 * Called after login/signup to merge any anonymous feedback and votes
 * into the authenticated user's account.  Reads the `veerify_anon_session`
 * cookie, transfers ownership of feedback and votes, then deletes the
 * anonymous session and clears the cookie.
 */

import { eq, and, sql } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { readAnonToken, clearAnonCookie } from '~/server/utils/anonymous-session'
import { db } from '~/server/database/drizzle'
import { anonymousSession, feedback, vote } from '~/server/database/schema/feedback'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const token = readAnonToken(event)

  if (!token) {
    return createSuccessResponse({ merged: false, reason: 'no_anonymous_session' })
  }

  // Look up the anonymous session
  const [anonRow] = await db.select().from(anonymousSession).where(eq(anonymousSession.token, token)).limit(1)

  if (!anonRow) {
    clearAnonCookie(event)
    return createSuccessResponse({ merged: false, reason: 'session_not_found' })
  }

  const anonId = anonRow.id
  const userId = session.user.id

  // 1. Transfer feedback ownership
  await db
    .update(feedback)
    .set({
      authorUserId: userId,
      authorSessionId: null,
      updatedAt: new Date(),
    })
    .where(eq(feedback.authorSessionId, anonId))

  // 2. Transfer votes — but skip duplicates where the user already voted
  //    on the same feedback item.
  //    First, find anonymous votes that conflict with existing user votes.
  const anonVotes = await db
    .select({ id: vote.id, feedbackId: vote.feedbackId })
    .from(vote)
    .where(eq(vote.voterSessionId, anonId))

  const userVotes = await db.select({ feedbackId: vote.feedbackId }).from(vote).where(eq(vote.voterUserId, userId))

  const userVotedFeedbackIds = new Set(userVotes.map((v) => v.feedbackId))

  const duplicateVoteIds: string[] = []
  const transferVoteIds: string[] = []

  for (const v of anonVotes) {
    if (userVotedFeedbackIds.has(v.feedbackId)) {
      duplicateVoteIds.push(v.id)
    } else {
      transferVoteIds.push(v.id)
    }
  }

  // Delete duplicate votes and decrement feedback vote counts
  for (const dupId of duplicateVoteIds) {
    const dupVote = anonVotes.find((v) => v.id === dupId)!
    await db.delete(vote).where(eq(vote.id, dupId))
    await db
      .update(feedback)
      .set({ voteCount: sql`${feedback.voteCount} - 1`, updatedAt: new Date() })
      .where(eq(feedback.id, dupVote.feedbackId))
  }

  // Transfer non-duplicate votes to the user
  if (transferVoteIds.length > 0) {
    for (const transferId of transferVoteIds) {
      await db.update(vote).set({ voterUserId: userId, voterSessionId: null }).where(eq(vote.id, transferId))
    }
  }

  // 3. Delete the anonymous session
  await db.delete(anonymousSession).where(eq(anonymousSession.id, anonId))

  // 4. Clear the cookie
  clearAnonCookie(event)

  return createSuccessResponse({
    merged: true,
    feedbackTransferred: anonVotes.length > 0 || transferVoteIds.length > 0,
    votesTransferred: transferVoteIds.length,
    duplicateVotesRemoved: duplicateVoteIds.length,
  })
})
