import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { user, organization, team } from './auth'

// Projects table - operational workspaces scoped to teams.
// organizationId is retained for public URL resolution and org governance.
export const project = pgTable(
  'project',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'restrict' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isPublic: boolean('is_public')
      .$defaultFn(() => false)
      .notNull(),
    // Controls who can submit feedback: 'anonymous' allows anonymous + optional email, 'account_required' requires login
    submissionMode: text('submission_mode').default('anonymous').notNull(),
    customDomain: text('custom_domain'),
    settings: jsonb('settings').$type<Record<string, any>>(),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    // Unique slug within a team URL namespace
    uniqueTeamSlug: uniqueIndex('project_team_slug_idx').on(table.teamId, table.slug),
    // Index for governance/public URL lookups by organization
    orgIdx: index('project_org_idx').on(table.organizationId),
    // Index for querying projects by team
    teamIdx: index('project_team_idx').on(table.teamId),
    // Index for team timelines
    teamCreatedAtIdx: index('project_team_created_at_idx').on(table.teamId, table.createdAt),
    // Index for public projects
    publicIdx: index('project_public_idx').on(table.isPublic),
    // Unique custom domain per project
    customDomainIdx: uniqueIndex('project_custom_domain_idx').on(table.customDomain),
  })
)

// Anonymous sessions - persistent session tokens for anonymous users
export const anonymousSession = pgTable(
  'anonymous_session',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
    lastSeenAt: timestamp('last_seen_at')
      .$defaultFn(() => new Date())
      .notNull(),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (table) => ({
    // Index for token lookups
    tokenIdx: index('anon_session_token_idx').on(table.token),
    // Index for cleanup of expired sessions
    expiresIdx: index('anon_session_expires_idx').on(table.expiresAt),
  })
)

// Feedback statuses - per-project customizable workflow statuses
export const feedbackStatus = pgTable(
  'feedback_status',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    name: text('name').notNull(), // Display name: "Open", "In Progress"
    value: text('value').notNull(), // Machine value: "open", "in_progress" (stored in feedback.status)
    color: text('color'), // Hex color code
    description: text('description'), // Optional description
    sortOrder: integer('sort_order')
      .$defaultFn(() => 0)
      .notNull(),
    isDefault: boolean('is_default')
      .$defaultFn(() => false)
      .notNull(),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    // Unique value within a project
    uniqueProjectValue: uniqueIndex('status_project_value_idx').on(table.projectId, table.value),
    // Index for querying statuses by project
    projectIdx: index('status_project_idx').on(table.projectId),
  })
)

// Feedback categories - per-project categories (Bug, Feature, etc.)
export const feedbackCategory = pgTable(
  'feedback_category',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    icon: text('icon'), // Lucide icon name
    color: text('color'), // Hex color code
    description: text('description'),
    sortOrder: integer('sort_order')
      .$defaultFn(() => 0)
      .notNull(),
    isDefault: boolean('is_default')
      .$defaultFn(() => false)
      .notNull(),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    // Unique slug within a project
    uniqueProjectSlug: uniqueIndex('category_project_slug_idx').on(table.projectId, table.slug),
    // Index for querying categories by project
    projectIdx: index('category_project_idx').on(table.projectId),
    // Index for default categories
    defaultIdx: index('category_default_idx').on(table.isDefault),
  })
)

// Feedback items - individual feedback submissions
export const feedback = pgTable(
  'feedback',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    categoryId: text('category_id').references(() => feedbackCategory.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    body: text('body'),
    status: text('status')
      .$defaultFn(() => 'open')
      .notNull(), // open, in_progress, planned, completed, closed, declined
    // Author can be either a user or an anonymous session
    authorUserId: text('author_user_id').references(() => user.id, { onDelete: 'set null' }),
    authorSessionId: text('author_session_id').references(() => anonymousSession.id, { onDelete: 'set null' }),
    authorName: text('author_name'), // Display name for anonymous users
    authorEmail: text('author_email'), // Optional email for anonymous users
    voteCount: integer('vote_count')
      .$defaultFn(() => 0)
      .notNull(),
    commentCount: integer('comment_count')
      .$defaultFn(() => 0)
      .notNull(),
    isPinned: boolean('is_pinned')
      .$defaultFn(() => false)
      .notNull(),
    isLocked: boolean('is_locked')
      .$defaultFn(() => false)
      .notNull(),
    isHidden: boolean('is_hidden')
      .$defaultFn(() => false)
      .notNull(),
    metadata: jsonb('metadata').$type<Record<string, any>>(),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    // Index for querying feedback by project
    projectIdx: index('feedback_project_idx').on(table.projectId),
    // Index for querying by category
    categoryIdx: index('feedback_category_idx').on(table.categoryId),
    // Index for querying by status
    statusIdx: index('feedback_status_idx').on(table.status),
    // Index for querying by author (user)
    authorUserIdx: index('feedback_author_user_idx').on(table.authorUserId),
    // Index for querying by author (session)
    authorSessionIdx: index('feedback_author_session_idx').on(table.authorSessionId),
    // Index for sorting by vote count
    voteCountIdx: index('feedback_vote_count_idx').on(table.voteCount),
    // Index for pinned items
    pinnedIdx: index('feedback_pinned_idx').on(table.isPinned),
    // Index for hidden items
    hiddenIdx: index('feedback_hidden_idx').on(table.isHidden),
    // Composite index for project + status queries
    projectStatusIdx: index('feedback_project_status_idx').on(table.projectId, table.status),
    // Composite index for paginated project feedback lists sorted by date
    projectCreatedAtIdx: index('feedback_project_created_at_idx').on(table.projectId, table.createdAt),
  })
)

// Votes - one per user/session per feedback item
export const vote = pgTable(
  'vote',
  {
    id: text('id').primaryKey(),
    feedbackId: text('feedback_id')
      .notNull()
      .references(() => feedback.id, { onDelete: 'cascade' }),
    // Voter can be either a user or an anonymous session
    voterUserId: text('voter_user_id').references(() => user.id, { onDelete: 'cascade' }),
    voterSessionId: text('voter_session_id').references(() => anonymousSession.id, { onDelete: 'cascade' }),
    // Vote direction: 'upvote' (default, backwards compatible) or 'downvote'
    type: text('type').default('upvote').notNull(),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    // Unique constraint: one vote per user per feedback
    uniqueUserVote: uniqueIndex('vote_user_feedback_idx').on(table.feedbackId, table.voterUserId),
    // Unique constraint: one vote per session per feedback
    uniqueSessionVote: uniqueIndex('vote_session_feedback_idx').on(table.feedbackId, table.voterSessionId),
    // Index for querying votes by feedback
    feedbackIdx: index('vote_feedback_idx').on(table.feedbackId),
    // Index for querying votes by user
    userIdx: index('vote_user_idx').on(table.voterUserId),
    // Index for querying votes by session
    sessionIdx: index('vote_session_idx').on(table.voterSessionId),
  })
)

// Roadmap items - roadmap entries, optionally linked to feedback
export const roadmapItem = pgTable(
  'roadmap_item',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status')
      .$defaultFn(() => 'planned')
      .notNull(), // planned, in_progress, completed, cancelled
    priority: text('priority'), // low, medium, high, critical
    quarter: text('quarter'), // e.g., "Q1 2024", "Q2 2024"
    startDate: timestamp('start_date'),
    targetDate: timestamp('target_date'),
    completedDate: timestamp('completed_date'),
    sortOrder: integer('sort_order')
      .$defaultFn(() => 0)
      .notNull(),
    linkedFeedbackIds: jsonb('linked_feedback_ids').$type<string[]>(), // Array of feedback IDs
    metadata: jsonb('metadata').$type<Record<string, any>>(),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    // Index for querying roadmap items by project
    projectIdx: index('roadmap_project_idx').on(table.projectId),
    // Index for querying by status
    statusIdx: index('roadmap_status_idx').on(table.status),
    // Index for querying by priority
    priorityIdx: index('roadmap_priority_idx').on(table.priority),
    // Composite index for project + status queries
    projectStatusIdx: index('roadmap_project_status_idx').on(table.projectId, table.status),
  })
)

// GitHub integrations - per-project GitHub repo configuration
export const githubIntegration = pgTable(
  'github_integration',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' })
      .unique(),
    owner: text('owner').notNull(), // GitHub repo owner/org
    repo: text('repo').notNull(), // GitHub repo name
    installationId: text('installation_id'), // GitHub App installation ID
    accessToken: text('access_token'), // Encrypted access token
    webhookId: text('webhook_id'), // GitHub webhook ID for this integration
    webhookSecret: text('webhook_secret'), // Webhook secret for verification
    syncEnabled: boolean('sync_enabled')
      .$defaultFn(() => true)
      .notNull(),
    autoCreateIssues: boolean('auto_create_issues')
      .$defaultFn(() => false)
      .notNull(),
    autoSyncStatus: boolean('auto_sync_status')
      .$defaultFn(() => true)
      .notNull(),
    lastSyncAt: timestamp('last_sync_at'),
    settings: jsonb('settings').$type<Record<string, any>>(),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    // Index for querying by project
    projectIdx: index('github_integration_project_idx').on(table.projectId),
    // Index for querying by owner and repo
    repoIdx: index('github_integration_repo_idx').on(table.owner, table.repo),
  })
)

// GitHub issue links - maps feedback ID to GitHub issue number
export const githubIssueLink = pgTable(
  'github_issue_link',
  {
    id: text('id').primaryKey(),
    feedbackId: text('feedback_id')
      .notNull()
      .references(() => feedback.id, { onDelete: 'cascade' }),
    githubIntegrationId: text('github_integration_id')
      .notNull()
      .references(() => githubIntegration.id, { onDelete: 'cascade' }),
    issueNumber: integer('issue_number').notNull(),
    issueUrl: text('issue_url').notNull(),
    issueState: text('issue_state'), // open, closed
    lastSyncAt: timestamp('last_sync_at'),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    // Unique constraint: one link per feedback item
    uniqueFeedback: uniqueIndex('github_link_feedback_idx').on(table.feedbackId),
    // Index for querying links by GitHub integration
    integrationIdx: index('github_link_integration_idx').on(table.githubIntegrationId),
    // Index for querying by issue number within an integration
    issueIdx: index('github_link_issue_idx').on(table.githubIntegrationId, table.issueNumber),
  })
)

// Feedback comments - threaded discussions on feedback items
export const feedbackComment = pgTable(
  'feedback_comment',
  {
    id: text('id').primaryKey(),
    feedbackId: text('feedback_id')
      .notNull()
      .references(() => feedback.id, { onDelete: 'cascade' }),
    parentCommentId: text('parent_comment_id').references((): AnyPgColumn => feedbackComment.id, {
      onDelete: 'cascade',
    }),
    body: text('body').notNull(),
    // Author can be either a user or an anonymous session
    authorUserId: text('author_user_id').references(() => user.id, { onDelete: 'set null' }),
    authorSessionId: text('author_session_id').references(() => anonymousSession.id, { onDelete: 'set null' }),
    authorName: text('author_name'), // Display name for anonymous users
    authorEmail: text('author_email'), // Optional email for anonymous users
    isInternal: boolean('is_internal')
      .$defaultFn(() => false)
      .notNull(), // Internal team notes vs public comments
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    // Index for querying comments by feedback
    feedbackIdx: index('comment_feedback_idx').on(table.feedbackId),
    // Index for querying by author (user)
    authorUserIdx: index('comment_author_user_idx').on(table.authorUserId),
    // Index for querying by author (session)
    authorSessionIdx: index('comment_author_session_idx').on(table.authorSessionId),
    // Index for threaded replies
    parentIdx: index('comment_parent_idx').on(table.parentCommentId),
    // Index for internal vs public comments
    internalIdx: index('comment_internal_idx').on(table.isInternal),
    // Composite index for threaded comment sorting by date
    feedbackCreatedAtIdx: index('comment_feedback_created_at_idx').on(table.feedbackId, table.createdAt),
  })
)

// Feedback subscriptions - email notification opt-in per feedback item
export const feedbackSubscription = pgTable(
  'feedback_subscription',
  {
    id: text('id').primaryKey(),
    feedbackId: text('feedback_id')
      .notNull()
      .references(() => feedback.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    // Optional: link to a registered user account
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    // Opaque token used in one-click unsubscribe links
    token: text('token').notNull(),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    // One subscription per email per feedback item
    uniqueEmailFeedback: uniqueIndex('sub_email_feedback_idx').on(table.feedbackId, table.email),
    // Fast lookup by token (unsubscribe links)
    tokenIdx: uniqueIndex('sub_token_idx').on(table.token),
    // Index for querying all subscribers of a feedback item
    feedbackIdx: index('sub_feedback_idx').on(table.feedbackId),
  })
)

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
