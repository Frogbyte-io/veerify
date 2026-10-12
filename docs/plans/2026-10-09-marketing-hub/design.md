# Marketing Hub — Design

**Created:** October 9, 2026
**Status:** Proposed. Stage M0 is implemented. LLM keys, launch providers and self-hosting were decided
on October 9, 2026 (see [Resolved decisions](#resolved-decisions)); M1+ wait on the remaining open questions.
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

| Decision                   | Choice                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Placement in hierarchy     | **Product-scoped.** A marketing site belongs to one `project`; the switch is per team + per product                                                                 |
| Module enablement          | `marketingEnabled` on `team_module_settings` **and** in `project.settings` (same rule as D-31)                                                                      |
| Module definitions         | **One registry**, `lib/modules.ts` (Stage M0). No new hand-copied module lists                                                                                      |
| Site ownership             | **Must be verified** before any crawl, audit or monitoring runs (DNS TXT, meta tag, or file)                                                                        |
| Crawling runtime           | **Crawl service, not our own crawler.** Firecrawl adapter (hosted or self-hosted Firecrawl); Veerify only fetches a handful of site files itself                    |
| Crawl limits               | **50 pages per audit** by default (`MARKETING_MAX_AUDIT_PAGES`, hard cap 500), one running audit per site, 3 manual audits per site per day, weekly scheduled audit |
| Outbound HTTP safety       | Reuse `server/utils/webhook-url.ts` checks for private addresses. Re-check after every redirect                                                                     |
| LLM access                 | **Bring your own key.** Each team adds its own API key; a provider adapter lives in `server/services/llm/`                                                          |
| LLM providers at launch    | **Anthropic (Claude) and OpenAI.** Perplexity and Gemini later                                                                                                      |
| Self-hosting               | **Fully supported.** Every feature runs on a self-hosted install; missing optional keys disable one capability, never the module                                    |
| AI visibility sampling     | **Several samples per prompt per provider**, reported as a mention _rate_, never a single yes/no                                                                    |
| Mentions sources (first)   | **Hacker News, Reddit, Bluesky.** X is deferred (API cost)                                                                                                          |
| Mentions ingestion         | **Shared with support Stage 12 (social)**: one ingestion layer, two consumers                                                                                       |
| Automated posting/outreach | **Out of scope.** Veerify drafts; a human posts                                                                                                                     |
| Cost control               | **Usage metering from M1.** Every LLM call and crawled page is counted per team per month; teams can set an LLM budget cap                                          |

### Why product-scoped

Everything in marketing hangs off a site: the audit crawls it, AI visibility asks about it, mentions
match its brand name. In Veerify a site maps to a product (`project`), not to a team. A team with
two products markets them separately. This matches how domains already work (`project.customDomain`,
`projectDomain`).

The team-level `marketingEnabled` switch still exists. It controls the sidebar group. Both switches
must be on, as D-31 requires for the other modules.

### Why verification is required

Without it, Veerify would crawl and monitor any domain a signed-up user types in. That is a vehicle
for abuse: it can hammer third-party sites, and it would let users monitor competitors under the
guise of "my site". Verification is also cheap. If the product already has a verified custom domain
under the same registrable domain (e.g. `feedback.acme.com` for `acme.com`), the site counts as
verified automatically. Otherwise the user adds a DNS TXT record, a `<meta>` tag or a
`/.well-known/veerify-verification.txt` file.

Competitors are a separate concept (see M3/M6). Veerify only ever records _whether a competitor is
named_ in an LLM answer or a public post. It never crawls a competitor's site.

### Why a crawl service instead of our own crawler

Decided October 10, 2026. A crawler that is polite, robust and fast (robots.txt, JavaScript rendering,
retries, redirect handling, rate limiting) is a product of its own. Veerify uses a crawl service behind a
`CrawlProvider` interface (`server/services/crawl/`) and keeps only the analysis.

- **Firecrawl first.** It has a hosted API and is open source, so self-hosters can run their own
  instance. The key is a team key (bring your own, like LLM keys) or an instance key
  (`FIRECRAWL_API_KEY`), and the endpoint is configurable (`FIRECRAWL_API_URL`) for a self-hosted
  Firecrawl.
- **Flow.** Starting an audit starts a crawl job at the provider (`limit` = page cap, same origin only).
  A scheduled task (`marketing:audit-advance`, every minute) polls running jobs, stores the returned
  pages as `seoAuditPage` rows, and when the job completes runs the rules and computes the score. No
  long-running request and no worker process, on Vercel cron and Nitro alike.
- **Without a crawl key** the audit still runs in **basic mode**: Veerify itself fetches only
  `robots.txt`, `llms.txt`, `sitemap.xml` and the home page (SSRF-checked, size and time capped) and
  runs the site-level and home-page rules. The UI says which mode ran and how to unlock the full crawl.
- **Limits.** 50 pages per audit by default, configurable per install up to a hard cap of 500. One
  running audit per site, 3 manual audits per site per day, plus the weekly scheduled audit.

### Why sampling for AI visibility

LLM answers vary from run to run, and the provider APIs are not the consumer apps people actually
use. A single "ChatGPT mentioned you" result would be both noisy and misleading. The tool therefore:

- runs each prompt N times per provider (default 3) and reports the share of runs that mention the brand;
- uses each provider's web-search mode (Anthropic web search tool, OpenAI web search), because that is
  closest to what end users see;
- states clearly in the UI that results come from the API and approximate the consumer apps, rather
  than claiming they are identical.

### Why bring your own key

With team-owned keys, the LLM cost of AI visibility sits with the team that chose to run it, so
Veerify needs no billing before M3 ships. A self-hosted install works the same way as the cloud.
And the team sees the real usage on its own provider dashboard, which builds trust in the numbers.

What this requires:

- **Storage.** A `teamApiCredential` table (teamId, provider, encryptedKey, keyHint, createdBy,
  lastValidatedAt, lastError), unique on teamId + provider. Keys are encrypted at rest with
  AES-256-GCM, using a new instance secret `SECRETS_ENCRYPTION_KEY` (added to `.env.example` in M1).
  Veerify has no encryption helper yet, so M1 adds `server/utils/secrets.ts`.
- **Access.** Only team admins can add, replace or remove a key. The API never returns a key, only its
  hint (last four characters) and validation status. Keys are never logged, and the observability
  allowlist rule from support applies here too.
- **Validation.** Saving a key makes one cheap call to the provider (list models). If a scheduled run
  later gets a 401 or 403, the key is marked invalid, runs for that provider pause, and team admins get
  one email. The runs do not keep failing silently.
- **Budget.** Metering still counts tokens per team per month. The team can set an optional monthly
  cap per provider; Veerify estimates cost from token counts and stops runs at the cap. The estimate is
  labelled as an estimate, because the provider's invoice is the real figure.
- **Model choice.** The answers use each provider's current general model with web search. The
  extraction step (rank, sentiment, citations) uses the same team's key with that provider's smallest
  model. Default model IDs live in one config file and can be changed per team.

Without any key, AI visibility shows a setup screen. The site audit, including the `robots.txt`
AI-crawler checks and `llms.txt` validation, still works because it needs no LLM.

### How self-hosting works

Self-hosted installs get the whole module. Every external dependency is either a team key, an optional
instance setting, or not needed at all:

| Capability             | Needs                                                                                                   | When it is missing                |
| ---------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Site audit, basic mode | Outbound internet access only                                                                           | —                                 |
| Site audit, full crawl | Firecrawl key (team key or `FIRECRAWL_API_KEY`), optional `FIRECRAWL_API_URL` for self-hosted Firecrawl | Basic mode, with a note           |
| Core Web Vitals        | PageSpeed Insights key: a team key, or `PAGESPEED_API_KEY` for the instance                             | Section shows "not configured"    |
| AI visibility          | Team's Anthropic and/or OpenAI key                                                                      | Setup screen                      |
| Mentions: HN, Bluesky  | Nothing                                                                                                 | —                                 |
| Mentions: Reddit       | Instance OAuth app (`REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`)                                         | Reddit listed as unavailable      |
| Search Console (M5)    | Instance Google OAuth app                                                                               | Integration listed as unavailable |
| Scheduled work         | Nitro scheduled tasks (already used by support)                                                         | —                                 |

- The marketing settings page has an **integration status** panel listing each capability as ready,
  not configured, or failing, with what to set. A missing key must never surface as a silent empty chart.
- The crawler user agent points at the install's own URL: `VeerifyBot/1.0 (+${BETTER_AUTH_URL}/bot)`.
- Crawl limits are instance settings with generous self-host defaults (`MARKETING_MAX_AUDIT_PAGES`,
  `MARKETING_AUDIT_BATCH_SIZE`). The cloud sets tighter values.
- No feature depends on a Veerify-operated service. Self-hosters never send data to veerify.com.

### Why mentions are shared with support Stage 12

Support Stage 12 plans social as a new inbox type. Both features need the same plumbing: poll a source,
de-duplicate by external id, match against terms. The ingestion layer is built once
(`server/services/social-sources/`). Marketing uses it for _mentions and opportunities_; support uses
it for _conversations_. A mention can be escalated into a support conversation, linked the same way
`contactLink` links conversations to feedback.

---

## Tools

### 1. Site audit (Stage M2)

- Crawls the verified site through the crawl provider (Firecrawl), same origin only, up to the page cap
  (default 50). Without a crawl key, runs in basic mode (site files and home page only).
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
- **Runs:** weekly by default. Each prompt goes to each provider the team has a valid key for (Claude,
  OpenAI) N times, and the answers are stored.
- **Analysis**, in two steps:
  1. Deterministic matching of brand and competitor terms. This step is cheap and needs no LLM.
  2. Extraction with a small model and structured output: position in the list, sentiment, and the
     cited URLs and domains. This step runs on the team's own key with the provider's smallest model.
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
- More providers: Perplexity (Sonar), Gemini (grounding).
- Optional Veerify-provided keys on the cloud, as a paid add-on, if billing exists by then.

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

team → teamApiCredential (provider, encryptedKey)    ← bring-your-own LLM / PageSpeed keys
team → marketingUsage (period, metric, units)        ← metering for LLM calls, pages, sources
```

### Data model sketch (`server/database/schema/marketing.ts`)

| Table                | Key columns                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `marketingSite`      | id, projectId (unique), teamId, origin, verificationMethod, verificationToken, verifiedAt                                                                     |
| `seoAudit`           | id, siteId, trigger (`auto`/`schedule`/`manual`), status, pageLimit, pagesFetched, score, startedAt, finishedAt                                               |
| `seoAuditPage`       | id, auditId, url (unique per audit), depth, status, httpStatus, fetchedAt, facts (jsonb: title, meta, canonical, …)                                           |
| `seoIssue`           | id, auditId, pageId (nullable for site-level), ruleId, severity, details (jsonb)                                                                              |
| `marketingTerm`      | id, siteId, kind (`brand`/`competitor`/`keyword`), label, aliases (text[]), competitorDomain                                                                  |
| `aiVisibilityPrompt` | id, siteId, text, locale, active, source (`user`/`suggested`)                                                                                                 |
| `aiVisibilityRun`    | id, siteId, trigger, status, startedAt, finishedAt                                                                                                            |
| `aiVisibilityAnswer` | id, runId, promptId, provider, model, sample, answer, brandMentioned, brandRank, competitorsMentioned (jsonb), citations (jsonb), inputTokens, outputTokens   |
| `mention`            | id, siteId, source, externalId (unique per source), url, author, excerpt, publishedAt, termId, kind, status                                                   |
| `teamApiCredential`  | id, teamId, provider (`anthropic`/`openai`/`firecrawl`/`pagespeed`), encryptedKey, keyHint, createdBy, lastValidatedAt, lastError (unique on teamId+provider) |
| `marketingUsage`     | teamId, period (`YYYY-MM`), metric, units (unique on teamId+period+metric)                                                                                    |

The rule definitions, provider list and source list are code, not tables, for the same reason the
conversation statuses are fixed (design.md of support): reports must mean the same thing across teams.

### Services and routes

- `server/services/llm/`: a `LlmProvider` interface (`complete`, `completeWithSearch`,
  `extractStructured`, `validateKey`) with Anthropic and OpenAI adapters. Each call takes the team's
  decrypted key; the key is never stored on the adapter. Default model IDs live in one config file, so
  upgrading a model is a one-line change. Every call goes through `recordUsage()`, which also enforces
  the team's budget cap.
- `server/utils/secrets.ts`: AES-256-GCM encrypt/decrypt with `SECRETS_ENCRYPTION_KEY`, versioned
  so the key can be rotated.
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
- API keys: encrypted at rest, admin-only, never returned or logged (see "Why bring your own key").
  Deleting a team deletes its keys (cascade).
- Mention excerpts are public content, but they are still stored with retention limits (default 180 days)
  and are deletable.

---

## Stages

| Stage | Scope                                                                                                                                                                                                                  | Depends on                           |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| M0    | One module registry in `lib/modules.ts`; team API, Tools tab, product Features tab and sidebar read from it. No behaviour change                                                                                       | —                                    |
| M1    | Foundation: `marketingEnabled` (team + product), `marketingSite` with verification, `/marketing` overview, encrypted team API keys, Claude + OpenAI adapters, usage metering and budget caps, integration status panel | M0                                   |
| M2    | Site audit: crawler, rules, `robots.txt` / `llms.txt` / AI-crawler checks, PageSpeed, score trend                                                                                                                      | M1                                   |
| M3    | AI visibility: terms, prompts, scheduled sampled runs, analysis, share of voice, `llms.txt` generator                                                                                                                  | M1 (LLM layer), M2 helpful           |
| M4    | Mentions: HN, Reddit, Bluesky ingestion (shared layer), triage, digest                                                                                                                                                 | M1; coordinate with support Stage 12 |
| M5    | Growth features: changelog → drafts, review/testimonial requests, customer language, Search Console                                                                                                                    | Changelog module; M3                 |
| M6+   | Launch kit, competitor change tracking, Perplexity and Gemini, optional Veerify-provided keys                                                                                                                          | —                                    |

M2 and M3 can be built in parallel after M1.

---

## Resolved decisions

Decided October 9–10, 2026:

1. **LLM keys: bring your own.** Teams add their own provider keys; Veerify pays for no LLM usage.
   See "Why bring your own key".
2. **Launch providers: Claude and OpenAI.** Perplexity and Gemini move to M6+.
3. **Self-hosting: supported.** Every marketing feature works on a self-hosted install. See "How
   self-hosting works".

4. **Crawling: use a service.** Firecrawl behind a provider interface, with basic mode when no key is
   set. 50 pages per audit by default (decided October 10, 2026).
5. **Reddit: approved** as a launch source for M4 (October 10, 2026).

## Open questions

1. **Paid tier.** Whether marketing is free or part of a paid plan on the cloud. Not blocking: with
   bring-your-own keys for LLMs and crawling, the cloud's own cost per team is small.
