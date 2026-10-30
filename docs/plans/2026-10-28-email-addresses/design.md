# Project email addresses — Design

**Created:** October 28, 2026
**Status:** E1 and E2 merged (PR #106), E3 merged (PR #107), E4 docs and MCP tools on `t3/mail-e4-docs-mcp`. The
staging test waits for Frogmail's SES setup; see [Staging acceptance](#staging-acceptance).

**Goal:** A paying workspace adds a project, connects a domain hosted at any DNS provider, and creates email
addresses on it. Each address delivers to the project's inbox, forwards to any external address, or both. Every
domain can have a catch-all.

---

## Decisions

| Topic                | Decision                                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who                  | Paid feature for every workspace on the Veerify cloud. Inert when self-hosted without a Frogmail key.                                                                   |
| Domains              | Anywhere (Porkbun, Cloudflare, …). The customer pastes DNS records; automatic DNS is out of scope for v1.                                                               |
| Receiving            | Frogmail over Amazon SES inbound: one MX `10 inbound-smtp.us-east-1.amazonaws.com`. Works on the apex and on subdomains.                                                |
| Existing mail system | Brand-new domains use the apex. To keep an existing provider (Google Workspace etc.), use a subdomain (`hello@mail.newsite.com`). One hostname cannot be split.         |
| Forwarding           | Done by Frogmail, not Veerify. Re-sent as `"Jane via hello@newsite.com" <hello@newsite.com>` with `Reply-To: Jane`. Any external destination, after a click-to-confirm. |
| Spam                 | SES verdicts. Spam and viruses are never forwarded; they land in the inbox's Spam folder.                                                                               |
| Inbox                | **One inbox for everything**: the existing support inbox. Assign, resolve, archive, mark spam, delete.                                                                  |
| Tool name            | **Support → Inbox**. Mail is not only support any more.                                                                                                                 |
| Ownership            | Domains and addresses belong to the **project** (brand). An address can be tagged with a product.                                                                       |
| Replies              | From Veerify, as the receiving address, through the existing Frogmail SMTP outbox. No third-party mail client.                                                          |
| Back-compat          | None needed. Tables are renamed outright.                                                                                                                               |

### Naming: Inbox

- The tool is called **Inbox** everywhere users see it: sidebar, Tools tab, page titles, dashboard routes
  (`/support` → `/inbox`, `/support/settings` → `/inbox/settings`, `/support/contacts` → `/inbox/contacts`).
- Each address has a **behaviour**:
  - **Mail**: no auto-reply, SLA or satisfaction survey.
  - **Helpdesk**: the inbox's auto-replies, SLAs, CSAT and automation rules apply, as support does today.
- Kept internal on purpose: the module key `supportEnabled`, `/api/support/*`, `support_*` tables that are not
  reworked here, and the `server/utils/support-*` files. Renaming them changes no behaviour, touches the OpenAPI
  document, the MCP tools and the `project.settings` JSON, and is not worth the churn now. This can be revisited
  separately.

---

## Mail flow

```
sender → MX (SES inbound, us-east-1) → Frogmail: verdicts, store, route by address
  route hello@newsite.com
    ├─ forward("https://<veerify>/api/support/inbound/mailgun")   inbox delivery (exists today)
    ├─ forward("me@frogbyte.io")                                  only if the destination is confirmed and verdicts pass
    └─ stop()
  route match_recipient("^.*@newsite\.com$") (priority 100) → as configured for "*"
```

Veerify owns the configuration and the inbox. Frogmail owns receiving, forwarding, destination confirmation and
abuse limits. Veerify never re-sends inbound mail itself.

---

## Data model

| Change                                               | Columns                                                                                                                                                                                                                                                          |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `support_sending_domain` → **`project_mail_domain`** | Existing columns, plus `receivingStatus` (`missing_mx` / `active` / `conflict`). `receivesViaProvider` stays.                                                                                                                                                    |
| `support_inbox_address` → **`project_mail_address`** | `domainId`; `productId` nullable; `behaviour` (`mail` / `helpdesk`). A catch-all is the address `*@domain` (one per domain via the unique address). E3 adds a nullable `inboxId` (forward only) and `forwardEnabled`.                                            |
| **`mail_forward_destination`** (new)                 | `domainId`, `email`, `frogmailDestinationId`, `status` and `statusReason` mirrored from Frogmail (`pending` / `verified` / `revoked` / `suspended`), `verifiedAt`, `lastEventAt`. Unique (`domainId`, `email`): consent is per receiving domain, as in Frogmail. |
| **`project_mail_address_forward`** (new)             | `addressId`, `destinationId`. Several addresses on one domain share one confirmed destination.                                                                                                                                                                   |
| `conversation`                                       | `mailAddressId` (the receiving address), `behaviour` (snapshot at creation), `spamAt`, `deletedAt`. Status `closed` is shown as **Archived**. Spam and Trash are folders, not statuses. Trash is purged after 30 days.                                           |
| **`mail_entitlement`** (new)                         | `organizationId` (unique), `tier` (`standard` / `owner`), `updatedAt`, `updatedBy`. No row means `standard`.                                                                                                                                                     |
| `support_inbox.forwardAddress`                       | Dropped. It was never used; forwarding lives on addresses.                                                                                                                                                                                                       |

Platform addresses (`kind = 'platform'`, on `SUPPORT_PLATFORM_MAIL_DOMAIN`) stay as they are. They are how a
customer forwards in from a domain we do not receive for.

---

## Limits

Limits count per **workspace** (organization), the future paying customer in the
[billing design](../2026-10-11-billing/design.md). They live in `lib/mail-plans.ts`:

| Tier       | Domains | Addresses | Forwards per month |
| ---------- | ------: | --------: | -----------------: |
| `standard` |       3 |        20 |              5,000 |
| `owner`    |      69 |       420 |             80,085 |

- `owner` is Frogbyte's own tier. There is no UI for it. It is set by an operator script:
  `yarn mail:set-tier <workspace-slug> owner|standard`, which writes `mail_entitlement` and an audit event.
- Pending domains count toward the domain limit. The existing per-project caps (10 domains, 3 pending) are
  replaced by the workspace limit, with at most 3 pending per workspace.
- Forwards are counted from Frogmail's per-domain usage. At the monthly limit, Veerify pauses the forward
  actions on that workspace's routes until the next month. Inbox delivery continues.
- When billing ships, it writes `mail_entitlement` (and paid tiers) instead of the script. Nothing else changes.

---

## UI

- **Project settings → Email** (new tab, `components/project/ProjectSettingsEmail.vue`):
  - Domains list with sending and receiving status, and a link to each domain's DNS records.
  - Addresses list. Each row shows the address, where it delivers, the product tag and the status.
  - Usage line against the workspace limits.
  - `SupportSendingDomains` moves here from Inbox settings.
- **Connect domain** wizard:
  1. Enter the domain, then choose the apex or a subdomain. Warn when the apex already has MX records.
  2. DNS records: ownership TXT, DKIM, MX, SPF and an optional DMARC record, each with a live status and **Check now**.
  3. Create the first address.
- **Address editor**:
  - Local part (or `*` for a catch-all) and the domain.
  - Delivery: Inbox / Forward / Inbox + forward.
  - Forward destinations, each with its confirmation status and Resend.
  - Behaviour (Mail / Helpdesk), product, default assignee and sender name.
- **Inbox**:
  - The existing conversation list, with address filters and catch-all in the sidebar.
  - New folders Archived, Spam and Trash.
  - New actions Archive, Spam and Delete. Restoring from Spam or Trash is allowed.
- Inbox delivery needs the Inbox tool on for the project. Creating an inbox address while it is off offers to
  turn it on. Forward-only addresses work without it.

---

## Phases

| Phase  | Scope                                                                                                                                                             | Depends on        |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| **E1** | Rename Support → Inbox in the UI and dashboard routes. Archive, Spam and Trash for conversations. Address behaviour (Mail / Helpdesk).                            | —                 |
| **E2** | Table renames, Email tab, domains moved there, address editor with inbox delivery and catch-all routes, `mail_entitlement`, `lib/mail-plans.ts`, `mail:set-tier`. | —                 |
| **E3** | Forward destinations, Inbox + forward, SES MX in the DNS wizard, subdomain receiving, forward usage and pause, bounce handling.                                   | Frogmail contract |
| **E4** | Docs (`docs/deployment-mail.md`, `docs/mcp.md`, OpenAPI), MCP tools for addresses, staging test against real Frogmail.                                            | E3                |

E2 already works with Frogmail as it is today: inbox delivery goes through the existing `forward(url)` routes, on
domains where an operator has enabled Cloudflare receiving.

---

## Frogmail contract (as reviewed)

Source: Frogmail `docs/plans/2026-10-28-ses-inbound-forwarding.md` §10. How Veerify uses it:

- **Connect domain:** `POST /v4/domains`, then `PUT /api/v1/domains/{d}/receiving {"provider":"ses"}` straight away,
  so one wizard step shows every record. Email-tab domains always receive. Sending-only claims never call it.
  `receivingStatus` mirrors Frogmail's `pending_verification` / `pending_mx` / `active` / `disabled`.
- **Routes** are created only after Veerify's own ownership TXT and Frogmail verification both pass. All customers
  share one Frogmail project, so Veerify's TXT proof is what separates customers.
- **Routes:** one route per address, `match_recipient("^addr$")` at priority 10 with `stop()`. Catch-all is
  `match_recipient("^.*@domain\.com$")` at priority 100 (Frogmail reads the anchored form as the domain catch-all). Never `catch_all()`: in the shared project it would span every
  customer's domains.
- **Destinations:** created implicitly by `forward("x@y")`. Status comes from the route response, the native
  lifecycle webhook (a new receiver with native signing) and a reconcile pass in the 5-minute domain poller.
- **Delivery events:** forwards arrive on the existing Mailgun delivery webhook, correlated by
  `frogmail-forward-destination-id`. Veerify adds the `complained` subscription.
- **Spam:** `frogmail-verdicts` decides the Spam folder. Skipped forwards (`frogmail-forwards`) are shown on the
  message.
- **Monthly forward limit:** read from `GET /api/v1/domain-usage`. At the limit, forwarding is paused per domain
  (requested from Frogmail as a receiving-domain flag).
- **Removing a domain:** `DELETE /v3/domains/{d}` disables receiving first and revokes its destinations.

## E3 build

Built against the final contract: Frogmail design §10 and the pinned responses in Frogmail
`tests/Fixtures/Contract/veerify/`. Changes since review: another project's domain is a generic 404 `not_found`;
`PUT …/receiving` returns 409 `domain_receives_elsewhere` while another project's pending reservation exists (retry
after the domain verifies); route responses carry `verification_sent_at` (null = not sent yet); resending to a verified
destination is 409 `conflict`; `PATCH …/receiving` on a non-SES domain is 409 `domain_not_receiving`.

**Switch.** `MAIL_FORWARDING_ENABLED=true` (Frogmail with SES receiving) sets the provider's `capabilities.forwarding`.
Off, everything behaves as E2: no receiving calls, no forwards, the address editor hides Forward. The fake provider
always forwards.

**Schema (0069).**

- `project_mail_domain`: `receiving_status` (null until enabled, then Frogmail's status) and `forwarding_paused_at`.
- `project_mail_address.deliver_to_inbox` (default true). A forward-only address keeps its `inboxId` (permissions,
  the address list) but its route has no inbox action. This replaces the nullable `inboxId` sketched above, so the
  Inbox tool must be on for forward-only addresses too (follow-up if that matters).
- `mail_forward_destination` and `project_mail_address_forward` as in the data model.

**Provider** (`server/services/sending-domains`): `enableReceiving`, `getReceiving`, `setForwardingPaused`,
`disableReceiving`, `create/update/deleteInboundRoute` with `forwardUrl | null` and `forwardTo[]` (at most 5), forward
destination list/create/resend/delete, and `getDomainUsage`. Native calls use Bearer auth; native `code` and
`X-Frogmail-Error` map to `SendingDomainErrorCode`.

**Domain lifecycle.**

- When forwarding is on, the poller calls `enableReceiving` for every claim once the provider has registered it
  (allowed while pending), and stores `receiving_status`. `receiving_provider_conflict` (Cloudflare receiving) leaves
  the claim on the E2 path. `domain_receives_elsewhere` is retried on later passes.
- Each check pass on a receiving claim refreshes `receiving_status` and the MX record (it is in
  `receiving_dns_records`), then reconciles destinations from `listForwardDestinations`.
- Removing a claim stays `DELETE /v3/domains/{d}`; Frogmail disables receiving first. Local destination rows cascade.

**Addresses and routes.**

- `POST`/`PATCH /api/support/inboxes/{id}/addresses[/{addressId}]` accept `deliverToInbox` and `forwardTo` (emails,
  at most 5, deduplicated). Forwards need a claim with forwarding on and a verified domain; a catch-all may forward.
  At least one of inbox delivery or a forward.
- A change rebuilds the route with `updateInboundRoute` (create when there is none) and upserts destinations from
  `frogmail_forward_destinations`. Removing the last address that uses a destination does not revoke it: consent
  stays with the domain, as in Frogmail.
- `POST /api/projects/{slug}/mail/destinations/{id}/resend` and `DELETE …/{id}` (project admins) wrap resend and
  revoke. 429 keeps `Retry-After`.
- `GET /api/projects/{slug}/mail/addresses` adds `deliverToInbox`, `forwards: [{id, email, status, statusReason,
verificationSentAt}]` per address, and `domains: [{id, domain, receivingStatus, forwardingPaused}]`;
  `usage.used.forwardsThisMonth` is filled in.

**Webhooks.**

- `POST /api/support/frogmail/events`: native Frogmail webhooks, verified with `FROGMAIL_WEBHOOK_SECRET`
  (`Frogmail-Signature: t=…,v1=<hex HMAC-SHA256 of "t.body">`, 300 s window, replay guard). Handles
  `forward_destination.verified|revoked|suspended` by Frogmail id. The poller's reconcile covers a missed webhook.
- Forward delivery events (tag `frogmail-forward`) arriving on the Mailgun delivery webhook are acknowledged and only
  stamp `last_event_at`; they are not support deliveries. Suspension and revocation come from the lifecycle webhook.
- Inbound callback: `frogmail-forwards` and `frogmail-attachments-removed` are kept on the message metadata
  (`frogmailForwards`, `attachmentsRemoved`) and shown on the message. Spam already uses `frogmail-verdicts` (E1).

**Usage and pause.** Cron `mail:forward-usage` (hourly) sums `forwarded` from `getDomainUsage` for the calendar
month (UTC) over each workspace's receiving domains. At or over the tier limit it pauses forwarding on every one of
them (`setForwardingPaused(true)`, `forwarding_paused_at`); in a new month, or below the limit after a tier change,
it resumes the domains it paused. The count is cached per workspace for the Email tab.

**UI.** Address editor: Delivery (Inbox / Forward / Inbox + forward) and up to 5 forward addresses, each with its
status (Waiting for confirmation, Confirmed, Bounced, Stopped) and Resend. Email tab: receiving status and the MX
record per domain, the forwards usage line, and a paused banner. Message view: skipped forwards and removed
attachments.

## E4 build

- `docs/deployment-mail.md` → "Receiving and forwarding through SES": switch, key scopes, webhook subscription,
  usage pause, rollback. Stale team-era wording updated to projects and workspace limits.
- `docs/mcp.md` and `server/mcp/tools/mail.ts`: `mail_list_domains`, `mail_add_domain`, `mail_verify_domain`,
  `mail_remove_domain`, `mail_list_addresses`, `mail_list_inboxes`, `mail_create_address`, `mail_update_address`,
  `mail_delete_address`, `mail_resend_forward_confirmation`, `mail_stop_forwarding`. Thin wrappers over the routes,
  so permissions and validation stay in one place.
- OpenAPI: every E3 route already carries its `@openapi` block (`yarn openapi:check`).

## Staging acceptance

Run on staging once Frogmail has SES receiving there, with `MAIL_FORWARDING_ENABLED=true`, a webhook endpoint
subscribed and `FROGMAIL_WEBHOOK_SECRET` set. Use a fresh subdomain of a domain we control (for example
`e4.frogbyte-test.com`).

1. Connect the subdomain in Project settings → Email. The records list ownership TXT, DKIM, SPF and the SES MX.
   Publish them. The domain turns Verified, then receiving `active`.
2. Create `hello@` with Inbox + forward to a mailbox we read. The forward shows Waiting for confirmation; the
   confirmation email arrives. Before clicking, send a test mail: it reaches the Inbox, and the message shows
   "Not forwarded … has not confirmed yet".
3. Click Confirm (the page needs the button press). The forward shows Confirmed within a minute (webhook), or by
   the next poll with the webhook endpoint disabled.
4. Send again: it reaches the Inbox and the mailbox, as `"Name via hello@…"` with `Reply-To` the sender.
5. Send GTUBE (spam) and EICAR (virus) test mails: both land in Spam, neither is forwarded; the virus mail shows
   "Attachments removed".
6. Create `*@` (catch-all, forward-only). Mail to `random@` is forwarded and does not reach the Inbox; mail to
   `hello@` still follows step 4.
7. Resend twice within 10 minutes: the second answers with a wait time. Stop forwarding: mail stops reaching the
   mailbox.
8. To test the pause without sending 5,000 mails, deploy a staging build with `standard.forwardsPerMonth` in
   `lib/mail-plans.ts` lowered to 2, then run `mail:forward-usage`. Check the paused banner, that mail still
   reaches the Inbox and is not forwarded, and that restoring the limit resumes forwarding on the next run.
9. Remove the domain: Frogmail's domain, routes and destinations are gone; the MX can be deleted.
10. MCP: repeat steps 1–2 with the `mail_*` tools from Claude Code against staging.

## Open questions

1. Trash retention: is 30 days right? Frogmail's own copy follows its retention setting, so that setting should be
   no longer than Veerify's.
