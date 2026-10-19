# Billing (Veerify-provided keys) — Design

**Created:** October 11, 2026
**Status:** Proposed — needs owner decisions. No code until the open questions at the end are answered.
**Builds on:** [Marketing Hub](../2026-10-09-marketing-hub/design.md) (usage metering, budget reservations,
team credentials), [support platform](../2026-08-11-support-platform/design.md) (scheduler, deployment modes)

**Goal:** On the Veerify cloud, let a team pay for Veerify-provided LLM and crawl keys as an optional
add-on, so a team that does not want to create Anthropic, OpenAI or Firecrawl accounts can still use the
Marketing Hub. This document covers only what that needs. It is not a general billing system for Veerify
plans.

---

## Goal and non-goals

**Goals**

- A cloud team can switch on "Veerify-provided keys" and pay for the LLM and crawl cost it uses.
- Spend is capped per team, so one team can never run up an unbounded bill on Veerify's accounts.
- Invoices and VAT / sales tax are handled correctly for customers worldwide.

**Non-goals**

- **Self-hosted installs never need billing.** Nothing in this design may be required to run Veerify. With
  `APP_DEPLOYMENT_MODE=self-hosted` (the default outside Vercel, see `nuxt.config.ts`) the billing code is
  inert: no billing tables are consulted, no provider SDK is loaded, no webhook route answers.
- **Bring your own key always stays available and free.** A team key is never removed, throttled or
  priced. The add-on only fills the gap when a team has no key.
- No pricing for the core product (feedback, roadmap, support). Those stay as they are.
- No seat-based plans, coupons, trials engine or enterprise invoicing in the first version.

---

## Scope decisions

| Decision                 | Choice (recommended)                                                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where billing runs       | **Cloud only.** Gated by the deployment mode; also off unless the provider env vars are set                                                                    |
| Billing provider         | **Stripe Billing, with Stripe Managed Payments (merchant of record) if metered usage works under it; otherwise Stripe Tax, or Paddle** (decided by a B0 spike) |
| Packaging                | **Flat add-on with an included monthly allowance, plus optional overage at cost + margin up to a hard cap**                                                    |
| Who pays                 | **The organization** holds the subscription; **teams** receive entitlements from it                                                                            |
| Metering source of truth | **`marketing_usage`** (already per team, per month, per provider). Billing reads it; it does not add a second meter                                            |
| Hard cap                 | **Allowance plus the admin-chosen overage cap is the reservation cap** in `llm-budget.ts`                                                                      |
| At the limit             | **Pause**, exactly like a team budget reached today. Nothing is billed beyond the cap                                                                          |
| Key isolation            | **Veerify keys are never decrypted into a response, a log or a team-visible field**; dedicated provider projects with provider-side spend limits               |
| BYO precedence           | **A team key always wins.** Veerify keys are used only when the team has no usable key for that provider                                                       |

---

## Billing provider options

Researched October 11, 2026. Pricing pages change often; confirm before signing.

| Option                                      | What it is                                                                                   | Fit for Veerify                                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Stripe Billing + Stripe Tax**             | Veerify is the seller. Stripe computes tax; Veerify registers and files in each jurisdiction | Best usage-based support. But a Norwegian company then owns VAT/sales-tax registration and filing abroad |
| **Stripe Billing + Managed Payments (MoR)** | Stripe is the merchant of record and handles tax, fraud and disputes                         | Norway is a supported business location. Metered-price support is **not confirmed** (see below)          |
| **Paddle Billing (MoR)**                    | Paddle is the merchant of record                                                             | Removes tax work. Native metering is not available; usage must be billed as custom line items            |
| **Lemon Squeezy (MoR, owned by Stripe)**    | Simple MoR for digital products                                                              | Acquired by Stripe in July 2024; 2026 status unconfirmed. Not recommended as a new foundation            |

What the sources say:

- **Stripe usage-based billing** works with meters: the server sends meter events (event name, customer id,
  numeric value, optional timestamp). Each event has an `identifier` for deduplication, and idempotency keys
  prevent double reporting. Timestamps must be within the past 35 calendar days and not more than 5 minutes
  in the future. Events are processed asynchronously, and invalid events surface in
  `v1.billing.meter.error_report_triggered` webhooks. Usage should be reported before the invoice
  finalizes. Source: [Stripe: Record usage for billing with the API](https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage-api)
  (read October 11, 2026).
- **Stripe fees** (Norwegian pricing page, October 11, 2026): Billing 0.7% of Billing volume; Tax Basic 0.5%
  per transaction in jurisdictions where you are registered (no-code); Managed Payments 3.5% per
  successful transaction on top of standard card fees; EEA cards 2.4% + 2.00 kr. Source:
  [Stripe pricing](https://stripe.com/pricing).
- **Stripe Managed Payments** is Stripe's merchant of record product for SaaS, handling sales tax, VAT and
  GST in 80+ countries plus fraud and disputes. Norway is a supported business location, and SaaS and
  "AI as a service" tax codes exist. Restrictions that matter here: subscriptions must be created through
  Checkout or Payment Links, **attaching invoice items to a Managed Payments subscription and one-off
  invoices are unsupported**, no Connect, no third-party tax integrations, and Stripe may refuse or
  revoke access on an eligibility and dispute-rate review. The pages do not say whether metered prices
  work with Managed Payments. Sources: [Managed Payments](https://docs.stripe.com/payments/managed-payments)
  and [eligibility](https://docs.stripe.com/payments/managed-payments/eligibility) (read October 11, 2026).
- **Paddle** charges 5% + 50 cents per checkout transaction as merchant of record and handles tax
  collection and filing ([Paddle pricing](https://www.paddle.com/pricing), October 11, 2026). Its developer
  docs say native usage-based billing (metering, events, credits) is "coming soon"; today usage is tracked
  by the seller and billed as a custom line item on the next transaction, or with one-time products for
  prepaid credits ([Paddle for AI companies](https://developer.paddle.com/get-started/how-paddle-works/ai-companies/),
  seen through a search summary on October 11, 2026, and possibly stale: the page was about five months old).
- **Lemon Squeezy** was bought by Stripe in July 2024
  ([TechCrunch](https://techcrunch.com/2024/07/26/stripe-acquires-payment-processing-startup-lemon-squeezy/)).
  I found nothing confirming its status in 2026.

### Why Stripe, and why the tax question decides it

A Norwegian company selling a SaaS add-on worldwide has three separate obligations: Norwegian VAT, EU VAT
on sales to consumers and businesses (OSS or per-country registration), and US state sales tax once
economic nexus is reached. Doing this alone with Stripe Tax means tax is computed automatically but the
**owner registers and files**. A merchant of record takes that off the owner's desk at a price (3.5% to 5%
plus a fixed fee).

The add-on is B2B (teams running marketing for a product), so the EU reverse charge applies to most
business customers who give a VAT number. That makes the filing burden smaller than for a consumer
product, but US sales tax and any consumer sales remain.

**Recommendation:** use **Stripe Billing**, because it has the strongest metering and the best fit with the
existing Node/Drizzle stack, and decide the tax model with a one-week spike in B0:

1. If metered prices work with Managed Payments, use **Managed Payments**. It is the lowest-effort path
   for a small Norwegian company.
2. If not, use **Stripe Billing + Stripe Tax** and have an accountant handle registrations, or fall back to
   Paddle with custom line items (more work in Veerify, but Paddle stays merchant of record).

The packaging below avoids the Managed Payments restrictions on purpose: the flat add-on is a normal
subscription price, and overage is the only part that needs metering. If metered prices are unsupported
under Managed Payments, a prepaid-credit top-up (a separate Checkout payment) can replace overage.

---

## Packaging options

All three are priced from Veerify's own cost, which `marketing_usage` already records in micro-USD
(`llm:<provider>:cost_usd_micros`) plus `crawl:pages`.

| Option                                           | How it works                                                                                         | Pros                                                         | Cons                                                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| **(a) Flat add-on, included allowance, overage** | Monthly fee includes a spend allowance. Beyond it, usage is billed at cost + margin up to a hard cap | Predictable bill; fits indie teams; margin on idle allowance | Needs metering and invoicing of overage                                                           |
| **(b) Prepaid credits**                          | Team buys credits; each call draws them down; pauses at zero                                         | No overage invoicing, no unpaid debt, simplest risk model    | Worse UX (top-ups, expiry, refund rules); credit balances may be taxed or regulated differently   |
| **(c) Pass-through at cost + margin**            | No flat fee; bill the month's usage in arrears                                                       | Fairest in theory                                            | Bill shock, unpaid-invoice risk, the card is charged after the cost is spent. Worst abuse profile |

**Recommendation: (a).** It matches how the budget cap already works. The allowance becomes the default
cap, and overage is an optional higher cap the team admin chooses. Teams that dislike overage keep the cap
at the allowance and simply pause, so there is never a surprise invoice. Option (b) is the fallback if
Managed Payments cannot bill metered usage.

### Price formulas (no final prices)

Let `C` be the month's Veerify cost in USD (`cost_usd_micros / 1,000,000` summed across providers, plus
crawl cost), `A` the allowance expressed in cost USD, and `m` a margin multiplier chosen by the owner.

- **Flat fee** `F = (A × (1 + m) + fixed) / (1 − fee_rate)`. Payment fees scale with `F`, so they are
  solved for rather than added. With Managed Payments plus Billing plus EEA cards, `fee_rate` is about
  0.035 + 0.007 + 0.024 = 0.066, plus the fixed card fee as `fixed`.
- **Overage** `O = max(0, C − A) × (1 + m_over)`, billed in the metered unit.
- **Hard cap** `cap = A + overage cap chosen by the admin` (cost USD), enforced by reservation (below).

**Example from `LLM_PRICING`** (`server/services/llm/models.ts`; illustrative, not a quote). One AI
visibility sample on Anthropic: answer model `claude-sonnet-5-5` ($2 in / $10 out per million tokens)
with a typical 3,000 input tokens, 800 output tokens and 2 web searches at $0.01 each, then an extraction
call on `claude-haiku-4-5` ($1 / $5) with 1,500 input and 300 output tokens.

- Answer: 3,000 × 2 + 800 × 10 + 2 × 10,000 = 34,000 micro-USD.
- Extraction: 1,500 × 1 + 300 × 5 = 3,000 micro-USD.
- Cost per sample = 37,000 micro-USD = **$0.037**.

If the owner chose `A = $5` and `m = 0.5`, the allowance covers about 135 samples (5 / 0.037) and the fee
before payment costs is `5 × 1.5 = $7.50`. With `fee_rate = 0.066` and a fixed fee `f`, `F = (7.50 + f) / 0.934`,
about $8.03 plus `f / 0.934`. These numbers only show how the formula behaves.

The worst-case reservation for the same call (`LLM_CALL_LIMITS`: 4,096 output tokens, 5 searches, input
sized at 1,000 + 5 × 3,000 tokens) is about $0.12, roughly 3x the typical cost. The last few calls of a
month can therefore be refused early; size the allowance with that headroom in mind.

Crawl pages need a similar line: `crawl:pages` × Firecrawl's per-page cost (current plan pricing must be
looked up in B0; it is not stored in the codebase today) × `(1 + m)`. Recommended: fold crawl into the same
dollar allowance, converting pages to cost with a configured constant
(`BILLING_CRAWL_PAGE_COST_USD_MICROS`).

---

## How it plugs into the existing code

### Credential resolution order

Today `getTeamApiKey(teamId, provider)` returns the team's decrypted key or null, and
`resolveCrawlConfig(teamKey)` falls back to the instance `FIRECRAWL_API_KEY`. The new order, per provider:

1. **Team key** with status `valid` or `unchecked`: use it, budgeted by
   `teamApiCredential.monthlyBudgetCents`. Never billed.
2. **Veerify-provided key**, only when the deployment mode is `cloud`, billing is configured, and the team
   has an active entitlement: use the instance key (for example `VEERIFY_ANTHROPIC_API_KEY`), budgeted by
   the entitlement.
3. **None**: the capability reports "add a key or enable the add-on", as today.

One new function, `resolveProviderAccess(teamId, provider)`, decides this and returns
`{ source: 'team' | 'veerify', apiKey, capCents, keyHint }`. `llm-call.ts`, `visibility/runner.ts` and
`audit/runner.ts` call it instead of `getTeamApiKey` directly (the visibility runner already takes `getKey`
as an injected dependency, so tests stay easy). Self-hosted installs never reach step 2, and the operator's
own `FIRECRAWL_API_KEY` fallback keeps working there.

**Required change on the cloud:** the instance Firecrawl fallback in `resolveCrawlConfig` gives every team
on an instance with `FIRECRAWL_API_KEY` free crawling. On the cloud that fallback must be replaced by the
entitlement check, or the add-on can be bypassed. This belongs in B2.

### Metering source of truth

`marketing_usage` already stores per-team, per-month counters, written atomically by `recordUsage` and
`settleBudget`. Billing adds nothing to the hot path. To tell team-key spend from Veerify-key spend,
Veerify-provided calls write metrics with a prefix, for example `veerify:llm:anthropic:cost_usd_micros` and
`veerify:crawl:pages`. Team-key metrics keep their names and are never exported to billing.

### Hard caps via reservations

`reserveBudget(teamId, provider, amount, capCents)` already enforces `spent + reserved + amount <= cap`.
For Veerify keys, `capCents` comes from the entitlement (allowance plus the admin's chosen overage cap).
The cap must cover all Veerify-provided providers together, but today the guard is per provider
(`llm:<provider>:...`). B2 therefore adds a team-wide Veerify counter (`veerify:total_cost_usd_micros` and
its reserved twin) and guards on that. This also bounds Veerify's worst-case bill: the sum of caps across
subscribed teams.

Existing caveats carry over and should be accepted: a call can cost more than reserved (Anthropic
`pause_turn` continuations), and reservations leaked by a crash clear after 15 minutes. The provider's
invoice stays the source of truth for Veerify's own costs.

### Usage reporting to the billing provider

A daily scheduled task, `billing:export-usage`, registered in the existing scheduler (Vercel cron on the
cloud, so it must be listed in the cron config like the other tasks):

1. For each active subscription, read the team's `veerify:*` counters for the open period.
2. Compute `billable = max(0, cost − allowance)` for the period so far, in the meter's unit (for example
   cents of overage).
3. Compare with the cumulative total in `usage_export` for that team and period, and send only the
   **delta** as a meter event.
4. Use an idempotency key and meter-event `identifier` of `<teamId>:<period>:<seq>` so a retry after a
   timeout cannot double-report. Record the export row in the same transaction that decides the delta, then
   mark it `sent` or `failed`.
5. Send a final export on the last day of the period and again after the grace window, before the invoice
   finalizes. Stripe accepts events up to 35 days old, but they may not reach an already-finalized invoice.

Round up to the smallest billable unit. The cumulative total, not the daily delta, is authoritative.

### At the limit

When a reservation is refused for a Veerify-key call, behave like a team budget reached today: the run is
skipped with a clear status ("Veerify-provided keys paused: monthly limit reached"), admins are emailed
once, and the Billing page shows a "raise cap" action. Nothing is billed beyond the cap. When the period
rolls over, counters reset by design (`period` is part of the key) and runs resume.

If a payment fails, the entitlement moves to `past_due`. Calls continue for a short grace period (owner
decision, suggested 3 days), then pause the same way. Cancellation pauses at the end of the paid period.

### Abuse controls

- **Per-team cap** (above) bounds one team. A **global kill switch** (`BILLING_VEERIFY_KEYS_ENABLED=false`)
  stops all Veerify-key use at once.
- **New-account limits:** the add-on needs a paid subscription with a successfully charged first payment.
  No free trial on Veerify-provided keys in the first version. If a trial is wanted, give it a very small
  separate cap (a few cents of cost) and require a verified email and a verified site.
- **Ceilings:** a maximum number of entitled teams per organization, a maximum overage cap an admin may
  choose without contacting support, and the existing per-site and per-day endpoint limits
  (`consumeDbLimit`) stay in force.
- **Fraud:** card testing and stolen cards are handled by the provider (Radar, or the merchant of record).
  Disputes after usage are the main loss, which is another reason for a small cap and no post-paid
  overage in the first release.
- **Global budget alarm:** a daily check that total Veerify spend across teams stays below a configured
  ceiling, with an alert to the owner.

### Key isolation

- Veerify's provider keys live only in server environment variables (or the host's secret store). They are
  never stored in the database, never returned by the API, never logged and never sent to the browser. The
  same allowlist rule as for team keys applies.
- Use **dedicated provider organizations or projects** for the add-on: one per provider, separate from
  anything else the company runs, with a spend limit set at the provider as a second cap behind the
  per-team caps.
- Rotate by replacing the env var. No data migration is needed because nothing is encrypted per team.
- Do not pass user emails or team names as provider "user" fields. Use an opaque hashed team id, so a
  provider can help with abuse investigations without learning customer identities.

---

## Data model sketch

A new `server/database/schema/billing.ts`, re-exported from the schema index. Migrations come from
`yarn db:generate`, as always.

| Table                   | Key columns                                                                                                                                                                             | Notes                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `billing_customer`      | id, organizationId (unique, FK→organization), providerCustomerId, billingEmail, taxId, country, createdAt                                                                               | One per organization                                                            |
| `billing_subscription`  | id, customerId, providerSubscriptionId (unique), planKey, status (`trialing/active/past_due/canceled`), currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd, updatedAt              | Mirrors the provider; webhooks are the only writer                              |
| `team_entitlement`      | id, teamId (FK→team), subscriptionId, feature (`veerify_keys`), allowanceCostMicros, overageCapMicros, status (`active/grace/paused`), graceEndsAt, updatedAt; unique (teamId, feature) | What the code reads. Set by the org owner; status derived from the subscription |
| `usage_export`          | id, teamId, period, seq, cumulativeUnits, deltaUnits, idempotencyKey (unique), status (`pending/sent/failed`), providerEventId, error, createdAt                                        | Ledger of what was reported to the provider                                     |
| `billing_webhook_event` | providerEventId (unique), type, receivedAt, processedAt, error                                                                                                                          | Replay protection and debugging                                                 |

Entitlement checks read `team_entitlement` only. They never call the provider, so a provider outage cannot
block calls.

### Webhooks

One endpoint, `POST /api/billing/webhook` (the only unauthenticated billing route, so it must be allowed
by the guard), cloud mode only.

1. Read the **raw** body. Verify the provider signature header with the signing secret
   (`BILLING_WEBHOOK_SECRET`) and the provider SDK, with a short timestamp tolerance. Reject anything else
   with 400 and log no payload.
2. Insert `billing_webhook_event` by provider event id. If it already exists, return 200 (replays are
   normal).
3. Handle: `customer.subscription.created`, `.updated`, `.deleted` (upsert `billing_subscription`, then
   recompute `team_entitlement` rows); `invoice.payment_failed` (set `past_due`, start grace, email org
   admins); `invoice.paid` (clear `past_due`); `v1.billing.meter.error_report_triggered` (mark the export
   failed and alert the owner). These are Stripe's names; a Paddle choice maps to its equivalents.
4. Process in a transaction and return 200 quickly. Anything unknown is stored and ignored.

Checkout and the customer portal use provider-hosted pages, so Veerify never touches card data.

---

## Organization versus team

Veerify's hierarchy is organization → team → product. Keys, usage and budgets are **per team**
(`team_api_credential`, `marketing_usage`), while customers, invoices and tax identity are naturally
**per legal entity**, which is the organization.

| Option                                        | Pros                                                                              | Cons                                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Team-level subscription                       | Matches where usage lives; simple entitlement check                               | Several invoices and tax IDs for one company; a team admin can bind the company to a charge |
| **Org-level subscription, team entitlements** | One customer, one invoice, one VAT number; org owners control spend; teams opt in | One extra table and a UI to assign allowance to teams                                       |

**Recommendation:** the **organization** is the paying customer. Only organization owners can start or
change the subscription (not ordinary team admins). The subscription has one pool of allowance that org
owners divide among teams through `team_entitlement` (default: one team, or an equal split). Metering and
caps stay per team, so no code in the hot path learns about organizations. This is also a natural home for
any other paid feature later.

---

## Legal and compliance checklist

**Every item below needs the owner and legal review. This list is not legal advice.**

- **LLM provider terms and DPA.** When Veerify supplies the key, Veerify (not the team) is the customer of
  Anthropic, OpenAI, Perplexity, Google and Firecrawl, and sends the team's prompts and site content
  through its own accounts. Check each provider's usage policy for reselling or powering a product for
  third parties, enable zero-data-retention or the strictest retention options if available, and sign their
  data processing agreements. Veerify becomes a **processor** and the provider a **sub-processor**.
- **Veerify's own DPA and sub-processor list.** Add the providers (and the billing provider) as
  sub-processors, with a way to notify customers of changes.
- **Terms of service.** Add the add-on terms: fair use and prohibited uses (the providers' acceptable-use
  rules flow down), pausing at the cap, no uptime guarantee for upstream providers, price-change notice,
  cancellation, and what happens to data on cancellation.
- **Privacy policy.** Disclose the new processing and that team-key calls are unaffected. The existing rule
  stays: no support conversations or feedback text go to an LLM without the team's opt-in.
- **Invoices, VAT and sales tax.** Decide the tax model (merchant of record or self-filing). Collect
  customer country and VAT ID at checkout. Invoices must show the required fields (Norwegian invoice
  rules, EU reverse-charge wording). Confirm the accounting treatment of metered revenue with an
  accountant.
- **Refunds.** Decide a policy, for example no refund of used allowance and a pro-rata refund of an unused
  flat fee on request within N days. Consumer cooling-off rules may apply to individuals, and a merchant of
  record may apply its own refund rules (Stripe Managed Payments mentions refunds within 60 days in some
  cases).
- **Chargebacks.** Dispute handling, and what happens to the entitlement after a lost dispute.
- **Sanctions and restricted regions.** A merchant of record excludes a list of countries (Stripe's list
  includes China, Cuba, Iran, North Korea, Russia and Syria). Block checkout accordingly.
- **Data retention.** Accounting law requires multi-year retention of invoices, which conflicts with
  deleting a team. Billing rows should survive team deletion in anonymized form.
- **Company registrations.** Without a merchant of record: VAT registration (Norway, EU OSS) and US nexus
  monitoring.

---

## Stages

Rough effort is one engineer, including tests and review.

| Stage  | Content                                                                                                                                                                                                       | Effort    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **B0** | Owner decisions (open questions below). Spike: does Stripe Managed Payments accept metered prices? Provider accounts, dedicated LLM and crawl projects with provider-side spend limits. Legal review starts   | 1 week    |
| **B1** | Provider integration: `billing.ts` schema, customer and subscription tables, Checkout and customer portal links, signed webhook endpoint, `billing_webhook_event`, cloud-mode gating, `.env.example`          | 1.5 weeks |
| **B2** | Entitlements and provided keys: `team_entitlement`, `resolveProviderAccess`, team-wide Veerify cap in `llm-budget.ts`, removal of the free instance Firecrawl fallback on cloud, kill switch, grace and pause | 2 weeks   |
| **B3** | Usage export and invoices: `veerify:*` metrics, `usage_export` ledger, daily `billing:export-usage` task, meter-event idempotency, error-report handling, reconciliation against the provider invoice         | 1.5 weeks |
| **B4** | Dashboard: org Billing page (plan, allowance used, cap control, invoices through the portal), per-team entitlement assignment, Marketing Hub banners for paused and past-due, admin emails                    | 1.5 weeks |

Total about 7.5 weeks, plus calendar time for legal and tax setup that does not parallelize with coding.
Each stage ships behind the cloud-only flag and can be released separately; nothing is visible to users
until B4.

---

## Open questions for the owner

These decisions are needed before any code.

1. **Tax model:** will the owner register and file VAT/sales tax (Stripe Tax), or should a merchant of
   record take that on, accepting the higher fee (about 3.5% to 5% plus fixed fees)?
2. **Provider:** Stripe (recommended) or Paddle? If Stripe Managed Payments does not support metered
   prices, is a prepaid-credit top-up acceptable instead of overage?
3. **Packaging:** confirm option (a), a flat add-on with an allowance and optional overage. Should overage
   exist at all in the first release, or only the flat allowance with a hard stop?
4. **Prices:** the margin `m`, the allowance `A` and the resulting flat fee `F` (formulas above), and the
   currency (USD, EUR or both).
5. **Who pays:** confirm the organization as customer, with owner-only purchase rights and team
   entitlements. Are there customers who need per-team invoices?
6. **Trial:** none (recommended), or a tiny capped trial? What proof (verified email, verified site) is
   required?
7. **Providers covered:** which of Anthropic, OpenAI, Perplexity, Gemini and Firecrawl are offered as
   Veerify-provided at launch? Fewer is simpler and cheaper to secure.
8. **Provider terms:** has anyone confirmed that Anthropic and OpenAI allow this kind of reselling under
   their terms, and are a DPA with each provider acceptable?
9. **Failure policy:** the grace period after a failed payment (suggested 3 days), and whether a lost
   dispute suspends the whole organization or only the add-on.
10. **Refunds:** policy for unused allowance and for cancellations mid-period.
11. **Spend ceilings:** the global monthly ceiling for Veerify's own provider bills, and the maximum
    overage cap an admin may set alone.
12. **Self-hosted operators:** should the billing code ship in the open-source build, inert, or be kept
    out of it? (Recommended: shipped but inert, no separate fork.)
