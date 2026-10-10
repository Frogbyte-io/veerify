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
- M1–M4 are in progress.

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
