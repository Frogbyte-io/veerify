import { pgTable, text, timestamp, boolean, index } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { feedback, project } from './feedback'

// In-app notifications for authenticated users
export const notification = pgTable(
  'notification',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // Notification type: status_change, new_comment, new_feedback, team_invite, etc.
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    // Optional link to navigate to when clicked
    link: text('link'),
    // Related entity references for grouping/deduplication
    feedbackId: text('feedback_id').references(() => feedback.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => project.id, { onDelete: 'cascade' }),
    // Actor who triggered the notification (null for system notifications)
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    actorName: text('actor_name'),
    isRead: boolean('is_read')
      .$defaultFn(() => false)
      .notNull(),
    readAt: timestamp('read_at'),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    // Index for querying notifications by user (most common query)
    userIdx: index('notification_user_idx').on(table.userId),
    // Composite index for user + read status (unread count, filtering)
    userReadIdx: index('notification_user_read_idx').on(table.userId, table.isRead),
    // Composite index for user + created date (paginated list)
    userCreatedAtIdx: index('notification_user_created_at_idx').on(table.userId, table.createdAt),
    // Index for querying by feedback (cleanup on feedback delete)
    feedbackIdx: index('notification_feedback_idx').on(table.feedbackId),
  })
)
