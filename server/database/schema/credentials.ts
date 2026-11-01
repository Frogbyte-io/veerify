import { pgTable, text, timestamp, integer, index, uniqueIndex } from 'drizzle-orm/pg-core'
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
    // 'all' = All projects (see session.activeProjectScope)
    activeProjectScope: text('active_project_scope'),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
    lastUsedAt: timestamp('last_used_at'),
    expiresAt: timestamp('expires_at'),
    revokedAt: timestamp('revoked_at'),
    // 'manual' (Settings -> API keys) | 'device' (issued through the device login flow)
    createdVia: text('created_via').notNull().default('manual'),
  },
  (table) => ({
    keyHashIdx: uniqueIndex('user_api_key_hash_idx').on(table.keyHash),
    userIdx: index('user_api_key_user_idx').on(table.userId),
  })
)

export type UserApiKeyRow = typeof userApiKey.$inferSelect

// Device login requests (RFC 8628 style). An agent starts a request, the user approves it in the
// browser, and the agent redeems the device code once for a personal API key.
// Only the SHA-256 hex hash of the device code is stored; userCode is stored normalised (no dash).
export const deviceAuthorization = pgTable(
  'device_authorization',
  {
    id: text('id').primaryKey(),
    deviceCodeHash: text('device_code_hash').notNull().unique(),
    userCode: text('user_code').notNull().unique(),
    clientName: text('client_name'),
    // pending | approved | denied | redeemed
    status: text('status').notNull().default('pending'),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    interval: integer('interval').notNull().default(5),
    lastPolledAt: timestamp('last_polled_at'),
    expiresAt: timestamp('expires_at').notNull(),
    approvedAt: timestamp('approved_at'),
    redeemedAt: timestamp('redeemed_at'),
    issuedKeyId: text('issued_key_id').references(() => userApiKey.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    expiresIdx: index('device_authorization_expires_idx').on(table.expiresAt),
    userIdx: index('device_authorization_user_idx').on(table.userId),
  })
)

export type DeviceAuthorizationRow = typeof deviceAuthorization.$inferSelect
