import { pgTable, text, timestamp, integer, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { project, product } from './feedback'

// importedPerson lives in feedback.ts (feedback/vote/comment reference it; importing imports.ts there would cycle).

export type ImportRunStatus = 'draft' | 'committing' | 'completed' | 'failed' | 'canceled'
export type ImportIssueSeverity = 'warning' | 'error' | 'skipped'
export type ImportTombstoneEntity = 'feedback' | 'comment'

// Import runs - one staged import into a product, committed inline or by the scheduled task
export const importRun = pgTable(
  'import_run',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    source: text('source').notNull(),
    sourceLabel: text('source_label').notNull(),
    onExisting: text('on_existing').default('sync').notNull(), // sync | skip
    status: text('status').$type<ImportRunStatus>().default('draft').notNull(),
    recordCount: integer('record_count').default(0).notNull(),
    progress: jsonb('progress').$type<{ phase: string; done: number; total: number; transientFailures?: number }>(),
    summary: jsonb('summary').$type<Record<string, any>>(),
    error: text('error'),
    leaseUntil: timestamp('lease_until'),
    committedAt: timestamp('committed_at'),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    projectCreatedIdx: index('import_run_project_created_idx').on(table.projectId, table.createdAt),
    statusIdx: index('import_run_status_idx').on(table.status),
  })
)

// Staged batches: a partial ImportDocument (no format/target)
export const importRunBatch = pgTable(
  'import_run_batch',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => importRun.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    payload: jsonb('payload').$type<Record<string, any>>().notNull(),
    recordCount: integer('record_count').notNull(),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    runSeqUnique: uniqueIndex('import_run_batch_run_seq_idx').on(table.runId, table.seq),
  })
)

export const importRunIssue = pgTable(
  'import_run_issue',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => importRun.id, { onDelete: 'cascade' }),
    severity: text('severity').$type<ImportIssueSeverity>(),
    entityType: text('entity_type'),
    externalId: text('external_id'),
    message: text('message').notNull(),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    runIdx: index('import_run_issue_run_idx').on(table.runId),
  })
)

// Imported feedback and comments the team deleted in Veerify. A re-import skips them instead of bringing them back.
// Comment externalIds are scoped to their feedback: `externalId` is JSON `[feedbackExternalId, commentExternalId]`.
export const importTombstone = pgTable(
  'import_tombstone',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    entity: text('entity').$type<ImportTombstoneEntity>().notNull(),
    source: text('source').notNull(),
    externalId: text('external_id').notNull(),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    unique: uniqueIndex('import_tombstone_idx').on(table.projectId, table.entity, table.source, table.externalId),
  })
)
