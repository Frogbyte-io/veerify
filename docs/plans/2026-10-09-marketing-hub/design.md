# Marketing Hub — Design

**Created:** October 9, 2026
**Status:** Proposed. Stage M0 is implemented; M1+ need sign-off on the open questions below.
**Builds on:** `support-platform` (team module enablement, scheduler, domains, email delivery)

**Goal:** A marketing tool inside Veerify that helps a team get its product found: by search engines, by
LLM assistants that recommend tools, and by people discussing the problem it solves. It uses the
feedback, changelog, roadmap and support data Veerify already holds, so it does not start from zero
like a standalone SEO or social-listening product.

---

## Positioning

Ahrefs, Semrush, Brand24, Profound and Peec each do one part of this better than Veerify will for
years. Matching any of them feature by feature is not the plan. Veerify's advantages are:

1. **It already knows the product.** It has the product's changelog, roadmap, feedback wording and
   support conversations. No other marketing tool has these.
2. **One place, one bill**, priced for indie and small SaaS teams that will not pay for five tools.
3. **AI visibility is a new category.** Most small teams have no way to measure it yet, and a basic
   version is cheap to build.

Every stage below should be judged by one question: does it use something only Veerify has, or does it
make the team act on something? A dashboard of numbers alone is not enough.

---

## Scope decisions

| Decision                   | Choice                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Placement in hierarchy     | **Product-scoped.** A marketing site belongs to one `project`; the switch is per team + per product            |
| Module enablement          | `marketingEnabled` on `team_module_settings` **and** in `project.settings` (same rule as D-31)                 |
| Module definitions         | **One registry**, `lib/modules.ts` (Stage M0). No new hand-copied module lists                                 |
| Site ownership             | **Must be verified** before any crawl, audit or monitoring runs (DNS TXT, meta tag, or file)                   |
| Crawling runtime           | **Resumable crawl frontier in Postgres**, advanced in small batches by a scheduled task. No new worker process |
| Outbound HTTP safety       | Reuse `server/utils/webhook-url.ts` checks for private addresses. Re-check after every redirect                |
| LLM access                 | **Provider adapter** in `server/services/llm/`, platform-owned keys first, bring-your-own key later            |
| AI visibility sampling     | **Several samples per prompt per provider**, reported as a mention _rate_, never a single yes/no               |
| Mentions sources (first)   | **Hacker News, Reddit, Bluesky.** X is deferred (API cost)                                                     |
| Mentions ingestion         | **Shared with support Stage 12 (social)**: one ingestion layer, two consumers                                  |
| Automated posting/outreach | **Out of scope.** Veerify drafts; a human posts                                                                |
| Cost control               | **Usage metering from M1.** Every LLM call and crawled page is counted per team per month                      |

### Why product-scoped

Everything in marketing hangs off a site: the audit crawls it, AI visibility asks about it, mentions
match its brand name. In Veerify a site maps to a product (`project`), not to a team. A team with
two products markets them separately. This matches how domains already work (`project.customDomain`,
`projectDomain`).

The team-level `marketingEnabled` switch still exists. It controls the sidebar group and the overall
cost exposure. Both switches must be on, as D-31 requires for the other modules.

### Why verification is required

Without it, Veerify would crawl and monitor any domain a signed-up user types in. That is a vehicle
for abuse: it can hammer third-party sites, and it would let users monitor competitors under the
guise of "my site". Verification is also cheap. If the product already has a verified custom domain
under the same registrable domain (e.g. `feedback.acme.com` for `acme.com`), the site counts as
verified automatically. Otherwise the user adds a DNS TXT record, a `<meta>` tag or a
`/.well-known/veerify-verification.txt` file.

Competitors are a separate concept (see M3/M6). Veerify only ever records _whether a competitor is
named_ in an LLM answer or a public post. It never crawls a competitor's site.

### Why no new worker process

Support handled heavy outbound work with a database table as the queue (`supportOutboundDelivery`) and a
cron task. Crawling fits the same pattern if the crawl can be resumed:

- Each audit stores its frontier as rows (`seoAuditPage`, `status = pending | fetched | failed | skipped`).
- Each scheduler tick claims a few pages (`FOR UPDATE SKIP LOCKED`) and fetches them within a time
  budget (e.g. 20s). It records the results and the newly discovered same-origin links, then stops.
- When no `pending` rows remain, the tick computes the audit score and marks the audit `done`.

This runs the same way on Vercel cron and on self-hosted Nitro tasks. It needs no new infrastructure,
and a crash loses at most one batch. A dedicated worker becomes worth it only once audits move beyond
a few hundred pages, which is a later pricing tier, not the MVP.

### Why sampling for AI visibility

LLM answers vary from run to run, and the provider APIs are not the consumer apps people actually
use. A single "ChatGPT mentioned you" result would be both noisy and misleading. The tool therefore:

- runs each prompt N times per provider (default 3) and reports the share of runs that mention the brand;
- uses each provider's web-search or grounded mode where it exists (Anthropic web search, OpenAI web
  search, Perplexity Sonar, Gemini grounding), because that is closest to what end users see;
- states clearly in the UI that results come from the API and approximate the consumer apps, rather
  than claiming they are identical.

### Why mentions are shared with support Stage 12

Support Stage 12 plans social as a new inbox type. Both features need the same plumbing: poll a source,
de-duplicate by external id, match against terms. The ingestion layer is built once
(`server/services/social-sources/`). Marketing uses it for _mentions and opportunities_; support uses
it for _conversations_. A mention can be escalated into a support conversation, linked the same way
`contactLink` links conversations to feedback.

---

## Tools

### 1. Site audit (Stage M2)

- Crawls the verified site, staying on the same origin and respecting `robots.txt`. The user agent is
  `VeerifyBot/1.0 (+https://veerify.com/bot)`. Page caps depend on the plan (MVP: 100 pages).
- Each fetched page is checked against rules defined in code (`server/services/marketing/audit-rules/`). Each
  rule has an id, a severity, a check function and fix guidance:
  - titles and meta descriptions: missing, duplicate, too long or too short
  - canonical tags, `noindex` mistakes, broken internal links, redirect chains
  - Open Graph and Twitter card tags, images without `alt` text
  - structured data that is present and parses (JSON-LD)
  - `sitemap.xml` present and consistent with the crawled pages
- Site-level checks:
  - `robots.txt` lets search and AI crawlers in (Googlebot, Bingbot, GPTBot, ClaudeBot, PerplexityBot,
    Google-Extended), shown as a table with a per-bot verdict
  - `llms.txt` present and valid
- Core Web Vitals for the top pages come from the PageSpeed Insights API. It is free and needs an API key.
- Output: a score, an issue list grouped by rule with affected pages, and a score trend across audits.
  The first audit runs automatically after verification; later audits run weekly or on demand.

### 2. AI visibility (Stage M3)

- **Setup:** brand terms (name and aliases), competitors (name and aliases), and prompts. A short
  wizard suggests starter prompts from the product description, feedback categories and support
  topics. Example: "What's the best tool for collecting user feedback for a small SaaS?"
- **Runs:** weekly by default. Each prompt goes to each enabled provider N times, and the
  answers are stored.
- **Analysis**, in two steps:
  1. Deterministic matching of brand and competitor terms. This step is cheap and needs no LLM.
  2. Extraction with a small model and structured output: position in the list, sentiment, and the
     cited URLs and domains.
- **Reports:**
  - mention rate per prompt and per provider, and the trend over time
  - "share of voice" against competitors
  - the domains models cite most often for these prompts, e.g. "Perplexity cites g2.com and
    r/SaaS threads you don't appear in"
- **Actions:**
  - generate or update `llms.txt` from the product's public pages, roadmap and changelog
  - fix crawler blocks found by the audit
  - suggested pages (comparison and "alternatives to X" pages) built from the gaps found

### 3. Mentions and opportunities (Stage M4)

- Sources: Hacker News (Algolia API), Reddit (OAuth API, within its commercial-use terms), Bluesky
  (public search API). Later: GitHub discussions, Product Hunt, RSS feeds.
- Matches brand terms (mentions), competitor terms (competitive mentions), and problem keywords
  ("looking for a feedback tool"), which become opportunities.
- Inbox-style triage: new / seen / dismissed / escalated to support. Alerts go out as a daily
  email digest, plus an in-app realtime event on the `team:<id>` channel (thin envelope, as in support).

### 4. Growth features built on Veerify's own data (Stage M5)

- **Changelog → announcements:** when a changelog entry is published, draft posts for X, LinkedIn and
  Bluesky plus a newsletter section. These are drafts to copy or edit, not auto-posted. _Depends on the
  Changelog module shipping; it is currently only a switch with no table._
- **Review and testimonial requests:** a good CSAT score, or a "shipped" status on feedback the
  customer voted for, triggers an optional email asking for a review on G2 or Capterra, or a
  testimonial. Testimonials can be shown on a public wall on the product's subdomain. Sent through the
  existing email delivery path, with an unsubscribe and suppression check.
- **Customer language:** frequent phrases from feedback and support become keyword and prompt
  suggestions for M2 and M3.
- **Google Search Console** (OAuth): queries, clicks, impressions and position for the verified site.

### 5. Later (M6+)

- A launch kit: directory checklist (Product Hunt, BetaList, AlternativeTo, SaaS directories) with
  submission status.
- Competitor change tracking: pricing and changelog pages. Only public pages, fetched at a low rate,
  and only after a separate review of the abuse question above.
- Bring-your-own LLM keys; more providers.

---

## Architecture

```
organization → team ── team_module_settings.marketingEnabled
                 │
                 └── project (product) ── settings.marketingEnabled
                        │
                        └── marketingSite (verified origin)
                               ├── seoAudit → seoAuditPage → seoIssue
                               ├── marketingTerm (brand | competitor | keyword)
                               ├── aiVisibilityPrompt
                               │      └── aiVisibilityAnswer (run, provider, model, sample, analysis)
                               └── mention (source, externalId, matchedTerm, kind, status)

team → marketingUsage (period, metric, units)        ← metering for LLM calls, pages, sources
```

### Data model sketch (`server/database/schema/marketing.ts`)

| Table                | Key columns                                                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `marketingSite`      | id, projectId (unique), teamId, origin, verificationMethod, verificationToken, verifiedAt                                                                   |
| `seoAudit`           | id, siteId, trigger (`auto`/`schedule`/`manual`), status, pageLimit, pagesFetched, score, startedAt, finishedAt                                             |
| `seoAuditPage`       | id, auditId, url (unique per audit), depth, status, httpStatus, fetchedAt, facts (jsonb: title, meta, canonical, …)                                         |
| `seoIssue`           | id, auditId, pageId (nullable for site-level), ruleId, severity, details (jsonb)                                                                            |
| `marketingTerm`      | id, siteId, kind (`brand`/`competitor`/`keyword`), label, aliases (text[]), competitorDomain                                                                |
| `aiVisibilityPrompt` | id, siteId, text, locale, active, source (`user`/`suggested`)                                                                                               |
| `aiVisibilityRun`    | id, siteId, trigger, status, startedAt, finishedAt                                                                                                          |
| `aiVisibilityAnswer` | id, runId, promptId, provider, model, sample, answer, brandMentioned, brandRank, competitorsMentioned (jsonb), citations (jsonb), inputTokens, outputTokens |
| `mention`            | id, siteId, source, externalId (unique per source), url, author, excerpt, publishedAt, termId, kind, status                                                 |
| `marketingUsage`     | teamId, period (`YYYY-MM`), metric, units (unique on teamId+period+metric)                                                                                  |

The rule definitions, provider list and source list are code, not tables, for the same reason the
conversation statuses are fixed (design.md of support): reports must mean the same thing across teams.

### Services and routes

- `server/services/llm/`: a `LlmProvider` interface (`complete`, `completeWithSearch`,
  `extractStructured`) with Anthropic, OpenAI, Google and Perplexity adapters. Default model IDs live
  in one config file, so upgrading a model is a one-line change. Every call goes through
  `recordUsage()`.
- `server/services/marketing/`: crawler (fetch → parse → frontier), audit rules, visibility analysis.
- `server/services/social-sources/`: shared with support Stage 12.
- Scheduler tasks (`server/services/scheduler/tasks/`): `marketing-audit-advance`,
  `marketing-visibility-run`, `marketing-mentions-poll`, `marketing-digest`.
- API: `server/api/marketing/**`, protected by a new `requireMarketingAccess(projectId, userId)`
  helper. It wraps `requireProjectAccess` and checks both module switches.
- Pages: `pages/marketing/index.vue` (overview per product), `pages/marketing/audit.vue`,
  `pages/marketing/ai-visibility.vue`, `pages/marketing/mentions.vue`. The `/marketing` prefix is added
  to `protectedRoutes`.
- Sidebar: a "Marketing" group, shown when the team switch is on. The registry in `lib/modules.ts`
  declares the group (see M0).

### Security and privacy constraints

- Outbound fetches: block private and reserved addresses (reuse `isPrivateWebhookAddress`), re-check
  on every redirect, enforce timeouts and a body size cap, accept only `text/html` and the few text formats
  the checks need, and never follow cross-origin links.
- LLM prompts carry product facts and user-written prompts only. Support conversations and feedback
  text are **never** sent to an LLM provider without a separate, explicit team opt-in.
  The "customer language" feature in M5 needs that opt-in.
- Mention excerpts are public content, but they are still stored with retention limits (default 180 days)
  and are deletable.

---

## Stages

| Stage | Scope                                                                                                                                         | Depends on                           |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| M0    | One module registry in `lib/modules.ts`; team API, Tools tab, product Features tab and sidebar read from it. No behaviour change              | —                                    |
| M1    | Foundation: `marketingEnabled` (team + product), `marketingSite` with verification, `/marketing` overview, LLM provider layer, usage metering | M0                                   |
| M2    | Site audit: crawler, rules, `robots.txt` / `llms.txt` / AI-crawler checks, PageSpeed, score trend                                             | M1                                   |
| M3    | AI visibility: terms, prompts, scheduled sampled runs, analysis, share of voice, `llms.txt` generator                                         | M1 (LLM layer), M2 helpful           |
| M4    | Mentions: HN, Reddit, Bluesky ingestion (shared layer), triage, digest                                                                        | M1; coordinate with support Stage 12 |
| M5    | Growth features: changelog → drafts, review/testimonial requests, customer language, Search Console                                           | Changelog module; M3                 |
| M6+   | Launch kit, competitor change tracking, bring-your-own LLM keys                                                                               | —                                    |

M2 and M3 can be built in parallel after M1.

---

## Open questions

1. **Pricing and limits.** Veerify has no billing yet. Metering ships in M1 regardless, but someone has to
   choose the free-tier caps (pages per audit, prompts × providers × samples per month) before M3
   ships, because every run costs real money.
2. **LLM keys.** Platform-owned keys mean Veerify carries the cost and must enforce caps. Bring-your-own
   moves the cost to the user but adds key storage (encrypted) and support burden. Proposal: platform keys
   with caps for MVP, bring-your-own as a paid-tier option later.
3. **Which providers at launch?** Proposal: Anthropic + OpenAI + Perplexity for M3. Add Gemini when the
   grounding API cost per run is known.
4. **Reddit commercial terms.** Confirm that Reddit's data API terms allow this use at our scale
   before M4. If not, launch M4 with HN and Bluesky only.
5. **Self-hosted installs.** Do marketing features ship for self-hosters? They need their own API keys
   (PageSpeed, LLMs, Reddit), and the module should show clearly which keys are missing instead of failing
   silently.
