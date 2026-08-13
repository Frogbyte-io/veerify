# Stage 10 — Customer portal

**Depends on:** Stage 02. **Blocks:** nothing.

**Goal:** Let customers submit and track tickets on the public domain, without email being the only way in.

> Outline-level detail. Refine when unblocked.

**Knowledge base integration is out of scope** — the KB was dropped from this program on August 11, 2026.
Leave a clear seam (an empty slot above the submit form) so article suggestions can be added later
without restructuring the page.

## Scope

Ticket submission form, ticket list, ticket detail with reply, on the existing public domain
infrastructure. Reuses `anonymousSession`, `server/utils/public-auth-handoff.ts`, and the host-based
routing already handling public boards in `pages/[...slug].vue`.

## Behaviour

- **Submission** — name, email, subject, message, attachments, and optional per-inbox custom fields.
  Creates a contact (or resolves an existing one via `contactIdentity`) and a conversation with an
  `incoming` message. Rate-limited through the Stage 00 limiter and protected by the existing anti-spam
  measures applied to public feedback submission.
- **Access to existing tickets** requires proof of email ownership. Two paths, matching how the rest of
  Veerify already works:
  - Logged-in Veerify users: resolved through `contactIdentity` on `kind: 'user'`.
  - Anonymous: emailed magic link granting a scoped, expiring session for that contact only.
    **Never list tickets by email address alone.** Anyone could enumerate another customer's support
    history.
- **Reply** from the portal appends an `incoming` message, resumes SLA timers, and publishes realtime
  envelopes exactly as an inbound email would — the agent side must not be able to tell the difference.
- Portal visibility is per inbox: off, submit-only, or submit-and-track.

## UI

Rendered on the team's public subdomain or custom domain, inheriting the existing public board
appearance settings (banner, colors, light/dark mode) so it looks like part of the customer's brand.

## Acceptance criteria

1. An anonymous submission creates a contact and a conversation visible in the agent inbox.
2. Ticket history is inaccessible without a verified session; supplying only an email address returns
   nothing.
3. A magic-link session grants access to exactly one contact's tickets and expires.
4. A portal reply is indistinguishable from an email reply on the agent side, including SLA resume.
5. Portal pages inherit the product's public appearance settings and work on a custom domain.
6. Rate limiting blocks submission floods.
7. `yarn harness:verify` green on `support-platform`.

## TODO items

- [ ] Add per-inbox portal visibility setting (off / submit-only / submit-and-track) and custom field config
- [ ] Build the public ticket submission form with attachments, rate limiting, and existing anti-spam measures
- [ ] Implement contact resolution or creation from a portal submission via `contactIdentity`
- [ ] Implement magic-link verification granting a scoped, expiring contact session for anonymous customers
- [ ] Implement logged-in customer access via `contactIdentity` on `kind: 'user'`
- [ ] Build the ticket list and detail pages with reply, inheriting public appearance settings
- [ ] Ensure portal replies produce identical server-side effects to inbound email, including SLA resume
- [ ] Leave a documented empty slot above the submit form for future article suggestions
- [ ] Add E2E coverage: submit anonymously, verify by magic link, reply, confirm the agent sees it live
- [ ] Add E2E coverage: attempting to view another contact's tickets fails

## Risks

- **Ticket enumeration.** Listing tickets by unverified email is a serious data leak. Verified session
  only, always.
- **Divergent code paths.** If portal replies take a different path from email replies, SLA and
  automation will behave inconsistently. Funnel both into the same service function.
- **Spam.** A public form on a custom domain is an attractive target; reuse the existing anti-spam work
  rather than reinventing it.
