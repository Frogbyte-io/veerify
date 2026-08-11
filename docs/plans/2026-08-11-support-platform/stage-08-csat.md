# Stage 08 — CSAT

**Depends on:** Stage 04. **Blocks:** Stage 09 (CSAT metrics only).
**Runs in parallel with Stages 05, 06, 07.**

**Goal:** Ask customers how the support went, and turn the answers into a number per agent and per inbox.

> Outline-level detail. Refine when unblocked.

## Schema

- **`csatSurvey`** — `id`, `teamId`, `inboxId` (nullable), `name`, `scale` (`csat_5` | `thumbs` |
  `nps_10`), `question`, `followUpQuestion`, `sendTrigger` (`on_resolve` | `on_close`), `delayMinutes`,
  `isEnabled`, timestamps.
- **`csatResponse`** — `id`, `surveyId`, `conversationId`, `contactId`, `agentUserId` (the assignee at
  resolution), `rating` (integer), `comment`, `token` (opaque, unique), `sentAt`, `respondedAt`,
  `createdAt`. Unique on `conversationId` — one survey per conversation.

## Behaviour

- Sent on the configured trigger, after `delayMinutes`, via the Stage 00 scheduler.
- **One-click rating in the email.** Each rating option is a distinct tokenized URL, so the customer
  rates without logging in and without a page load first. Landing on that URL records the rating and
  then offers the optional free-text follow-up.
- Tokens are single-use for the rating and remain valid for the follow-up comment for a bounded window.
- Guards: never survey a conversation with no agent reply; never survey the same conversation twice;
  never survey a contact more than once per configurable window; respect a per-contact opt-out.
- A response writes an `activity` message into the thread so the agent sees the outcome in context.

## UI

- Survey configuration per inbox: scale, question wording, trigger, delay.
- Rating landing page on the public domain — no login, works for anonymous contacts, mobile-first.
- CSAT column and filter on the conversation list.
- Per-agent and per-inbox score summary (feeds Stage 09).

## Acceptance criteria

1. Resolving a conversation with at least one agent reply sends a survey after the configured delay.
2. Clicking a rating in the email records it in one request, with no login and no intermediate page.
3. The same token cannot change a submitted rating, but can still attach a follow-up comment within the
   window.
4. A conversation resolved with no agent reply is never surveyed.
5. A contact who opted out receives nothing.
6. `yarn harness:verify` green on `main`.

## TODO items

- [ ] Add `csatSurvey` and `csatResponse` tables; generate migration
- [ ] Implement survey dispatch on the Stage 00 scheduler with trigger, delay, and all four guards
- [ ] Add the CSAT email template following the existing `lib/email-templates.ts` pattern, with one tokenized URL per rating option
- [ ] Build the public rating landing page with follow-up comment capture; no authentication required
- [ ] Implement token single-use semantics for rating and bounded-window validity for comments
- [ ] Write an `activity` message into the thread on response
- [ ] Build survey configuration UI per inbox
- [ ] Add CSAT column and filter to the conversation list, and per-agent/per-inbox score summaries

## Risks

- **Survey fatigue.** Per-contact rate limiting and opt-out are requirements, not options — a support
  tool that spams surveys damages the customer relationship it is measuring.
- **Token security.** Rating tokens appear in email and in browser history. Keep them opaque,
  single-use for the rating, and scoped to one conversation.
- **Attribution.** `agentUserId` is captured at resolution time; reassigning the conversation afterwards
  must not retroactively move the score.
