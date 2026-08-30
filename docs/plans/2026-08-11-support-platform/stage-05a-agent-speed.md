# Stage 05a — Agent speed (MVP)

**Depends on:** Stages 02, 04. **Blocks:** Stage 05b.
**Scope settled:** August 30, 2026, in review. `stage-05-decisions.md` records the reasoning behind
every cut — this document states _what_, that one states _why_, and the why matters because most of
this stage is things deliberately left out.

**Goal:** Make the inbox comfortable to live in all day for a **1–3 agent team**, so that Veerify can
run its own support on it. This is the MVP.

## The loop this optimizes

Not triage, and not routing. **Claiming.** With three agents and one shared queue, the failure mode is
not "tickets go to the wrong person" — it is "two people answer the same ticket." Every item below
serves ownership clarity: who has this, what have I not seen, and what did I leave half-written.

## Scope

**In:** claim and assignment, per-user read state, four fixed views, local draft persistence, canned
responses, scoped search, keyboard shortcuts.

**Out — and these are decisions, not omissions:** round-robin, agent availability, macros, saved views,
bulk actions, merge/split, snooze, undo-send, presence/typing indicators, message-body full-text search,
and the whole feedback bridge (Stage 05b). See the backlog in `stage-05-decisions.md`.

## Work

### 1. Claim and assignment

- **Claim button** in the conversation header, plus **auto-claim on the first `outgoing` reply** when the
  conversation is unassigned. Replying claims; nobody can forget to claim.
- **An internal note never claims.** Only `kind: 'outgoing'` triggers auto-claim. A note is often
  "is this yours?" — the case where claiming is actively wrong.
- **Unassign** (release to the pool) and **assign to another agent** via a plain dropdown, no shortcut.
  Handoff is the one coordination act a three-person team really performs; unassign is the escape hatch
  that keeps auto-claim from being a trap.
- Every change writes an `activity` message — Stage 02's `PATCH /conversations/[id]` already does this.
- **Reopen keeps the original assignee.** A customer replying to a resolved conversation does not
  return it to the pool.

### 2. Per-user read state

- New per-user, per-conversation `lastReadAt`. Unread rows render bold in the list.
- **Handled-ness supersedes read state:** once a conversation is claimed _and_ has an `outgoing` reply,
  it stops surfacing as unread to every agent other than the assignee. It is handled; it is not their
  queue.
- A new incoming customer message re-marks unread **for the assignee only** once the conversation is
  owned, and **for everyone** while it is still unclaimed.
- Manual **mark unread**, so agents can self-flag "come back to this."

### 3. Four fixed views

`Unassigned` · `Assigned to me` · `Resolved` · `All`. **Unassigned is the landing view** — the shared
queue is what you open the app to see. Unread badges on `Unassigned` and `Assigned to me` only.

No snoozed view (snooze is out) and no `closed` view — with fixed statuses and no automation, nothing
distinguishes `closed` from `resolved` at this team size. This fixed set is the _entire_ navigation
model; there are no saved views to patch holes with, which is why search must be global (item 6).

### 4. Local draft persistence

- Draft text stored client-side, **keyed by `(conversationId, mode)`** so a reply draft and a note draft
  can coexist on one conversation.
- **Restoring a draft restores its mode.** Non-negotiable: restoring note text into a reply composer
  reintroduces the note/reply confusion that Stage 02 calls the single highest-consequence UI bug in a
  support product, through the back door.
- Cleared on successful send. An unsaved-draft indicator on the conversation row makes a forgotten draft
  visible from the list. No expiry, no server-side sync.

### 5. Canned responses

- **`cannedResponse`** — `id`, `teamId`, `shortcode`, `title`, `body`, `createdByUserId`, timestamps.
  Unique `(teamId, shortcode)`. **Team-scoped only — no `inboxId` column**: `design.md` gives each team
  one shared inbox, so the nullable inbox scope has exactly one possible value. Add it back if
  multi-inbox teams ever materialize.
- **Every agent can create and edit.** No role check, consistent with delta D-28.
- `/shortcode` in the composer **inserts at the cursor**, does not replace the composer contents.
- Two variables only: `{{contact.name}}`, `{{agent.name}}`.

### 6. Scoped search

- Matches `displayId`, conversation subject, and contact name/email. Substring on subject and contact;
  bare numeric input additionally matches `displayId` exactly.
- **Always global, never scoped to the current view.** The conversation you cannot find is nearly always
  the one that is not in the view you are looking at.
- All matched columns live on `conversation` and `contact` — small tables, ordinary indexes.
- **Standing rule: never `ILIKE` `conversationMessage`.** Message-body search is deferred to a proper
  `tsvector` + GIN implementation when volume demands it. It must not be crept into via `ILIKE`.

### 7. Keyboard shortcuts

`j`/`k` navigate, `r` reply, `n` note, `c` claim-to-me, `e` resolve, `/` search, `?` help overlay.
Scoped to `/support`; never swallow input while a field is focused. **Build this item last** — it is the
safest thing to drop if the stage runs long.

## Acceptance criteria

1. Replying to an unassigned conversation assigns it to the replying agent and writes one `activity`
   message. Posting an internal note to an unassigned conversation leaves it unassigned.
2. Unassign returns a conversation to `Unassigned`; assign-to-another-agent moves it out of the
   assigner's `Assigned to me` and into the assignee's, both with `activity` messages.
3. A conversation claimed and replied to by agent A does not render unread for agent B. A subsequent
   customer reply re-marks it unread for A only.
4. A reply draft and a note draft on the same conversation both survive navigating away and back, each
   restoring its own composer mode.
5. Search finds a resolved conversation from the `Unassigned` view by contact email and by bare ticket
   number.
6. `/shortcode` inserts at the cursor with `{{contact.name}}` and `{{agent.name}}` substituted from the
   actual conversation, leaving surrounding text intact.
7. `EXPLAIN` confirms search touches no sequential scan of `conversationMessage` — because it never
   queries that table at all.
8. `yarn harness:verify` green on `support-platform`.

## Definition of done — the dogfood gate

**Veerify's own support runs on this and every ticket is answered in the app.** No ticket answered from
the current helpdesk during the window.

**Known limitation, stated rather than glossed:** current volume is roughly **one ticket per week**, so a
two-week window is about two tickets. That validates _nothing is broken_; it does **not** exercise queue
management, unread signal decay, or agent collision — the risk explicitly accepted when presence was cut.
Compensate deliberately: either run the gate long enough to accumulate real volume, or seed the inbox
with imported historical tickets and run a scripted two-agent session that deliberately attempts a
collision. Do not treat two clean tickets as evidence the collision risk did not materialize.

## TODO items

- [ ] Implement claim, auto-claim on first `outgoing` reply (notes excluded), unassign, and assign-to-another-agent, each writing an `activity` message; reopen preserves assignee
- [ ] Add per-user conversation read state with the handled-ness supersede rule, manual mark-unread, and unread badges on `Unassigned` and `Assigned to me`
- [ ] Implement the four fixed views with `Unassigned` as the landing view
- [ ] Implement local draft persistence keyed by `(conversationId, mode)` that restores composer mode, clears on send, and shows an unsaved-draft indicator in the list
- [ ] Add the team-scoped `cannedResponse` table (no `inboxId`) + CRUD + `/shortcode` insert-at-cursor with `{{contact.name}}` and `{{agent.name}}`
- [ ] Implement global scoped search over `displayId`, subject, and contact name/email; no `conversationMessage` access
- [ ] Add keyboard shortcuts scoped to `/support` with a `?` help overlay — build last
- [ ] Add E2E coverage: reply auto-claims, note does not, draft restores its own mode, search finds a resolved conversation from another view

## Risks

- **Accepted collision risk.** With presence cut, two agents can open the same unclaimed conversation
  within seconds and both reply. Tolerable at three agents, not above ~five. The dogfood gate will not
  detect this at one ticket per week — see the limitation above.
- **Auto-claim as a trap.** Replying claims silently. Unassign must be obvious and one click, or agents
  accumulate ownership they did not intend.
- **Draft mode restoration.** Getting this wrong recreates the note/reply confusion. Treat criterion 4 as
  functional, with E2E coverage.
- **Dormant snooze columns.** `conversation.status = 'snoozed'` and `snoozedUntil` have no writer anywhere
  in the program. Do not invent semantics for them and do not remove them as dead-column cleanup.
