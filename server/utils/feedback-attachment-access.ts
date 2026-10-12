import type { H3Event } from 'h3'
import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackAttachment, project } from '~/server/database/schema/feedback'
import { teamMember } from '~/server/database/schema/auth'
import { optionalAuth } from '~/server/utils/auth-middleware'
import { getAnonSession } from '~/server/utils/anonymous-session'
import {
  buildFeedbackAttachmentDownloadUrl,
  decideAttachmentAccess,
  FEEDBACK_ATTACHMENT_MAX_COUNT,
  FEEDBACK_ATTACHMENT_PENDING_TTL_MS,
  feedbackAttachmentError,
  type AttachmentAccess,
} from '~/server/utils/feedback-attachments'

type Executor = Pick<typeof db, 'select' | 'update'>
export type FeedbackAttachmentRow = typeof feedbackAttachment.$inferSelect

export interface AttachmentActor {
  userId: string | null
  anonSessionId: string | null
}

/** Resolve who is calling without creating an anonymous session as a side effect. */
export async function resolveAttachmentActor(event: H3Event): Promise<AttachmentActor> {
  const session = await optionalAuth(event)
  if (session?.user) return { userId: session.user.id, anonSessionId: null }
  const anon = await getAnonSession(event)
  return { userId: null, anonSessionId: anon?.id ?? null }
}

export function isRowUploader(
  row: Pick<FeedbackAttachmentRow, 'uploadedByUserId' | 'uploadedBySessionId'>,
  actor: AttachmentActor
) {
  if (actor.userId) return row.uploadedByUserId === actor.userId
  if (actor.anonSessionId) return row.uploadedBySessionId === actor.anonSessionId
  return false
}

export async function isTeamMemberOfProject(projectTeamId: string, userId: string | null): Promise<boolean> {
  if (!userId) return false
  const [membership] = await db
    .select({ id: teamMember.id })
    .from(teamMember)
    .where(and(eq(teamMember.teamId, projectTeamId), eq(teamMember.userId, userId)))
    .limit(1)
  return Boolean(membership)
}

export interface FeedbackAttachmentContext {
  feedback: typeof feedback.$inferSelect
  project: typeof project.$inferSelect
  actor: AttachmentActor
  isTeamMember: boolean
  isAuthor: boolean
  access: AttachmentAccess
}

/** Load a feedback item and decide what this caller may do with its attachments. */
export async function loadFeedbackAttachmentContext(
  event: H3Event,
  feedbackId: string,
  preResolvedActor?: AttachmentActor
): Promise<FeedbackAttachmentContext> {
  const [fb] = await db.select().from(feedback).where(eq(feedback.id, feedbackId)).limit(1)
  if (!fb) feedbackAttachmentError(404, 'Feedback not found')
  const [proj] = await db.select().from(project).where(eq(project.id, fb.projectId)).limit(1)
  if (!proj) feedbackAttachmentError(404, 'Project not found')

  const actor = preResolvedActor ?? (await resolveAttachmentActor(event))
  const isTeamMember = await isTeamMemberOfProject(proj.teamId, actor.userId)
  const isAuthor = actor.userId
    ? fb.authorUserId === actor.userId
    : actor.anonSessionId
      ? fb.authorSessionId === actor.anonSessionId
      : false

  const access = decideAttachmentAccess({
    isTeamMember,
    isAuthor,
    projectIsPublic: proj.isPublic,
    feedbackIsHidden: fb.isHidden,
    feedbackIsSupportDerived: fb.metadata?.source === 'support_conversation',
  })
  return { feedback: fb, project: proj, actor, isTeamMember, isAuthor, access }
}

export function serializeFeedbackAttachment(row: FeedbackAttachmentRow, canDelete: boolean, now = new Date()) {
  const signed = buildFeedbackAttachmentDownloadUrl(row.id, now)
  return {
    id: row.id,
    feedbackId: row.feedbackId,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    kind: row.kind,
    width: row.width,
    height: row.height,
    createdAt: row.createdAt,
    url: signed.url,
    urlExpiresAt: signed.expiresAt.toISOString(),
    canDelete,
  }
}

export async function listReadyAttachments(feedbackId: string, executor: Executor = db) {
  return executor
    .select()
    .from(feedbackAttachment)
    .where(and(eq(feedbackAttachment.feedbackId, feedbackId), eq(feedbackAttachment.status, 'ready')))
    .orderBy(asc(feedbackAttachment.createdAt))
}

/** Ready + still-pending (recent) attachments bound to a feedback item. */
export async function countFeedbackAttachmentSlots(feedbackId: string, excludeId?: string): Promise<number> {
  const cutoff = new Date(Date.now() - FEEDBACK_ATTACHMENT_PENDING_TTL_MS)
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(feedbackAttachment)
    .where(
      and(
        eq(feedbackAttachment.feedbackId, feedbackId),
        excludeId ? ne(feedbackAttachment.id, excludeId) : undefined,
        or(eq(feedbackAttachment.status, 'ready'), sql`${feedbackAttachment.createdAt} > ${cutoff}`)
      )
    )
  return row?.count ?? 0
}

/** Unattached uploads (pre-create) by one uploader on one project, used to bound abuse. */
export async function countUnattachedUploads(projectId: string, actor: AttachmentActor): Promise<number> {
  const cutoff = new Date(Date.now() - FEEDBACK_ATTACHMENT_PENDING_TTL_MS)
  const uploaderFilter = actor.userId
    ? eq(feedbackAttachment.uploadedByUserId, actor.userId)
    : actor.anonSessionId
      ? eq(feedbackAttachment.uploadedBySessionId, actor.anonSessionId)
      : sql`false`
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(feedbackAttachment)
    .where(
      and(
        eq(feedbackAttachment.projectId, projectId),
        isNull(feedbackAttachment.feedbackId),
        isNull(feedbackAttachment.attachedAt),
        sql`${feedbackAttachment.createdAt} > ${cutoff}`,
        uploaderFilter
      )
    )
  return row?.count ?? 0
}

/**
 * Bind finalized, unattached uploads to a freshly created feedback item. Runs in
 * the feedback-creation transaction; every id must be a ready, unattached upload
 * owned by this actor on this project, otherwise the whole submission fails.
 */
export async function attachUploadsToFeedback(
  tx: Executor,
  input: { attachmentIds: string[]; feedbackId: string; projectId: string; actor: AttachmentActor; now: Date }
): Promise<void> {
  if (input.attachmentIds.length === 0) return
  if (new Set(input.attachmentIds).size !== input.attachmentIds.length) {
    feedbackAttachmentError(400, 'Duplicate attachment ids are not allowed')
  }
  if (input.attachmentIds.length > FEEDBACK_ATTACHMENT_MAX_COUNT) {
    feedbackAttachmentError(400, `At most ${FEEDBACK_ATTACHMENT_MAX_COUNT} attachments are allowed`)
  }
  const uploaderFilter = input.actor.userId
    ? eq(feedbackAttachment.uploadedByUserId, input.actor.userId)
    : input.actor.anonSessionId
      ? eq(feedbackAttachment.uploadedBySessionId, input.actor.anonSessionId)
      : sql`false`
  const updated = await tx
    .update(feedbackAttachment)
    .set({ feedbackId: input.feedbackId, attachedAt: input.now })
    .where(
      and(
        inArray(feedbackAttachment.id, input.attachmentIds),
        eq(feedbackAttachment.projectId, input.projectId),
        eq(feedbackAttachment.status, 'ready'),
        isNull(feedbackAttachment.feedbackId),
        isNull(feedbackAttachment.attachedAt),
        uploaderFilter
      )
    )
    .returning({ id: feedbackAttachment.id })
  if (updated.length !== input.attachmentIds.length) {
    // A foreign, unfinished, or already-used id is indistinguishable from a missing one.
    feedbackAttachmentError(400, 'One or more attachments are invalid or were not uploaded completely')
  }
}
