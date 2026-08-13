import { pgTable, text, timestamp, integer, jsonb, index } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { project } from './feedback'

// Import runs - staged migration/import jobs per product
export const importRun = pgTable(
  'import_run',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sourceType: text('source_type').notNull(), // sleekplan, csv
    sourceMode: text('source_mode').notNull(), // api, file
    status: text('status')
      .$defaultFn(() => 'draft')
      .notNull(), // draft, analyzing, ready, importing, completed, failed, canceled
    contentScope: jsonb('content_scope').$type<Record<string, any>>(),
    mappingConfig: jsonb('mapping_config').$type<Record<string, any>>(),
    summary: jsonb('summary').$type<Record<string, any>>(),
    progressCompleted: integer('progress_completed')
      .$defaultFn(() => 0)
      .notNull(),
    progressTotal: integer('progress_total')
      .$defaultFn(() => 0)
      .notNull(),
    snapshotKey: text('snapshot_key'),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    projectIdx: index('import_run_project_idx').on(table.projectId),
    projectCreatedAtIdx: index('import_run_project_created_at_idx').on(table.projectId, table.createdAt),
    statusIdx: index('import_run_status_idx').on(table.status),
  })
)

// Import issues - warnings/errors/skips discovered during analysis or execution
export const importRunIssue = pgTable(
  'import_run_issue',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => importRun.id, { onDelete: 'cascade' }),
    severity: text('severity').notNull(), // warning, error, skipped
    entityType: text('entity_type').notNull(),
    externalId: text('external_id'),
    message: text('message').notNull(),
    details: jsonb('details').$type<Record<string, any> | null>(),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    runIdx: index('import_issue_run_idx').on(table.runId),
    runSeverityIdx: index('import_issue_run_severity_idx').on(table.runId, table.severity),
  })
)
