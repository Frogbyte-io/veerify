# Stage 02 — Inbox + conversation core

**Depends on:** Stages 00, 01. **Blocks:** Stages 03, 05, 06, 07, 09, 10, 11, 13.
**Read `design.md` first.**

**Goal:** The inbox entity, the conversation model, and the full Chatwoot-style agent UI — working
end to end **without any mail pipeline**. Conversations are created manually by agents in this stage,
which lets the entire interface be built and tested before email lands in Stage 03.

## Scope

**In:** all conversation tables, `support-access.ts`, conversation CRUD, realtime wiring, the `/support`
agent UI, internal notes, activity messages, navigation, and the product Support tab.

**Out:** inbound email, outbound email, assignment automation, SLA, macros, search beyond a simple
filter. Replies in this stage are stored, not sent — Stage 04 sends them.

## Work

### 1. Schema

Add to `server/database/schema/support.ts`, per `design.md` → Data model → Stage 02: `supportInbox`,
`supportInboxAddress`, `supportInboxMember`, `conversation`, `supportCounter`, `conversationMessage`,
`conversationAttachment`, `conversationParticipant`, `supportTag`, `conversationTag`,
`supportEmailEvent`.

`supportEmailEvent` is created here even though Stage 03 is its first writer — it keeps the inbound
pipeline from needing a migration mid-stage. The same applies to `supportInboxAddress`: Stage 03 is its
first reader, but it is created here so mail intake needs no migration.

**Multi-address inboxes (delta D-27).** One team inbox serves every product, so the receiving address is
the only product signal an email carries. `supportInboxAddress` holds `id`, `inboxId` (FK cascade),
`address` (unique), `projectId` (FK project, set null — null means unattributed), `isPrimary`,
`createdAt`. Teams want several addresses per inbox: one per product, plus general team addresses.
`supportInbox.emailAddress` remains the primary _sending_ identity; `supportInboxAddress` governs what
the inbox _receives_.

`conversation` gains a nullable `projectId` (FK project, set null) for the resolved product.

**`displayId` allocation.** A `supportCounter` row per team, incremented with `SELECT … FOR UPDATE`
inside the same transaction as the conversation insert. Not a sequence, because the number must be
per-team and gap-free enough to read as a ticket number. Concurrency is an acceptance criterion, not an
afterthought.

### 2. Access utilities

Extend `server/utils/support-access.ts`:

- `requireInboxAccess(inboxId, userId)` — 404 if not found, 403 unless the user is a
  `supportInboxMember` **or** a member of the inbox's team with an admin role.
- `requireConversationAccess(conversationId, userId)` — resolves through the inbox.
- `resolveInboxByAddress(emailAddress)` — used by Stage 03; returns the inbox or null.

**`teamMember.role` semantics are not changed.** Support permissions live on `supportInboxMember.role`
(`agent` | `supervisor` | `admin`).

### 3. API

| Route                                          | Method          | Notes                                                                      |
| ---------------------------------------------- | --------------- | -------------------------------------------------------------------------- |
| `/api/support/inboxes`                         | GET/POST        | Team-scoped list and create                                                |
| `/api/support/inboxes/[id]`                    | GET/PUT/DELETE  | Detail, settings, delete                                                   |
| `/api/support/inboxes/[id]/addresses`          | GET/POST/DELETE | Receiving addresses and their optional product mapping                     |
| `/api/support/inboxes/[id]/members`            | GET/POST/DELETE | Agent membership                                                           |
| `/api/support/conversations`                   | GET             | Filter by inbox, status, assignee, tag, contact, product; cursor-paginated |
| `/api/support/conversations`                   | POST            | Manual creation — the Stage 02 entry point                                 |
| `/api/support/conversations/[id]`              | GET             | Detail with contact and participants                                       |
| `/api/support/conversations/[id]`              | PATCH           | Status, priority, assignee, subject, product                               |
| `/api/support/conversations/[id]/messages`     | GET/POST        | Thread; `POST` accepts `kind` of `outgoing` or `note`                      |
| `/api/support/conversations/[id]/participants` | POST/DELETE     | CC and followers                                                           |
| `/api/support/conversations/[id]/tags`         | POST/DELETE     | Tag assignment                                                             |
| `/api/support/tags`                            | GET/POST/DELETE | Team tag management                                                        |

**Activity messages.** Every mutation through `PATCH /conversations/[id]` that changes status, priority,
or assignee also writes a `conversationMessage` with `kind: 'activity'` describing the change. This is
what renders the Chatwoot-style inline event feed from one ordered query. Do not build a separate
audit table.

**Realtime.** Every write publishes a thin envelope on `conversation:<id>` and `inbox:<id>`:
`{ v: 1, type: 'conversation.updated' | 'message.created' | …, teamId, inboxId, conversationId, messageId }`.
No record contents. Clients refetch.

### 4. UI — `/support`

Three-pane Chatwoot-style layout:

- **Left** — inbox switcher and filters (status, assignee, tag).
- **Middle** — conversation list: contact name, subject, snippet, status, assignee, relative time.
  Live-updating from `inbox:<id>`.
- **Right** — the thread. Messages ordered by `createdAt`, rendered by `kind`:
  - `incoming` — customer, left-aligned
  - `outgoing` — agent, right-aligned
  - `note` — visually distinct internal note (Chatwoot uses a yellow tint); must be
    **unmistakably** different from a customer-visible reply
  - `activity` — inline, centred, muted system line
- **Far right / drawer** — contact panel: attributes, company, and the Stage 01 timeline with previous
  conversations and linked feedback.
- Composer with a reply/note toggle. The toggle's current mode must be obvious at a glance — an agent
  posting an internal note as a public reply is the worst failure mode in a support tool.

Options API throughout. Skeletons while loading; error states with retry.

### 5. Navigation and settings

Settled in deltas D-26 and D-28. Two surfaces were previously conflated and are now separate: the
**agent workspace** (`/support`, team-scoped) and the **customer entry point** (per-product, public
board). Stage 02 builds only the first.

**Sidebar** — `components/sidebar/AppSidebar.vue`:

- **Rename the existing `Support` group to `System`.** It contains only _Settings_ and is a mis-named
  misc group; the name is needed for the real module. This is a rename, not a move — Settings stays put.
- Add a **`Support` group** with _Inbox_ (`/support`) and _Contacts_ (`/support/contacts`), inside the
  `hasActiveOrganization === true` block alongside `Feedback` and `Management`. This also closes the
  Stage 01 loose end where contacts were reachable only by URL.
- `/support` prefix added to `protectedRoutes` in `middleware/auth.global.ts`.

**Team module enablement** — a new **Tools** tab in `pages/settings/index.vue`:

- Lists Feedback / Roadmap / Changelog / Support as **per-team** module toggles, stored in a new
  `teamModuleSettings` table (`server/database/schema/teams.ts`) — **not** in `supportTeamSettings`,
  which delta D-19 reserved for support-only policy. Defaults mirror the existing per-project ones:
  `feedbackEnabled` true, the rest false. See delta **D-31** for the full rationale, including why a
  `feedbackEnabled` default of false would hide the feedback nav for every existing team on deploy.
- **Team level is a master switch; the per-project toggle still applies and both must be on.** A product
  with feedback enabled inside a team with feedback disabled shows nothing (delta D-31).
- This is the one migration expected in the rest of Stage 02 (`0023`), and it belongs to this item.
- Drives sidebar group visibility. `Roadmap` and `Changelog` are currently hardcoded `disabled: true`
  placeholders in `AppSidebar.vue`; this replaces that with real state, so the tab is not
  support-specific scaffolding.
- **Disabling Support hides the nav group and stops inbound processing, but preserves conversations and
  contacts.** Re-enabling restores them intact. Follow the wording contract already set by the
  `ProductSettingsFeatures.vue` disable dialog: "Your data will not be deleted."
- **Permissions: team membership only**, matching every other settings surface today. Restricting module
  toggles to admins was considered and deliberately deferred — see delta D-28. Do not introduce a
  `teamMember.role` check here.

**Inbox configuration** — in-context at `/support/settings`, **not** a global settings tab. Stages 05–07
add macros, SLA, and automation to this surface, which would make a `/settings` tab unreasonably deep.
Stage 02 covers: inbox name, signature, agent membership, and the receiving-address list with each
address's optional product mapping. Channel and provider configuration is Stage 03.

**Not in this stage:** the per-product `supportEnabled` toggle in `ProductSettingsFeatures.vue` and the
product Support tab. The customer-facing entry point they would control is the Stage 10 customer portal,
so shipping the toggle here would mean a switch that visibly does nothing for seven stages. Deferred to
Stage 10.

### 6. Notifications

Add `conversation_assigned` and `conversation_mention` to `server/utils/notifications.ts` and expose
toggles in `SettingsNotifications`. Reuse the existing infrastructure; do not build a parallel one.

## Acceptance criteria

1. Two agents in two browsers, on two app instances: one replies, the other sees it appear without a
   refresh.
2. 100 concurrent conversation inserts for one team produce 100 distinct sequential `displayId` values,
   no duplicates and no gaps.
3. Changing status, priority, or assignee produces an `activity` message that renders inline in the
   thread.
4. An internal note is visually unmistakable from a reply, and the composer's mode is obvious before
   sending.
5. A user with no `supportInboxMember` row and no team-admin role gets 403 on every inbox and
   conversation endpoint. Cross-tenant isolation is tested.
6. Deleting an inbox does not orphan conversations — the FK is `restrict`; the API returns a clear 409.
7. `/support` redirects to `/login` when signed out.
8. Disabling Support in the Tools tab hides the sidebar group; re-enabling restores it with all
   conversations and contacts intact.
9. An inbox with three receiving addresses, two mapped to products, resolves each to the correct
   `conversation.projectId`; an agent override persists and is not reverted by later activity.
10. `yarn harness:verify` green on `support-platform`.

## TODO items

Items 1 and 2 block everything else. Items 5, 6, and 7 can run in parallel once the API lands.

- [ ] Add inbox and conversation tables to `server/database/schema/support.ts` with all indexes, including `supportInboxAddress` and the nullable `conversation.projectId`; generate migration
- [ ] Extend `server/utils/support-access.ts` with `requireInboxAccess`, `requireConversationAccess`, `resolveInboxByAddress`; unit tests including the team-admin bypass
- [ ] **Replace the deny branch in `server/utils/realtime-channels.ts`.** `inbox:` and `conversation:` currently deny unconditionally because these tables did not exist in Stage 00, and `tests/realtime-channels.test.ts` asserts that denial. Swap it for `requireInboxAccess` / `requireConversationAccess` and update those tests — otherwise the agent UI silently receives no realtime events. See delta D-04
- [ ] Implement `displayId` allocation via `supportCounter` with `SELECT … FOR UPDATE` in the insert transaction; concurrency test with 100 parallel inserts
- [ ] Add inbox CRUD + membership endpoints
- [ ] Add receiving-address endpoints (`/api/support/inboxes/[id]/addresses`) with per-address product mapping and same-team `projectId` validation
- [ ] Add conversation list/create/get/patch endpoints with filters (including product) and cursor pagination; emit `activity` messages on every status, priority, assignee, and product change
- [ ] Add message, participant, and tag endpoints; publish thin realtime envelopes on `conversation:` and `inbox:` for every write
- [ ] Build the `/support` three-pane UI: inbox switcher, filtered conversation list, thread pane rendering all four message kinds, contact drawer
- [ ] Build the composer with an unmistakable reply/note toggle; messages are stored only, not sent, in this stage
- [ ] Rename the existing `Support` sidebar group to `System`; add a real `Support` group with Inbox and Contacts; add `/support` to `protectedRoutes`
- [ ] Add the per-team Tools tab to `/settings` with Feedback/Roadmap/Changelog/Support module toggles driving sidebar visibility, replacing the hardcoded `disabled: true` placeholders; team membership only, no role check (delta D-28)
- [ ] Implement disable semantics: hide nav and stop inbound processing while preserving conversations and contacts
- [ ] Build `/support/settings` with inbox name, signature, agent membership, and the receiving-address list with product mapping
- [ ] Add `conversation_assigned` and `conversation_mention` notification types and preference toggles
- [ ] Register support inbox and conversation routes in `server/utils/openapi.ts`
- [ ] Add E2E coverage: create conversation, reply, add note, change status, verify activity message and live update

## Risks

- **The note/reply confusion.** The single highest-consequence UI bug in a support product. Treat the
  visual distinction and the composer mode indicator as functional requirements with E2E coverage.
- **`displayId` races.** Two conversations sharing a ticket number is very hard to unwind after the fact.
  The concurrency test is not optional.
- **This stage is large.** It is the widest single stage in the program. If it needs splitting, the clean
  seam is API (items 1–6) then UI (items 7–10) — but the UI half cannot be verified without the API half,
  so keep the ordering.
