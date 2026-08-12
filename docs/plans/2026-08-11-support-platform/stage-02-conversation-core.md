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
`supportInboxMember`, `conversation`, `supportCounter`, `conversationMessage`,
`conversationAttachment`, `conversationParticipant`, `supportTag`, `conversationTag`,
`supportEmailEvent`.

`supportEmailEvent` is created here even though Stage 03 is its first writer — it keeps the inbound
pipeline from needing a migration mid-stage.

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

| Route                                          | Method          | Notes                                                             |
| ---------------------------------------------- | --------------- | ----------------------------------------------------------------- |
| `/api/support/inboxes`                         | GET/POST        | Team-scoped list and create                                       |
| `/api/support/inboxes/[id]`                    | GET/PUT/DELETE  | Detail, settings, delete                                          |
| `/api/support/inboxes/[id]/members`            | GET/POST/DELETE | Agent membership                                                  |
| `/api/support/conversations`                   | GET             | Filter by inbox, status, assignee, tag, contact; cursor-paginated |
| `/api/support/conversations`                   | POST            | Manual creation — the Stage 02 entry point                        |
| `/api/support/conversations/[id]`              | GET             | Detail with contact and participants                              |
| `/api/support/conversations/[id]`              | PATCH           | Status, priority, assignee, subject                               |
| `/api/support/conversations/[id]/messages`     | GET/POST        | Thread; `POST` accepts `kind` of `outgoing` or `note`             |
| `/api/support/conversations/[id]/participants` | POST/DELETE     | CC and followers                                                  |
| `/api/support/conversations/[id]/tags`         | POST/DELETE     | Tag assignment                                                    |
| `/api/support/tags`                            | GET/POST/DELETE | Team tag management                                               |

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

- `/support` in `components/sidebar/AppSidebar.vue`.
- `/support` prefix added to `protectedRoutes` in `middleware/auth.global.ts`.
- `supportEnabled` added to the feature toggles in `components/products/ProductSettingsFeatures.vue`,
  alongside `feedbackEnabled` / `roadmapEnabled` / `changelogEnabled`.
- A Support tab in `pages/products/[slug].vue` filtering to inboxes with `projectId` set to that product.
- Inbox settings UI: name, linked product, signature, agent membership. Channel configuration is
  Stage 03.

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
8. `yarn harness:verify` green on `main`.

## TODO items

Items 1 and 2 block everything else. Items 5, 6, and 7 can run in parallel once the API lands.

- [ ] Add inbox and conversation tables to `server/database/schema/support.ts` with all indexes; generate migration
- [ ] Extend `server/utils/support-access.ts` with `requireInboxAccess`, `requireConversationAccess`, `resolveInboxByAddress`; unit tests including the team-admin bypass
- [ ] **Replace the deny branch in `server/utils/realtime-channels.ts`.** `inbox:` and `conversation:` currently deny unconditionally because these tables did not exist in Stage 00, and `tests/realtime-channels.test.ts` asserts that denial. Swap it for `requireInboxAccess` / `requireConversationAccess` and update those tests — otherwise the agent UI silently receives no realtime events. See delta D-04
- [ ] Implement `displayId` allocation via `supportCounter` with `SELECT … FOR UPDATE` in the insert transaction; concurrency test with 100 parallel inserts
- [ ] Add inbox CRUD + membership endpoints
- [ ] Add conversation list/create/get/patch endpoints with filters and cursor pagination; emit `activity` messages on every status, priority, and assignee change
- [ ] Add message, participant, and tag endpoints; publish thin realtime envelopes on `conversation:` and `inbox:` for every write
- [ ] Build the `/support` three-pane UI: inbox switcher, filtered conversation list, thread pane rendering all four message kinds, contact drawer
- [ ] Build the composer with an unmistakable reply/note toggle; messages are stored only, not sent, in this stage
- [ ] Add `/support` to `AppSidebar.vue` and `protectedRoutes`; add `supportEnabled` toggle and the product Support tab
- [ ] Add inbox settings UI (name, linked product, signature, agents)
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
