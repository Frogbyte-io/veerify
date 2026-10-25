// Changelog schema (M5): entries per product, and the feedback items each
// entry ships. Marketing announcement drafts reference `changelogEntry`.
//
// Status and label values are plain text; the unions below are the source of
// truth for application code.
//
// See `docs/plans/2026-10-09-marketing-hub/design.md` -> M5 implementation decisions.

import { pgTable, primaryKey, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { user } from './auth'
import { project, feedback, product } from './feedback'

export type ChangelogEntryStatus = 'draft' | 'published'
export type ChangelogLabel = 'new' | 'improved' | 'fixed'

const createdAtColumn = () =>
  timestamp('created_at')
    .$defaultFn(() => new Date())
    .notNull()

const updatedAtColumn = () =>
  timestamp('updated_at')
    .$defaultFn(() => new Date())
    .notNull()

export const changelogEntry = pgTable(
  'changelog_entry',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    summary: text('summary'),
    // Markdown source; rendered and sanitised on the server
    body: text('body').default('').notNull(),
    status: text('status').$type<ChangelogEntryStatus>().default('draft').notNull(),
    // Values are ChangelogLabel
    labels: text('labels')
      .array()
      .$type<ChangelogLabel[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    publishedAt: timestamp('published_at'),
    authorUserId: text('author_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => ({
    uniqueSlug: uniqueIndex('changelog_entry_project_slug_idx').on(table.projectId, table.slug),
    projectStatusPublishedIdx: index('changelog_entry_project_status_published_idx').on(
      table.projectId,
      table.status,
      table.publishedAt
    ),
  })
)

// Feedback items shipped by an entry. Composite identity, no surrogate id.
export const changelogEntryFeedback = pgTable(
  'changelog_entry_feedback',
  {
    entryId: text('entry_id')
      .notNull()
      .references(() => changelogEntry.id, { onDelete: 'cascade' }),
    feedbackId: text('feedback_id')
      .notNull()
      .references(() => feedback.id, { onDelete: 'cascade' }),
    createdAt: createdAtColumn(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.entryId, table.feedbackId] }),
    feedbackIdx: index('changelog_entry_feedback_feedback_idx').on(table.feedbackId),
  })
)

// Products a changelog entry applies to. No rows means the whole project.
export const changelogEntryProduct = pgTable(
  'changelog_entry_product',
  {
    entryId: text('entry_id')
      .notNull()
      .references(() => changelogEntry.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.entryId, table.productId] }),
    productIdx: index('changelog_entry_product_product_idx').on(table.productId),
  })
)
