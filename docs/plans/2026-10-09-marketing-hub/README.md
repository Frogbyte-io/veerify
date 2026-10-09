# Marketing Hub — Plan Index

A marketing module for Veerify: site/SEO audit, AI (LLM) visibility tracking, mentions and
opportunities, and growth features built on feedback, changelog and support data.

## Current status

- **M0 (module registry) is implemented.** Module definitions live in `lib/modules.ts`. The team
  modules API, the Tools tab, the product Features tab and the sidebar read from it. Adding a module
  is now one registry entry plus a schema column.
- M1+ are proposed and wait on the open questions in [design.md](design.md#open-questions).

## Durable references

- [Architecture, scope decisions and stages](design.md)
- Builds on the [support platform](../2026-08-11-support-platform/README.md): module enablement
  (delta D-31), scheduler, domains, email delivery.

## Constraints

- Never crawl or monitor a site until the team has verified it owns that site.
- Outbound fetches go through the private-address checks in `server/utils/webhook-url.ts`.
- Every LLM call and crawled page is metered per team per month.
- Do not send support conversations or feedback text to an LLM provider without an explicit team opt-in.
