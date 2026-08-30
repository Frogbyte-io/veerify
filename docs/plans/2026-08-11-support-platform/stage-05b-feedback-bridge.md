# Stage 05b — Feedback bridge

**Depends on:** Stage 05a. **Blocks:** nothing.
**Scheduled ahead of Stages 06, 07, and 08** — see `stage-05-decisions.md`, decision 16.

**Goal:** Connect a support conversation to the product feedback it is really about, and close the loop
with the customer when it ships. This is the differentiator — the one capability in this program that a
Chatwoot or Freshdesk install cannot match, because neither has a feedback board underneath it.

**Deferred out of the MVP on August 30, 2026, and deliberately scheduled next rather than "later."**
SLA (06), automation (07), and CSAT (08) are parity features that a 1–3 agent team needs less than the
macros already cut from 05a. If the bridge slips behind them it slips a very long way, and the platform
spends its whole early life being a worse Zendesk instead of something Zendesk cannot be.

## Work

### 1. Convert conversation → feedback

Opens a prefilled dialog: title from subject, body from the first incoming message, product from the
inbox address's linked project, category selectable. On confirm, **in one transaction**: create the
feedback item, set `conversation.linkedFeedbackId`, create a `contactLink` with
`entityType: 'feedback'` and `source: 'agent'`, and write an `activity` message.

### 2. Link to existing feedback

Search and select an existing feedback item; same linking side effects, no new feedback item. This is
what makes item 3 valuable — fifty conversations, one feature request.

### 3. Notify on ship

When linked feedback moves to a completed status, or a changelog post referencing it publishes, notify
the conversation's contact. Reuse the existing `feedbackSubscription` and notification machinery; do not
build a second dispatcher.

**Deduplicate per contact, not per conversation.** One feedback item linked to fifty conversations sends
each contact one notification. This is a grouped query, not an architecture — but it is the only part of
this stage that is genuinely easy to get wrong.

### 4. Show the link both ways

The conversation thread shows the linked feedback with its current status and vote count; the feedback
detail view shows how many support conversations are linked — **for team members only, never on the
public board.**

## Privacy constraint — non-negotiable

Linking a conversation to public feedback must never expose the contact's email, name, or ticket contents
on the public board. The link is internal. Contacts and feedback stay separate by design — see
`design.md`, "Why contacts and feedback stay separate."

## Acceptance criteria

1. Converting a conversation to feedback creates the feedback item, `linkedFeedbackId`, the `contactLink`,
   and the activity message in one transaction — a failure rolls back all four.
2. Linking fifty conversations to one feedback item and completing it notifies each distinct contact
   exactly once.
3. The conversation thread shows the linked feedback's live status and vote count.
4. The feedback detail view shows the linked-conversation count to team members and to nobody else.
5. **The public board shows no contact identity and no ticket content for linked feedback.** Verified by
   an E2E test against the public board as an anonymous visitor — a manual check does not satisfy this.
6. `yarn harness:verify` green on `support-platform`.

## TODO items

- [ ] Implement convert-conversation-to-feedback: prefilled dialog, transactional creation of feedback + `linkedFeedbackId` + `contactLink` + activity message
- [ ] Implement link-to-existing-feedback with search and select
- [ ] Implement notify-contact-on-linked-feedback-shipped, reusing `feedbackSubscription` and existing notification dispatch, deduplicated per contact
- [ ] Show the feedback link in the thread and the linked-conversation count on team-facing feedback views only
- [ ] Add E2E coverage: convert to feedback, then verify the public board leaks no contact identity or ticket content

## Risks

- **Public leakage.** The whole contacts-stay-separate design collapses if converting a ticket publishes
  the customer's words or identity on a public board. Acceptance criterion 5 is the guard and must be an
  E2E test.
- **Notification storms.** One feedback item linked to fifty conversations must not send fifty
  notifications to the same contact.
- **Scope creep back into 05a.** This stage does not touch the composer, the views, or read state. If it
  starts to, the split has failed.
