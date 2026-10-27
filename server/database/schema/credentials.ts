import { pgTable, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { user } from './auth'

// Personal API keys - user-scoped keys that let agents (MCP) act as the user.
// Only the SHA-256 hex hash is stored; the full key is shown once at creation.
export const userApiKey = pgTable(
  'user_api_key',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    activeOrganizationId: text('active_organization_id'),
    activeProjectId: text('active_project_id'),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
    lastUsedAt: timestamp('last_used_at'),
    expiresAt: timestamp('expires_at'),
    revokedAt: timestamp('revoked_at'),
  },
  (table) => ({
    keyHashIdx: uniqueIndex('user_api_key_hash_idx').on(table.keyHash),
    userIdx: index('user_api_key_user_idx').on(table.userId),
  })
)

export type UserApiKeyRow = typeof userApiKey.$inferSelect
