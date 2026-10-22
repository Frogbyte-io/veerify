# Custom sending domains for support: design

Status: approved for implementation, 2026-10-22. Decisions and remaining open questions are in §15.
Related: SUP-04-6 (From warning), commit `3762fb6` (subdomain authorization), D-28/SUP-X-4 (team-admin precedent), D-34 (provider config lives in env), `docs/deployment-mail.md`, Frogmail `docs/api/mailgun-compatibility.md` §Domains/§Routes, `docs/api/v1-contract.md` §2 and §9, `docs/dns-onboarding.md`.

---

## 1. Summary

Teams register their own sending domain on `/support/settings`. Veerify calls Frogmail with its one project key, shows the DNS records Frogmail returns plus a Veerify ownership TXT record, polls until both pass, and then lets inbox From addresses use that domain. Veerify becomes the tenant boundary. Every customer domain sits in one Frogmail project, and Frogmail authorizes per project, not per team. So Veerify has to decide which team may send as which domain. It enforces that in the settings warning, when an inbox is saved, when an agent replies, and as a final check in the outbox worker.

Inbound mail on customer domains has two paths:

- **Default:** the customer forwards `support@acme.com` to a Veerify-provided address on a platform receiving domain.
- **Optional:** "direct receiving". After an operator enables MX/receiving for the zone in the Frogmail dashboard, Veerify creates `POST /v3/routes` routes for the inbox addresses on that domain.

## 2. Findings that shape the design

1. **The current check is project-wide and leaks data.** `MailgunChannelDriver.checkSendingAuthorization` (`server/services/support-channels/webhook/mailgun.ts`) passes for any `active` domain in the Frogmail project. Its `unauthorized` verdict also returns `verifiedDomains`, which is every domain in the project. `server/api/support/inboxes/[id]/sending-status.get.ts` sends that list to any inbox agent. Once customers add domains, every team could read every other customer's domain list. This has to be fixed whatever else is decided.
2. **Nothing checks authorization at send time.** `checkSendingAuthorization` has one caller, the settings endpoint. `processOutboundDelivery` (`server/utils/outbound-delivery.ts`) sends whatever `payload.from` holds. Team A could set its From to `support@teamb.com` today, and Frogmail would accept it because the domain is verified for the project.
3. **DKIM verification does not prove which team owns a domain.** Frogmail never deletes the SES identity (`docs/dns-onboarding.md`, "Removing a domain"), so a domain's DKIM CNAMEs never change. If a previous owner left them published, any team that claims the domain would pass verification without touching DNS. Each claim therefore needs its own Veerify TXT challenge. `server/services/marketing/site-verification.ts` already does this with `resolveTxt`.
4. **Frogmail can report `active` for a domain it will not let us send from.** `POST /v4/domains` (`app/Services/DomainOnboarding.php::add`) only refuses a domain that another project has already *verified*. If both projects have it pending, both can verify. `SenderAuthorization::owningDomain` then gives sending to whichever verified first, but our `GET /v4/domains` still says `active` (see F-3).
5. **Frogmail re-checks pending domains on its own** every 10 minutes (`RecheckPendingDomains`, `routes/console.php:43`). Veerify can poll with the cheap `GET /v4/domains/{domain}` (`domains:read`) and save `PUT …/verify` for the user's "Verify now" click.
6. **Frogmail cannot receive mail on subdomains** (`docs/dns-onboarding.md`, "Apex and subdomain receiving"). Receiving requires Cloudflare MX at the zone apex. Most customers keep their apex MX on Google Workspace or Microsoft 365, so forwarding has to be the default. `match_recipient` routes only work on zones the project receives for, and that can only be enabled in the dashboard.
7. **Frogmail's Mailgun-adapter errors are `{message}` text only**, with no code. Auth errors are the exception and carry `X-Frogmail-Error`. Veerify needs to match on message text until F-2 ships.
8. **Rate limit:** 120 requests per minute per API key (`v1-contract.md` §9). Domain management must use a different key from the SMTP `SMTP_PASS` key so polling never competes with sending.
9. **Postmark has a full account-level Domains API** (`POST /domains`, `GET /domains/{id}`, `PUT /domains/{id}/verifyDkim`, `PUT /domains/{id}/verifyReturnPath`, `DELETE /domains/{id}`). The existing driver only reads the list. Decision for v1: Postmark runs in **list-only mode** (see §6.3). The claim, TXT proof and team-scoped enforcement all work there; an operator adds the domain in Postmark by hand. Full Postmark self-serve is a follow-up (Q6).
10. **Where things actually live:** the schema is in `server/database/schema/support.ts`, not `auth.ts` as `.agents/CLAUDE.md` says. The latest migration is `0054`. Metric names and fields are allow-listed in `server/utils/support-observability.ts`.

## 3. Goals and non-goals

**Goals:** team admins can add, verify and delete domains themselves; teams are strictly isolated (no team can send as, or receive for, a domain another team owns); the existing deployments keep working (Postmark, and Mailgun/Frogmail without management enabled); failures are visible and retried; nothing requires an operator except direct receiving.

**Non-goals (v1):** Veerify publishing DNS automatically (Frogmail keeps that behind its dashboard); enabling MX through the API; sharing domains across teams in an organization (Q1); full Postmark self-serve (Q6).

## 4. Tenant model and rules

### 4.1 Ownership

- One row per claimed domain in `support_sending_domain`, owned by exactly one team. The `domain` column is globally unique.
- A claim authorizes sending once it is `verified`, which requires both of these:
  - the Veerify ownership TXT `_veerify-mail.<domain> TXT "veerify-mail-verification=<token>"` resolves, and
  - the provider reports the domain `active` and, after F-3, owned by our project.
- Subdomains follow `matchVerifiedDomain` from `3762fb6`: a verified `acme.com` covers `x.acme.com`, matched on label boundaries, most specific claim wins. This only applies when the provider authorizes subdomains (`authorizesSubdomains`: true for Mailgun/Frogmail, false for Postmark).

### 4.2 Claim rules (checked in one transaction under a lock)

All values are normalized first: trimmed, lowercased, trailing dot removed, IDN converted to ASCII. `normalizeDomainHostname` in `server/services/domains/provider.ts` already does this.

1. The name must be valid. Each label matches `[a-z0-9-]`, up to 63 characters; the whole name is at most 253. `tldts.parse` must find an ICANN public suffix and a registrable domain. IP addresses are rejected. The `fake` provider also accepts `*.test` for e2e.
2. The name is not on the reserved list, and is neither an ancestor nor a descendant of a reserved entry. The list is: the domains of `MAIL_FROM`, `SYSTEM_MAIL_FROM` and `SUPPORT_MAILGUN_ACCOUNT_KEY`; `APP_DOMAIN`; `SUPPORT_PLATFORM_MAIL_DOMAIN`; and any extra entries in `SUPPORT_SENDING_DOMAINS_RESERVED`. Common mailbox providers are also refused (gmail.com, googlemail.com, outlook.com, hotmail.com, live.com, yahoo.com, icloud.com, me.com, proton.me, protonmail.com, gmx.*, aol.com), using a constant list in `lib/support-sending-domains.ts`.
3. **Across teams:** the new domain may not equal, sit under, or sit over any claim of another team in any status. `badacme.com` does not conflict with `acme.com`. The response is `409 DOMAIN_CLAIMED`, with the message "This domain, or a parent or subdomain of it, is already registered by another Veerify workspace." This tells the caller the domain exists elsewhere. Frogmail's dashboard discloses the same thing, and the owning team is never named.
4. **Within a team:** nested claims are allowed. `mail.acme.com` alongside `acme.com` is useful for separate DKIM keys or reputation.
5. **Limits:** at most `MAX_DOMAINS_PER_TEAM = 10` claims, of which at most `MAX_PENDING_PER_TEAM = 3` may be unverified. This limits squatting.
6. **Pending claims expire** after `PENDING_TTL_DAYS = 7`. The poller then deletes them, also removing the provider domain if Veerify created it. This caps how long a squatter can block the real owner.

Concurrency: the create transaction takes `pg_advisory_xact_lock(hashtext('support_sending_domain:' || registrable_domain))`. That serializes every claim under `acme.com`, so the ancestor/descendant check cannot race. The unique index on `domain` is the final guarantee.

### 4.3 When the domain already exists on the provider

| Provider answer to `POST /v4/domains` | Meaning | Veerify behaviour |
| --- | --- | --- |
| `200` | Registered | `providerOwnership = 'created'`, status `pending` |
| `400 This domain name is already taken` | It is already in *our* Frogmail project: added by an operator before self-serve, left over from an interrupted delete, or a legacy manual setup | **Adopt it:** `GET /v4/domains/{domain}`, set `providerOwnership = 'adopted'`, status `pending`. The team still has to pass the TXT proof. Veerify never deletes an adopted domain from the provider (§8.4). |
| `400 … verified sending domain of another project` | Another Frogmail project (another Frogbyte app) owns sending | Delete the Veerify row and return `409 DOMAIN_OWNED_ELSEWHERE`: "This domain is already used to send mail by another service. Remove it there first or use a subdomain." Nothing stays claimed. |
| `400`, any other message | Invalid name or a provider-side refusal | Delete the row and return `422 DOMAIN_REJECTED` with the sanitized provider message |
| `401` with `X-Frogmail-Error: missing_scope` | Operator misconfiguration | Delete the row, return `503 PROVIDER_MISCONFIGURED`, log an error |
| `429`, `5xx`, network error or timeout | Transient | Keep the row as `failed` with `nextCheckAt` from backoff. The poller retries; the admin can click Verify to retry immediately. Return `202` with the row. |

### 4.4 Sender policy (outbound)

`SUPPORT_SENDER_POLICY` has two values:

- `legacy`: today's behaviour. The verdict comes from the provider, with no team scope. This is the default when management is off, so existing Postmark and manual deployments behave as before. The leaked `verifiedDomains` list is removed in both modes.
- `team`: an address may be used as From only if one of these is true:
  - it sits on a `verified` claim of the inbox's team (subdomains per the provider), and the claim's `provider` and `providerAccountKey` match the current configuration, or
  - it is exactly one of the team's own platform addresses (§9.1).

`team` is the default whenever `SUPPORT_SENDING_DOMAINS_ENABLED=true`. Setting `legacy` together with management enabled is a misconfiguration: `validate-env` logs an error and `team` applies. Self-serve domains in one shared provider project are unsafe without team scope.

### 4.5 Where `team` policy is enforced

| Point | File | Behaviour |
| --- | --- | --- |
| Settings verdict | `server/api/support/inboxes/[id]/sending-status.get.ts` | Team-scoped verdict (§7.3). Never returns provider-wide lists. |
| Saving an inbox | `server/api/support/inboxes/[id].put.ts` | `emailAddress` must be on one of the team's own claims (any status except `deleting`) or be one of its platform addresses. Otherwise `422 SENDER_DOMAIN_NOT_OWNED`. A pending domain is allowed so teams can set things up ahead of time; replies stay blocked until it is verified. |
| Agent reply | `server/api/support/conversations/[id]/messages/index.post.ts` | Before the transaction: if not authorized, `409 SENDER_NOT_VERIFIED` ("Replies from support@acme.com are blocked until acme.com is verified in Support settings"). |
| Auto-reply | `server/api/support/inbound/[provider].post.ts` | If not authorized, skip the auto-reply, log it, and record metric `support.sending_domain.blocked` with `reason: 'auto_reply'`. The ticket is still created. |
| CSAT | `server/utils/csat.ts` | Same: skip and log. |
| Outbox worker (final check) | `server/utils/outbound-delivery.ts` `processOutboundDelivery` | Find the team (delivery → message → conversation → `teamId`) and re-check `payload.from.address`. If not authorized, fail the delivery as terminal immediately with `lastError = 'SENDER_DOMAIN_NOT_AUTHORIZED'`, without calling `sendEmail`. This covers code paths that enqueue directly, and domains deleted or suspended while mail was queued. The existing retry endpoint can resend once the domain is verified again. |

## 5. Schema (WP1; `server/database/schema/support.ts`, then `yarn db:generate`)

### 5.1 New table `support_sending_domain`

```ts
export const SUPPORT_SENDING_DOMAIN_STATUSES = ['provisioning','pending','verified','suspended','failed','deleting'] as const

export const supportSendingDomain = pgTable('support_sending_domain', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => team.id, { onDelete: 'cascade' }),
  domain: text('domain').notNull(),                       // normalized ASCII
  registrableDomain: text('registrable_domain').notNull(), // tldts getDomain(); lock + hierarchy query key
  status: text('status').default('provisioning').notNull(),
  provider: text('provider').notNull(),                   // 'mailgun' | 'postmark' | 'fake'
  providerAccountKey: text('provider_account_key').notNull().default(''),
  providerOwnership: text('provider_ownership'),          // 'created' | 'adopted' | null (not yet registered)
  providerState: text('provider_state'),                  // 'active' | 'unverified' | null
  receivesViaProvider: boolean('receives_via_provider').default(false).notNull(),
  ownershipToken: text('ownership_token').notNull(),
  ownershipVerifiedAt: timestamp('ownership_verified_at'),
  ownershipFailures: integer('ownership_failures').default(0).notNull(),
  providerFailures: integer('provider_failures').default(0).notNull(),
  dnsRecords: jsonb('dns_records').$type<SendingDomainDnsRecord[]>().default([]).notNull(),
  verifiedAt: timestamp('verified_at'),
  lastCheckedAt: timestamp('last_checked_at'),
  nextCheckAt: timestamp('next_check_at'),
  leaseExpiresAt: timestamp('lease_expires_at'),
  attemptCount: integer('attempt_count').default(0).notNull(),
  lastErrorCode: text('last_error_code'),
  lastError: text('last_error'),                          // sanitized, <= 500 chars
  expiresAt: timestamp('expires_at'),                     // pending-claim TTL; null once verified
  createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').$defaultFn(() => new Date()).notNull(),
  updatedAt: timestamp('updated_at').$defaultFn(() => new Date()).notNull(),
}, (t) => ({
  uniqueDomain: uniqueIndex('support_sending_domain_domain_idx').on(t.domain),
  teamIdx: index('support_sending_domain_team_idx').on(t.teamId),
  registrableIdx: index('support_sending_domain_registrable_idx').on(t.registrableDomain),
  dueIdx: index('support_sending_domain_due_idx').on(t.status, t.nextCheckAt),
  validStatus: check('support_sending_domain_status_check', sql`${t.status} in ('provisioning','pending','verified','suspended','failed','deleting')`),
  validOwnership: check('support_sending_domain_ownership_check', sql`${t.providerOwnership} is null or ${t.providerOwnership} in ('created','adopted')`),
}))
```

`SendingDomainDnsRecord` (exported from `lib/support-sending-domains.ts` so the UI can use it):

```ts
interface SendingDomainDnsRecord {
  purpose: 'ownership' | 'sending' | 'receiving' | 'recommended'
  type: 'TXT' | 'CNAME' | 'MX'
  name: string            // FQDN
  value: string
  priority?: string
  status: 'valid' | 'invalid' | 'unknown'
}
```

### 5.2 Changes to `support_inbox_address`

- `kind text not null default 'custom'`, constrained to `'custom' | 'platform'` (§9.1).
- `provider_route_id text` (nullable) and `provider_route_status text` (nullable), constrained to `'active' | 'failed'` (§9.2).

`support_inbox` is unchanged. The From domain is worked out from `emailAddress` at read time with `matchVerifiedDomain`, so there is no foreign key to keep in sync.

### 5.3 Status machine

```
provisioning --register ok--> pending --TXT ok + provider active--> verified
provisioning --transient error--> failed --retry ok--> pending
pending --TTL elapsed--> (row deleted; provider domain deleted if 'created')
verified --2 consecutive provider 'unverified' OR 3 consecutive TXT misses--> suspended
suspended --both checks pass--> verified
any --admin delete--> deleting --provider ok/permanent refusal--> (row deleted)
deleting --transient error--> deleting (poller retries)
```

Details added after review:

- `suspended --SUSPENDED_TTL_DAYS (30) elapsed--> (row deleted like an expired pending claim)`. The clock starts at the suspension (`expiresAt`), is not restarted by the daily checks, and is cleared when the claim recovers to `verified`.
- A `suspended` (or manually verified) claim whose provider domain is gone (`not_found`) is registered again (`provisioning`), not counted as a synthetic `unverified`. Providers without `capabilities.register` (Postmark list-only) treat "not listed" as `unverified`, so the TXT and DMARC checks run and the claim stays `pending`.
- `deleting --permanent provider refusal, or MAX_REMOVE_ATTEMPTS (12) failures--> (row deleted, metric operator_cleanup_required)`. Credential failures count as attempts too, so a row cannot stay `deleting` and block the domain for every team.
- An admin delete during an in-flight register or poll pass is refused with 409 `DOMAIN_BUSY` while `leaseExpiresAt > now`.
- A send refused by the provider with 553 / `sender_not_authorized` suspends the verified claim (`suspendClaimForSenderRejection`, reason `sender_rejected`).

## 6. Provider abstraction (WP2; new module `server/services/sending-domains/`)

This is kept separate from `ChannelDriver`, which handles inbound plus the authorization verdict. Domain management has its own lifecycle and credentials, and a separate module keeps file ownership clear for parallel work. The provider is chosen from `SUPPORT_CHANNEL_PROVIDER`. A non-production-only `SUPPORT_SENDING_DOMAIN_PROVIDER=fake` override exists for dev and e2e; it is refused when `NODE_ENV=production`.

### 6.1 Contract (fixed now, so every work package can code against it)

```ts
// server/services/sending-domains/types.ts
export interface SendingDomainCapabilities {
  register: boolean         // can create the domain at the provider
  verifyNow: boolean        // has an on-demand re-check
  remove: boolean
  inboundRoutes: boolean
  authorizesSubdomains: boolean
}
export interface ProviderDomainResult {
  domain: string
  state: 'active' | 'unverified'
  receivesMail: boolean                  // Frogmail: receiving_dns_records non-empty
  records: SendingDomainDnsRecord[]      // purpose 'sending' | 'receiving'
  message: string | null
}
export type SendingDomainErrorCode =
  | 'already_exists' | 'owned_elsewhere' | 'invalid_domain' | 'not_found' | 'receiving_enabled'
  | 'rate_limited' | 'unauthorized' | 'missing_scope' | 'provider_unavailable' | 'unknown'
export class SendingDomainProviderError extends Error {
  constructor(public code: SendingDomainErrorCode, message: string,
              public retryable: boolean, public retryAfterSeconds?: number) { super(message) }
}
export interface SendingDomainProvider {
  readonly name: string
  readonly accountKey: string
  readonly capabilities: SendingDomainCapabilities
  isConfigured(): { configured: boolean; missing: string[] }   // names only (D-34)
  register(domain: string): Promise<ProviderDomainResult>      // adopts on already_exists
  get(domain: string): Promise<ProviderDomainResult | null>    // null = not_found
  verify(domain: string): Promise<ProviderDomainResult>
  remove(domain: string): Promise<{ cleanup: { removed: string[]; kept: string[]; failed: string[] } | null }>
  createInboundRoute?(input: { address: string; forwardUrl: string; description: string }): Promise<{ routeId: string }>
  deleteInboundRoute?(routeId: string): Promise<void>
}
export function getSendingDomainProvider(): SendingDomainProvider | null

// server/services/sending-domains/ownership.ts
export function ownershipRecord(domain: string, token: string): SendingDomainDnsRecord
export async function checkOwnershipTxt(domain: string, token: string,
  deps?: { resolveTxt?: typeof import('node:dns/promises').resolveTxt }): Promise<'valid' | 'invalid' | 'unknown'>
export async function checkDmarc(domain: string, deps?): Promise<SendingDomainDnsRecord | null> // 'recommended' row when missing
```

### 6.2 Mailgun/Frogmail provider (`providers/mailgun.ts`)

- Reads `SUPPORT_MAILGUN_API_BASE_URL` (with the same `||` empty-string handling as the driver) and `SUPPORT_MAILGUN_API_KEY`. That key now carries `domains:read` and `domains:manage`, plus `routes:manage` if direct receiving is used. Authentication is Basic `api:<key>`.
- Calls:
  - `POST /v4/domains` (form `name=`)
  - `GET /v4/domains/{domain}`
  - `PUT /v4/domains/{domain}/verify`
  - `DELETE /v3/domains/{domain}`
  - `POST /v3/routes` with `expression=match_recipient("<escaped address>")`, `action=forward("<url>")`, `action=stop()`, `priority=10`, `description=veerify:<inboxId>:<addressId>`
  - `DELETE /v3/routes/{id}`
- Address escaping for routes: escape `.`, `-`, `_`, `+` as Frogmail requires. Refuse addresses containing `+` (Frogmail refuses an unescaped `+` and does not match plus-addressing).
- Mapping `DnsRecord` to `SendingDomainDnsRecord`: `record_type` becomes `type`; `valid` is passed through; the MX `priority` is kept; `sending_dns_records` become `purpose:'sending'` and `receiving_dns_records` become `purpose:'receiving'`.
- Error mapping, applied in order:
  - `X-Frogmail-Error` code (after F-2)
  - `401`: `missing_scope` / `unauthorized`
  - `404`: `not_found`
  - `429`: `rate_limited`, with `Retry-After`
  - `5xx`, network or `AbortSignal.timeout(10_000)`: `provider_unavailable`, retryable
  - `400` with `/already taken/i`: `already_exists`
  - `400` with `/another project/i`: `owned_elsewhere`
  - `400` with `/receives mail/i`: `receiving_enabled`
  - other `400`: `invalid_domain`
- Messages are sanitized (whitespace collapsed, at most 500 characters) and never contain the API key.
- Capabilities are all true, with `authorizesSubdomains: true`.
- The `fetchImpl` is injectable, following the existing driver pattern.

### 6.3 Postmark provider (`providers/postmark.ts`, list-only)

- Capabilities: `register:false, verifyNow:false, remove:false, inboundRoutes:false, authorizesSubdomains:false`.
- `register()` and `verify()` call `GET https://api.postmarkapp.com/domains?count=500&offset=0` with `SUPPORT_POSTMARK_ACCOUNT_TOKEN`. They return `state:'active'` when `DKIMVerified && ReturnPathDomainVerified`, otherwise `unverified`. `records` is empty and `message` says "Your Veerify operator adds this domain in Postmark and sends you its DNS records." `remove()` does nothing.
- The UI shows a "Managed by your operator" note in place of the provider records. The TXT proof and team enforcement work unchanged.

### 6.4 Fake provider (`providers/fake.ts`, never in production)

Its behaviour depends on the domain name, so e2e runs are repeatable:

- `*.verify-ok.test`: active after the first `verify()` call.
- `*.owned-elsewhere.test`: `owned_elsewhere`.
- `*.flaky.test`: `provider_unavailable` on the first `register`, then success.
- Anything else stays unverified.

In fake mode, `checkOwnershipTxt` returns `valid` for `*.verify-ok.test`. State is kept in memory per process; that is enough for one dev or preview server.

## 7. API (WP3), with OpenAPI JSDoc on every route

All routes live under `server/api/support/teams/[teamId]/sending-domains/` and use `requireAuth`, `validateBody`/`validateQuery` (zod), `createError` + `createErrorResponse`, and `createSuccessResponse`. If `SUPPORT_SENDING_DOMAINS_ENABLED` is false, every route except GET returns `404 FEATURE_DISABLED`. GET returns `{ enabled:false }`.

### 7.1 Endpoints

| Method and path | Who may call | Purpose | Rate limit (`requireRateLimit`, `subject`) |
| --- | --- | --- | --- |
| `GET …/sending-domains` | `resolveSupportTeamRole` non-null (any support role) or team admin | List the team's claims with records, plus `{ enabled, policy, provider, capabilities, canManage, limits, providerConfigured, missingEnvVars }` | none |
| `POST …/sending-domains` `{ domain }` | `requireTeamAdmin` | Claim and register (§4.2, §4.3). `201` for pending, `202` for failed but retrying. | `sending-domain-create`: 10 per hour per team; 5 per minute per user |
| `GET …/sending-domains/[id]` | as list | Detail, including the inboxes using this domain (`inboxes: {id,name,emailAddress}[]`) | none |
| `POST …/sending-domains/[id]/verify` | `requireTeamAdmin` | `failed`/`provisioning`: run register again. Otherwise: provider `verify()` (or `get()` without `verifyNow`), then TXT and DMARC checks, then save. Returns the row. | `sending-domain-verify`: 1 per 20 seconds per domain; 60 per hour per team |
| `DELETE …/sending-domains/[id]?force=true` | `requireTeamAdmin` | If inboxes use the domain and `force` is not set, `409 DOMAIN_IN_USE` with the inbox list. Otherwise delete per §8.4. | 20 per hour per team |

Every route checks that the claim belongs to `teamId` (`and(eq(id), eq(teamId))`) and returns 404 otherwise, never 403, so claim ids stay opaque. Mutations are admin-only because a domain affects every inbox of the team. This follows the D-28 reasoning that changes with team-wide effect need `teamMember.role === 'admin'`. Inbox admins still choose their inbox's From address, but only from the team's own domains (§4.5).

### 7.2 Response shape for a claim

```json
{ "id": "…", "domain": "acme.com", "status": "pending",
  "providerState": "unverified", "ownershipVerified": false, "receivesViaProvider": false,
  "records": [ /* ownership row first, then sending, receiving, recommended */ ],
  "lastCheckedAt": "…", "nextCheckAt": "…", "expiresAt": "…", "verifiedAt": null,
  "lastErrorCode": null, "lastError": null, "providerOwnership": "created",
  "providerMismatch": false }
```

`providerMismatch` is true when the claim's `provider`/`providerAccountKey` differ from the current configuration, for example after switching Frogmail projects. The UI then offers "Register again" (the verify endpoint calls `register`).

### 7.3 `sending-status` response (changed)

```ts
{ address: string | null, policy: 'legacy' | 'team',
  authorization:
   | { status: 'authorized'; domain: { id: string; domain: string } | null; platform?: true }
   | { status: 'pending'; domain: { id: string; domain: string; status: string } }
   | { status: 'unauthorized'; reason: 'not_owned' | 'suspended' | 'provider_mismatch'; teamDomains: string[] }
   | { status: 'unknown'; reason: string } }
```

`teamDomains` lists only the caller's team's verified domains. In `legacy` mode the verdict is the driver's, with `verifiedDomains` removed. The SUP-04-6 rule still holds: `unknown` must never be shown as "not authorized".

### 7.4 Shared server helpers (WP1, `server/utils/sending-domains.ts`)

```ts
export function resolveSenderPolicy(): 'legacy' | 'team'
export function isSendingDomainsEnabled(): boolean
export function reservedSendingDomains(): string[]
export async function createSendingDomainClaim(input: { teamId; domain; userId; provider; providerAccountKey }):
  Promise<typeof supportSendingDomain.$inferSelect>            // lock + rules + insert 'provisioning'
export async function listTeamSendingDomains(teamId: string)
export async function getTeamSendingDomain(teamId: string, id: string)   // 404 on cross-team
export async function resolveTeamSenderAuthorization(teamId: string, address: string,
  opts?: { executor?: Pick<typeof db,'select'>; provider?: { name: string; accountKey: string; authorizesSubdomains: boolean } }):
  Promise<TeamSenderVerdict>                                    // §7.3 union, pure DB read
export async function assertSenderAddressAllowedForInbox(teamId: string, address: string): Promise<void> // §4.5 PUT rule
export async function assertReceivingAddressAllowed(teamId: string, address: string): Promise<void>      // §9.3
export function applyProviderResult(row, result, ownership: 'valid'|'invalid'|'unknown', now): Partial<Row> // pure status transition
```

`applyProviderResult` and the hierarchy rules are pure functions in `lib/support-sending-domains.ts`, so they can be unit tested without a database:

```ts
export function normalizeSendingDomain(input: string): string
export function validateSendingDomain(domain: string, opts: { reserved: string[]; allowTestTld: boolean }): string | null
export function findHierarchyConflict(domain: string, teamId: string, claims: { domain: string; teamId: string }[]): { domain: string } | null
export function relativeRecordHost(fqdn: string, zone: string): string   // "_veerify-mail" for UIs that append the zone
export const MAX_DOMAINS_PER_TEAM = 10, MAX_PENDING_PER_TEAM = 3, PENDING_TTL_DAYS = 7
```

## 8. Background polling, failures and retries (WP3)

### 8.1 Task wiring (follows the existing scheduler pattern)

- `server/services/scheduler/tasks/sending-domains-poll.ts`: `defineScheduledTask('support:sending-domains-poll', '*/5 * * * *', () => runSendingDomainPoll())`.
- `server/tasks/support/sending-domains-poll.ts`: Nitro `defineTask` adapter.
- `server/api/cron/support-sending-domains-poll.get.ts`: `createCronHttpHandler(...)` with an OpenAPI block (tag `Internal`).
- `nuxt.config.ts` `scheduledTasks['*/5 * * * *']` and a `vercel.json` cron entry.

### 8.2 Poll pass (`server/utils/sending-domain-poller.ts`)

- Claims due rows the same way as `claimNextOutboundDelivery`: `UPDATE … WHERE id IN (SELECT … WHERE next_check_at <= now AND (lease_expires_at IS NULL OR lease_expires_at < now) ORDER BY next_check_at FOR UPDATE SKIP LOCKED LIMIT 25)`, with a 2-minute lease. The pass stops after 45 seconds, or after 3 consecutive `provider_unavailable` results (a simple circuit breaker).
- What each status does:
  - `provisioning` / `failed`: `register()`.
  - `pending`: `get()`, plus TXT and DMARC checks. Becomes `verified` when TXT is valid and the provider is `active`. Past `expiresAt`, the expiry deletion runs.
  - `verified` / `suspended`: `get()` and TXT, once a day. Update the failure counters and apply the §5.3 transitions.
  - `deleting`: `remove()`.
- Next check for pending claims: every 5 minutes for the first hour, every 15 minutes until 24 hours, then hourly until expiry. Verified claims are checked every 24 hours. Failed registrations back off exponentially (5, 10, 20 … up to 6 hours) with ±20% jitter, reusing the shape of `computeNextAttemptAt`. After 8 failed register attempts the claim stays `failed` with `nextCheckAt = null` until an admin clicks Verify.
- `rate_limited` sets `nextCheckAt = now + Retry-After` and does not count as an attempt.
- `missing_scope` / `unauthorized` stop the whole pass: log an error and record metric `support.sending_domain.provider_misconfigured`. No row is changed.
- Each transition records `support.sending_domain.{verified|suspended|expired|failed|deleted}` with `{ domainId, provider, status, reason }`. WP1 adds these names and the `domainId` field to the allow-lists in `server/utils/support-observability.ts`.

### 8.3 Interaction with inboxes

When a claim moves to `suspended` or `deleting`, nothing is changed on inbox rows. Enforcement is evaluated at read and send time, so recovery needs no backfill. On a move to `verified`, the poller looks for `support_inbox_address` rows of *other* teams on that domain or its subdomains (they could only exist from before enforcement). It detaches them (deletes the row) and logs `support.sending_domain.address_detached`. This only happens under `team` policy (Q4).

### 8.4 Deletion

1. In one transaction: set the row to `deleting`. From this point it stops authorizing.
2. If `providerOwnership === 'created'` and the provider can remove: call `remove()`.
   - Success, or `not_found`: delete the row and its provider routes.
   - `receiving_enabled` (Frogmail refuses while the domain receives mail): delete the Veerify row anyway, record metric `support.sending_domain.operator_cleanup_required`, and tell the admin "Veerify released this domain. Your operator must remove it from the mail provider because it receives mail there." The domain can be claimed again, and the TXT proof still protects it.
   - Transient error: keep `deleting`; the poller retries.
3. If `providerOwnership === 'adopted'` or `null`: delete the row only, never the provider domain.

## 9. Inbound

### 9.1 Forwarding to a platform address (default, WP4)

- `SUPPORT_PLATFORM_MAIL_DOMAIN`, for example `veerifymail.com`. It must be an apex zone that receives through Frogmail (an operator step: Frogmail dashboard "Enable receiving", plus one catch-all route `match_recipient(".*@veerifymail.com")` → `forward(<inbound url>)`). It is also verified for sending in the Frogmail project.
- On inbox create (`server/api/support/inboxes/index.post.ts`), and lazily for existing inboxes through `POST /api/support/inboxes/[id]/addresses/platform` (inbox admin, idempotent), Veerify creates a `support_inbox_address` row with `kind='platform'`. The address is `<teamSlug>-<inboxSlug>-<6 random base32>@<platform domain>`, trimmed to 64 characters in the local part. The random suffix stops people guessing addresses to spam. Users cannot delete platform rows; they can regenerate one (the old address is removed).
- The channel card shows "Forward support@acme.com to `<platform address>`" with a copy button, plus notes for Google Workspace and Microsoft 365. Gmail's forwarding confirmation email arrives as a ticket, so the code is visible inside Veerify.
- Under `team` policy, the platform address is also an authorized From (§4.4). Teams without a custom domain can still reply, and nobody can impersonate a platform domain.
- **Product attribution with forwarding.** The envelope recipient is the platform address, which identifies the inbox. To keep the per-product mapping from D-27, once the inbox is resolved through a `kind='platform'` address, `server/utils/inbound-routing.ts` also tries the `To`/`Cc` headers against *that same inbox's* custom addresses to pick `projectId`. There is no cross-tenant risk because the inbox is already fixed by the envelope.

### 9.2 Direct receiving through provider routes (optional, WP4)

- The poller sets `receivesViaProvider = result.receivesMail`. This is the Frogmail `receiving_dns_records` non-empty signal, which appears only after an operator enabled receiving for the apex in the Frogmail dashboard. Veerify never enables MX.
- When a `custom` receiving address is added on a team's *verified* claim that has `receivesViaProvider`, and the provider supports `inboundRoutes`, Veerify creates a route. The forward URL is `SUPPORT_INBOUND_WEBHOOK_URL` or `${BETTER_AUTH_URL}/api/support/inbound/<provider>`. The route id and status are stored on the address row.
  - A route failure does not fail the address create. The status becomes `failed` and the poller retries on its daily pass.
  - Deleting the address deletes the route on a best-effort basis.
  - Deleting the domain deletes all its routes first.
- Subdomain addresses (`support@help.acme.com`) cannot receive directly (a Frogmail limitation). The UI says so and points to forwarding.

### 9.3 Receiving-address rule (`assertReceivingAddressAllowed`)

Under `team` policy, `POST /api/support/inboxes/[id]/addresses` refuses an address in these cases:

- its domain sits on or under another team's claim (`409 ADDRESS_DOMAIN_CLAIMED`), or
- its domain is the platform domain, or under it, and the address was not system-generated (`422 ADDRESS_DOMAIN_RESERVED`). This holds when the operator sets `SUPPORT_PLATFORM_MAIL_DOMAIN` equal to `APP_DOMAIN`: platform addresses still work, and customers can neither claim the domain or a subdomain of it nor enter an address on it by hand, or
- the provider routes inbound mail by the To/Cc header and the domain is not on the team's own verified claim (`422 ADDRESS_DOMAIN_UNVERIFIED`).

Postmark routes by header: its inbound payload has no envelope recipient, so `envelopeRecipients` is empty and `resolveInboxByAddress` falls back to To/Cc. A team could otherwise add `support@other-team.com` and capture that team's mail. On such a provider the address must therefore be on (or under) one of the team's own `verified` claims of the current provider. Forwarding to the platform address needs no custom address, so it is unaffected.

On Mailgun and Frogmail, which route by envelope recipient, addresses on unclaimed domains are still allowed. Forwarding depends on them, and they cannot capture mail that does not reach Veerify by envelope.

Under any policy (including `legacy` with the flag off), a From address on or under another team's claim in any status is refused at the inbox PUT, reply, auto-reply, CSAT and the outbox final check. `resolveEffectiveSenderPolicy()` also returns `team` whenever at least one claim row exists, so rolling management back cannot reopen cross-team sending. It reads the table once and caches the answer for 30 seconds per process; claim creation in the same process refreshes it. The synchronous `resolveSenderPolicy()` keeps returning the configured policy only.

## 10. UI (WP5, `/support/settings`, Options API only)

New components; `pages/support/settings.vue` only gets small insertions:

- **`components/support/SupportSendingDomains.vue`**, a card in the team section. Props: `teamId`, `canManage` (from the list response, not the page). States: `isLoading` shows Skeleton rows, `error` shows a message and Retry, `!enabled` hides the card, and the list renders otherwise.
  - Header shows the provider label. Without `providerConfigured`, it lists `missingEnvVars` (names only, as in the Channel card).
  - "Add domain" (admins only) opens a Dialog with an Input. Client-side checks use `validateSendingDomain`. Server errors (409 claimed, 409 owned elsewhere, 422, 429) appear inline.
  - Each domain row shows the domain, a status Badge, "Last checked x ago · next check in ~y" and "Expires in n days" while pending, then the actions Verify now (spinner, disabled during the cooldown and while busy) and Delete. An Expand toggle opens the DNS table.
  - Status labels: Provisioning, Waiting for DNS, Verified, Suspended (with the reason: "DNS records no longer found"), Failed (with `lastError` and "Retry"), Removing. Colours reuse the emerald/amber/muted classes from the existing sending-status block.
  - The card polls `GET` every 30 seconds while any row is provisioning, pending or deleting and the tab is visible (`document.visibilityState`). The interval is cleared in `beforeUnmount`.
  - Delete opens a confirm Dialog. On `409 DOMAIN_IN_USE`, it lists the inboxes and offers "Delete anyway"; those inboxes will be blocked from sending.
  - The `receiving_enabled` outcome shows a toast explaining the operator step.
- **`components/support/SupportDnsRecordTable.vue`** with columns Purpose, Type, Host (the relative host from `relativeRecordHost`, FQDN in a tooltip), Value (monospace, truncated with expand), Priority, Status (check / cross / clock icon with a text label for accessibility).
  - Copy buttons for host and value use the page's existing `copy()` pattern (`navigator.clipboard` with a toast on failure). Records are ordered ownership, sending, receiving, then recommended DMARC (marked "recommended").
  - In Postmark list-only mode, the provider rows are replaced by an "Your operator provides these records" note.
- **`components/support/SupportFromAddressPicker.vue`** replaces the free-text "From address" input in the General card.
  - Under `team` policy: a local-part Input, an "@", and a select with the team's platform addresses, then verified domains, then pending domains (labelled "(waiting for DNS)"). Unverified subdomains are not offered as separate entries; a verified parent allows typing `support@mail.acme.com` through a "Use a subdomain" option.
  - Under `legacy` policy it is today's free-text input.
  - It emits the full address into `generalEmailAddress`, so `saveGeneral` does not change.
  - The sending-status block under it renders the new `pending` state ("Replies are blocked until acme.com is verified") and `unauthorized.reason`.
- `settings.vue` edits: mount `<SupportSendingDomains>` above the inbox section, swap the From input for the picker, and add the platform forwarding address to the Channel card. These are three insertions, all marked with `data-testid` (`support-sending-domains`, `support-sending-domain-row`, `support-dns-record-copy-value`, `support-from-picker`).

## 11. Environment, docs and Frogmail

### 11.1 Veerify environment (add to `.env.example`, `docker-compose.yml` with `${VAR:-}`, and `docs/deployment-mail.md`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `SUPPORT_SENDING_DOMAINS_ENABLED` | `false` | Turns on self-serve domains (card and mutating endpoints). Forces the `team` policy. |
| `SUPPORT_SENDER_POLICY` | empty | `legacy` or `team`. Empty means `team` when the above is enabled, otherwise `legacy`. |
| `SUPPORT_MAILGUN_API_KEY` | existing | Scope widened: `domains:read`, `domains:manage`, and `routes:manage` if direct receiving is used. Must be a **different key** from `SMTP_PASS`, which keeps only `emails:send`. |
| `SUPPORT_PLATFORM_MAIL_DOMAIN` | empty | The apex receiving and sending zone for platform forwarding addresses. Empty means no platform addresses. |
| `SUPPORT_SENDING_DOMAINS_RESERVED` | empty | Comma list of extra domains no team may claim. |
| `SUPPORT_INBOUND_WEBHOOK_URL` | empty | Forward URL for created routes. Empty means `${BETTER_AUTH_URL}/api/support/inbound/<provider>`. |
| `SUPPORT_SENDING_DOMAIN_PROVIDER` | empty | `fake` for dev and e2e only. Refused in production. |

`server/plugins/validate-env.ts` gains warnings (not crashes) for these cases:

- management enabled but the provider is unconfigured, or the provider cannot `register` (Postmark list-only is allowed and logged);
- `legacy` policy set together with management enabled;
- `fake` set in production (refused).

`docs/deployment-mail.md` gets the following changes:

- In the Frogmail table, `SUPPORT_MAILGUN_API_KEY` changes from "only `domains:read`" to the new scope set.
- A new section, "Customer sending domains", covering the flow, the separate-key rule, the platform forwarding domain setup (enable receiving plus a catch-all route), the operator step for direct receiving, and the operator cleanup after a `receiving_enabled` delete.
- The rollback section gains: set `SUPPORT_SENDING_DOMAINS_ENABLED=false`. Claims stay in the database, policy reverts, and the migration is purely additive.

### 11.2 Frogmail-side requirements

| # | Need | Required? | Where in Frogmail |
| --- | --- | --- | --- |
| F-1 | Issue a Veerify project key with `domains:read`, `domains:manage` (and `routes:manage` if direct receiving is used), separate from the SMTP `emails:send` key, so the 120/min per-key budget is not shared | Config only, required | Scopes exist in `app/Support/ApiScope.php` |
| F-2 | Machine-readable codes on domain endpoint errors: `X-Frogmail-Error: domain_taken \| domain_owned_elsewhere \| invalid_domain \| provider_unavailable \| domain_receives_mail`. Veerify matches message text until then. | Required (small) | `app/Http/Controllers/Mailgun/DomainController.php` (`store`, `destroy`), `app/Services/DomainOnboarding.php::add` (the `RuntimeException`); `app/Exceptions/MailgunApiException.php` already accepts headers |
| F-3 | `GET /v4/domains[/{domain}]` must not report `active` when another project owns sending for the domain (two projects with it pending, the other verified first). Either report `unverified` or add an extension such as `frogmail_sending_owner: "other_project"`. Without this Veerify shows Verified and sends fail with `sender_not_authorized`/553. Veerify's outbox records those as failures, so the impact is limited, but the status would be wrong. | Required for correct status | `app/Services/Mailgun/MailgunDomains.php::present`/`detail`, using `app/Services/SenderAuthorization.php::owningDomain` |
| F-4 | Confirm that `DomainOnboarding::add` repointing `$source->domain_id` to each newly added domain has no side effects when one project adds many customer domains. Otherwise skip that assignment for API-created domains. | Verify; change only if needed | `app/Services/DomainOnboarding.php` (the line `$source->forceFill(['domain_id' => …])`) |
| F-5 | Contract fixtures for domain create, detail, verify and delete, and for route create/delete as Veerify sends them, plus `tests/Fixtures/Contract/veerify/sending-domains.json` covered by `VeerifyContractTest`, matching how `domains-list.json` pins the current check | Required | `tests/Fixtures/Contract/mailgun/`, `tests/Fixtures/Contract/veerify/` |
| F-6 | A domain state-change webhook (`domain.verified` / `domain.unverified`) to replace polling | Nice to have | event pipeline |
| F-7 | Receiving on subdomains (`docs/dns-onboarding.md`, "Addresses at a subdomain … are not supported") | Not needed for v1; forwarding covers it | inbound provisioning |
| F-8 | One-time operator setup of the platform receiving zone and its catch-all `match_recipient(".*@<zone>")` route | Operator step, existing capability | dashboard |

## 12. Tests (repo patterns)

**Unit (`tests/*.test.ts`, vitest, no DB or network)**

- `tests/support-sending-domain-rules.test.ts`:
  - normalization (case, trailing dot, IDN to punycode);
  - validation (public suffix only, IP, too long, reserved plus ancestors/descendants, mailbox-provider denylist, `.test` only when allowed);
  - `findHierarchyConflict` (label boundary `badacme.com`, cross-team ancestor and descendant, same-team nesting allowed);
  - `relativeRecordHost`;
  - `applyProviderResult` (every transition in §5.3, including the 2× and 3× suspension thresholds and recovery).
- `tests/sending-domain-provider-mailgun.test.ts`:
  - injected `fetchImpl` for every call, checking request shape and Basic auth;
  - record mapping with MX priority;
  - every error mapping (400 already-taken leads to adopt via GET; 400 another-project; 401 with `X-Frogmail-Error: missing_scope`; 404; 429 with `Retry-After`; 5xx; network error; timeout);
  - route expression escaping and the `+` refusal;
  - payloads copied from the F-5 fixtures once they exist.
- `tests/sending-domain-provider-postmark.test.ts`: list-only behaviour and exact-domain matching.
- `tests/sending-domain-ownership.test.ts`: injected `resolveTxt` (chunked TXT joined, NXDOMAIN gives invalid, SERVFAIL gives unknown); DMARC recommendation.
- `tests/sending-domain-poller.test.ts`: backoff schedule, Retry-After handling, the circuit breaker, expiry, all with injected deps.
- Extend `tests/support-channels-outbound.test.ts` to assert `sending-status` never exposes provider-wide lists. Extend `tests/outbound-delivery.test.ts` so the final check fails terminally without calling `sendEmail`. Extend `tests/support-route-authorization.test.ts` and `tests/support-route-validation.test.ts` for the new routes (admin vs member, cross-team 404, zod 400). `tests/openapi-scanner.test.ts` covers the JSDoc blocks automatically.

**Postgres integration (`tests/integration/*.test.ts`, run with `yarn test:integration:postgres:if-available`)**

- `sending-domain-claims.test.ts`:
  - two teams claim `acme.com` concurrently: exactly one row;
  - team A claims `acme.com` while team B claims `mail.acme.com` concurrently: one wins, which shows the advisory lock works;
  - per-team limits;
  - two poll passes running at once never process the same row (`SKIP LOCKED`);
  - expiry deletes the row.
- `sending-authorization.test.ts`:
  - team A verified `acme.com`; team B's inbox From `support@acme.com` is unauthorized, and team A's `x.acme.com` is authorized (mailgun) or not (postmark);
  - pending claims are not authorized;
  - an outbox delivery for team B is failed terminally with `SENDER_DOMAIN_NOT_AUTHORIZED`;
  - suspension blocks and recovery unblocks;
  - `assertReceivingAddressAllowed` across teams;
  - platform address authorization.

**Playwright (`tests/e2e/support-sending-domains.spec.ts`, run with the `fake` provider: `playwright.config.ts` `webServer.env` sets `SUPPORT_SENDING_DOMAINS_ENABLED=true` and `SUPPORT_SENDING_DOMAIN_PROVIDER=fake` unless the caller overrides)**

1. A team admin adds `acme.verify-ok.test`. The DNS table shows the ownership row first, and copying the value works (`context.grantPermissions(['clipboard-read','clipboard-write'])`). Verify now changes the status to Verified. The From picker offers the domain; saving gives an authorized sending-status.
2. `x.owned-elsewhere.test` shows the inline 409 error. `y.flaky.test` shows Failed, then Retry gives Waiting for DNS.
3. A team member sees the card read-only, with no Add, Verify or Delete buttons. Direct API calls return 403.
4. Multi-tenant check (alongside `multi-tenant-authorization.spec.ts` helpers): team B cannot read team A's claim (404), cannot claim `mail.acme.verify-ok.test` (409), and cannot save a From on it (422).
5. Deleting a domain used by an inbox shows the in-use dialog. After force delete, that inbox's sending-status is unauthorized.

UI-only states (Suspended, Removing, `receiving_enabled`) are covered with `page.route` stubs, following the pattern in `product-settings-tabs.spec.ts`.

## 13. Work packages (parallel, clear file ownership)

The contracts in §6.1 and §7.4 are fixed by this design. WP1 and WP2 start together; WP3, WP4 and WP5 can start against the contracts (stubs or `page.route`) and merge in order WP1 → WP2 → WP3 → WP4 → WP5. Only WP1 touches the schema or runs `yarn db:generate`.

**WP1: data model, rules and authorization core**
- Owns:
  - `server/database/schema/support.ts` (new table, and the `support_inbox_address` columns);
  - the generated `server/database/migrations/0055_*.sql` and `meta/`;
  - `lib/support-sending-domains.ts`;
  - `server/utils/sending-domains.ts`;
  - `server/utils/support-observability.ts` (metric names and the `domainId` field);
  - `server/plugins/validate-env.ts`.
- Tests: `tests/support-sending-domain-rules.test.ts`, `tests/integration/sending-domain-claims.test.ts`, `tests/integration/sending-authorization.test.ts` (the authorization parts).
- Done when: the migration applies cleanly and `resolveTeamSenderAuthorization` / `assertReceivingAddressAllowed` pass their integration tests.

**WP2: provider adapters**
- Owns all of `server/services/sending-domains/` (`types.ts`, `index.ts`, `ownership.ts`, `providers/mailgun.ts`, `providers/postmark.ts`, `providers/fake.ts`).
- Tests: `tests/sending-domain-provider-*.test.ts`, `tests/sending-domain-ownership.test.ts`.
- No DB access. It imports `SendingDomainDnsRecord` from `lib/support-sending-domains.ts`; WP1 lands that type first, or it is temporarily duplicated and swapped on merge.

**WP3: team API and the background poller**
- Owns:
  - `server/api/support/teams/[teamId]/sending-domains/**`;
  - `server/utils/sending-domain-poller.ts`;
  - `server/services/scheduler/tasks/sending-domains-poll.ts`;
  - `server/tasks/support/sending-domains-poll.ts`;
  - `server/api/cron/support-sending-domains-poll.get.ts`;
  - the `scheduledTasks` block in `nuxt.config.ts`;
  - `vercel.json`;
  - the schema components in `server/api/openapi.json.get.ts`.
- Tests: `tests/sending-domain-poller.test.ts`, route authorization and validation cases, and the poller concurrency case in the integration suite.

**WP4: enforcement and inbound wiring**
- Owns:
  - `server/api/support/inboxes/[id]/sending-status.get.ts`, `[id].put.ts`, `index.post.ts`;
  - `server/api/support/inboxes/[id]/addresses/index.post.ts`, `[addressId].delete.ts`, new `platform.post.ts`;
  - `server/api/support/channel-status.get.ts`;
  - `server/api/support/conversations/[id]/messages/index.post.ts`;
  - `server/api/support/inbound/[provider].post.ts` (the auto-reply check only);
  - `server/utils/outbound-delivery.ts` (the final check plus a `terminal` option on `failOutboundDelivery`);
  - `server/utils/csat.ts`;
  - `server/utils/inbound-routing.ts` (platform attribution);
  - `server/services/support-channels/webhook/mailgun.ts` and `postmark.ts` (only to stop leaking `verifiedDomains` and to expose `authorizesSubdomains`).
- Tests: the existing outbound, sending-status and inbound-routing tests extended, plus the integration enforcement cases.

**WP5: settings UI and e2e**
- Owns:
  - `components/support/SupportSendingDomains.vue`, `SupportDnsRecordTable.vue`, `SupportFromAddressPicker.vue`;
  - the three insertions in `pages/support/settings.vue`;
  - `tests/e2e/support-sending-domains.spec.ts`;
  - `webServer.env` in `playwright.config.ts`.
- Built against §7.2/§7.3 with `page.route` until WP3 and WP4 merge.

**Integration and acceptance (one owner, after all merges)**

1. `.env.example`, `docker-compose.yml`, `docs/deployment-mail.md`. Add `D-37` to `docs/plans/2026-08-11-support-platform/deltas.md` ("SUP-04-6 verdict becomes team-scoped; outbox enforces sender ownership"). Correct the schema location in `.agents/CLAUDE.md` if wanted.
2. `scripts/backfill-sending-domains.ts`, dry run by default. It groups existing inbox From domains by team. Domains used by exactly one team that are `active` in the provider get a claim (`providerOwnership='adopted'`, `pending`), so that team only has to publish the TXT. Domains shared by several teams are reported for an operator to resolve. It is run before enabling `team` policy.
3. `yarn lint`, `yarn test`, `yarn test:integration:postgres:if-available`, `yarn test:e2e:if-available`, `yarn harness:verify`.
4. Staging acceptance against a real Frogmail with a test zone:
   - add the domain and publish records;
   - Verified within one poll;
   - a reply is delivered with DKIM aligned;
   - a second team is refused for that domain and its subdomain;
   - forwarding to the platform address creates a ticket in the right inbox with the right product;
   - delete cleans up Frogmail (`frogmail_dns_cleanup`);
   - with direct receiving enabled by an operator, the route is created and inbound works.
5. Production rollout: issue the F-1 key, run the backfill, set `SUPPORT_SENDING_DOMAINS_ENABLED=true` (which brings `team` policy), and watch the `support.sending_domain.blocked` and `support.delivery.failed` metrics for 48 hours.

## 14. Risks

| Risk | Mitigation |
| --- | --- |
| Turning on `team` policy breaks teams already sending from manually onboarded domains | Backfill script plus the TXT-only step. The settings warning shows before the flip. The flag can be reverted. |
| Provider says active but Frogmail refuses (F-3) | The outbox records the failure. The status is corrected when F-3 ships. Until then Veerify also maps a 553 / `sender_not_authorized` send failure to suspending the claim. |
| Polling uses up the provider budget | Separate key, batch of 25 every 5 minutes, Retry-After handling, circuit breaker. |
| Forwarded mail fails SPF or DMARC checks at Cloudflare Email Routing | Google and Microsoft keep DKIM and add ARC. Covered in staging acceptance; documented. |
| Squatting | Per-claim TXT proof, 3 pending claims per team, 7-day expiry. |

## 15. Open questions for the product owner (recommended default in bold)

1. **Q1: scope of ownership. Decided 2026-10-22: one team.** Org-level sharing can be added later with an `organizationId` column.
2. **Q2: who manages domains. Decided 2026-10-22: team admins only** (SUP-X-4/D-28 precedent). Inbox admins choose From addresses among verified domains.
3. **Q3: replies from a pending domain.** Block, or send anyway? **Block** with a clear 409. Sending would fail at Frogmail regardless.
4. **Q4: other teams' receiving addresses on a newly verified domain.** **Detach automatically and log.** The alternative is to flag them for operator review.
5. **Q5: notifications.** Email or in-app notification to team admins on Verified, Suspended or Expired? **In-app to team admins**, as a small WP3 follow-up. v1 shows a banner on settings plus the sending-status block.
6. **Q6: Postmark.** Is list-only mode enough, or should full Postmark self-serve be built (its Domains API exists)? **List-only in v1**; full support only if a Postmark-hosted customer asks.
7. **Q7: platform forwarding domain.** Still open. A subdomain such as `in.veerify.io` cannot receive through Frogmail today: Frogmail receives only at a Cloudflare zone apex (`docs/dns-onboarding.md`, "Apex and subdomain receiving"), and `veerify.io` is on Vercel DNS. **A dedicated apex on Cloudflare** (for example `veerifymail.com`) works without Frogmail changes. The value is only the `SUPPORT_PLATFORM_MAIL_DOMAIN` setting, so the code does not depend on this choice.
8. **Q8: limits.** **10 domains per team and 3 pending, 7-day pending expiry**, as code constants. Should paid plans get more? Leave this to billing (`docs/plans/2026-10-11-billing`).
9. **Q9: DMARC.** Recommend only, or require DMARC before Verified? **Recommend only.** Gmail and Yahoo require it for bulk senders, not for support volume.
