// Support platform schema.
//
// Stage 01 of the support platform plan: customer identity — `contact`, the
// identifiers a contact is known by (`contactIdentity`), the companies they
// belong to (`supportCompany`), and explicit links from a contact to other
// Veerify entities (`contactLink`). Stage 02 adds the inbox and conversation
// tables: `supportInbox`, `supportInboxAddress`, `supportInboxMember`,
// `conversation`, `supportCounter`, `conversationMessage`,
// `conversationAttachment`, `conversationParticipant`, `supportTag`,
// `conversationTag`, and `supportEmailEvent`. Stage 04 adds
// `supportOutboundDelivery` and `supportDeliveryEvent`.
//
// `contactLink` points outward at entities like `feedback` by
// (entityType, entityId) — a loose reference, not a foreign key. Feedback
// never references a contact; see "Why contacts and feedback stay separate"
// in `docs/plans/2026-08-11-support-platform/design.md`.
//
// `conversation.projectId` and `supportInboxAddress.projectId` are real
// foreign keys into `feedback.ts`'s `project` table (support → feedback,
// the permitted direction — see delta D-27). `conversation.linkedFeedbackId`
// likewise references `feedback.ts`'s `feedback` table. `feedback.ts` itself
// is never edited to support this schema.
//
// See `docs/plans/2026-08-11-support-platform/design.md` → Data model →
// Stage 01 and Stage 02, and delta D-27 in `deltas.md` for the
// `supportInboxAddress` / `conversation.projectId` addition.

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  boolean,
  integer,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { user, team } from './auth'
import { project, feedback } from './feedback'

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
    uniqueTeamKindValue: uniqueIndex('contact_identity_team_kind_value_idx').on(table.teamId, table.kind, table.value),
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
  autoLinkFeedback: boolean('auto_link_feedback').default(false).notNull(),
  createdAt: timestamp('created_at')
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp('updated_at')
    .$defaultFn(() => new Date())
    .notNull(),
})

// ---------------------------------------------------------------------------
// Stage 02 — inbox and conversations
// See `docs/plans/2026-08-11-support-platform/design.md` → Data model →
// Stage 02, and delta D-27 for `supportInboxAddress` / `conversation.projectId`.
// ---------------------------------------------------------------------------

// Support inboxes - one shared inbox per team ("support@acme.com" as the
// primary sending identity). What the inbox actually *receives* on is
// governed by `supportInboxAddress` (delta D-27), which lets one inbox map
// several receiving addresses to different products.
export const supportInbox = pgTable(
  'support_inbox',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    // Optional single-product link for teams that don't need multi-address routing
    projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    // 'email' | 'chat' | 'whatsapp' | … (Stage 02 ships 'email' only)
    type: text('type').default('email').notNull(),
    // Provider, inbound address, credential references - never raw secrets
    channelConfig: jsonb('channel_config').$type<Record<string, any>>(),
    // Primary *sending* identity - distinct from the receiving addresses in supportInboxAddress
    emailAddress: text('email_address'),
    forwardAddress: text('forward_address'),
    fromName: text('from_name'),
    signature: text('signature'),
    autoReplyEnabled: boolean('auto_reply_enabled').default(false).notNull(),
    autoReplyTemplate: text('auto_reply_template'),
    defaultAssigneeUserId: text('default_assignee_user_id').references(() => user.id, { onDelete: 'set null' }),
    isEnabled: boolean('is_enabled').default(true).notNull(),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    uniqueTeamSlug: uniqueIndex('support_inbox_team_slug_idx').on(table.teamId, table.slug),
    uniqueEmailAddress: uniqueIndex('support_inbox_email_address_idx').on(table.emailAddress),
    teamIdx: index('support_inbox_team_idx').on(table.teamId),
    projectIdx: index('support_inbox_project_idx').on(table.projectId),
  })
)

// Receiving addresses for an inbox, and the product each maps to (delta D-27).
// Email carries no product signal on its own; a customer mailing
// `billing@acme.com` attributes to Billing only because that address is
// mapped here. `projectId` null means unattributed.
export const supportInboxAddress = pgTable(
  'support_inbox_address',
  {
    id: text('id').primaryKey(),
    inboxId: text('inbox_id')
      .notNull()
      .references(() => supportInbox.id, { onDelete: 'cascade' }),
    address: text('address').notNull(),
    projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),
    isPrimary: boolean('is_primary').default(false).notNull(),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    uniqueAddress: uniqueIndex('support_inbox_address_address_idx').on(table.address),
    inboxIdx: index('support_inbox_address_inbox_idx').on(table.inboxId),
    projectIdx: index('support_inbox_address_project_idx').on(table.projectId),
  })
)

// Support permissions live here, not on `teamMember.role` (delta D-28 -
// `teamMember.role` semantics are unchanged).
export const supportInboxMember = pgTable(
  'support_inbox_member',
  {
    id: text('id').primaryKey(),
    inboxId: text('inbox_id')
      .notNull()
      .references(() => supportInbox.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // 'agent' | 'supervisor' | 'admin'
    role: text('role').notNull(),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    uniqueInboxUser: uniqueIndex('support_inbox_member_inbox_user_idx').on(table.inboxId, table.userId),
    userIdx: index('support_inbox_member_user_idx').on(table.userId),
  })
)

// Per-team `displayId` allocation for conversations. A row per team,
// incremented with `SELECT … FOR UPDATE` inside the same transaction as the
// conversation insert - not a sequence, because the number must be per-team
// and gap-free enough to read as a ticket number.
export const supportCounter = pgTable('support_counter', {
  teamId: text('team_id')
    .primaryKey()
    .references(() => team.id, { onDelete: 'cascade' }),
  nextConversationDisplayId: integer('next_conversation_display_id').default(1).notNull(),
})

// Conversations - the core support ticket entity.
export const conversation = pgTable(
  'conversation',
  {
    id: text('id').primaryKey(),
    inboxId: text('inbox_id')
      .notNull()
      .references(() => supportInbox.id, { onDelete: 'restrict' }),
    // Denormalized for team-scoped queries and isolation checks
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    contactId: text('contact_id')
      .notNull()
      .references(() => contact.id, { onDelete: 'restrict' }),
    // Resolved product - from the receiving address's mapping, or an agent override (delta D-27)
    projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),
    displayId: integer('display_id').notNull(),
    subject: text('subject'),
    // 'open' | 'pending' | 'resolved' | 'snoozed' | 'closed'
    status: text('status').default('open').notNull(),
    // 'low' | 'normal' | 'high' | 'urgent', nullable
    priority: text('priority'),
    assigneeUserId: text('assignee_user_id').references(() => user.id, { onDelete: 'set null' }),
    linkedFeedbackId: text('linked_feedback_id').references(() => feedback.id, { onDelete: 'set null' }),
    // Root RFC Message-ID, used to thread replies onto this conversation
    channelThreadKey: text('channel_thread_key'),
    firstResponseAt: timestamp('first_response_at'),
    resolvedAt: timestamp('resolved_at'),
    snoozedUntil: timestamp('snoozed_until'),
    lastActivityAt: timestamp('last_activity_at'),
    lastCustomerReplyAt: timestamp('last_customer_reply_at'),
    lastAgentReplyAt: timestamp('last_agent_reply_at'),
    metadata: jsonb('metadata').$type<Record<string, any>>(),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    uniqueTeamDisplayId: uniqueIndex('conversation_team_display_id_idx').on(table.teamId, table.displayId),
    teamStatusActivityIdx: index('conversation_team_status_activity_idx').on(
      table.teamId,
      table.status,
      table.lastActivityAt
    ),
    inboxStatusIdx: index('conversation_inbox_status_idx').on(table.inboxId, table.status),
    assigneeStatusIdx: index('conversation_assignee_status_idx').on(table.assigneeUserId, table.status),
    contactCreatedAtIdx: index('conversation_contact_created_at_idx').on(table.contactId, table.createdAt),
    channelThreadKeyIdx: index('conversation_channel_thread_key_idx').on(table.channelThreadKey),
    projectStatusIdx: index('conversation_project_status_idx').on(table.projectId, table.status),
  })
)

// Messages within a conversation. `kind = 'activity'` stores system events
// ("assigned to Bob", "status → resolved") as messages rather than in a side
// table - this is what lets the Chatwoot-style thread render actions inline
// with replies from a single ordered query.
export const conversationMessage = pgTable(
  'conversation_message',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    // 'incoming' | 'outgoing' | 'note' | 'activity'
    kind: text('kind').notNull(),
    body: text('body'),
    // Sanitized on ingest - never render raw provider HTML
    bodyHtml: text('body_html'),
    // 'contact' | 'agent' | 'system'
    senderKind: text('sender_kind').notNull(),
    senderContactId: text('sender_contact_id').references(() => contact.id, { onDelete: 'set null' }),
    senderUserId: text('sender_user_id').references(() => user.id, { onDelete: 'set null' }),
    isPrivate: boolean('is_private').default(false).notNull(),
    channelMessageId: text('channel_message_id'),
    inReplyTo: text('in_reply_to'),
    channelHeaders: jsonb('channel_headers').$type<Record<string, any>>(),
    // 'pending' | 'sent' | 'delivered' | 'failed' | 'bounced'
    deliveryStatus: text('delivery_status').default('pending').notNull(),
    deliveryError: text('delivery_error'),
    metadata: jsonb('metadata').$type<Record<string, any>>(),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    conversationCreatedAtIdx: index('conversation_message_conversation_created_at_idx').on(
      table.conversationId,
      table.createdAt
    ),
    uniqueChannelMessageId: uniqueIndex('conversation_message_channel_message_id_idx').on(table.channelMessageId),
    deliveryStatusIdx: index('conversation_message_delivery_status_idx').on(table.deliveryStatus),
  })
)

// Attachments on a message. Reuses `server/utils/storage` and the existing
// presign flow.
export const conversationAttachment = pgTable(
  'conversation_attachment',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id')
      .notNull()
      .references(() => conversationMessage.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type'),
    sizeBytes: integer('size_bytes'),
    isInline: boolean('is_inline').default(false).notNull(),
    contentId: text('content_id'),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    messageIdx: index('conversation_attachment_message_idx').on(table.messageId),
  })
)

// CCs and watchers on a conversation. Either `contactId` or `userId` is set,
// never both - a CC'd customer or an internal follower.
export const conversationParticipant = pgTable(
  'conversation_participant',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    contactId: text('contact_id').references(() => contact.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    // 'cc' | 'follower'
    role: text('role').notNull(),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    uniqueConversationContact: uniqueIndex('conversation_participant_conversation_contact_idx').on(
      table.conversationId,
      table.contactId
    ),
    uniqueConversationUser: uniqueIndex('conversation_participant_conversation_user_idx').on(
      table.conversationId,
      table.userId
    ),
  })
)

// Team-scoped tags. `design.md` describes this pair only as "team-scoped
// tags and their join table" without a column list; columns below follow
// the existing `supportCompany` (team-scoped, named entity) and
// `contactLink` (join-style, unique compound index) conventions in this file.
export const supportTag = pgTable(
  'support_tag',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color'),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    uniqueTeamName: uniqueIndex('support_tag_team_name_idx').on(table.teamId, table.name),
  })
)

// Join table between conversations and tags.
export const conversationTag = pgTable(
  'conversation_tag',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => supportTag.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    uniqueConversationTag: uniqueIndex('conversation_tag_conversation_tag_idx').on(table.conversationId, table.tagId),
    tagIdx: index('conversation_tag_tag_idx').on(table.tagId),
  })
)

// Inbound idempotency and audit. A unique key on its own is not enough: a
// failed claim must be replayable without duplicating a processed event -
// `status` + `leaseExpiresAt` support a claim/lease pattern on top of it.
export const supportEmailEvent = pgTable(
  'support_email_event',
  {
    id: text('id').primaryKey(),
    // Nullable, because the row is keyed on the *delivery*, not on an inbox:
    // it is claimed as soon as the provider signature verifies, which is
    // before parsing has revealed which address the mail was sent to, and
    // mail to an unrecognised address never resolves to an inbox at all.
    // Stage 03 requires recording both of those cases - "no match → record the
    // event with an error and return 200", and the same for a team with
    // support disabled - which a NOT NULL column makes impossible.
    // `resultConversationId` below is nullable for exactly this reason
    // already; this is the same category of field (delta D-35).
    inboxId: text('inbox_id').references(() => supportInbox.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    rawStorageKey: text('raw_storage_key'),
    // 'processing' | 'processed' | 'failed'
    status: text('status').default('processing').notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    leaseExpiresAt: timestamp('lease_expires_at'),
    processedAt: timestamp('processed_at'),
    resultConversationId: text('result_conversation_id').references(() => conversation.id, {
      onDelete: 'set null',
    }),
    error: text('error'),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    uniqueProviderEventId: uniqueIndex('support_email_event_provider_event_id_idx').on(
      table.provider,
      table.providerEventId
    ),
    inboxIdx: index('support_email_event_inbox_idx').on(table.inboxId),
  })
)

// Durable outbound-delivery outbox (Stage 04, delta D-21). Message insertion
// and outbox enqueue are one transaction; a worker claims and retries
// delivery, so a request-lifetime background promise is never the only copy
// of "this needs to be sent". `payload` carries storage/credential
// *references* only, never resolved bytes - see `EmailAttachment` vs
// `OutboundAttachment` in `server/utils/outbound-delivery.ts`, which resolves
// a stored key to bytes only inside the worker.
//
// `kind` is 'email' for everything Stage 04 sends; the column exists so
// later stages (CSAT, social) reuse this table rather than building their
// own outbox, per design.md.
export const supportOutboundDelivery = pgTable(
  'support_outbound_delivery',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id')
      .notNull()
      .references(() => conversationMessage.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<Record<string, any>>().notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    // 'pending' | 'sent' | 'failed'
    status: text('status').default('pending').notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    leaseExpiresAt: timestamp('lease_expires_at'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    // One queued delivery per (message, kind) - the same insert that fails on
    // conflict here is what makes re-running the endpoint's transaction safe.
    uniqueMessageKind: uniqueIndex('support_outbound_delivery_message_kind_idx').on(table.messageId, table.kind),
    uniqueIdempotencyKey: uniqueIndex('support_outbound_delivery_idempotency_key_idx').on(table.idempotencyKey),
    statusIdx: index('support_outbound_delivery_status_idx').on(table.status),
  })
)

// Delivery/bounce webhook idempotency (Stage 04). Deliberately its own table,
// not `supportEmailEvent`: that table's unique key collapses to one row per
// *email*, correct for inbound (a provider retry must never become a second
// ticket) but wrong here, because one outbound message legitimately produces
// several delivery events (Delivery, then Open, then possibly Bounce or
// SpamComplaint). Sharing the key would silently swallow every event after
// the first - including the hard bounce that acceptance criterion 6 exists
// to catch. See `parallel-agents.md`, "the delivery webhook gets its own
// table", and delta D-35 for why `messageId` below is nullable for the same
// reason `supportEmailEvent.inboxId` is.
export const supportDeliveryEvent = pgTable(
  'support_delivery_event',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id').references(() => conversationMessage.id, { onDelete: 'set null' }),
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    // Provider-normalized: 'delivered' | 'bounced' | 'opened' | 'spam_complaint' | …
    recordType: text('record_type').notNull(),
    recipient: text('recipient').notNull(),
    // 'processing' | 'processed' | 'failed'
    status: text('status').default('processing').notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    leaseExpiresAt: timestamp('lease_expires_at'),
    processedAt: timestamp('processed_at'),
    error: text('error'),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    uniqueProviderEventId: uniqueIndex('support_delivery_event_provider_event_id_idx').on(
      table.provider,
      table.providerEventId
    ),
    messageIdx: index('support_delivery_event_message_idx').on(table.messageId),
  })
)
