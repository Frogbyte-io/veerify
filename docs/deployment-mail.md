# Mail transports and providers

Veerify sends two kinds of mail and receives one:

| Kind            | What                                                                                             | Transport                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Support mail    | Agent replies and auto-replies, sent by the support outbox (`server/utils/outbound-delivery.ts`) | Always the primary transport: `SMTP_*` (runtime `NUXT_NODEMAILER_*`)                |
| System mail     | Sign-in links, email verification, password reset, invitations, notifications, digests           | `SYSTEM_SMTP_*` when `SYSTEM_SMTP_HOST` is set, otherwise the same primary `SMTP_*` |
| Inbound support | Customer mail, posted by the provider to `/api/support/inbound/{provider}`                       | Webhook; signature checked with the selected provider's credentials                 |

The transport split lives in `lib/mail-transport.ts`. With `SYSTEM_SMTP_HOST` unset (the default),
every message uses the primary transport exactly as before, so the split only takes effect once an
operator opts in.

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

Frogmail, Frogbyte's email service, is Mailgun-compatible: an SMTP submission
gateway for outbound mail, Mailgun-format signed inbound callbacks and event webhooks, and
`GET /v4/domains`. Veerify talks to it through the existing `SMTP_*` and `mailgun` settings; no
Frogmail-specific code path exists. The staged cutover (outbound first, then inbound, each with its
own observation window) is described in the Frogmail repository's
`docs/acceptance/production-cutover.md`.

### Veerify environment

| Variable                       | Value                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `SMTP_HOST`                    | The Frogmail SMTP submission gateway host (TLS, on a private network or tailnet)                                                            |
| `SMTP_PORT`, `SMTP_SECURE`     | `587` + `false` (STARTTLS), or `465` + `true`                                                                                               |
| `SMTP_USER`                    | `api`                                                                                                                                       |
| `SMTP_PASS`                    | A Frogmail API key of the Veerify project with only the `emails:send` scope                                                                 |
| `MAIL_FROM`                    | Unchanged; its domain must be a verified Frogmail domain of the project (or a subdomain of one)                                             |
| `SUPPORT_CHANNEL_PROVIDER`     | `mailgun` (inbound stage)                                                                                                                   |
| `SUPPORT_MAILGUN_SIGNING_KEY`  | The project's Mailgun signing key, returned once by the first `POST /v3/routes` or `POST /v3/domains/{domain}/webhooks` (or a key rotation) |
| `SUPPORT_MAILGUN_API_BASE_URL` | The Frogmail origin, e.g. `https://mail.example.com` (no path). Empty means `https://api.mailgun.net`.                                      |
| `SUPPORT_MAILGUN_API_KEY`      | A Frogmail API key with only `domains:read`. Veerify calls `GET /v4/domains` to warn about From addresses Frogmail would refuse.            |
| `SUPPORT_MAILGUN_ACCOUNT_KEY`  | The sending domain, e.g. `veerify.io`                                                                                                       |

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

| Purpose                    | Frogmail call                                                                                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delivery and bounce status | `POST /v3/domains/<domain>/webhooks` for `delivered`, `permanent_fail` and `temporary_fail` → `https://<veerify-host>/api/support/delivery/mailgun`                   |
| Inbound support mail       | `POST /v3/routes` with `match_recipient("<support address>")`, `forward("https://<veerify-host>/api/support/inbound/mailgun")`, `stop()`; one route per inbox address |

Delivery events correlate through the `X-Mailgun-Variables` header the outbox adds to every support
reply, so `SUPPORT_MAILGUN_SIGNING_KEY` is needed from the outbound stage onwards even while inbound
mail still arrives through the previous provider.

### Rollback

Rollback is an environment revert and a redeploy: restore the previous `SMTP_*` (and, for the
inbound stage, `SUPPORT_CHANNEL_PROVIDER` and `SUPPORT_MAILGUN_*`) values. Keep the previous
provider's values in the secret store under rollback names until the cutover is decommissioned.
Messages Frogmail already accepted are still delivered and reported. No database change needs to be
undone: `provider_channel_message_id` is additive and unused by the previous providers.
