import { eq, and, inArray, isNotNull } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { feedbackSubscription, project } from '~/server/database/schema/feedback'
import { notification } from '~/server/database/schema/notifications'
import { teamMember, user } from '~/server/database/schema/auth'
import { createLogger } from '~/server/utils/logger'
import { publishRealtime, userChannel } from '~/server/services/realtime'

const logger = createLogger('notifications')

export type NotificationType = 'status_change' | 'new_comment' | 'new_feedback' | 'feedback_pinned'

interface CreateNotificationParams {
  userId: string
  type: NotificationType
  title: string
  body?: string
  link?: string
  feedbackId?: string
  projectId?: string
  actorUserId?: string
  actorName?: string
}

/**
 * Creates an in-app notification for a single user.
 */
export async function createNotification(params: CreateNotificationParams) {
  try {
    const [created] = await db
      .insert(notification)
      .values({
        id: crypto.randomUUID(),
        userId: params.userId,
        type: params.type,
        title: params.title,
        body: params.body || null,
        link: params.link || null,
        feedbackId: params.feedbackId || null,
        projectId: params.projectId || null,
        actorUserId: params.actorUserId || null,
        actorName: params.actorName || null,
        isRead: false,
        createdAt: new Date(),
      })
      .returning()

    // Announce to the user's connected clients across every instance.
    //
    // Only the id travels — the client refetches through the normal authorized
    // endpoint. That is what makes this safe to broadcast: a subscription bug
    // can leak the existence of a notification, never its contents.
    if (created) {
      void publishRealtime(userChannel(params.userId), {
        type: 'notification.created',
        userId: params.userId,
      })
    }

    return created
  } catch (err) {
    logger.error('Failed to create notification', {
      userId: params.userId,
      type: params.type,
      error: err instanceof Error ? err.message : err,
    })
    return null
  }
}

/**
 * Creates in-app notifications for all team members of a project,
 * optionally excluding a specific user (e.g. the actor who triggered the event).
 */
export async function notifyProjectTeam(
  projectId: string,
  excludeUserId: string | null,
  params: Omit<CreateNotificationParams, 'userId' | 'projectId'>
) {
  try {
    // Get the project's team
    const [proj] = await db.select({ teamId: project.teamId }).from(project).where(eq(project.id, projectId)).limit(1)

    if (!proj) return

    // Get all team members
    const members = await db
      .select({ userId: teamMember.userId })
      .from(teamMember)
      .where(eq(teamMember.teamId, proj.teamId))

    // Create notifications for each member (excluding the actor)
    const recipientIds = members.filter((m) => m.userId !== excludeUserId).map((m) => m.userId)

    if (recipientIds.length === 0) return

    // Check notification preferences for recipients
    const users = await db
      .select({ id: user.id, settings: user.settings })
      .from(user)
      .where(inArray(user.id, recipientIds))

    // Map notification type to preference key
    const prefKeyMap: Record<string, string> = {
      new_feedback: 'newFeedback',
      status_change: 'statusChanges',
      new_comment: 'newComments',
    }
    const prefKey = prefKeyMap[params.type]

    const filteredRecipients = users.filter((u) => {
      const prefs = u.settings?.notificationPreferences
      // Default to enabled if no preferences set
      if (!prefs) return true
      if (prefs.inAppNotifications === false) return false
      if (prefKey && prefs[prefKey] === false) return false
      return true
    })

    await Promise.allSettled(
      filteredRecipients.map((u) =>
        createNotification({
          ...params,
          userId: u.id,
          projectId,
        })
      )
    )
  } catch (err) {
    logger.error('Failed to notify project team', {
      projectId,
      type: params.type,
      error: err instanceof Error ? err.message : err,
    })
  }
}

/**
 * Creates in-app notifications for logged-in users subscribed to a feedback item
 * whose notifyChannel is 'app' or 'both'.
 * Excludes a specific user (e.g. the actor) and any users already notified as team members.
 */
export async function notifyFeedbackSubscribers(
  feedbackId: string,
  excludeUserId: string | null,
  excludeUserIds: string[],
  params: Omit<CreateNotificationParams, 'userId'>
) {
  try {
    // Get subscribers with 'app' or 'both' channel who have a userId (logged-in)
    const subscribers = await db
      .select({
        userId: feedbackSubscription.userId,
        notifyChannel: feedbackSubscription.notifyChannel,
      })
      .from(feedbackSubscription)
      .where(and(eq(feedbackSubscription.feedbackId, feedbackId), isNotNull(feedbackSubscription.userId)))

    // Filter to app/both channels, exclude actor and already-notified team members
    const allExcluded = new Set([...excludeUserIds, ...(excludeUserId ? [excludeUserId] : [])])
    const recipients = subscribers.filter(
      (s) => s.userId && !allExcluded.has(s.userId) && (s.notifyChannel === 'app' || s.notifyChannel === 'both')
    )

    if (recipients.length === 0) return

    await Promise.allSettled(
      recipients.map((s) =>
        createNotification({
          ...params,
          userId: s.userId!,
        })
      )
    )
  } catch (err) {
    logger.error('Failed to notify feedback subscribers', {
      feedbackId,
      type: params.type,
      error: err instanceof Error ? err.message : err,
    })
  }
}
