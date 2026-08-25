# Stage 01-04 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Support Stages 01-04 production-safe without making daily conversation work slower or exposing privacy-sensitive data.

**Architecture:** Staged generated schema migrations establish upload-session, permission, provider-correlation, and retry contracts in dependency order: additive tables/columns/defaults first, then constraints and index replacement. Focused services enforce those contracts at API boundaries, while Options API components consume server-returned capabilities and explicit paginated state. Provider delivery stays at-least-once and attachments use durable reservation before external object operations.

**Tech Stack:** Nuxt 3, Vue 3 Options API, TypeScript, Drizzle ORM, PostgreSQL, Redis/Valkey, Vitest, Playwright, Nodemailer, AWS SDK S3.

**Spec:** `docs/plans/2026-08-11-support-platform/stage-01-04-hardening-design.md`

## Global Constraints

- Preserve the existing email-first scope; do not add live chat, social channels, or a knowledge base.
- Keep contacts and feedback structurally separate; feedback never receives a contact foreign key.
- Preserve bracketless RFC Message-ID storage and add angle brackets only when constructing mail headers.
- UI authorization is supplemental; every capability is enforced server-side.
- Existing messages, attachments, contacts, links, and queued outbound deliveries remain readable and deliverable.
- New message requests accept attachment upload IDs only; no compatibility route may accept client-provided storage keys.
- Attachment limits are 10 MB per file and 25 MB per message, based on verified object bytes.
- Inbox roles are exactly `agent`, `supervisor`, and `admin`; team admins bypass inbox assignment as inbox admins.
- Timeline pages default to 25 rows, allow at most 100, and use versioned opaque `(createdAt,id)` cursors.
- Delivery is at-least-once with at most five automatic attempts and operator-visible duplicate-risk wording on manual retry.
- Provider account keys are non-secret deployment identifiers from `SUPPORT_POSTMARK_ACCOUNT_KEY` and `SUPPORT_MAILGUN_ACCOUNT_KEY`; never persist provider tokens as identity.
- Schema changes are made in `server/database/schema/support.ts` and generated with `yarn db:generate`; generated SQL is reviewed but not hand-edited.
- Any user-facing behavior change receives Playwright coverage, run serially with `--workers=1` when forced locally.
- Run `yarn harness:verify` after each task; report guarded skips separately from passes.

---

### Task 1: Establish the shared schema and migration contracts

**Files:**

- Modify: `server/database/schema/support.ts`
- Modify: `server/database/schema/index.ts` only if the support export is not already present
- Create: next generated file under `server/database/migrations/`
- Modify: `server/database/migrations/meta/_journal.json`
- Create: `tests/integration/support-hardening-schema.test.ts`
- Modify: `.env.example`

**Interfaces:**

- Produces: `supportAttachmentUpload` with statuses `pending | uploaded | finalizing | cleanup_required | consumed | expired`.
- Produces: `supportOutboundDelivery.provider`, `.providerAccountKey`, `.providerMessageId`, and `.nextAttemptAt`.
- Produces: `supportDeliveryEvent.providerAccountKey` and `.correlationKey`, unique by `(provider,providerAccountKey,providerEventId)`.
- Produces: nullable `supportDeliveryEvent.occurredAt` for provider event time; new webhook rows always set it, while legacy rows remain distinguishable from locally recorded `createdAt`.
- Produces: a non-unique `conversation_message_channel_message_id_idx` and a database check restricting inbox member roles.
- Consumes: the exact columns, foreign keys, indexes, and cleanup fields from the approved spec.

- [ ] **Step 1: Write the failing real-Postgres schema test**

Create a test that queries `information_schema.columns`, `pg_indexes`, and `pg_constraint` and asserts literal contracts:

```ts
expect(uploadColumns).toEqual(
  expect.arrayContaining([
    'id',
    'conversation_id',
    'user_id',
    'temp_storage_key',
    'final_storage_key',
    'file_name',
    'requested_content_type',
    'requested_size_bytes',
    'stored_content_type',
    'actual_size_bytes',
    'object_version',
    'status',
    'expires_at',
    'uploaded_at',
    'consumed_at',
    'temp_deleted_at',
    'finalize_lease_expires_at',
    'cleanup_attempt_count',
    'cleanup_last_error',
    'message_id',
    'created_at',
    'updated_at',
  ])
)
expect(channelMessageIndex?.indexdef).not.toContain('UNIQUE')
expect(uploadForeignKeys).toEqual(
  expect.arrayContaining([
    'conversation_id -> conversation.id',
    'user_id -> user.id',
    'message_id -> conversation_message.id',
  ])
)
expect(uploadIndexes).toEqual(
  expect.arrayContaining([
    ['conversation_id', 'status'],
    ['user_id', 'status'],
    ['status', 'expires_at'],
  ])
)
expect(await acceptsInboxRole('agent')).toBe(true)
expect(await acceptsInboxRole('supervisor')).toBe(true)
expect(await acceptsInboxRole('admin')).toBe(true)
expect(await acceptsInboxRole('member')).toBe(false)
expect(providerAccountColumn).toMatchObject({ isNullable: 'NO', columnDefault: "'legacy'::text" })
expect(deliveryEventColumns).toEqual(expect.arrayContaining(['provider_account_key', 'correlation_key', 'occurred_at']))
expect(deliveryEventUniqueColumns).toEqual(['provider', 'provider_account_key', 'provider_event_id'])
```

Prefer semantic catalog queries and transaction-rolled-back insert probes over exact `pg_get_constraintdef` formatting.

- [ ] **Step 2: Run the schema test and verify RED**

Run: `yarn vitest run -c vitest.integration.config.ts tests/integration/support-hardening-schema.test.ts`

Expected: FAIL because `support_attachment_upload` and the new columns/constraints do not exist.

- [ ] **Step 3: Add the Drizzle schema declarations**

Use `check`, `sql`, `index`, and `uniqueIndex` to express the contracts. The upload status and inbox role checks must be schema-owned, and `providerAccountKey` must be `.default('legacy').notNull()` so existing delivery events migrate safely. Add nullable `occurredAt: timestamp('occurred_at')` to preserve real provider event time on new rows without fabricating a historical value for legacy rows.

```ts
export const supportAttachmentUpload = pgTable(
  'support_attachment_upload',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    tempStorageKey: text('temp_storage_key').notNull(),
    finalStorageKey: text('final_storage_key'),
    fileName: text('file_name').notNull(),
    requestedContentType: text('requested_content_type').notNull(),
    requestedSizeBytes: integer('requested_size_bytes').notNull(),
    storedContentType: text('stored_content_type'),
    actualSizeBytes: integer('actual_size_bytes'),
    objectVersion: text('object_version'),
    status: text('status').default('pending').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    uploadedAt: timestamp('uploaded_at'),
    consumedAt: timestamp('consumed_at'),
    tempDeletedAt: timestamp('temp_deleted_at'),
    cleanupAttemptCount: integer('cleanup_attempt_count').default(0).notNull(),
    cleanupLastError: text('cleanup_last_error'),
    finalizeLeaseExpiresAt: timestamp('finalize_lease_expires_at'),
    messageId: text('message_id').references(() => conversationMessage.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    conversationStatusIdx: index('support_attachment_upload_conversation_status_idx').on(
      table.conversationId,
      table.status
    ),
    userStatusIdx: index('support_attachment_upload_user_status_idx').on(table.userId, table.status),
    statusExpiryIdx: index('support_attachment_upload_status_expiry_idx').on(table.status, table.expiresAt),
    validStatus: check(
      'support_attachment_upload_status_check',
      sql`${table.status} in ('pending','uploaded','finalizing','cleanup_required','consumed','expired')`
    ),
  })
)
```

- [ ] **Step 4: Preflight the exact migration target**

Print the resolved target without credentials and abort unless it is the isolated development database intended for this worktree:

```powershell
if ($env:DATABASE_URL) { $target = [Uri]$env:DATABASE_URL; Write-Output "DB_TARGET=$($target.Host):$($target.Port)$($target.AbsolutePath)" } else { Write-Output "DB_TARGET=$env:PGHOST`:$env:PGPORT/$env:PGDATABASE" }
yarn tsx -e "import { db } from './server/database/drizzle'; import { sql } from 'drizzle-orm'; const invalid=await db.execute(sql\`select role,count(*) from support_inbox_member where role not in ('agent','supervisor','admin') group by role\`); const events=await db.execute(sql\`select count(*)::int as count from support_delivery_event\`); console.log(JSON.stringify({invalidRoles:invalid.rows,deliveryEventCount:events.rows[0]?.count})); process.exit(invalid.rows.length ? 2 : 0)"
```

Do not run migration commands if the host/database is unclear, if the target is production/shared, or if any invalid role is reported.

- [ ] **Step 5: Generate, capture, and review staged migrations**

Run in one PowerShell session:

```powershell
$migrationManifest = Join-Path ([IO.Path]::GetTempPath()) 'veerify-stage-01-04-task1-migrations.txt'
$before = @(git ls-files --others --exclude-standard -- 'server/database/migrations/*.sql')
yarn db:generate
if ($LASTEXITCODE -ne 0) { throw 'Migration generation failed' }
$after = @(git ls-files --others --exclude-standard -- 'server/database/migrations/*.sql')
$generatedMigrations = @($after | Where-Object { $_ -notin $before })
if ($generatedMigrations.Count -lt 1) { throw 'No newly generated migration found' }
$generatedMigrations | Set-Content -LiteralPath $migrationManifest
```

Inspect only the paths captured in `$migrationManifest`, in this order: (1) upload table and additive delivery columns/defaults including `support_delivery_event.occurred_at`, (2) role constraint and provider-event uniqueness replacement, (3) global RFC unique-index removal and non-unique replacement. If one generated file does not preserve that order, generate two or more schema states in sequence and append only each newly captured path to the manifest; do not edit SQL manually.

- [ ] **Step 6: Apply only to the verified development target and verify GREEN**

Run: `yarn db:migrate`

Run: `yarn vitest run -c vitest.integration.config.ts tests/integration/support-hardening-schema.test.ts`

Expected: PASS.

- [ ] **Step 7: Update deployment configuration names and verify the task**

Add empty documented entries for `SUPPORT_POSTMARK_ACCOUNT_KEY` and `SUPPORT_MAILGUN_ACCOUNT_KEY` to `.env.example`, then run `yarn typecheck`, `yarn lint`, and `yarn harness:verify`.

- [ ] **Step 8: Commit exact files only**

```powershell
$migrationManifest = Join-Path ([IO.Path]::GetTempPath()) 'veerify-stage-01-04-task1-migrations.txt'
$generatedMigrations = @(Get-Content -LiteralPath $migrationManifest)
if ($generatedMigrations.Count -lt 1 -or ($generatedMigrations | Where-Object { -not (Test-Path -LiteralPath $_) })) { throw 'Captured generated migration is missing' }
git add -- server/database/schema/support.ts server/database/migrations/meta/_journal.json tests/integration/support-hardening-schema.test.ts .env.example $generatedMigrations
git diff --cached --name-status
git commit -m "feat(support): add hardening data contracts"
```

---

### Task 2: Implement ranked inbox access and filtered capability payloads

**Files:**

- Modify: `server/utils/support-access.ts`
- Modify: `server/api/support/inboxes/index.get.ts`
- Modify: `server/api/support/inboxes/[id].get.ts`
- Modify: `server/api/support/teams/[teamId]/settings.get.ts`
- Modify: `tests/support-access.test.ts`
- Create: `tests/support-inbox-list.test.ts`

**Interfaces:**

- Produces: `SupportInboxRole`, `SupportCapabilities`, `requireTeamAdmin`, `requireInboxAccess`, `requireInboxRole`, and `requireSupportTeamRole`.
- `requireInboxAccess` preserves inbox row fields and adds `effectiveRole`, `isTeamAdmin`, and `capabilities`.
- Produces: filtered inbox list/detail/settings payloads with no inaccessible inbox metadata.

- [ ] **Step 1: Extend the access-helper tests and verify RED**

Add table-driven cases with literal expected capabilities:

```ts
expect(capabilitiesForRole('agent', false)).toEqual({
  canWorkConversations: true,
  canManageTagVocabulary: false,
  canManageMembers: false,
  canManageInbox: false,
  canManageTeamSupport: false,
})
expect(capabilitiesForRole('supervisor', false).canManageTagVocabulary).toBe(true)
expect(capabilitiesForRole('admin', false).canManageInbox).toBe(true)
expect(capabilitiesForRole('admin', true).canManageTeamSupport).toBe(true)
```

Also assert an unassigned team member receives 403 without observing the inbox name, while a team admin receives effective role `admin`.

Run: `yarn vitest run tests/support-access.test.ts`

Expected: FAIL because the ranked helpers and capability results do not exist.

- [ ] **Step 2: Implement the centralized ranked access API**

```ts
export type SupportInboxRole = 'agent' | 'supervisor' | 'admin'
export type SupportCapabilities = {
  canWorkConversations: boolean
  canManageTagVocabulary: boolean
  canManageMembers: boolean
  canManageInbox: boolean
  canManageTeamSupport: boolean
}
export async function requireInboxRole(
  inboxId: string,
  userId: string,
  minimumRole: SupportInboxRole
): Promise<InboxAccess>
export async function requireTeamAdmin(teamId: string, userId: string): Promise<TeamMembership>
export async function requireSupportTeamRole(
  teamId: string,
  userId: string,
  minimumRole: 'agent' | 'supervisor'
): Promise<{ effectiveRole: SupportInboxRole; isTeamAdmin: boolean }>
```

Use a fixed rank map `{ agent: 1, supervisor: 2, admin: 3 }`. Return one consistent forbidden response: `You do not have access to this support inbox`.

- [ ] **Step 3: Write the failing filtered-inbox tests**

Exercise the list/detail handlers through database-boundary fakes. An ordinary assigned agent receives only joined inboxes with agent capabilities; a team admin receives every team inbox with admin capabilities; an unassigned member receives an empty list and cannot load detail.

Run: `yarn vitest run tests/support-inbox-list.test.ts`

Expected: FAIL because list queries currently return every team inbox and payloads have no capabilities.

- [ ] **Step 4: Filter inbox queries and return capabilities**

Team admins receive every team inbox. Other users receive only inboxes joined through `supportInboxMember`. Add capabilities to inbox list/detail/settings payloads; never return inaccessible inbox metadata and never infer capabilities in the browser.

- [ ] **Step 5: Verify GREEN and commit exact files**

Run: `yarn vitest run tests/support-access.test.ts tests/support-inbox-list.test.ts`

Run: `yarn typecheck && yarn lint && yarn harness:verify`

```powershell
git add -- server/utils/support-access.ts server/api/support/inboxes/index.get.ts 'server/api/support/inboxes/[id].get.ts' 'server/api/support/teams/[teamId]/settings.get.ts' tests/support-access.test.ts tests/support-inbox-list.test.ts
git diff --cached --name-status
git commit -m "feat(support): rank inbox access"
```

---

### Task 3: Apply the support route authorization matrix

**Files:**

- Modify: `server/api/support/inboxes/index.post.ts`
- Modify: `server/api/support/inboxes/[id].put.ts`
- Modify: `server/api/support/inboxes/[id].delete.ts`
- Modify: `server/api/support/inboxes/[id]/addresses/index.post.ts`
- Modify: `server/api/support/inboxes/[id]/addresses/[addressId].delete.ts`
- Modify: `server/api/support/inboxes/[id]/members/index.post.ts`
- Modify: `server/api/support/inboxes/[id]/members/[memberId].delete.ts`
- Modify: `server/api/support/inboxes/[id]/sending-status.get.ts`
- Modify: `server/api/support/tags/index.post.ts`
- Modify: `server/api/support/tags/[id].delete.ts`
- Modify: `server/api/support/channel-status.get.ts`
- Modify: `server/api/support/teams/[teamId]/settings.put.ts`
- Modify: `server/api/teams/[teamId]/modules.put.ts`
- Create: `server/api/support/inboxes/[id]/members/[memberId].patch.ts`
- Create: `tests/support-route-authorization.test.ts`

**Interfaces:**

- Consumes: ranked helpers and capabilities from Task 2.
- Produces: `GET /api/support/channel-status?inboxId=...`, exact route minimum roles, and validated member-role updates.

- [ ] **Step 1: Write the failing route inventory matrix**

Import each route handler with auth/database helpers mocked at the boundary. Assert the exact helper and minimum role for every route category, including inbox create/settings/member mutation, statuses, contacts/companies, links/timelines, tags, participants, and attachments. Include validation that member writes reject roles outside the three-value enum.

Run: `yarn vitest run tests/support-route-authorization.test.ts`

Expected: FAIL on routes still using membership-only helpers or no scoped access.

- [ ] **Step 2: Apply the role matrix route by route**

Use:

```ts
await requireTeamAdmin(teamId, session.user.id) // inbox creation and team policy mutation
await requireInboxRole(inboxId, session.user.id, 'admin') // inbox/member/address mutation
await requireInboxRole(inboxId, session.user.id, 'supervisor') // shared tag vocabulary mutation
await requireInboxRole(inboxId, session.user.id, 'agent') // daily conversation/status/attachment work
```

For team-scoped tag creation/deletion, call `requireSupportTeamRole(teamId,userId,'supervisor')`. Keep contact/company/timeline/link routes on `requireTeamMembership` or entity-specific team access.
Require `requireTeamAdmin` in `server/api/teams/[teamId]/modules.put.ts` before changing `supportEnabled` or any other team module toggle; generic team membership is not sufficient for policy mutation.

- [ ] **Step 3: Add member-role update and role validation**

The new `PATCH /api/support/inboxes/{id}/members/{memberId}` accepts exactly:

```ts
z.object({ role: z.enum(['agent', 'supervisor', 'admin']) })
```

It requires inbox admin, verifies the row belongs to the route inbox, and returns the updated member without exposing unrelated memberships.

- [ ] **Step 4: Scope provider status and verify GREEN**

Require `inboxId` on channel status, call `requireInboxRole(inboxId,userId,'agent')`, and return configuration names only after authorization.

Run: `yarn vitest run tests/support-route-authorization.test.ts`

Run: `yarn typecheck && yarn lint && yarn harness:verify`

- [ ] **Step 5: Commit exact files**

```powershell
git add -- server/api/support/inboxes/index.post.ts 'server/api/support/inboxes/[id].put.ts' 'server/api/support/inboxes/[id].delete.ts' 'server/api/support/inboxes/[id]/addresses/index.post.ts' 'server/api/support/inboxes/[id]/addresses/[addressId].delete.ts' 'server/api/support/inboxes/[id]/members/index.post.ts' 'server/api/support/inboxes/[id]/members/[memberId].delete.ts' 'server/api/support/inboxes/[id]/members/[memberId].patch.ts' 'server/api/support/inboxes/[id]/sending-status.get.ts' server/api/support/tags/index.post.ts 'server/api/support/tags/[id].delete.ts' server/api/support/channel-status.get.ts 'server/api/support/teams/[teamId]/settings.put.ts' 'server/api/teams/[teamId]/modules.put.ts' tests/support-route-authorization.test.ts
git diff --cached --name-status
git commit -m "feat(support): enforce inbox roles"
```

---

### Task 4: Make support settings and navigation capability-aware

**Files:**

- Modify: `pages/support/index.vue`
- Modify: `pages/support/settings.vue`
- Modify: `components/support/SupportInboxSidebar.vue`
- Modify: `tests/e2e/helpers/selectors.ts`
- Create: `tests/e2e/helpers/support-permissions.ts`
- Modify: `tests/e2e/support-conversation-flow.spec.ts`
- Create: `tests/e2e/support-permissions.spec.ts`

**Interfaces:**

- Consumes: server-returned `SupportCapabilities` from Task 2 and enforced routes from Task 3.
- Produces: hidden/read-only administrative controls, descriptive role choices, and safe fallback navigation.

- [ ] **Step 1: Add failing Playwright permission scenarios**

Create `createSupportPermissionFixture(request)` in the new helper. It signs up unique users through `/api/auth/sign-up/email`, inserts the team/inbox memberships through Drizzle with fixed roles, and returns credentials plus opaque IDs; `cleanupSupportPermissionFixture` deletes only those returned IDs in reverse FK order. Use `test.beforeAll`/`afterAll`, `browser.newContext()`, and `loginViaProgrammaticPage` for team admin, inbox admin, supervisor, agent, and unassigned member. Add stable `data-testid` selectors for each administrative action and the no-assignment state. Assert:

```ts
await expect(agentPage.getByRole('button', { name: 'Add inbox member' })).toHaveCount(0)
await expect(supervisorPage.getByRole('button', { name: 'Create tag' })).toBeVisible()
await expect(unassignedPage.getByText(inaccessibleInboxName)).toHaveCount(0)
await expect(agentPage.getByText('You do not have access to this support inbox')).toBeVisible()
```

The deep-link case must end at the first accessible inbox or the support empty state, never loop on 403.

- [ ] **Step 2: Run Playwright and verify RED**

Run prerequisite guard (PowerShell): `$env:PLAYWRIGHT_FORCE='1'; yarn test:e2e:if-available`. Continue only when its output confirms Playwright ran against a reachable, migrated, seeded database; otherwise record the skip and keep the task open.

Then run focused: `$env:PLAYWRIGHT_FORCE='1'; yarn test:e2e:worktree -- tests/e2e/support-permissions.spec.ts --workers=1`

Expected: FAIL because every settings control is currently exposed and deep-link recovery is absent.

- [ ] **Step 3: Implement capability-driven UI**

Read capabilities from the selected inbox payload. Hide destructive/admin actions when false; use disabled/read-only fields only where agents still need to inspect the value. Add role copy:

```js
roleDescriptions: {
  agent: 'Works conversations and applies existing tags.',
  supervisor: 'Also manages the shared tag list.',
  admin: 'Also manages inbox settings and members.',
}
```

Label the team policy switch `Automatically link signed-in customer feedback` and show it only to team admins.

- [ ] **Step 4: Add safe authorization recovery**

On an inbox 403, show the consistent access message, refresh the filtered inbox list, select the first accessible inbox, and otherwise render `No support inboxes are assigned to you.` Do not reveal the rejected inbox name.

- [ ] **Step 5: Verify GREEN**

Run the focused Playwright command from Step 2 until it passes, then run `yarn typecheck`, `yarn lint`, and `yarn harness:verify`.

- [ ] **Step 6: Commit exact files**

```powershell
git add -- pages/support/index.vue pages/support/settings.vue components/support/SupportInboxSidebar.vue tests/e2e/helpers/selectors.ts tests/e2e/helpers/support-permissions.ts tests/e2e/support-conversation-flow.spec.ts tests/e2e/support-permissions.spec.ts
git diff --cached --name-status
git commit -m "feat(support): reflect inbox permissions in the UI"
```

---

### Task 5: Auto-link authenticated feedback at write time

**Files:**

- Create: `server/utils/support-auto-link.ts`
- Modify: `server/api/feedback/index.post.ts`
- Modify: `server/api/public/t/[teamSlug]/[projectSlug]/feedback.post.ts`
- Modify: `server/api/support/teams/[teamId]/settings.put.ts`
- Create: `tests/integration/support-auto-link.test.ts`
- Modify: `tests/e2e/support-contact-timeline.spec.ts`

**Interfaces:**

- Produces: `createAutomaticFeedbackLink(tx,{teamId,feedbackId,authorUserId,createdAt})` returning `{ linked:boolean; contactId:string|null; reason:'disabled'|'anonymous'|'none'|'ambiguous'|'linked' }`.
- Consumes: team-admin setting enforcement from Task 3.

- [ ] **Step 1: Write failing auto-link tests**

Cover exact-one, zero, ambiguous, blocked, merged, anonymous, email-only, disabled, concurrent duplicate, and unlink behavior. A literal successful row is:

```ts
expect(link).toMatchObject({
  contactId: activeContactId,
  entityType: 'feedback',
  entityId: feedbackId,
  source: 'auto',
  createdByUserId: null,
})
```

Run: `yarn vitest run -c vitest.integration.config.ts tests/integration/support-auto-link.test.ts`

Expected: FAIL because write-time auto-linking does not exist.

- [ ] **Step 2: Implement transaction-local auto-linking in both feedback routes**

Select active same-team contacts by exact `userId`, limit to two rows to detect ambiguity, and insert the link in the same transaction as feedback and vote. Convert the public feedback route to one transaction. Do not call this helper for anonymous submissions or `merge-anonymous`.

- [ ] **Step 3: Add and run browser auto-link coverage**

Exercise authenticated auto-link, no link for an email-only or anonymous submission, an `Automatically linked` label, and unlinking an automatic link.

Run prerequisite guard (PowerShell): `$env:PLAYWRIGHT_FORCE='1'; yarn test:e2e:if-available`. Continue only when its output confirms Playwright ran; otherwise record the skip and keep the task open.

Then run focused: `$env:PLAYWRIGHT_FORCE='1'; yarn test:e2e:worktree -- tests/e2e/support-contact-timeline.spec.ts --workers=1`

- [ ] **Step 4: Run task gates and commit exact files**

Run: `yarn typecheck && yarn lint && yarn harness:verify`

```powershell
git add -- server/utils/support-auto-link.ts server/api/feedback/index.post.ts 'server/api/public/t/[teamSlug]/[projectSlug]/feedback.post.ts' 'server/api/support/teams/[teamId]/settings.put.ts' tests/integration/support-auto-link.test.ts tests/e2e/support-contact-timeline.spec.ts
git diff --cached --name-status
git commit -m "feat(support): auto-link authenticated feedback"
```

---

### Task 6: Paginate both contact timeline sections independently

**Files:**

- Modify: `server/utils/list-cursor.ts`
- Modify: `server/utils/support-timeline.ts`
- Modify: `server/api/support/contacts/[id]/timeline.get.ts`
- Modify: `pages/support/contacts/[id].vue`
- Modify: `components/support/SupportContactPanel.vue`
- Modify: `pages/support/index.vue`
- Modify: `tests/contact-cursor.test.ts`
- Modify: `tests/support-timeline.test.ts`
- Create: `tests/integration/support-timeline-pagination.test.ts`
- Modify: `tests/e2e/support-contact-timeline.spec.ts`

**Interfaces:**

- Produces: version-1 opaque cursors from `encodeListCursor` and strict validation in `decodeListCursor`.
- Timeline query consumes independent `linkedCursor` and `probableCursor` and returns independent arrays/has-more/next-cursor fields.

- [ ] **Step 1: Write failing cursor and pagination tests**

Assert a cursor round trip equals a literal versioned object and wrong versions throw a 400. In Postgres, create equal-millisecond rows and verify deterministic descending ID tie-breaks, independent cursors, a maximum limit of 100, and exclusion of every already-linked feedback row—not merely links loaded on the current page.

Run: `yarn vitest run tests/contact-cursor.test.ts tests/support-timeline.test.ts`

Run: `yarn vitest run -c vitest.integration.config.ts tests/integration/support-timeline-pagination.test.ts`

Expected: FAIL because the current timeline is unbounded and the shared cursor is unversioned.

- [ ] **Step 2: Implement the versioned cursor and bounded SQL**

Use a payload shaped exactly as:

```ts
type ListCursorV1 = { v: 1; createdAt: string; id: string }
```

Query `limit + 1` rows ordered by `desc(createdAt), desc(id)`, apply tuple predicates for each independent cursor, and calculate each `hasMore`/`nextCursor` separately.

- [ ] **Step 3: Update both contact timeline surfaces**

Keep separate arrays, cursors, loading flags, and Load more buttons. Display `Automatically linked` when `source === 'auto'`. After link or unlink, reset and refetch both first pages so the row moves immediately between sections.

- [ ] **Step 4: Add and run browser coverage**

Exercise a manually linked email suggestion and both Load more controls independently. Linking or unlinking refetches the affected first page.

Run prerequisite guard (PowerShell): `$env:PLAYWRIGHT_FORCE='1'; yarn test:e2e:if-available`. Continue only when its output confirms Playwright ran; otherwise record the skip and keep the task open.

Then run focused: `$env:PLAYWRIGHT_FORCE='1'; yarn test:e2e:worktree -- tests/e2e/support-contact-timeline.spec.ts --workers=1`

- [ ] **Step 5: Run task gates and commit exact files**

Run: `yarn typecheck && yarn lint && yarn harness:verify`

```powershell
git add -- server/utils/list-cursor.ts server/utils/support-timeline.ts 'server/api/support/contacts/[id]/timeline.get.ts' 'pages/support/contacts/[id].vue' components/support/SupportContactPanel.vue pages/support/index.vue tests/contact-cursor.test.ts tests/support-timeline.test.ts tests/integration/support-timeline-pagination.test.ts tests/e2e/support-contact-timeline.spec.ts
git diff --cached --name-status
git commit -m "feat(support): bound contact timelines"
```

---

### Task 7: Create server-owned attachment upload sessions

**Files:**

- Modify: `server/utils/storage/types.ts`
- Modify: `server/utils/storage/provider-local.ts`
- Modify: `server/utils/storage/provider-s3.ts`
- Modify: `server/utils/support-attachments.ts`
- Modify: `server/api/support/attachments/presign.post.ts`
- Modify: `server/api/support/attachments/upload/[token].put.ts`
- Create: `server/api/support/attachments/[uploadId]/complete.post.ts`
- Modify: `tests/support-attachments.test.ts`
- Create: `tests/storage-provider-contract.test.ts`
- Create: `tests/support-attachment-routes.test.ts`

**Interfaces:**

- Produces: `StorageObjectMetadata { sizeBytes:number; contentType:string|null; objectVersion:string }`.
- Produces: `StorageProvider.headObject(key)` and `copyObject(sourceKey,destinationKey,{contentType,ifMatch})`.
- Produces: `StorageProvider.directUploadConstraints: 'content-length-enforced' | 'proxy-required'`.
- Presign returns `uploadId`, `uploadUrl`, `method`, `headers`, `expiresAt`, `fileName`, and `contentType`; it never returns a storage key.
- Local upload token identifies an upload row, not an object key, and is single-use.

- [ ] **Step 1: Write failing provider-contract tests**

Use a temporary local storage root and assert:

```ts
expect(await storage.headObject(tempKey)).toEqual({
  sizeBytes: 4,
  contentType: null,
  objectVersion: sha256OfFourBytes,
})
await expect(
  storage.copyObject(tempKey, finalKey, { contentType: 'application/pdf', ifMatch: 'wrong-version' })
).rejects.toMatchObject({ code: 'OBJECT_VERSION_MISMATCH' })
```

For S3, inject `S3Client.send` and assert `HeadObjectCommand` plus conditional `CopyObjectCommand` inputs. If the configured S3-compatible target cannot enforce a signed length constraint, assert presign chooses the application upload endpoint instead of direct S3.

Run: `yarn vitest run tests/storage-provider-contract.test.ts`

Expected: FAIL because metadata/copy contracts do not exist.

- [ ] **Step 2: Extend both storage providers**

```ts
export interface StorageObjectMetadata {
  sizeBytes: number
  contentType: string | null
  objectVersion: string
}
export interface CopyObjectOptions {
  contentType: string
  ifMatch: string
}
export interface StorageProvider {
  readonly directUploadConstraints: 'content-length-enforced' | 'proxy-required'
  headObject(key: string): Promise<StorageObjectMetadata>
  copyObject(sourceKey: string, destinationKey: string, options: CopyObjectOptions): Promise<StorageObjectMetadata>
}
```

Local object versions are SHA-256 values. S3 uses version ID when available, otherwise a normalized ETag. Conditional copy must fail closed on a changed source.

- [ ] **Step 3: Write failing session/presign/completion route tests**

Cover invalid MIME, declared size above 10 MB, foreign conversation, missing authentication, absent object, actual size mismatch, oversized object, changed version, expired row, foreign owner, repeated completion of an unchanged object, and repeated local upload token use.

Run: `yarn vitest run tests/support-attachments.test.ts tests/support-attachment-routes.test.ts`

Expected: FAIL because requests still expose and trust a storage key.

- [ ] **Step 4: Implement server-owned session helpers**

```ts
export function createSupportUploadTempKey(uploadId: string, fileName: string): string
export function createSupportAttachmentFinalKey(attachmentId: string, fileName: string): string
export function signSupportUploadToken(input: { uploadId: string; expiresAt: Date }): string
export function verifySupportUploadToken(token: string): { uploadId: string; expiresAt: Date }
```

Temporary keys are `support/attachments/uploads/{uploadId}/{sanitizedFilename}`. Final keys use a new random attachment ID under the existing outbound prefix.

- [ ] **Step 5: Replace presign and bounded proxy-upload behavior**

Presign inserts a `pending` row owned by the authenticated user and conversation. When `directUploadConstraints === 'content-length-enforced'`, it returns the provider target with signed content type and expected length. When it is `proxy-required`, it returns the existing application route `/api/support/attachments/upload/{token}`. That route is the fail-closed proxy for both local and constrained-incompatible S3 providers: it locks the pending row, streams incrementally into a bounded temporary file, aborts immediately after 10 MB, then calls storage only after the cap is proven, computes/captures the object version, and atomically records `uploadedAt`, actual bytes, canonical content type, object version, and `uploaded` status. It must not call `readRawBody`.

Route tests must set both capability values and assert the exact selected URL plus an over-limit streamed request that stops consuming after the first byte beyond the ceiling.

- [ ] **Step 6: Add idempotent direct-upload completion**

The completion route verifies ownership, current conversation access, expiry, object existence, declared/actual size and MIME contracts, then records the exact version. A repeated call returns the same completed metadata only if `headObject` still matches it.

- [ ] **Step 7: Verify GREEN and commit exact files**

Run: `yarn vitest run tests/storage-provider-contract.test.ts tests/support-attachments.test.ts tests/support-attachment-routes.test.ts`

Run: `yarn typecheck && yarn lint && yarn harness:verify`

```powershell
git add -- server/utils/storage/types.ts server/utils/storage/provider-local.ts server/utils/storage/provider-s3.ts server/utils/support-attachments.ts server/api/support/attachments/presign.post.ts 'server/api/support/attachments/upload/[token].put.ts' 'server/api/support/attachments/[uploadId]/complete.post.ts' tests/storage-provider-contract.test.ts tests/support-attachments.test.ts tests/support-attachment-routes.test.ts
git diff --cached --name-status
git commit -m "feat(support): own attachment upload sessions"
```

---

### Task 8: Finalize attachment uploads into messages durably

**Files:**

- Create: `server/utils/support-attachment-finalization.ts`
- Modify: `server/api/support/conversations/[id]/messages/index.post.ts`
- Create: `tests/integration/support-attachment-finalization.test.ts`

**Interfaces:**

- Produces: `reserveAttachmentFinalization`, `commitMessageWithAttachments`, and `markAttachmentCleanupRequired`.
- Message API accepts `attachments: Array<{uploadId:string}>` only.

- [ ] **Step 1: Write failing Postgres finalization tests**

Cover duplicate IDs, wrong owner/conversation, expired/not-uploaded state, current-version mismatch, per-file and cumulative limits, durable reservation before copy, successful message/attachment/outbox atomicity, copy failure, message transaction rollback, stale finalization lease, and upload reuse only after orphan cleanup.

Key successful assertions:

```ts
expect(upload.status).toBe('consumed')
expect(upload.messageId).toBe(message.id)
expect(attachment.storageKey).toBe(upload.finalStorageKey)
expect(outbox.messageId).toBe(message.id)
expect(outbox.payload).not.toHaveProperty('bytes')
```

Run: `yarn vitest run -c vitest.integration.config.ts tests/integration/support-attachment-finalization.test.ts`

Expected: FAIL because the message route still accepts raw metadata and has no reservation state.

- [ ] **Step 2: Implement the three-phase finalization service**

1. Reservation transaction: lock all upload rows in stable ID order, write random final keys, set `finalizing`, and set a bounded lease; commit.
2. External phase: re-check `headObject`, enforce verified 10/25 MB caps, and conditionally copy every object using the recorded version.
3. Message transaction: lock the same rows, verify keys/version/lease, insert message plus canonical `conversationAttachment` rows plus outbox, then mark uploads `consumed` with `messageId` and `consumedAt`.

On any external or message failure, a separate short transaction moves every reserved row to `cleanup_required`. The durable final key is never cleared until cleanup deletes it.

- [ ] **Step 3: Verify GREEN and commit exact files**

Run: `yarn vitest run -c vitest.integration.config.ts tests/integration/support-attachment-finalization.test.ts`

Run: `yarn typecheck && yarn lint && yarn harness:verify`

```powershell
git add -- server/utils/support-attachment-finalization.ts 'server/api/support/conversations/[id]/messages/index.post.ts' tests/integration/support-attachment-finalization.test.ts
git diff --cached --name-status
git commit -m "feat(support): finalize attachment messages"
```

---

### Task 9: Recover orphaned uploads and harden downloads

**Files:**

- Create: `server/utils/support-attachment-cleanup.ts`
- Modify: `server/api/support/conversations/[id]/messages/index.get.ts`
- Modify: `server/api/support/attachments/[id].get.ts`
- Modify: `server/utils/outbound-delivery.ts`
- Create: `server/services/scheduler/tasks/attachment-cleanup.ts`
- Create: `server/tasks/support/attachment-cleanup.ts`
- Create: `server/api/cron/support-attachment-cleanup.get.ts`
- Modify: `nuxt.config.ts`
- Modify: `vercel.json`
- Create: `tests/integration/support-attachment-cleanup.test.ts`
- Modify: `tests/outbound-delivery.test.ts`

**Interfaces:**

- Produces: `runAttachmentCleanup` with explicit claim, transition, deletion, and retry outcomes.
- Message GET returns finalized attachment metadata `{id,fileName,contentType,sizeBytes,downloadUrl}`.

- [ ] **Step 1: Write failing cleanup tests**

Assert bounded claiming without double ownership; expiration of pending/uploaded rows; stale finalizing transition; deletion of final orphans; retry after deletion failure; cleanup of consumed temporary objects; and a retryable 409 when Send encounters `cleanup_required`. A failed deletion must increment `cleanupAttemptCount` and retain the key/state for another claim. After successful final-orphan deletion, clear `finalStorageKey` and transition an unexpired row to `uploaded` or an expired row to `expired`; never clear the key before deletion succeeds.

Run: `yarn vitest run -c vitest.integration.config.ts tests/integration/support-attachment-cleanup.test.ts`

- [ ] **Step 2: Implement and schedule cleanup**

Use claim/lease semantics and a default bounded batch. `cleanup_required` rows stay unavailable to Send until final deletion succeeds; successful deletion clears the final key and returns the session to `uploaded` only when unexpired, otherwise `expired`. Register `support:attachment-cleanup` in Nitro scheduled tasks and add an authenticated cron endpoint plus Vercel schedule. Log claimed/deleted/expired/retried counts without keys or filenames.

- [ ] **Step 3: Update downloads and worker defense-in-depth**

Keep conversation authorization. Set `Content-Disposition: attachment; filename="..."` and `X-Content-Type-Options: nosniff`. Before buffering outbound attachments, sum canonical row sizes and reject any payload above 25 MB.

- [ ] **Step 4: Verify GREEN and commit exact files**

Run: `yarn vitest run -c vitest.integration.config.ts tests/integration/support-attachment-cleanup.test.ts`

Run: `yarn vitest run tests/outbound-delivery.test.ts`

Run: `yarn typecheck && yarn lint && yarn harness:verify`

```powershell
git add -- server/utils/support-attachment-cleanup.ts 'server/api/support/conversations/[id]/messages/index.get.ts' 'server/api/support/attachments/[id].get.ts' server/utils/outbound-delivery.ts server/services/scheduler/tasks/attachment-cleanup.ts server/tasks/support/attachment-cleanup.ts server/api/cron/support-attachment-cleanup.get.ts nuxt.config.ts vercel.json tests/integration/support-attachment-cleanup.test.ts tests/outbound-delivery.test.ts
git diff --cached --name-status
git commit -m "feat(support): clean attachment upload sessions"
```

---

### Task 10: Show upload progress and persisted attachments in conversations

**Files:**

- Modify: `components/support/SupportComposer.vue`
- Modify: `components/support/SupportMessageItem.vue`
- Modify: `tests/e2e/support-outbound-reply.spec.ts`

**Interfaces:**

- Consumes: upload session APIs from Task 7, finalization from Task 8, and attachment message payloads from Task 9.
- Produces: per-file progress, expiry blocking, and named downloadable attachment chips.

- [ ] **Step 1: Write failing browser/API attachment flow**

Exercise select, upload progress, direct-completion when applicable, send, persisted downloadable chip, outbound payload, expired upload guidance, and rejection of a legacy `{storageKey:...}` request. The exact blocked-send copy is `This attachment expired. Remove it and upload the file again.`

- [ ] **Step 2: Implement composer and message attachment UX**

The composer stores upload IDs and per-file state only. Disable Send while uploading/completing or after expiry. After send, render named downloadable attachment chips in `SupportMessageItem.vue` so the agent sees what persisted.

- [ ] **Step 3: Verify GREEN and commit exact files**

Run prerequisite guard (PowerShell): `$env:PLAYWRIGHT_FORCE='1'; yarn test:e2e:if-available`. Continue only when its output confirms Playwright ran; otherwise record the skip and keep the task open.

Then run focused: `$env:PLAYWRIGHT_FORCE='1'; yarn test:e2e:worktree -- tests/e2e/support-outbound-reply.spec.ts --workers=1`

Run: `yarn typecheck && yarn lint && yarn harness:verify`

```powershell
git add -- components/support/SupportComposer.vue components/support/SupportMessageItem.vue tests/e2e/support-outbound-reply.spec.ts
git diff --cached --name-status
git commit -m "feat(support): show persisted attachments"
```

---

### Task 11: Scope RFC threading identity to the receiving inbox

**Files:**

- Modify: `server/utils/inbound-threading.ts`
- Modify: `server/api/support/inbound/[provider].post.ts`
- Modify: `tests/inbound-threading.test.ts`
- Modify: `tests/integration/inbound-threading.test.ts`
- Modify: `tests/e2e/support-inbound-email.spec.ts`

**Interfaces:**

- Extends the existing `ThreadResolution.matchedBy` union to `'message-id' | 'thread-key' | 'subject' | 'ambiguous-message-id' | null`; all existing consumers keep the `matchedBy` property name.
- `ambiguous-message-id` always returns `conversationId: null` and prevents both thread-key and subject fallback for that inbound message.
- Header lookup joins `conversationMessage` to `conversation`, filters by receiving `inboxId`, and reads at most two matches to detect ambiguity.

- [ ] **Step 1: Write failing inbox-scope and ambiguity tests**

Insert the same bracketless RFC ID in two inboxes and prove each inbound message resolves only inside its receiving inbox. Insert two matching messages inside one inbox and assert:

```ts
expect(result).toMatchObject({ matchedBy: 'ambiguous-message-id', conversationId: null })
```

Run: `yarn vitest run tests/inbound-threading.test.ts`

Run: `yarn vitest run -c vitest.integration.config.ts tests/integration/inbound-threading.test.ts`

Expected: FAIL because same-inbox collisions currently select one row.

- [ ] **Step 2: Implement scoped lookup and collision outcome**

Never query `channelMessageId` without joining to `conversation` and filtering `conversation.inboxId`. A two-row result is ambiguous even if both rows happen to belong to the same conversation; uncertainty creates a new conversation rather than guessing.

- [ ] **Step 3: Surface safe collision diagnostics in inbound processing**

On `ambiguous-message-id`, create a new conversation and store this exact shape in `conversation.metadata`: `{ threadingCollision: { type: 'ambiguous-message-id', headerMessageId: normalizedId, occurredAt: now.toISOString() } }`. Log provider, inbox ID, normalized header ID, and new conversation ID without subject/body/customer fields. Assert both persisted metadata and sanitized log fields. Preserve bracketless storage.

- [ ] **Step 4: Add browser/API inbound acceptance cases**

Extend the existing spec for cross-team duplicate RFC IDs and same-inbox ambiguity creating a new conversation. Re-run serially.

- [ ] **Step 5: Verify and commit exact files**

Run prerequisite guard (PowerShell): `$env:PLAYWRIGHT_FORCE='1'; yarn test:e2e:if-available`. Continue only when its output confirms Playwright ran; otherwise record the skip and keep the task open.

Then run focused: `$env:PLAYWRIGHT_FORCE='1'; yarn test:e2e:worktree -- tests/e2e/support-inbound-email.spec.ts --workers=1`

Run: `yarn typecheck && yarn lint && yarn harness:verify`

```powershell
git add -- server/utils/inbound-threading.ts 'server/api/support/inbound/[provider].post.ts' tests/inbound-threading.test.ts tests/integration/inbound-threading.test.ts tests/e2e/support-inbound-email.spec.ts
git diff --cached --name-status
git commit -m "fix(support): scope email threading to inboxes"
```

---

### Task 12: Correlate provider delivery events through outbox metadata

**Files:**

- Modify: `server/services/support-channels/types.ts`
- Modify: `server/services/support-channels/webhook/postmark.ts`
- Modify: `server/services/support-channels/webhook/mailgun.ts`
- Modify: `lib/email.ts`
- Modify: `server/utils/outbound-reply.ts`
- Modify: `server/utils/outbound-delivery.ts`
- Modify: `server/utils/delivery-events.ts`
- Modify: `server/api/support/delivery/[provider].post.ts`
- Modify: `server/api/support/channel-status.get.ts`
- Modify: `tests/support-channels-delivery.test.ts`
- Modify: `tests/support-channels-outbound.test.ts`
- Modify: `tests/email-options.test.ts`
- Modify: `tests/outbound-delivery.test.ts`
- Create: `tests/delivery-route-control.test.ts`
- Modify: `tests/integration/delivery-events.test.ts`

**Interfaces:**

- Replaces `DeliveryEvent.messageId` with `providerEventId`, `providerAccountKey`, `correlationKey`, `providerMessageId`, `recipient`, `recordType`, `occurredAt: Date`, `error`, `bounceType: 'hard' | 'soft' | null`, and `description: string | null`.
- Persists `occurredAt` into `supportDeliveryEvent.occurredAt`; `createdAt` remains local receipt time.
- Produces: `ChannelDriver.buildDeliveryCorrelationHeaders(correlationKey)`.
- Outbound transport returns `{ accepted:boolean; providerMessageId?:string; response:string }`.
- Primary resolution is globally unique outbox `idempotencyKey === correlationKey`; fallback is an exact single match on `(provider,providerAccountKey,providerMessageId,recipient)`.

- [ ] **Step 1: Write failing provider metadata tests**

Assert exact outgoing headers:

```ts
expect(postmark.buildDeliveryCorrelationHeaders('delivery-1')).toEqual({
  'X-PM-KeepID': 'true',
  'X-PM-Metadata-veerify-delivery-id': 'delivery-1',
})
expect(JSON.parse(mailgunHeaders['X-Mailgun-Variables'])).toEqual({
  'veerify-delivery-id': 'delivery-1',
})
```

Parse fixtures with metadata, trace/event IDs, account/server identity, multiple recipients, timestamps, hard/soft bounce fields, and missing provider event IDs. Hand-derived fallback keys must include provider message ID, recipient, record type, and timestamp. Assert the normalized `occurredAt` is recorded separately from local receipt time.

Run: `yarn vitest run tests/support-channels-delivery.test.ts tests/support-channels-outbound.test.ts tests/email-options.test.ts`

Expected: FAIL because drivers expose no correlation-header API and normalized events still claim RFC identity.

- [ ] **Step 2: Implement the provider contracts**

Use non-secret configured account keys as a fallback only when the verified webhook payload does not expose stable server/domain identity. Extend the inbox-scoped channel status from Task 3 so a missing required account key is an explicit configuration error, not a shared global account.

- [ ] **Step 3: Add failing outbox correlation route tests**

Cover primary correlation, exact provider-ID fallback, ambiguous fallback, valid uncorrelated event, duplicate event in two provider accounts, and a malicious provider ID equal to another conversation's RFC Message-ID. The last case must remain uncorrelated.

Run: `yarn vitest run tests/delivery-route-control.test.ts`

Expected: FAIL because the route currently queries `conversationMessage.channelMessageId`.

- [ ] **Step 4: Persist send diagnostics and correlate through the outbox**

At claim/send time, derive metadata from the existing stable `idempotencyKey`, so legacy queued rows need no payload rewrite. Store `provider`, `providerAccountKey`, and a documented provider message ID when the transport exposes one. Do not treat Nodemailer's RFC `messageId` as a provider ID by default.

- [ ] **Step 5: Update delivery-event claiming and status application**

Claim events with `(provider,providerAccountKey,providerEventId)`, persist `correlationKey`, and resolve the exact local outbox/message before changing delivery status. Record and acknowledge valid uncorrelated events. Log identity and correlation results without message content or credentials.

- [ ] **Step 6: Prove concurrent terminal-state behavior**

Extend Postgres integration tests to run duplicate claims concurrently and delivered/bounced events in both arrival orders. Final state must be `bounced` with exactly one bounce activity.

Run: `yarn vitest run -c vitest.integration.config.ts tests/integration/delivery-events.test.ts`

- [ ] **Step 7: Prove legacy queued rows remain deliverable**

In `tests/integration/outbound-delivery.test.ts`, insert an existing-style queued outbox row whose JSON contains only legacy recipient/body/attachment references and whose new provider columns are null. Claim it, derive provider metadata from its existing `idempotencyKey`, load the existing `conversationAttachment`, and assert successful send plus provider diagnostics without rewriting the stored payload.

- [ ] **Step 8: Verify and commit exact files**

Run: `yarn typecheck && yarn lint && yarn harness:verify`

```powershell
git add -- server/services/support-channels/types.ts server/services/support-channels/webhook/postmark.ts server/services/support-channels/webhook/mailgun.ts lib/email.ts server/utils/outbound-reply.ts server/utils/outbound-delivery.ts server/utils/delivery-events.ts 'server/api/support/delivery/[provider].post.ts' server/api/support/channel-status.get.ts tests/support-channels-delivery.test.ts tests/support-channels-outbound.test.ts tests/email-options.test.ts tests/outbound-delivery.test.ts tests/delivery-route-control.test.ts tests/integration/delivery-events.test.ts tests/integration/outbound-delivery.test.ts
git diff --cached --name-status
git commit -m "feat(support): correlate provider delivery metadata"
```

---

### Task 13: Schedule retries safely and explain duplicate risk

**Files:**

- Modify: `server/utils/outbound-delivery.ts`
- Modify: `server/services/scheduler/tasks/outbound-delivery.ts`
- Modify: `server/api/support/conversations/[id]/messages/[messageId]/retry.post.ts`
- Modify: `components/support/SupportMessageItem.vue`
- Modify: `tests/outbound-delivery.test.ts`
- Modify: `tests/outbound-delivery-scheduler.test.ts`
- Modify: `tests/integration/outbound-delivery.test.ts`
- Modify: `tests/e2e/support-outbound-reply.spec.ts`

**Interfaces:**

- Produces: `computeNextAttemptAt(attemptCount,now,random)` using `min(60 seconds * 2^(attemptCount-1), 15 minutes)` with multiplier jitter in `[0.8,1.2]`.
- Claims only `pending` rows where `nextAttemptAt <= now` and obtains attempt-scoped lease ownership.
- `failOutboundDelivery(deliveryId,messageId,error,attemptCount,deps?)` accepts optional `{ now?: Date; random?: () => number }`; completion/failure return `boolean` and mutate only if claimed attempt ownership still matches.

- [ ] **Step 1: Write failing deterministic retry tests**

Inject a fixed clock and random value. Assert increasing due times remain inside documented jitter bounds, five attempts maximum, the same worker pass cannot reclaim a just-failed row, and stable RFC/correlation identities are reused.

```ts
expect(await claimNextOutboundDelivery({ now: beforeDue })).toBeNull()
expect((await claimNextOutboundDelivery({ now: exactlyDue }))?.attemptCount).toBe(2)
expect(await failOutboundDelivery(deliveryId, messageId, error, 1, { now, random: () => 0.5 })).toBe(false)
```

Run: `yarn vitest run tests/outbound-delivery.test.ts tests/outbound-delivery-scheduler.test.ts`

Expected: FAIL because failure currently clears the lease and immediately requeues the row.

- [ ] **Step 2: Implement due-time claims and attempt ownership**

Use exponential delays based on the failed attempt with bounded jitter and a maximum delay appropriate to five attempts. Persist `nextAttemptAt`; never sleep inside the worker. Set final failed state only after the fifth failed owned attempt.

- [ ] **Step 3: Add real-concurrency tests**

Claim from concurrent workers, prove only one owns the row, prove stale completion/failure cannot mutate a newer claim, and prove the first worker pass processes a retryable row at most once.

Run: `yarn vitest run -c vitest.integration.config.ts tests/integration/outbound-delivery.test.ts`

- [ ] **Step 4: Add the manual retry warning contract**

The retry endpoint returns whether a previous submission attempt occurred. Before calling it for a failed message, the UI requires confirmation with exact copy:

`The previous attempt may already have been accepted. Retrying could send a duplicate.`

Cancel leaves the message failed; confirm resets it to due-now pending without changing RFC or correlation IDs.

- [ ] **Step 5: Verify browser behavior and commit exact files**

Run prerequisite guard (PowerShell): `$env:PLAYWRIGHT_FORCE='1'; yarn test:e2e:if-available`. Continue only when its output confirms Playwright ran; otherwise record the skip and keep the task open.

Then run focused: `$env:PLAYWRIGHT_FORCE='1'; yarn test:e2e:worktree -- tests/e2e/support-outbound-reply.spec.ts --workers=1`

Run: `yarn typecheck && yarn lint && yarn harness:verify`

```powershell
git add -- server/utils/outbound-delivery.ts server/services/scheduler/tasks/outbound-delivery.ts 'server/api/support/conversations/[id]/messages/[messageId]/retry.post.ts' components/support/SupportMessageItem.vue tests/outbound-delivery.test.ts tests/outbound-delivery-scheduler.test.ts tests/integration/outbound-delivery.test.ts tests/e2e/support-outbound-reply.spec.ts
git diff --cached --name-status
git commit -m "fix(support): schedule bounded outbound retries"
```

---

### Task 14: Make build and deployment operations explicit

**Files:**

- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `Dockerfile`
- Modify: `README.md`
- Modify: `scripts/seed.ts` comments only where they describe build behavior
- Create: `scripts/profile-build.mjs`
- Modify: `nuxt.config.ts`
- Create: `tests/build-lifecycle.test.ts`

**Interfaces:**

- `yarn build` compiles only and never runs migration or seed commands.
- `yarn db:migrate:deploy` is the explicit deployment migration command.
- `yarn vercel-build` explicitly runs deployment migration then compilation.
- `scripts/profile-build.mjs` reports phase timings, exit code, and peak RSS without modifying tracked files.

- [ ] **Step 1: Write the failing build-lifecycle behavior test**

Run package scripts in a controlled child-process fixture with fake `drizzle-kit`, `tsx`, and `nuxt` executables that append their names to a log. Assert `yarn build` logs only `nuxt`, while `yarn vercel-build` logs `drizzle-kit` before `nuxt` and never logs the seed executable.

Run: `yarn vitest run tests/build-lifecycle.test.ts`

Expected: FAIL because `postbuild` currently migrates and seeds after every build.

- [ ] **Step 2: Remove implicit mutation and update deployment callers**

Delete `postbuild`. Add `db:migrate:deploy`, keep development/test seeding explicit, and update CI/Docker/README to call the intended operation in visible order. No build or package install hook may seed a database.

- [ ] **Step 3: Add reproducible build profiling**

The profiler launches `yarn nuxt build`, samples RSS for the process tree, records cold/warm cache timings, and prints the last observed build phase and exit code. Add `buildDir: process.env.NUXT_BUILD_DIR || '.nuxt'` to Nuxt config. Cold mode creates a unique OS temporary directory with `mkdtemp`, verifies the resolved path is inside the OS temp root, passes it as `NUXT_BUILD_DIR`, and removes only that validated temporary directory in `finally`. Warm mode reuses one profiler-owned temporary build directory for two builds. Neither mode touches the developer's normal `.nuxt` or commits `.output`.

Run: `node scripts/profile-build.mjs --cold`

Run: `node scripts/profile-build.mjs --warm`

Run: `yarn build`

- [ ] **Step 4: Verify and commit exact files**

Run: `yarn vitest run tests/build-lifecycle.test.ts`

Run: `yarn typecheck && yarn lint && yarn harness:verify`

```powershell
git add -- package.json .github/workflows/ci.yml Dockerfile README.md scripts/seed.ts scripts/profile-build.mjs nuxt.config.ts tests/build-lifecycle.test.ts
git diff --cached --name-status
git commit -m "chore(build): make database operations explicit"
```

---

### Task 15: Prove realtime behavior across two application processes

**Files:**

- Modify: `server/services/realtime/drivers/redis.ts` only if the failing test exposes a production defect
- Create: `tests/integration/realtime-two-process.test.ts`

**Interfaces:**

- Consumes: the existing identifier-only realtime envelope and authorized WebSocket subscription contract.
- Produces: cross-process proof for `message.created`, `message.delivery-status`, and reconnect restoration.

- [ ] **Step 1: Write the failing two-process realtime test**

Launch two independent worktree app processes on distinct ports with one shared Redis URL and configured Postgres. Connect one WebSocket client to each, subscribe to the same authorized conversation, mutate through instance A, and assert instance B receives both `message.created` and `message.delivery-status`. Drop and restore the Redis subscriber connection and prove the subscription resumes.

Run: `yarn vitest run -c vitest.integration.config.ts tests/integration/realtime-two-process.test.ts`

Expected: FAIL if process-local assumptions or missing test hooks prevent real cross-process delivery.

- [ ] **Step 2: Verify or correct reconnect behavior at the Redis driver boundary**

Keep envelopes identifier-only and authorization server-side. The existing `server/services/realtime/drivers/redis.ts` `ready` handler must re-subscribe every channel in its handler map after reconnect. If the two-process test passes unchanged, retain it as evidence and record that memory mode remains single-instance; if it fails at reconnect, correct that handler and re-run the same failing test before proceeding.

- [ ] **Step 3: Run integration gates and commit exact files**

Run: `yarn test:integration:if-available`

Run: `yarn vitest run -c vitest.integration.config.ts tests/integration/realtime-two-process.test.ts`

Run: `yarn typecheck && yarn lint && yarn harness:verify`

```powershell
git add -- tests/integration/realtime-two-process.test.ts
if (Test-Path server/services/realtime/drivers/redis.ts) { git add -- server/services/realtime/drivers/redis.ts }
git diff --cached --name-status
git commit -m "test(support): prove multi-instance realtime"
```

---

### Task 16: Add support observability and complete verification records

**Files:**

- Create: `server/utils/support-observability.ts`
- Modify: `server/utils/outbound-delivery.ts`
- Modify: `server/utils/delivery-status.ts`
- Modify: `server/api/support/delivery/[provider].post.ts`
- Modify: `server/utils/support-attachment-cleanup.ts`
- Create: `tests/support-observability.test.ts`
- Create: `docs/plans/2026-08-11-support-platform/stage-01-04-provider-checklist.md`
- Modify: `docs/plans/2026-08-11-support-platform/README.md`

**Interfaces:**

- Produces: structured log-based counters with a closed metric-name and safe-field contract.
- Produces: a provider-only validation record kept separate from automated results.

- [ ] **Step 1: Add stable structured support metrics**

Define a typed `recordSupportMetric(name, fields)` boundary that emits structured log records suitable for log-based counters. Cover these literal names: `support.delivery.queued`, `.sent`, `.delivered`, `.failed`, `.bounced`, `support.delivery.uncorrelated`, `support.attachment.expired`, and `support.attachment.cleanup_failed`. Unit tests assert invalid names and content-bearing fields are rejected; integration points pass IDs/status/counts only, never message content, filenames, storage keys, or credentials.

Run: `yarn vitest run tests/support-observability.test.ts`

- [ ] **Step 2: Write the separate manual provider checklist**

Include Gmail/Outlook reply threading; Postmark preserved RFC ID, metadata, trace IDs, delivery and bounce; Mailgun metadata, delivery and permanent failure; multiple recipients; S3 size enforcement and temporary-prefix lifecycle. Each row records prerequisite, action, expected evidence, actual result, and status `pending | passed | failed | unavailable`.

- [ ] **Step 3: Run the complete verification matrix**

Run:

```powershell
yarn harness:docs
yarn typecheck
yarn test
yarn lint
yarn test:integration:if-available
yarn test:integration:postgres:if-available
yarn test:e2e:if-available
$env:PLAYWRIGHT_FORCE='1'; yarn test:e2e:worktree -- --workers=1 # only after the configured database and webhook prerequisites pass
yarn build
git diff --check
```

Report exact pass counts, every guarded skip reason, build profile evidence, and the separate manual-provider status.

- [ ] **Step 4: Commit exact files**

```powershell
git add -- server/utils/support-observability.ts tests/support-observability.test.ts docs/plans/2026-08-11-support-platform/stage-01-04-provider-checklist.md docs/plans/2026-08-11-support-platform/README.md
git add -- server/utils/outbound-delivery.ts server/utils/delivery-status.ts 'server/api/support/delivery/[provider].post.ts' server/utils/support-attachment-cleanup.ts
git diff --cached --name-status
git commit -m "chore(support): record hardening observability"
```

---

## Final Review Gate

After all sixteen tasks:

1. Resolve and ledger `MERGE_BASE=$(git merge-base support-platform HEAD)` before Task 1. At the end run `/c/Users/ananords/.codex/plugins/cache/claude-plugins-official/superpowers/6.3.0/skills/subagent-driven-development/scripts/review-package docs/plans/2026-08-11-support-platform/stage-01-04-hardening-implementation.md "$MERGE_BASE" HEAD` under Git Bash and retain the printed package path.
2. The controller calls `collaboration.spawn_agent` with `model: 'gpt-5.6-luna'`, `reasoning_effort: 'high'`, `fork_turns: 'none'`, and a read-only whole-branch review prompt containing that package path, this plan path, the approved spec path, and every deferred-minor/ruling line from the SDD ledger.
3. Fix every Critical or Important finding in one reviewed fix wave.
4. Re-run the complete verification matrix.
5. Use `superpowers:finishing-a-development-branch` and present integration options; do not merge or push without explicit user approval.
