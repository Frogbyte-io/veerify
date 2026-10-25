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
import { user, organization } from './auth'

export type ProjectAccessMode = 'workspace' | 'restricted'
export type ProjectMemberRole = 'admin' | 'member'

// Projects - the top level inside an organization (workspace). A project owns its
// domain, appearance, statuses/categories, marketing and support; products live inside it.
export const project = pgTable(
  'project',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isPublic: boolean('is_public')
      .$defaultFn(() => false)
      .notNull(),
    // Controls who can submit feedback: 'anonymous' allows anonymous + optional email, 'account_required' requires login
    submissionMode: text('submission_mode').default('anonymous').notNull(),
    customDomain: text('custom_domain'),
    // Who can open the project: 'workspace' = every organization member,
    // 'restricted' = organization owners/admins plus `project_member` rows only.
    accessMode: text('access_mode').$type<ProjectAccessMode>().default('workspace').notNull(),
    settings: jsonb('settings').$type<Record<string, any>>(),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    // Unique slug within an organization URL namespace
    uniqueOrgSlug: uniqueIndex('project_org_slug_idx').on(table.organizationId, table.slug),
    // Index for governance/public URL lookups by organization
    orgIdx: index('project_org_idx').on(table.organizationId),
    // Index for organization timelines
    orgCreatedAtIdx: index('project_org_created_at_idx').on(table.organizationId, table.createdAt),
    // Index for public projects
    publicIdx: index('project_public_idx').on(table.isPublic),
    // Unique custom domain per project
    customDomainIdx: uniqueIndex('project_custom_domain_idx').on(table.customDomain),
  })
)

// Explicit project membership. Organization owners/admins never need a row:
// they administer every project. In 'workspace' access mode, organization
// members without a row are plain members; a row with role 'admin' makes them
// project admins.
export const projectMember = pgTable(
  'project_member',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').$type<ProjectMemberRole>().default('member').notNull(),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    projectUserUnique: uniqueIndex('project_member_project_user_idx').on(table.projectId, table.userId),
    userIdx: index('project_member_user_idx').on(table.userId),
  })
)

// Products inside a project. Each product has its own feedback board; roadmap
// and changelog are project-wide and filter by product. Every project has at
// least one product; with exactly one, the UI hides the product layer.
export const product = pgTable(
  'product',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    // A product's board is public only when the project is public too.
    isPublic: boolean('is_public').default(true).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    projectSlugUnique: uniqueIndex('product_project_slug_idx').on(table.projectId, table.slug),
    projectOrderIdx: index('product_project_order_idx').on(table.projectId, table.sortOrder),
  })
)

// Provider-neutral domain state. project.customDomain remains as temporary
// compatibility state while callers migrate to this table.
export const projectDomain = pgTable(
  'domain',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    hostname: text('hostname').notNull(),
    kind: text('kind').default('custom_subdomain').notNull(),
    provider: text('provider').notNull(),
    status: text('status').default('pending').notNull(),
    isPrimary: boolean('is_primary').default(true).notNull(),
    providerDomainId: text('provider_domain_id'),
    verificationPayload: jsonb('verification_payload').$type<Record<string, unknown>>(),
    dnsRecords: jsonb('dns_records').$type<Array<{ type: string; name: string; value: string }>>(),
    lastCheckedAt: timestamp('last_checked_at'),
    activatedAt: timestamp('activated_at'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    hostnameIdx: uniqueIndex('domain_hostname_idx').on(table.hostname),
    projectIdx: index('domain_project_idx').on(table.projectId),
    projectPrimaryIdx: index('domain_project_primary_idx').on(table.projectId, table.isPrimary),
    statusIdx: index('domain_status_idx').on(table.status),
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
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'restrict' }),
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
    // Index for per-product boards
    projectProductIdx: index('feedback_project_product_idx').on(table.projectId, table.productId),
    // Index for querying by category
    categoryIdx: index('feedback_category_idx').on(table.categoryId),
    // Index for querying by status
    statusIdx: index('feedback_status_idx').on(table.status),
    // Index for querying by author (user)
    authorUserIdx: index('feedback_author_user_idx').on(table.authorUserId),
    // Index for querying by author (session)
    authorSessionIdx: index('feedback_author_session_idx').on(table.authorSessionId),
    // Index for the Stage 01 support "probable match" query (contact.email -> feedback.authorEmail)
    authorEmailIdx: index('feedback_author_email_idx').on(table.authorEmail),
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

// Feedback subscriptions - notification opt-in per feedback item
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
    // Notification channel: 'email', 'app', or 'both'
    // Anonymous subscribers are always 'email' (no account for in-app)
    notifyChannel: text('notify_channel').default('email').notNull(),
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

// Feedback attachments (images, logs, PDFs). Objects live in the shared storage
// layer under a private `feedback-attachments/` prefix and are only ever served
// through short-lived signed URLs.
//
// `feedbackId` is nullable and `set null` (not cascade) on purpose: uploads are
// created before the feedback row exists, and deleting feedback must not erase
// the storage keys before the cleanup task has removed the objects. A row with
// `attachedAt` set and `feedbackId` null is an orphan of a deleted feedback item.
// `projectId` deliberately has no FK for the same reason (project deletion
// cascades to feedback, and the objects still need collecting).
export const feedbackAttachment = pgTable(
  'feedback_attachment',
  {
    id: text('id').primaryKey(),
    feedbackId: text('feedback_id').references(() => feedback.id, { onDelete: 'set null' }),
    projectId: text('project_id').notNull(),
    storageKey: text('storage_key').notNull(),
    fileName: text('file_name').notNull(),
    // Declared by the client at presign time; `contentType` below is the sniffed truth.
    requestedContentType: text('requested_content_type').notNull(),
    requestedSizeBytes: integer('requested_size_bytes').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    kind: text('kind').notNull(), // image | log | file
    width: integer('width'),
    height: integer('height'),
    uploadedByUserId: text('uploaded_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    uploadedBySessionId: text('uploaded_by_session_id').references(() => anonymousSession.id, {
      onDelete: 'set null',
    }),
    status: text('status').notNull(), // pending | ready
    attachedAt: timestamp('attached_at'),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    feedbackIdx: index('feedback_attachment_feedback_idx').on(table.feedbackId),
    cleanupIdx: index('feedback_attachment_cleanup_idx').on(table.attachedAt, table.createdAt),
    uploaderUserIdx: index('feedback_attachment_user_idx').on(table.uploadedByUserId),
    uploaderSessionIdx: index('feedback_attachment_session_idx').on(table.uploadedBySessionId),
  })
)
