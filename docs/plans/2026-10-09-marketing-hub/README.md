# Marketing Hub — Plan Index

A marketing module for Veerify: site/SEO audit, AI (LLM) visibility tracking, mentions and
opportunities, and growth features built on feedback, changelog and support data.

## Current status

- **M0 (module registry) is implemented.** Module definitions live in `lib/modules.ts`. The team
  modules API, the Tools tab, the product Features tab and the sidebar read from it. Adding a module
  is now one registry entry plus a schema column.
- Decided October 9, 2026: teams bring their own LLM keys; Claude and OpenAI at launch; the module
  must work fully on self-hosted installs.
- Decided October 10, 2026: crawling goes through a crawl service (Firecrawl, bring your own key, basic
  mode without one), 50 pages per audit by default; Reddit is a launch source.
- **M1–M4 are implemented** (October 10, 2026): settings (site verification, encrypted team keys,
  terms, integration status), site audit, AI visibility and mentions. Migrations `0044` and `0045`.
  Verified with unit tests, a production build, and a live smoke test against a scratch database
  (basic audit, Hacker News ingestion, credential validation against the real Anthropic API, every
  page rendered). Not yet exercised live: full Firecrawl crawls, PageSpeed, Reddit, Bluesky, and AI
  visibility runs with real Claude/OpenAI keys.

- **M5 is implemented** (October 10, 2026), stacked on the M1–M4 PR:
  - a Changelog module (dashboard at `/dashboard/changelog`, public page and RSS)
  - announcement drafts
  - review and testimonial requests with a public wall
  - customer language insights behind per-source data consent
  - Google Search Console
  - migrations `0046` and `0047`
    It was verified with unit tests, a build, and a live smoke test (review emails through Mailpit,
    testimonial moderation, changelog publish hook, public pages). Search Console and the
    LLM-backed features have not been run against real Google and LLM accounts.

- **M6 is implemented** (October 10, 2026), stacked on the M5 PR:
  - Perplexity (Agent API, which replaced Sonar chat completions on 2026-09-27) and Google Gemini as
    bring-your-own-key providers
  - escalating a mention into a support conversation (a private note, nothing is emailed), plus a live
    banner for new mentions
  - a launch kit with 27 checked directories
  - competitor change tracking: daily at most, robots.txt honoured on every redirect hop, competitor
    domain required, 3 pages per competitor and 15 per site
  - migration `0048`
    It was verified with unit tests, a build, and a live smoke test (one real page fetched from
    iana.org, change detection, escalation, launch kit). Perplexity and Gemini have not been called
    with real keys.

## Known gaps

- Review-request emails are at-least-once: a worker that dies after sending but before recording the
  result can cause one duplicate after the 10-minute sweeper.
- Review requests only go to verified user emails and CSAT contacts; anonymous feedback authors and
  unlinked subscribers are never asked.
- Multiple app replicas are still unsupported (no scheduler leader election or disable flag), but the
  Marketing tasks no longer double-send or double-spend when two processes overlap: digest has a
  per-team-per-day ledger, mention polling and search sync claim each (site, source) / site before
  working, and audit finishing holds its lease. Remaining: the per-host competitor spacing and the
  Reddit/Bluesky rate-limit state are per process, the digest is at-most-once (a crash after the
  claim loses that team's digest for the day) and search sync marks a site synced when claimed.
- Capacity at 5,000 products with Marketing on (estimates, see "Capacity at 5,000 products" in the
  [deployment plan](../2026-09-21-coolify-deployment.md)): mention polling runs every 5 minutes with
  16 sites at a time (`MARKETING_MENTIONS_CONCURRENCY`, max 32), about 2,900 sites per 30 minutes, so
  a full cycle over 5,000 sites takes about 50 minutes and Reddit's rate limit is the real ceiling;
  sites with more than 20 search queries rotate through them with a stored offset. AI visibility
  answers 24 at a time (8 per provider) and pauses scheduling at 5,000 pending answers
  (`MARKETING_VISIBILITY_BACKLOG_LIMIT`). Competitor checks cover about 17,000 pages a day (a URL
  watched by several teams is fetched once). Database pool size is `PG_POOL_MAX` (default 20).
- On the cloud the instance Firecrawl and PageSpeed keys are ignored (bring your own key) unless
  `MARKETING_ALLOW_INSTANCE_KEYS=true`.
- Veerify-provided LLM keys on the cloud are not built (they need billing first). A proposal is in the
  [billing design](../2026-10-11-billing/design.md) (status: Proposed, needs owner decisions).
- Budget caps are estimates (tokens × list price + web-search fees), enforced with atomic
  reservations: each LLM call reserves an upper bound (output cap, max searches, prompt ÷ 3 chars per
  token) in `llm:<provider>:reserved_usd_micros` only if `spent + reserved + amount <= cap`, then
  settles the actual estimate, so concurrent calls no longer overshoot. Remaining caveats: the
  reservation is an upper bound, so a call near the cap can be refused although its real cost would
  have fit; a call that costs more than reserved is still booked in full; reservations leaked by a
  crash are cleared by the hourly visibility schedule task once untouched for 15 minutes; the
  provider's invoice stays the source of truth.
- Vercel functions are configured for `maxDuration: 60` (nuxt.config.ts); the project's Vercel plan
  must allow it.
- The in-memory rate-limit store (unless `RATE_LIMIT_STORE=redis`) is per instance on serverless. The
  cost-relevant marketing endpoints do not depend on it: visibility prompt suggestions (40/day per
  site) and announcement generation (50/day per product) are also capped by `consumeDbLimit`
  (`server/utils/marketing-db-limit.ts`, atomic guarded upsert into `marketing_usage` with
  `ratelimit:*` metrics that the daily retention task deletes after 2 days), and manual audits, manual visibility runs,
  competitor checks (per-watch claim on `lastCheckedAt`) and manual review sends (team daily cap) are
  already counted from database rows. The remaining in-memory limits (hourly caps, per-host competitor
  day cap, site verify attempts) only add burst protection.

## Data retention, erasure and export

The `marketing:retention` task runs daily (`30 3 * * *`; a Nitro task on self-hosted installs, the
`/api/cron/marketing-retention` route on Vercel).

| Data                                                                       | Kept                                                                                                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Review requests (`sent`, `failed`, `skipped`): email, name, error          | 180 days, then anonymised (see below). Anonymised rows are deleted after 3 years, only when no testimonial references them           |
| Review requests still `queued`                                             | 30 days, then `skipped` (reason `expired`) and anonymised on the normal schedule. `sending` rows are left to the stale-claim sweeper |
| Email suppressions (`marketing_email_suppression`)                         | Indefinitely: the durable opt-out record (address and/or keyed hash)                                                                 |
| Testimonial author email                                                   | 180 days, then cleared (the keyed hash stays). Name, title, company and quote stay                                                   |
| Mentions                                                                   | 180 days after publication (mentions poller)                                                                                         |
| Competitor changes                                                         | 12 months                                                                                                                            |
| Usage counters (`marketing_usage`)                                         | 13 months by period                                                                                                                  |
| Rate-limit counters (`ratelimit:*` in `marketing_usage`)                   | 2 days after the last update                                                                                                         |
| Digest ledger (`digest:<date>`) and OAuth nonces (`oauth-nonce:*`)         | 7 days and 1 day after the last update                                                                                               |
| Customer language insights                                                 | Until consent for any source they used is switched off, then deleted at once                                                         |
| Everything else (audits, visibility answers, terms, launch kit, and so on) | Until the product's Marketing data is deleted                                                                                        |

- **Anonymisation, not deletion.** After 180 days a terminal review request keeps its id, token,
  project, team, trigger, source, status, timestamps and `email_hash`; `email` becomes `redacted:<id>`
  and `name` and `error` are cleared. `email_hash` (and `testimonial.author_email_hash`) is
  HMAC-SHA256 of the lower-cased, trimmed address, keyed by a key derived from `BETTER_AUTH_SECRET` with
  HKDF (info `marketing-email-hash`, `server/utils/marketing-email-hash.ts`). It is never exported or
  returned by an API. Because the token stays, the unsubscribe and withdraw links keep working for old
  emails (an unsubscribe on an anonymised row writes a hash-based suppression); suppression checks (at
  enqueue and right before sending) match by address or hash; and the unique
  (project, trigger, source, email_hash) index keeps a `shipped` event from being queued twice. Hashes
  are filled lazily by the retention task before anonymising, so existing rows need no data migration.
  Rotating `BETTER_AUTH_SECRET` invalidates existing hashes (they no longer match a given address).
- **Erase a person:** `POST /api/marketing/teams/{teamId}/erase-contact` (team admin) deletes all review
  requests and testimonials for an email (case-insensitive, or its keyed hash, so anonymised rows and
  testimonials without an address are found too) in the team's products and keeps or creates a
  suppression (address and hash), so the address is never contacted again. A review request the sender
  already claimed is deleted too; the sender re-checks that the row exists and the address is not
  suppressed immediately before calling the mailer.
- **Withdraw consent:** the testimonial page and the review-request email footer link to a page that
  calls `POST /api/marketing/r/{token}/withdraw`, which turns public consent off and un-features the
  testimonial. It works for expired links and after the 180-day anonymisation (the token is kept).
- **Export and delete a product's data:** `GET /api/marketing/projects/{projectId}/export` returns a JSON
  file (never keys or tokens); `DELETE /api/marketing/projects/{projectId}/data` with
  `{ "confirm": "<product slug>" }` revokes a connected Search Console token and deletes the site (with
  everything under it), review requests, testimonials, launch kit and announcement drafts. Both are team
  admin only and work while Marketing is switched off. All three are in the Privacy card in Marketing
  settings. Team API keys, consent and suppressions are kept.
- **Turning Marketing off hides data, it does not delete it.** Data stays until the retention windows
  above pass or the product's Marketing data is deleted. Site re-verification stops for that
  team or product while it is off.

## Durable references

- [Architecture, scope decisions and stages](design.md)
- Builds on the [support platform](../2026-08-11-support-platform/README.md): module enablement
  (delta D-31), scheduler, domains, email delivery.

## Constraints

- Never crawl or monitor a site until the team has verified it owns that site.
- Outbound fetches go through the private-address checks in `server/utils/webhook-url.ts`.
- Every LLM call and crawled page is metered per team per month.
- Team API keys are encrypted at rest, admin-only, and never returned by the API or logged.
- No feature may depend on a Veerify-operated service; a missing optional key disables one capability
  and says so, never the whole module.
- Do not send support conversations or feedback text to an LLM provider without an explicit team opt-in.
