// Support platform schema.
//
// Stage 01 of the support platform plan: customer identity — `contact`, the
// identifiers a contact is known by (`contactIdentity`), the companies they
// belong to (`supportCompany`), and explicit links from a contact to other
// Veerify entities (`contactLink`). Stage 02 adds the inbox and conversation
// tables.
//
// `contactLink` points outward at entities like `feedback` by
// (entityType, entityId) — a loose reference, not a foreign key. Feedback
// never references a contact; see "Why contacts and feedback stay separate"
// in `docs/plans/2026-08-11-support-platform/design.md`.
//
// See `docs/plans/2026-08-11-support-platform/design.md` → Data model → Stage 01.

import { pgTable, text, timestamp, jsonb, uniqueIndex, index, boolean, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { user, team } from './auth'

// Support companies - the Zendesk "organization" concept, named to avoid
// collision with the existing `organization` table. Declared before `contact`
// because `contact.companyId` references it.
export const supportCompany = pgTable(
  'support_company',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    domain: text('domain'),
    attributes: jsonb('attributes').$type<Record<string, any>>(),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    // Unique domain within a team (NULLs distinct - multiple domain-less companies are fine)
    uniqueTeamDomain: uniqueIndex('support_company_team_domain_idx').on(table.teamId, table.domain),
    // Unique name within a team
    uniqueTeamName: uniqueIndex('support_company_team_name_idx').on(table.teamId, table.name),
  })
)

// Contacts - a customer, scoped to a team. Deliberately separate from
// `feedback` (see file header): joining a pseudonymous public post to a
// private support identity would be a privacy and GDPR-erasure problem.
export const contact = pgTable(
  'contact',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    name: text('name'),
    email: text('email'),
    phone: text('phone'),
    avatarUrl: text('avatar_url'),
    companyId: text('company_id').references(() => supportCompany.id, { onDelete: 'set null' }),
    // Set when the contact has a Veerify account
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    attributes: jsonb('attributes').$type<Record<string, any>>(),
    blockedAt: timestamp('blocked_at'),
    // Self-reference for contact merge: set on the loser row, which is retained as a tombstone
    mergedIntoContactId: text('merged_into_contact_id').references((): AnyPgColumn => contact.id, {
      onDelete: 'set null',
    }),
    lastSeenAt: timestamp('last_seen_at'),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    // Unique email within a team (NULLs distinct - multiple email-less contacts are fine and intended)
    uniqueTeamEmail: uniqueIndex('contact_team_email_idx').on(table.teamId, table.email),
    // Index for team timelines
    teamCreatedAtIdx: index('contact_team_created_at_idx').on(table.teamId, table.createdAt),
    // Index for querying contacts by company
    companyIdx: index('contact_company_idx').on(table.companyId),
    // Index for querying contacts by linked user account
    userIdx: index('contact_user_idx').on(table.userId),
  })
)

// Contact identities - the identifiers a contact is known by. Separate table
// so contact merge is repointing rows plus a tombstone, not a destructive
// overwrite, and so new channels add identifier kinds for free.
export const contactIdentity = pgTable(
  'contact_identity',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id')
      .notNull()
      .references(() => contact.id, { onDelete: 'cascade' }),
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    // 'email' | 'user' | 'anon_session' | 'chat_token'
    kind: text('kind').notNull(),
    value: text('value').notNull(),
    verifiedAt: timestamp('verified_at'),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    // Unique identifier within a team - makes an email (or other identifier) resolve
    // to at most one contact per team, and makes contact merge tractable
    uniqueTeamKindValue: uniqueIndex('contact_identity_team_kind_value_idx').on(
      table.teamId,
      table.kind,
      table.value
    ),
    // Index for querying all identities of a contact
    contactIdx: index('contact_identity_contact_idx').on(table.contactId),
  })
)

// Contact links - explicit, agent-confirmed links from a contact to other
// entities. Lives in the support schema and points outward by
// (entityType, entityId), a loose reference - NOT a foreign key - so
// `feedback.ts` stays untouched. Feedback must never reference a contact.
export const contactLink = pgTable(
  'contact_link',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id')
      .notNull()
      .references(() => contact.id, { onDelete: 'cascade' }),
    // 'feedback' | 'conversation'
    entityType: text('entity_type').notNull(),
    // Loose reference into the target entity's table - no foreign key
    entityId: text('entity_id').notNull(),
    // 'auto' | 'agent'
    source: text('source').notNull(),
    createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    // Unique link per contact/entity pair
    uniqueContactEntity: uniqueIndex('contact_link_contact_entity_idx').on(
      table.contactId,
      table.entityType,
      table.entityId
    ),
    // Index for looking up links by target entity (e.g. from a feedback item)
    entityIdx: index('contact_link_entity_idx').on(table.entityType, table.entityId),
  })
)

// Team-scoped support policy. This intentionally does not live in generic
// team JSON: support privacy controls need an explicit ownership boundary.
export const supportTeamSettings = pgTable('support_team_settings', {
  teamId: text('team_id')
    .primaryKey()
    .references(() => team.id, { onDelete: 'cascade' }),
  autoLinkFeedback: boolean('auto_link_feedback')
    .default(false)
    .notNull(),
  createdAt: timestamp('created_at')
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp('updated_at')
    .$defaultFn(() => new Date())
    .notNull(),
})
