import { pgTable, text, timestamp, boolean, jsonb, index } from 'drizzle-orm/pg-core'
import { project } from './feedback'

// Changelog posts - product-scoped release notes and imported updates
export const changelogPost = pgTable(
  'changelog_post',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    category: text('category'),
    isDraft: boolean('is_draft')
      .$defaultFn(() => true)
      .notNull(),
    publishedAt: timestamp('published_at'),
    metadata: jsonb('metadata').$type<Record<string, any>>(),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    projectIdx: index('changelog_project_idx').on(table.projectId),
    projectDraftIdx: index('changelog_project_draft_idx').on(table.projectId, table.isDraft),
    projectPublishedAtIdx: index('changelog_project_published_at_idx').on(table.projectId, table.publishedAt),
  })
)
