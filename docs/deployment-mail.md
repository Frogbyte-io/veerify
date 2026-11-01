# Mail transports and providers

Veerify sends two kinds of mail and receives one:

| Kind            | What                                                                                             | Transport                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Support mail    | Agent replies and auto-replies, sent by the support outbox (`server/utils/outbound-delivery.ts`) | The primary transport `SMTP_*` (runtime `NUXT_NODEMAILER_*`), or the Mailgun-compatible HTTP API with `SUPPORT_SEND_TRANSPORT=mailgun` |
| System mail     | Sign-in links, email verification, password reset, invitations, notifications, digests           | `SYSTEM_SMTP_*` when `SYSTEM_SMTP_HOST` is set, otherwise the same primary `SMTP_*`                                                    |
| Inbound support | Customer mail, posted by the provider to `/api/support/inbound/{provider}`                       | Webhook; signature checked with the selected provider's credentials                                                                    |

The transport split lives in `lib/mail-transport.ts`. With `SYSTEM_SMTP_HOST` unset (the default),
every message uses the primary transport exactly as before, so the split only takes effect once an
operator opts in. `SUPPORT_SEND_TRANSPORT` (`server/utils/support-mail-transport.ts`) is read only by the
support outbox; system mail never uses it.

## Dedicated system transport

| Variable             | Meaning                                                                               |
| -------------------- | ------------------------------------------------------------------------------------- |
| `SYSTEM_SMTP_HOST`   | Enables the dedicated transport. Empty or unset: system mail uses `SMTP_*`.           |
| `SYSTEM_SMTP_PORT`   | Defaults to `465` when `SYSTEM_SMTP_SECURE=true`, otherwise `587`.                    |
| `SYSTEM_SMTP_SECURE` | `true` for implicit TLS (465); `false` uses STARTTLS when the server offers it (587). |
| `SYSTEM_SMTP_USER`   | Authenticates only when both user and password are set.                               |
| `SYSTEM_SMTP_PASS`   | Secret. Keep it in the secret store, never in the repository.                         |
| `SYSTEM_MAIL_FROM`   | Default From for system mail. Falls back to `NUXT_NODEMAILER_FROM`, then `MAIL_FROM`. |

These are read from the process environment at send time, not baked into the Nuxt build, so a
prebuilt image switches transports with an environment change and a restart.

## Inbound routing and threading

- **Routing.** Mailgun-format callbacks carry the SMTP envelope recipient in `recipient`. Veerify
  matches the inbox on that address only, so Bcc'd, forwarded and aliased mail routes correctly and a
  `To`/`Cc` header naming another inbox cannot redirect it. Several comma-separated recipients are
  tried in the order given. The `To`, then `Cc`, headers are used only when a callback has no
  `recipient` (and always for Postmark, whose `OriginalRecipient` is its own hash address for
  forwarded mail).
- **Deduplication.** Mailgun-format providers post one callback per envelope recipient, all with
  the same `Message-Id`. The inbound event key is the `Message-Id` plus the envelope recipient, so a
  provider retry of one recipient's callback is still dropped while every recipient gets through.
  Each inbox then files a given `Message-Id` once (under a per-inbox lock), so one email sent to two
  inboxes creates two tickets, and one sent to two aliases of the same inbox creates one. Postmark's
  event key is its own per-delivery `MessageID` and is unchanged; the per-inbox check applies to it
  too.
- **Inline images.** `content-id-map` maps each `<Content-ID>` to its `attachment-N` field, as
  Mailgun documents; those parts are stored as inline and their `cid:` references rewritten.
- **Provider Message-IDs.** When a reply goes out under a different Message-ID than Veerify
  generated (SES behind Frogmail replaces it), the provider's id is stored in
  `conversation_message.provider_channel_message_id`. Veerify reads it from Frogmail's
  `event-data.frogmail.provider-message-id` on delivery events and from the SMTP
  `250 … queued as … <message-id>` reply; real Mailgun keeps the sent id, so nothing extra is
  stored there. A customer reply whose `In-Reply-To` or `References` names either id threads onto
  the conversation. Independently, Frogmail appends Veerify's own Message-ID after an SES id in the
  `References` of inbound callbacks (and reports the mapping in `frogmail-original-message-ids`),
  so such replies thread through `References` even before the provider id is known.

## Using Frogmail

Frogmail, Frogbyte's email service, is Mailgun-compatible: the Mailgun sending API
(`POST /v3/{domain}/messages`), an SMTP submission gateway, Mailgun-format signed inbound callbacks
and event webhooks, and `GET /v4/domains`. Veerify talks to it through the existing `mailgun` settings
(and optionally `SMTP_*`); no Frogmail-specific code path exists. The staged cutover (outbound first,
then inbound, each with its own observation window) is described in the Frogmail repository's
`docs/acceptance/production-cutover.md`.

### Sending support replies over the HTTP API (recommended)

With `SUPPORT_SEND_TRANSPORT=mailgun` the support outbox posts every reply to
`{SUPPORT_MAILGUN_API_BASE_URL}/v3/{From domain}/messages` instead of using SMTP. Customer domains
are verified in Frogmail, so replies from `support@<customer domain>` go out through Frogmail while
`SMTP_*` (e.g. Resend) keeps carrying system mail, which only uses Veerify's own domain. No SMTP
gateway is needed.

| Variable                       | Value                                                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPPORT_SEND_TRANSPORT`       | `mailgun`. Empty or `smtp` (the default) keeps support mail on `SMTP_*`. Any other value fails deliveries with a configuration error.                             |
| `SUPPORT_MAILGUN_API_BASE_URL` | The Frogmail origin, e.g. `https://frogmail.frogbyte.io` (no path). Empty means `https://api.mailgun.net`.                                                        |
| `SUPPORT_MAILGUN_SEND_API_KEY` | A Frogmail API key of the Veerify project with only `emails:send`. Empty falls back to `SUPPORT_MAILGUN_API_KEY` (which then needs `emails:send`) with a warning. |

Behaviour:

- **Mapping.** `from`, `to` and `cc` (one field per address), `subject`, `text`, `html`,
  `h:Reply-To`, and every outbox header as `h:<Name>`: `In-Reply-To`, `References` (trimmed to the
  root plus the newest ids that fit Frogmail's 998-character header limit),
  `X-Veerify-Idempotency-Key` and `X-Mailgun-Variables`. Frogmail turns `h:X-Mailgun-Variables`
  into the message's user variables, so delivery webhooks carry `user-variables.veerify-delivery-id`
  exactly as for SMTP sends. Attachments are `attachment` files; an attachment with a Content-ID is
  an `inline` file named by its cid, matching the `cid:` reference in the HTML.
- **Message-ID.** Frogmail refuses `h:Message-ID` and assigns its own, returned as `id`. Veerify
  stores it (without brackets) as the delivery's `provider_message_id` and as the message's
  `provider_channel_message_id`, so delivery events correlate and customer replies thread. Veerify's
  generated id stays in `channel_message_id`; with SES behind Frogmail, recipients never saw that id
  over SMTP either.
- **Retries.** The outbox's idempotency key is sent as the `Idempotency-Key` request header, so a
  retry after a timeout returns the original id instead of sending twice.
- **Failures.** `404 Domain not found`, `400 Domain … is not verified for sending yet`,
  `400 The sender domain …` and any `4xx` (but `429`) whose body or `X-Frogmail-Error` carries
  `sender_not_authorized` are sender rejections: the delivery fails terminally with
  `SENDER_DOMAIN_NOT_AUTHORIZED` and the project's domain claim is suspended (`lastErrorCode:
sender_rejected`, `suspendedReason: sender_rejected` in the sending-domain API), as for an SMTP 553.
  Over SMTP the same applies to provider text such as Resend's `550 The <domain> domain is not
verified`, which used to be retried five times as a generic failure.
  Everything else (other `4xx`, `401` with the `X-Frogmail-Error` reason, `429`, `5xx`, network
  errors and timeouts) is a retryable failure. A missing key is a configuration error that fails
  (and retries) the delivery rather than falling back to SMTP. The API key is never logged.

Roll back by setting `SUPPORT_SEND_TRANSPORT=smtp` (or clearing it).

What agents see in the thread (any transport): `Sending…`, `Sending… (attempt n of 5)` while the outbox retries,
`Sent`, `Delivered`, `Delayed – retrying` when a `temporary_fail` (soft bounce) arrives for a sent reply (never
overriding `delivered`, `bounced` or `failed`), and for a failed or bounced reply a plain reason (sender not
authorized, recipient rejected, mailbox full, provider unavailable, configuration error) with the provider's text
under "Details". The thread API returns these as `failureReason` and `deliveryAttempt`. When a reply finally fails
(outbox gave up, abandoned final attempt, or hard bounce) the agent who wrote it gets one in-app notification
(`reply_failed`); a manual Retry re-arms it.

### Veerify environment

The variables below cover inbound, delivery events, domain checks and the SMTP gateway path. With
the HTTP API above, the `SMTP_*` rows are not needed for support mail and keep pointing at the system
mail provider.

| Variable                       | Value                                                                                                                                                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SMTP_HOST`                    | The Frogmail SMTP submission gateway host (TLS, on a private network or tailnet)                                                                                                                           |
| `SMTP_PORT`, `SMTP_SECURE`     | `587` + `false` (STARTTLS), or `465` + `true`                                                                                                                                                              |
| `SMTP_USER`                    | `api`                                                                                                                                                                                                      |
| `SMTP_PASS`                    | A Frogmail API key of the Veerify project with only the `emails:send` scope                                                                                                                                |
| `MAIL_FROM`                    | Unchanged; its domain must be a verified Frogmail domain of the project (or a subdomain of one)                                                                                                            |
| `SUPPORT_CHANNEL_PROVIDER`     | `mailgun` (inbound stage)                                                                                                                                                                                  |
| `SUPPORT_MAILGUN_SIGNING_KEY`  | The project's Mailgun signing key, returned once by the first `POST /v3/routes` or `POST /v3/domains/{domain}/webhooks` (or a key rotation)                                                                |
| `SUPPORT_MAILGUN_API_BASE_URL` | The Frogmail origin, e.g. `https://mail.example.com` (no path). Empty means `https://api.mailgun.net`.                                                                                                     |
| `SUPPORT_MAILGUN_API_KEY`      | A Frogmail API key with `domains:read` (From-address check), plus `domains:manage` and `webhooks:manage` for customer sending domains and `routes:manage` for direct receiving. Never the `SMTP_PASS` key. |
| `SUPPORT_DELIVERY_WEBHOOK_URL` | Optional. Where the delivery webhooks Veerify creates point. Empty means `${BETTER_AUTH_URL}/api/support/delivery/mailgun`.                                                                                |
| `SUPPORT_MAILGUN_ACCOUNT_KEY`  | The sending domain, e.g. `veerify.io`                                                                                                                                                                      |

For a Coolify image, the primary transport is configured at runtime through
`NUXT_NODEMAILER_HOST`, `_PORT`, `_SECURE`, `_FROM`, `_AUTH_USER` and `_AUTH_PASS` (see the
[Coolify plan](plans/2026-09-21-coolify-deployment.md#environment-inventory)); the values are the
same as the `SMTP_*` column above.

### Keep sign-in mail on Resend

The primary transport carries support mail to Frogmail. To keep account mail independent of it,
point the dedicated system transport at Resend:

```
SYSTEM_SMTP_HOST=smtp.resend.com
SYSTEM_SMTP_PORT=465
SYSTEM_SMTP_SECURE=true
SYSTEM_SMTP_USER=resend
SYSTEM_SMTP_PASS=<Resend API key, from the secret store>
SYSTEM_MAIL_FROM=Veerify <noreply@veerify.io>
```

A Frogmail outage then delays support replies (they stay queued in the outbox and retry) but never
blocks sign-in, verification or password recovery.

### Frogmail configuration

Create these with the Veerify project's Frogmail key (Mailgun API shapes):

| Purpose                    | Frogmail call                                                                                                                                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delivery and bounce status | Automatic with customer sending domains (see below). Without them, once by hand: `POST /v3/domains/<domain>/webhooks` for `delivered`, `permanent_fail`, `temporary_fail` and `complained` → `https://<veerify-host>/api/support/delivery/mailgun` |
| Inbound support mail       | `POST /v3/routes` with `match_recipient("<support address>")`, `forward("https://<veerify-host>/api/support/inbound/mailgun")`, `stop()`; one route per inbox address                                                                              |

Delivery events correlate through the `X-Mailgun-Variables` header the outbox adds to every support
reply, so `SUPPORT_MAILGUN_SIGNING_KEY` is needed from the outbound stage onwards even while inbound
mail still arrives through the previous provider.

## Customer sending domains

With `SUPPORT_SENDING_DOMAINS_ENABLED=true`, project admins connect their own domains in Project settings → Email.
Designs: `docs/plans/2026-10-22-custom-sending-domains/design.md` (sending) and
`docs/plans/2026-10-28-email-addresses/design.md` (addresses, receiving, forwarding).

### Flow

1. An admin adds `acme.com`. Veerify records a claim for that project and calls Frogmail
   (`POST /v4/domains`) with the project key. A domain the project already has is adopted, never deleted
   by Veerify later.
2. The settings card shows the DNS records: the Frogmail sending (DKIM) records plus a Veerify ownership TXT
   `_veerify-mail.<domain>` (`veerify-mail-verification=<token>`). DKIM alone does not prove which project owns
   a domain, so every claim needs its own TXT proof.
3. A poller (every 5 minutes, `support:sending-domains-poll`) checks the pending claims. The domain becomes
   Verified once the TXT resolves and Frogmail reports it `active`. Admins can click Verify now.
4. Once a claim is verified, the poll (or Verify now) makes sure the domain's delivery webhooks exist:
   `delivered`, `permanent_fail`, `temporary_fail` and `complained`, each pointing at
   `SUPPORT_DELIVERY_WEBHOOK_URL` (empty: `${BETTER_AUTH_URL}/api/support/delivery/mailgun`). It reads
   `GET /v3/domains/<domain>/webhooks`, creates missing events with `POST`, and adds Veerify's URL with `PUT` to an
   event that already has other URLs (never removing them; an event already at Frogmail's limit of 3 URLs is logged
   and left alone). The claim then stores a marker (`delivery_webhooks_key`, a hash of provider, URL and events), so
   later checks make no webhook call until the URL changes or the domain is registered again. A failure (for example
   a key without `webhooks:manage`) is logged as `Could not ensure delivery webhooks` and retried on the next check;
   it never affects verification. On Frogmail the webhooks belong to the project, so every domain reads the same set.
   If Frogmail ever answers with a new `mailgun_signing_key` (only when the project had none), Veerify drops it and
   logs a warning: rotate the key in Frogmail and update `SUPPORT_MAILGUN_SIGNING_KEY`.
5. Only then may inbox From addresses on that domain send. Pending claims expire after 7 days. Domain and address
   limits count per workspace (`lib/mail-plans.ts`): `standard` 3 domains and 20 addresses, `owner` 69 and 420,
   at most 3 domains pending. Set a workspace's tier with `yarn mail:set-tier <workspace-slug> standard|owner`.

Under the project policy (forced by the flag) a From address must sit on a verified claim of the inbox's project,
or be its platform address. The outbox re-checks this as the final step and fails the delivery with
`SENDER_DOMAIN_NOT_AUTHORIZED` instead of sending. A domain Frogmail reports as owned by another project
(`frogmail_sending_owner: "other_project"`) stays Waiting for DNS with the note "Another service already sends
from this domain"; publishing DNS does not fix that, so use a subdomain.

### The separate-key rule

`SUPPORT_MAILGUN_API_KEY` needs `domains:read`, `domains:manage` and `webhooks:manage`, plus `routes:manage` if
direct receiving is used. It must be a different Frogmail key from `SMTP_PASS`, which keeps only `emails:send`. Frogmail limits
each key to 120 requests per minute, and a separate key keeps domain polling from competing with sending.

### Platform forwarding domain

Customers receive by forwarding `support@acme.com` to a per-inbox Veerify address on
`SUPPORT_PLATFORM_MAIL_DOMAIN` (for example `veerifymail.com`). One-time operator setup:

1. Use an apex zone on Cloudflare. Frogmail cannot receive on subdomains.
2. In the Frogmail dashboard, enable receiving for the zone and verify it for sending in the Veerify project.
3. Create one catch-all route: `match_recipient(".*@veerifymail.com")` →
   `forward("https://<veerify-host>/api/support/inbound/mailgun")`.

With the domain unset, no platform addresses are created and teams without a custom domain cannot send under
the `team` policy.

### Direct receiving (optional, operator step)

Frogmail receives only at a zone apex, and most customers keep their MX on Google Workspace or Microsoft 365,
so forwarding is the default. To receive on the domain itself, an operator enables receiving for the zone in
the Frogmail dashboard. Veerify never enables MX. It then sees `receiving_dns_records`, marks the claim
`receivesViaProvider`, and creates a `POST /v3/routes` route for each custom address on the verified domain.
Subdomain addresses cannot receive directly.

### Deleting a domain

Veerify deletes the Frogmail domain only if it created it. Frogmail refuses while the domain receives mail
(`domain_receives_mail`). Veerify then releases its claim anyway and records
`support.sending_domain.operator_cleanup_required`; an operator must remove the domain in the Frogmail
dashboard, which shows the MX and Email Routing changes first. The domain can be claimed again, and the TXT
proof still protects it.

### Backfill before enabling team policy

Teams that already send from their own domain would lose sending when `team` policy turns on. Before setting
`SUPPORT_SENDING_DOMAINS_ENABLED=true`, run the backfill against the production database:

```bash
yarn db:backfill-sending-domains                  # dry run: a report, nothing written
yarn db:backfill-sending-domains --json           # the same, machine readable
yarn db:backfill-sending-domains --apply          # create the claims
```

It collects every From domain in use (`support_inbox.email_address` and custom `project_mail_address` rows),
grouped by team, and skips platform, reserved and mailbox-provider domains. Per domain:

- Used by one team and `active` on the provider: creates an adopted `pending` claim through the normal claim rules.
  The team only has to publish the `_veerify-mail.<domain>` TXT record, which the report prints per team. Email
  those teams their record. A subdomain whose parent the same team also uses is covered by the parent claim.
- Not on the provider (or not yet active there): nothing is created; the team must add the domain first.
- Already claimed: reported and left alone. Claimed by another team: reported as a conflict.
- Used by several teams: reported for an operator to resolve. Never assigned automatically.

The run is idempotent and calls the provider one domain at a time (`--delay-ms`, default 600) to stay under the
120 requests per minute limit. `--apply` refuses to run when `NODE_ENV` is `production` or the
database host is not local, unless you add `--i-know-this-is-production`. A team at its claim limits (10 domains,
3 pending) shows as `BLOCKED`. The closing summary lists claims created, conflicts and teams needing DNS action.

### Receiving and forwarding through SES (`MAIL_FORWARDING_ENABLED`)

With Frogmail's SES receiving, a connected domain (apex or subdomain, on any DNS host) gets its own MX record and
receives mail directly, so a brand-new site can have `hello@newsite.com` without any other mail system. Each address
delivers to the project's Inbox, forwards to up to 5 external mailboxes, or both. Off by default; until it is on,
domains behave as described above.

Before turning it on:

1. Frogmail: SES receiving enabled (its one-time AWS setup), and acceptance passed on staging.
2. The `SUPPORT_MAILGUN_API_KEY` key also needs `usage:read`, on top of `domains:read`, `domains:manage` and
   `routes:manage`.
3. Subscribe a native webhook endpoint with the same key (`POST /api/v1/webhook-endpoints`) to
   `forward_destination.verified`, `forward_destination.revoked` and `forward_destination.suspended`, with URL
   `https://<veerify-host>/api/support/frogmail/events`. Put its signing secret in `FROGMAIL_WEBHOOK_SECRET`
   (comma-separate two secrets while rotating). Unset, the endpoint answers 404; the 5-minute domain poll still
   reconciles destination status, only later.
4. Set `MAIL_FORWARDING_ENABLED=true` and redeploy.

The delivery webhooks, including `complained`, are ensured by the domain poll (see [Flow](#flow)); no manual step.

What Veerify then does:

- The domain poll enables receiving for every claim (`PUT /api/v1/domains/{d}/receiving`) and stores its status
  (`pending_verification`, `pending_mx`, `active`) and `last_received_at`. Project settings → Email shows each domain
  as a checklist: 1. ownership TXT + DKIM, 2. the MX record (`10 inbound-smtp.<region>.amazonaws.com`, shown once the
  domain verifies), 3. a test email the admin sends from any mailbox, confirmed when `last_received_at` changes
  (`POST …/sending-domains/{id}/receiving-check` asks Frogmail on demand). No SPF change is needed: replies are
  DKIM-signed. A domain that already receives through Cloudflare stays on the routes-only path.
- While receiving is not active, Veerify looks up the domain's current MX hosts (`resolveMx`, 3 s timeout, on add and
  on every check; a DNS failure keeps the previous answer) and stores them in `existing_mx_hosts` (the SES host
  excluded). When there are any, the Email tab warns that the MX moves all mail for the domain, suggests a subdomain,
  and hides the MX value until the admin ticks "I understand". A verified domain waiting for receiving is checked
  every 5 minutes for its first hour, every 15 minutes for a day, hourly for a week, then daily.
- When a domain reaches `pending_mx`, project admins (workspace owners/admins and project admins) get one email,
  "one more DNS record to add", on the system transport. `mx_notice_sent_at` makes it once per domain.
- Each address is one route: `match_recipient("^addr$")` at priority 10, or `match_recipient("^.*@domain$")` at
  priority 100 for a catch-all, with `forward("<inbox URL>")` when it delivers to the Inbox, `forward("<mailbox>")`
  per forward, then `stop()`. Never `catch_all()`: all customers share one Frogmail project.
- Every forward mailbox confirms once per domain through an email from Frogmail. Forwarding starts at the
  confirmation; mail received before it is not forwarded later. Status shows as text in the address table and
  editor ("Waiting for confirmation", "Forwarding", "Stopped by recipient", "Suspended – bounced"); admins can
  resend the confirmation inline or stop it. Spam and virus mail is never forwarded; it lands in the Inbox Spam
  folder.
- A forward-only address (`deliverToInbox: false`) also delivers to the Inbox while none of its forwards is
  confirmed, so nothing is lost while recipients confirm (shown as "Delivering to the Inbox until a forwarding
  address is confirmed."). When the first forward is confirmed (`forward_destination.verified` webhook, or the
  poll's destination reconcile) the route is re-synced to forward-only; when the last confirmed one is revoked or
  suspended it falls back to the Inbox again. The route's state is stored as
  `project_mail_address.provider_route_inbox_fallback`, so the re-sync is idempotent and skips addresses already
  in the right state. Routes created before this change are healed by the next domain poll.
- Confirmation emails carry the Veerify project's name as their sender brand (`forwarding_brand_name`, one line, at
  most 80 characters): sent with `PUT …/receiving` when receiving is enabled, with `PATCH …/receiving` after a
  project rename, and by the poll when Frogmail reports another value. A Frogmail without brand support ignores the
  field on `PUT`, reports no field on `GET` (the poll then does nothing) and answers 422 to the `PATCH`, which is
  logged and ignored.
- `mail:forward-usage` (hourly, minute 15) sums `forwarded` from `GET /api/v1/domain-usage` over each workspace's
  receiving domains for the calendar month (UTC). At the tier limit (`standard` 5,000, `owner` 80,085) it pauses
  forwarding on those domains (`PATCH …/receiving {"forwarding_paused": true}`); mail still reaches the Inbox. It
  resumes them in a new month or after a tier change. Forwards count per mailbox. Project admins get one email when
  forwarding pauses and one when it resumes (only the pass that changed the domain sends it). The Email tab turns
  amber from 80 % of the monthly forwards.
- Deleting a domain (`DELETE /v3/domains/{d}`) disables receiving first and revokes its forward mailboxes.

Rollback: set `MAIL_FORWARDING_ENABLED=false`. Existing routes keep their forward actions until each address is
saved again or the domain is removed; pause forwarding in Frogmail to stop it at once.

### Frogmail error codes

Veerify reads `X-Frogmail-Error` on Mailgun-compatible calls and `code` on native `/api/v1` calls: `domain_taken`
(adopt), `domain_owned_elsewhere` (409), `invalid_domain` (422), `provider_unavailable` (502, retried),
`domain_receives_mail`, plus the auth codes `missing_scope` and `unauthenticated`. With forwarding:
`domain_receives_elsewhere` and `receiving_provider_conflict` (receiving retried on later polls),
`forward_destination_invalid` and `forward_would_loop` (400 on the address), `forward_requires_ses`,
`forward_requires_domain`, `domain_not_receiving` and `receiving_unavailable` (409), and `verification_throttled`
(429 with `Retry-After` on resend). Without a code it falls back to matching the message text.

### Rollback

Rollback is an environment revert and a redeploy: restore the previous `SMTP_*` (and, for the
inbound stage, `SUPPORT_CHANNEL_PROVIDER` and `SUPPORT_MAILGUN_*`) values. Keep the previous
provider's values in the secret store under rollback names until the cutover is decommissioned.
Messages Frogmail already accepted are still delivered and reported. No database change needs to be
undone: `provider_channel_message_id` is additive and unused by the previous providers.

To roll back customer sending domains alone, set `SUPPORT_SENDING_DOMAINS_ENABLED=false` and restart. Claims stay
in the database, the sender policy reverts to `legacy`, and the migration is purely additive.
