# Stage 05 — Agent productivity

**Depends on:** Stages 02, 04. **Blocks:** nothing.
**Runs in parallel with Stages 06, 07, 08.**

**Goal:** Make the inbox fast to work in — assignment, macros, search, bulk actions — and build the
feedback bridge that is the reason this platform exists rather than a Zendesk subscription.

## Scope

**In:** assignment and round-robin, canned responses, macros, search and saved views, bulk actions,
merge and split, keyboard shortcuts, conversation ↔ feedback linking.

**Out:** time-based automation (Stage 07), SLA-driven assignment (Stage 06).

## Work

### 1. Assignment

- Manual assign and unassign, with an `activity` message on every change.
- Round-robin auto-assignment per inbox, over `supportInboxMember` rows with `role: 'agent'`,
  skipping agents marked unavailable.
- Agent availability toggle (available / away), stored per user per inbox.
- `conversation_assigned` notifications already exist from Stage 02.

### 2. Canned responses and macros

- **`cannedResponse`** — `id`, `teamId`, `inboxId` (nullable, for inbox-specific responses),
  `shortcode`, `title`, `body`, `createdByUserId`, timestamps. Unique `(teamId, shortcode)`.
- **`macro`** — `id`, `teamId`, `name`, `actions` (jsonb: an ordered list of set-status, set-priority,
  assign, add-tag, reply-with-canned-response), `createdByUserId`, timestamps.

Composer integration: typing `/shortcode` inserts a canned response with variables substituted
(`{{contact.name}}`, `{{agent.name}}`, `{{conversation.displayId}}`). Macros run from a menu and from
bulk actions, writing one `activity` message summarizing what ran — not one per action.

### 3. Search and views

- Full-text search across subject and message bodies. Use a Postgres `tsvector` column on
  `conversationMessage` with a GIN index, maintained by trigger. **Do not** scan with `ILIKE` — this is
  the table that grows without bound.
- Filters: status, assignee, tag, inbox, contact, company, priority, date range.
- **Saved views** — `savedView` table: `id`, `teamId`, `userId` (nullable, null = shared with team),
  `name`, `filters` (jsonb), `sortOrder`. Surfaced in the left pane above the inbox list.

### 4. Bulk actions

Multi-select in the conversation list: assign, set status, add or remove tag, run macro, delete.
Bounded batch size, one confirmation for destructive operations, one `activity` message per affected
conversation.

### 5. Merge and split

- **Merge** — move all messages from source to target ordered by `createdAt`, move participants and
  tags, close the source with an `activity` message linking to the target, keep the source resolvable by
  `displayId`.
- **Split** — move a selected message and everything after it into a new conversation, with `activity`
  messages on both sides.

### 6. Feedback bridge

This is the differentiator; give it real design attention rather than treating it as a checkbox.

- **Convert conversation → feedback.** Opens a prefilled dialog (title from subject, body from the first
  incoming message, product from the inbox's linked project, category selectable). On confirm: create
  the feedback item, set `conversation.linkedFeedbackId`, create a `contactLink` with
  `entityType: 'feedback'` and `source: 'agent'`, and write an `activity` message.
- **Link to existing feedback.** Search and select; same linking side effects, no new feedback item.
- **Notify on ship.** When linked feedback moves to a completed status, or a changelog post referencing
  it publishes, notify the conversation's contact. Reuse the existing `feedbackSubscription` and
  notification machinery rather than building a second dispatcher.
- **Show the link both ways.** The conversation thread shows the linked feedback with its current status
  and vote count; the feedback detail view shows how many support conversations are linked — for team
  members only, never on the public board.

**Privacy constraint, non-negotiable:** linking a conversation to public feedback must never expose the
contact's email, name, or ticket contents on the public board. The link is internal. Contacts and
feedback stay separate by design — see `design.md`.

### 7. Keyboard shortcuts

`j`/`k` navigate, `r` reply, `n` note, `a` assign, `e` resolve, `/` search, `?` shortcut help. Scoped to
`/support`; never swallow input while a field is focused.

## Acceptance criteria

1. Round-robin distributes evenly across available agents and skips unavailable ones.
2. `/shortcode` inserts a canned response with variables substituted from the actual conversation.
3. A macro applying three actions writes exactly one summarizing `activity` message.
4. Search returns results from message bodies via the GIN index; `EXPLAIN` confirms no sequential scan
   on `conversationMessage`.
5. Merging preserves full message ordering and leaves the source resolvable by its `displayId`.
6. Converting a conversation to feedback creates the feedback item, the link, the `contactLink`, and the
   activity message in one transaction.
7. Linked feedback reaching a completed status notifies the contact once, not once per linked
   conversation.
8. **The public board shows no contact identity or ticket content for linked feedback.** Verified by
   E2E against the public board as an anonymous visitor.
9. `yarn harness:verify` green on `support-platform`.

## TODO items

- [ ] Implement manual assignment, per-inbox round-robin over available agents, and the agent availability toggle
- [ ] Add `cannedResponse` table + CRUD + `/shortcode` composer insertion with variable substitution
- [ ] Add `macro` table + CRUD + a builder UI; execute from the conversation menu and from bulk actions with one summarizing activity message
- [ ] Add a `tsvector` column and GIN index on `conversationMessage` maintained by trigger; implement full-text conversation search
- [ ] Add `savedView` table + CRUD; surface personal and shared views in the left pane
- [ ] Implement bulk actions with multi-select, bounded batches, and confirmation on destructive operations
- [ ] Implement conversation merge and split with ordering preservation and activity messages on both sides
- [ ] Implement convert-conversation-to-feedback: prefilled dialog, transactional creation of feedback + `linkedFeedbackId` + `contactLink` + activity message
- [ ] Implement link-to-existing-feedback with search and select
- [ ] Implement notify-contact-on-linked-feedback-shipped, reusing `feedbackSubscription` and existing notification dispatch, deduplicated per contact
- [ ] Show the feedback link in the thread and the linked-conversation count on team-facing feedback views only
- [ ] Add keyboard shortcuts scoped to `/support` with a `?` help overlay
- [ ] Add E2E coverage: convert to feedback, verify the public board leaks no contact identity or ticket content

## Risks

- **Public leakage through the feedback bridge.** The whole contacts-stay-separate design collapses if
  converting a ticket publishes the customer's words or identity on a public board. Acceptance criterion
  8 is the guard and must be an E2E test, not a manual check.
- **Search performance.** `conversationMessage` is the fastest-growing table in the system. Full-text
  index from the start; never ship `ILIKE`.
- **Notification storms.** One feedback item linked to fifty conversations must not send fifty
  notifications to the same contact.
- **Merge data loss.** Merge moves rows across conversations. One transaction, and the source is retained
  rather than deleted.
