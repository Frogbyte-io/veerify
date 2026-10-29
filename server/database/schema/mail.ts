import { pgTable, text, timestamp, uniqueIndex, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organization } from './auth'

// Mail tier of a workspace (organization). No row means 'standard'. The limits
// per tier live in lib/mail-plans.ts. Set by operators (`yarn mail:set-tier`)
// until billing writes it. See docs/plans/2026-10-28-email-addresses/design.md.
export const mailEntitlement = pgTable(
  'mail_entitlement',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    tier: text('tier').default('standard').notNull(),
    // Free-form actor, e.g. 'script:andreas' or a user id once billing writes it.
    updatedBy: text('updated_by'),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    uniqueOrganization: uniqueIndex('mail_entitlement_organization_idx').on(table.organizationId),
    validTier: check('mail_entitlement_tier_check', sql`${table.tier} in ('standard','owner')`),
  })
)
