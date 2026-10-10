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
- M5 (growth features) waits on the Changelog module; M6+ not started.

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

## Known gaps

- Review-request emails are at-least-once: a worker that dies after sending but before recording the
  result can cause one duplicate after the 10-minute sweeper.
- Review requests only go to verified user emails and CSAT contacts; anonymous feedback authors and
  unlinked subscribers are never asked.
- Mentions can't yet be escalated into a support conversation (the `escalated` status exists, no action).
- No realtime push for new mentions; the page and the daily digest are the only surfaces.
- Budget caps are estimates (tokens × list price + web-search fees) and can overshoot by the answers
  already in flight.
- Token-verified sites (dns/meta/file) are re-checked monthly without a schema change: a failed
  re-check is stored in `lastVerificationError` ("Re-check failed (1/2)") and `updatedAt` is the
  "last checked" marker, so editing the site also resets the monthly timer.
- The language "apply" flow inserts terms and prompts from a pre-computed plan and does not take the
  per-site cap lock, so a concurrent manual add can overshoot the caps by a few rows.
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
