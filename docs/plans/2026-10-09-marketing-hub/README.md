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
- Veerify-provided LLM keys on the cloud are not built (they need billing first).
- Budget caps are estimates (tokens × list price + web-search fees), enforced with atomic
  reservations: each LLM call reserves an upper bound (output cap, max searches, prompt ÷ 3 chars per
  token) in `llm:<provider>:reserved_usd_micros` only if `spent + reserved + amount <= cap`, then
  settles the actual estimate, so concurrent calls no longer overshoot. Remaining caveats: the
  reservation is an upper bound, so a call near the cap can be refused although its real cost would
  have fit; a call that costs more than reserved is still booked in full; reservations leaked by a
  crash are cleared by the hourly visibility schedule task once untouched for 15 minutes; the
  provider's invoice stays the source of truth.
- Token-verified sites (dns/meta/file) are re-checked monthly without a schema change: a failed
  re-check is stored in `lastVerificationError` ("Re-check failed (1/2)") and `updatedAt` is the
  "last checked" marker, so editing the site also resets the monthly timer.
- Vercel functions are configured for `maxDuration: 60` (nuxt.config.ts); the project's Vercel plan
  must allow it.
- The rate-limit store is in-memory unless `RATE_LIMIT_STORE=redis`, so limits are per instance on
  serverless.

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
