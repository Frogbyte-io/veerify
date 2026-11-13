# Website forms API

Website forms let a site send contact and support form submissions straight into a project's Inbox. Each submission
is filed like a new email from the submitter:

- the contact is found by email (or created), and the mapped name is used for a new contact;
- a **new** conversation opens in the form's inbox, with the inbox's SLA policy, automation rules
  (`conversation_created`) and CSAT;
- the auto-reply is sent (the inbox's, the form's own, or none — set per form). Because anyone can type any address
  into a form, a form's auto-reply carries only the project's own text: the template, with the form name as subject.
  It never quotes or repeats what was submitted;
- agents see the form name, every field and the submission details in the thread, and their replies are emailed to
  the submitter through the normal outbound delivery. The customer's reply to that email threads back onto the same
  conversation.

There are two ways to submit:

| Endpoint                                        | For                            | Auth                                     |
| ----------------------------------------------- | ------------------------------ | ---------------------------------------- |
| `POST /api/v1/forms/{formSlug}/submissions`     | Your backend (recommended)     | Project server key (`vfy_srv_…`)         |
| `POST /api/public/forms/{publicId}/submissions` | Static sites without a backend | None: origin allowlist, honeypot, limits |

## Set up a form

1. **Inbox → Settings → Website forms → New form** (project admins). Pick a name and slug, the inbox, and the fields.
   "Use contact form fields" fills in name, email, subject (dropdown) and message.
2. Map the fields: **Contact email from** (a required email field, mandatory), **Contact name from** (a text field,
   optional), **Subject from** (a text or dropdown field, optional; otherwise the form name is the subject).
3. Choose the auto-reply: the inbox's, one for this form, or none.
4. Under the form list, **Create server key**. Copy the `vfy_srv_…` key (shown once) into your server's secrets.
5. **Connect** on the form row shows a ready-made `curl` for the form.

Field types: `text` (≤ 500 characters), `email` (≤ 254), `textarea` (≤ 10 000), `select` (the site sends the option
value; agents see its label), `checkbox` (boolean). Field keys are lowercase letters, digits, `_` and `-`. `_hp` is
reserved. A dropdown's options are entered one per line as `value | Label`.

Admin API (project admins, session or personal API key): `GET`/`POST /api/support/projects/{projectId}/forms`,
`PUT`/`DELETE /api/support/projects/{projectId}/forms/{formId}`. Server keys: `GET /api/projects/{slug}/api-keys?kind=server`,
`POST /api/projects/{slug}/api-keys` with `{ "name": "…", "kind": "server" }`, `DELETE /api/projects/{slug}/api-keys/{keyId}`.

## Server API

```
POST /api/v1/forms/{formSlug}/submissions
Authorization: Bearer vfy_srv_…
Content-Type: application/json
Idempotency-Key: <optional, unique per submission>
```

The key decides the project; `formSlug` is the form's slug in that project. Never send the key from a browser: this
endpoint grants no CORS.

### Request body (≤ 64 KiB)

```json
{
  "fields": {
    "name": "Kari Nordmann",
    "email": "kari@example.com",
    "subject": "support",
    "message": "My dot x will not boot."
  },
  "metadata": {
    "pageUrl": "https://shop.example.com/contact",
    "locale": "nb-NO",
    "brand": "dotmatrixlabs",
    "orderNumber": "DML-1042",
    "clientIp": "203.0.113.9",
    "userAgent": "Mozilla/5.0 …",
    "referrer": "https://shop.example.com/orders",
    "extra": { "cartItems": "3" }
  }
}
```

- `fields` (required): one entry per form field, by key. Strings for text, email, textarea and select (the option
  **value**); `true`/`false` for checkboxes. Unknown keys are rejected so a mismatch between site and form fails loudly.
  Values are trimmed, CRLF is folded to LF and control characters are removed. They are stored and shown as plain text,
  never rendered as HTML.
- `metadata` (optional, all keys optional, strings ≤ 2048): shown to agents under "Submission details", never sent to
  the customer. `extra` takes up to 20 more string values (keys `[A-Za-z0-9_.-]{1,40}`). Forward the visitor's
  `clientIp`: it also rate-limits submissions per visitor.

### Responses

`201 Created` (filed) or `200 OK` (idempotent replay, with header `Idempotent-Replayed: true`):

```json
{ "success": true, "data": { "id": "5d0c…", "conversationId": "9b1e…" } }
```

`id` is the submission id. Errors use the standard error body, with the machine-readable code in `data.error.code`:

```json
{
  "statusCode": 400,
  "statusMessage": "Validation failed",
  "data": {
    "success": false,
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "Some fields are invalid",
      "details": [
        { "field": "email", "message": "Not a valid email address" },
        { "field": "colour", "message": "Unknown field" }
      ]
    }
  }
}
```

| Status | `error.code`             | When                                                                                             |
| ------ | ------------------------ | ------------------------------------------------------------------------------------------------ |
| 400    | `VALIDATION_ERROR`       | Bad JSON, unknown top-level/metadata keys, invalid fields (`details`), malformed Idempotency-Key |
| 401    | `UNAUTHORIZED`           | Missing, unknown or revoked server key (app keys `vfy_pub_…` are refused)                        |
| 403    | `FORM_DISABLED`          | The form is switched off                                                                         |
| 403    | `INBOX_UNAVAILABLE`      | The form's inbox is disabled, or the project's Inbox tool is off                                 |
| 404    | `FORM_NOT_FOUND`         | No form with that slug in the key's project                                                      |
| 413    | `VALIDATION_ERROR`       | Body over 64 KiB                                                                                 |
| 422    | `IDEMPOTENCY_KEY_REUSED` | The Idempotency-Key was used before with a different body                                        |
| 429    | `RATE_LIMITED`           | Rate limit exceeded (see below); retry later                                                     |

### Idempotency

Send `Idempotency-Key` (1–255 printable ASCII characters, scoped to the form and to the endpoint: browser and server keys never collide) to make retries safe, for example a UUID
generated when the visitor presses Send. A retry with the same key and the same body (key order does not matter)
returns the original `id` and `conversationId` with `200` and `Idempotent-Replayed: true`; nothing is filed twice, even
when retries race. The same key with a different body is `422`. A retry of a filed submission is answered even if the form has since been switched off or edited. Keys are kept as
long as the form exists.

### Rate limits

| Bucket                                     | Limit           |
| ------------------------------------------ | --------------- |
| Per calling IP (before the key is checked) | 120 / minute    |
| Per server key                             | 600 / hour      |
| Per form and `metadata.clientIp`           | 10 / 10 minutes |

On top of that, the auto-reply is sent at most once an hour per contact, as for email.

### Example

```bash
curl -X POST https://app.veerify.io/api/v1/forms/contact/submissions \
  -H "Authorization: Bearer $VEERIFY_SERVER_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 2f6b1c1e-5a8e-4f4e-9d0a-0d1c2a3b4c5d" \
  -d '{
    "fields": {
      "name": "Kari Nordmann",
      "email": "kari@example.com",
      "subject": "support",
      "message": "My dot x will not boot."
    },
    "metadata": { "pageUrl": "https://shop.example.com/contact", "locale": "nb-NO", "clientIp": "203.0.113.9" }
  }'
```

A Nuxt/Nitro server route that relays a site's contact form:

```ts
// server/api/contact.post.ts
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  return $fetch(`${process.env.VEERIFY_URL}/api/v1/forms/contact/submissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.VEERIFY_SERVER_KEY}`,
      'Idempotency-Key': body.submissionId, // generated once in the browser
    },
    body: {
      fields: { name: body.name, email: body.email, subject: body.subject, message: body.message },
      metadata: {
        pageUrl: getRequestHeader(event, 'referer'),
        clientIp: getRequestIP(event, { xForwardedFor: true }),
        userAgent: getRequestHeader(event, 'user-agent'),
      },
    },
  })
})
```

## Browser endpoint

For sites without a backend. Off by default: switch on **Accept submissions straight from the browser** on the form
and list the **allowed origins** (`https://shop.example.com`, or `https://*.example.com` for any subdomain; scheme and
host only). The form's public id (`frm_…`) is shown in the form's **Connect** panel.

```
POST /api/public/forms/{publicId}/submissions
Content-Type: application/json            (or application/x-www-form-urlencoded)
Origin: https://shop.example.com           (sent by the browser)
Idempotency-Key: <optional>
```

JSON body:

```json
{
  "fields": { "name": "…", "email": "…", "subject": "support", "message": "…" },
  "metadata": { "pageUrl": "https://shop.example.com/contact", "locale": "nb-NO" },
  "_hp": "",
  "challengeToken": "…"
}
```

Form-encoded bodies use the field keys directly; `_hp`, `_page_url`, `_locale` and `_challenge` are reserved, and a
ticked checkbox may be sent as `on`, `true`, `1` or `yes`.

- **Origin**: requests whose `Origin` is not on the list get `403 ORIGIN_NOT_ALLOWED`; CORS (including the `OPTIONS`
  preflight) is granted to listed origins only, never `*`, never with credentials.
- **Honeypot**: add a hidden, empty input named `_hp`. When it is filled, the endpoint answers `201` as usual and files
  nothing.
- **Rate limits**: 5 per visitor IP per form per 10 minutes, and 200 accepted submissions per form per hour
  (honeypot hits and invalid requests don't count toward the per-form limit). The visitor IP is the first
  `X-Forwarded-For` entry, so the proxy in front of Veerify must overwrite that header.
- **Bot challenge**: Veerify has no CAPTCHA integration yet. `server/services/support-forms/challenge.ts` is the hook:
  it receives `challengeToken` and currently accepts every request; a failed check is `403 CHALLENGE_FAILED`.
  Cloudflare Turnstile can be added there.
- The visitor IP, user agent and page URL (from `metadata.pageUrl` or `Referer`) are recorded as submission details.
- `201` returns `{ "data": { "id": "…" } }` only: no internal ids go to the browser. Errors are as for the server API,
  plus `415` for other content types. An unknown public id and a form with browser submissions off are both `404`.

```html
<form id="contact">
  <input name="name" required />
  <input name="email" type="email" required />
  <textarea name="message" required></textarea>
  <input name="_hp" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true" />
  <button>Send</button>
</form>
<script>
  document.getElementById('contact').addEventListener('submit', async (event) => {
    event.preventDefault()
    const data = new URLSearchParams(new FormData(event.target))
    data.set('_page_url', location.href)
    const response = await fetch('https://app.veerify.io/api/public/forms/frm_XXXX/submissions', {
      method: 'POST',
      body: data, // form-encoded: no CORS preflight
    })
    // 201: show "Thanks"; 400: show response.json().data.error.details
  })
</script>
```

## In the inbox

A submission arrives as an incoming message from the submitter. The thread shows "Form: _name_", each field as
label and value, and a collapsible "Submission details" (page, locale, brand, order number, IP, user agent, extras,
and whether it came from a server or a browser). The message's plain-text body lists the same fields, which is what
appears in the conversation list and in the quoted history of replies. Every form conversation is a helpdesk
conversation; replies are sent from the inbox's sending address.

A form cannot be moved to another project. Deleting a form keeps its conversations; an inbox that forms deliver to
cannot be deleted until those forms are moved or deleted.
