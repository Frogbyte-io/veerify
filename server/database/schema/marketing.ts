// Marketing Hub schema (M1+): the verified site per product, bring-your-own
// provider keys, usage metering, SEO audits, AI visibility tracking and
// mention monitoring.
//
// Rule definitions, provider lists and source lists are code, not tables, so
// reports mean the same thing across teams. Status/kind columns are plain
// text; the unions below are the source of truth for application code.
//
// See `docs/plans/2026-10-09-marketing-hub/design.md` -> Data model sketch.

import {
  pgTable,
  primaryKey,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  boolean,
  integer,
  bigint,
  date,
  doublePrecision,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { user, team } from './auth'
import { project } from './feedback'
import { changelogEntry } from './changelog'
import { conversation } from './support'
import type { PageFacts } from '../../services/marketing/audit/types'

export type MarketingVerificationMethod = 'dns' | 'meta' | 'file' | 'domain'
export type ApiCredentialProvider = 'anthropic' | 'openai' | 'perplexity' | 'gemini' | 'firecrawl' | 'pagespeed'
export type ApiCredentialStatus = 'valid' | 'invalid' | 'unchecked'
export type SeoAuditTrigger = 'auto' | 'schedule' | 'manual'
export type SeoAuditMode = 'basic' | 'full'
export type SeoAuditStatus = 'queued' | 'crawling' | 'analyzing' | 'done' | 'failed' | 'cancelled'
export type MarketingTermKind = 'brand' | 'competitor' | 'keyword'
export type AiVisibilityPromptSource = 'user' | 'suggested'
export type AiVisibilityRunStatus = 'queued' | 'running' | 'done' | 'failed' | 'partial'
export type AiVisibilityAnswerStatus = 'pending' | 'done' | 'failed'
export type MentionSource = 'hackernews' | 'reddit' | 'bluesky'
export type MentionKind = 'mention' | 'competitor' | 'opportunity'
export type MentionStatus = 'new' | 'seen' | 'dismissed' | 'escalated'
export type AnnouncementChannel = 'x' | 'linkedin' | 'bluesky' | 'newsletter'
export type ReviewRequestTrigger = 'csat' | 'shipped' | 'manual'
// `sending` is a claim held by a worker (see `claimedAt`); a sweeper returns stale claims to `queued`.
export type ReviewRequestStatus = 'queued' | 'sending' | 'sent' | 'skipped' | 'failed'
export type EmailSuppressionReason = 'unsubscribed' | 'bounced' | 'complaint'
export type TestimonialStatus = 'pending' | 'approved' | 'rejected'
export type CustomerLanguageSource = 'feedback' | 'support'
export type CustomerLanguagePhraseKind = 'pain' | 'feature' | 'praise' | 'comparison'
export type GscConnectionStatus = 'connected' | 'needs_property' | 'error'

export type ReviewPlatform = { id: string; label: string; url: string }
export type CustomerLanguagePhrase = { phrase: string; kind: CustomerLanguagePhraseKind; mentions: number }
export type CustomerLanguageSuggestedTerm = { kind: 'keyword' | 'competitor'; label: string }

const createdAtColumn = () =>
  timestamp('created_at')
    .$defaultFn(() => new Date())
    .notNull()

const updatedAtColumn = () =>
  timestamp('updated_at')
    .$defaultFn(() => new Date())
    .notNull()

// One marketing site per product (project). `origin` is the scheme + host the
// audit is allowed to crawl; it must be verified before audits beyond `basic`.
export const marketingSite = pgTable(
  'marketing_site',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    origin: text('origin').notNull(),
    verificationMethod: text('verification_method').$type<MarketingVerificationMethod>(),
    verificationToken: text('verification_token').notNull(),
    verifiedAt: timestamp('verified_at'),
    lastVerificationError: text('last_verification_error'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => ({
    uniqueProject: uniqueIndex('marketing_site_project_idx').on(table.projectId),
    teamIdx: index('marketing_site_team_idx').on(table.teamId),
  })
)

// Team-supplied provider keys (bring your own key). `encryptedKey` is the
// versioned AES-256-GCM envelope from `server/utils/secrets.ts`; it is never
// returned by the API or logged. `keyHint` is the last few characters only.
export const teamApiCredential = pgTable(
  'team_api_credential',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<ApiCredentialProvider>().notNull(),
    encryptedKey: text('encrypted_key').notNull(),
    keyHint: text('key_hint').notNull(),
    // LLM providers only; null means no cap
    monthlyBudgetCents: integer('monthly_budget_cents'),
    status: text('status').$type<ApiCredentialStatus>().default('unchecked').notNull(),
    lastValidatedAt: timestamp('last_validated_at'),
    lastError: text('last_error'),
    createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => ({
    uniqueTeamProvider: uniqueIndex('team_api_credential_team_provider_idx').on(table.teamId, table.provider),
  })
)

// Monthly usage counters per team, incremented atomically by `recordUsage`.
// `period` is UTC `YYYY-MM`; `metric` e.g. `llm:anthropic:input_tokens`.
// Composite primary key: the (team, period, metric) triple is the identity.
export const marketingUsage = pgTable(
  'marketing_usage',
  {
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    period: text('period').notNull(),
    metric: text('metric').notNull(),
    units: bigint('units', { mode: 'number' }).default(0).notNull(),
    updatedAt: updatedAtColumn(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.teamId, table.period, table.metric] }),
  })
)

export const seoAudit = pgTable(
  'seo_audit',
  {
    id: text('id').primaryKey(),
    siteId: text('site_id')
      .notNull()
      .references(() => marketingSite.id, { onDelete: 'cascade' }),
    trigger: text('trigger').$type<SeoAuditTrigger>().notNull(),
    mode: text('mode').$type<SeoAuditMode>().default('basic').notNull(),
    status: text('status').$type<SeoAuditStatus>().default('queued').notNull(),
    crawlProvider: text('crawl_provider'),
    crawlJobId: text('crawl_job_id'),
    crawlCursor: text('crawl_cursor'),
    pageLimit: integer('page_limit').notNull(),
    pagesFetched: integer('pages_fetched').default(0).notNull(),
    score: integer('score'),
    // robots.txt / llms.txt / sitemap fetch results and AI-crawler access verdicts
    siteFacts: jsonb('site_facts').$type<Record<string, unknown>>(),
    error: text('error'),
    requestedByUserId: text('requested_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at'),
    finishedAt: timestamp('finished_at'),
    createdAt: createdAtColumn(),
  },
  (table) => ({
    siteCreatedIdx: index('seo_audit_site_created_idx').on(table.siteId, table.createdAt),
    // At most one active audit per site; the arbiter for concurrent starts
    activePerSiteIdx: uniqueIndex('seo_audit_active_site_idx')
      .on(table.siteId)
      .where(sql`${table.status} IN ('queued', 'crawling', 'analyzing')`),
    statusIdx: index('seo_audit_status_idx').on(table.status),
  })
)

export const seoAuditPage = pgTable(
  'seo_audit_page',
  {
    id: text('id').primaryKey(),
    auditId: text('audit_id')
      .notNull()
      .references(() => seoAudit.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    statusCode: integer('status_code').notNull(),
    facts: jsonb('facts').$type<PageFacts>().notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => ({
    uniqueAuditUrl: uniqueIndex('seo_audit_page_audit_url_idx').on(table.auditId, table.url),
  })
)

export const seoIssue = pgTable(
  'seo_issue',
  {
    id: text('id').primaryKey(),
    auditId: text('audit_id')
      .notNull()
      .references(() => seoAudit.id, { onDelete: 'cascade' }),
    // Null for site-level issues
    pageId: text('page_id').references(() => seoAuditPage.id, { onDelete: 'cascade' }),
    pageUrl: text('page_url'),
    ruleId: text('rule_id').notNull(),
    severity: text('severity').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAtColumn(),
  },
  (table) => ({
    auditRuleIdx: index('seo_issue_audit_rule_idx').on(table.auditId, table.ruleId),
  })
)

export const marketingTerm = pgTable(
  'marketing_term',
  {
    id: text('id').primaryKey(),
    siteId: text('site_id')
      .notNull()
      .references(() => marketingSite.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<MarketingTermKind>().notNull(),
    label: text('label').notNull(),
    aliases: text('aliases')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    competitorDomain: text('competitor_domain'),
    createdAt: createdAtColumn(),
  },
  (table) => ({
    siteKindIdx: index('marketing_term_site_kind_idx').on(table.siteId, table.kind),
  })
)

export const aiVisibilityPrompt = pgTable(
  'ai_visibility_prompt',
  {
    id: text('id').primaryKey(),
    siteId: text('site_id')
      .notNull()
      .references(() => marketingSite.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    locale: text('locale').default('en').notNull(),
    active: boolean('active').default(true).notNull(),
    source: text('source').$type<AiVisibilityPromptSource>().default('user').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => ({
    siteIdx: index('ai_visibility_prompt_site_idx').on(table.siteId),
  })
)

export const aiVisibilityRun = pgTable(
  'ai_visibility_run',
  {
    id: text('id').primaryKey(),
    siteId: text('site_id')
      .notNull()
      .references(() => marketingSite.id, { onDelete: 'cascade' }),
    trigger: text('trigger').$type<SeoAuditTrigger>().notNull(),
    status: text('status').$type<AiVisibilityRunStatus>().default('queued').notNull(),
    samplesPerPrompt: integer('samples_per_prompt').default(3).notNull(),
    providers: text('providers').array().notNull(),
    error: text('error'),
    startedAt: timestamp('started_at'),
    finishedAt: timestamp('finished_at'),
    createdAt: createdAtColumn(),
  },
  (table) => ({
    siteCreatedIdx: index('ai_visibility_run_site_created_idx').on(table.siteId, table.createdAt),
    // At most one active run per site; the arbiter for concurrent starts
    activePerSiteIdx: uniqueIndex('ai_visibility_run_active_site_idx')
      .on(table.siteId)
      .where(sql`${table.status} IN ('queued', 'running')`),
  })
)

export const aiVisibilityAnswer = pgTable(
  'ai_visibility_answer',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => aiVisibilityRun.id, { onDelete: 'cascade' }),
    promptId: text('prompt_id')
      .notNull()
      .references(() => aiVisibilityPrompt.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    sample: integer('sample').notNull(),
    status: text('status').$type<AiVisibilityAnswerStatus>().default('pending').notNull(),
    answer: text('answer'),
    citations: jsonb('citations')
      .$type<Array<{ url: string; title?: string | null }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    brandMentioned: boolean('brand_mentioned'),
    brandRank: integer('brand_rank'),
    competitorsMentioned: jsonb('competitors_mentioned')
      .$type<Array<{ termId?: string; label: string; rank?: number | null }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    citationDomains: text('citation_domains')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    brandSentiment: text('brand_sentiment'),
    inputTokens: integer('input_tokens').default(0).notNull(),
    outputTokens: integer('output_tokens').default(0).notNull(),
    error: text('error'),
    createdAt: createdAtColumn(),
    completedAt: timestamp('completed_at'),
  },
  (table) => ({
    uniqueSample: uniqueIndex('ai_visibility_answer_sample_idx').on(
      table.runId,
      table.promptId,
      table.provider,
      table.sample
    ),
    promptIdx: index('ai_visibility_answer_prompt_idx').on(table.promptId),
  })
)

export const mention = pgTable(
  'mention',
  {
    id: text('id').primaryKey(),
    siteId: text('site_id')
      .notNull()
      .references(() => marketingSite.id, { onDelete: 'cascade' }),
    termId: text('term_id').references(() => marketingTerm.id, { onDelete: 'set null' }),
    source: text('source').$type<MentionSource>().notNull(),
    externalId: text('external_id').notNull(),
    url: text('url').notNull(),
    author: text('author'),
    title: text('title'),
    excerpt: text('excerpt').notNull(),
    score: integer('score'),
    kind: text('kind').$type<MentionKind>().default('mention').notNull(),
    status: text('status').$type<MentionStatus>().default('new').notNull(),
    publishedAt: timestamp('published_at').notNull(),
    // Support conversation created when the mention was escalated (M6)
    conversationId: text('conversation_id').references(() => conversation.id, { onDelete: 'set null' }),
    escalatedAt: timestamp('escalated_at'),
    createdAt: createdAtColumn(),
  },
  (table) => ({
    uniqueExternal: uniqueIndex('mention_site_source_external_idx').on(table.siteId, table.source, table.externalId),
    inboxIdx: index('mention_site_status_published_idx').on(table.siteId, table.status, table.publishedAt),
  })
)

// Polling state per (site, source); composite identity, no surrogate id.
export const mentionSourceCursor = pgTable(
  'mention_source_cursor',
  {
    siteId: text('site_id')
      .notNull()
      .references(() => marketingSite.id, { onDelete: 'cascade' }),
    source: text('source').$type<MentionSource>().notNull(),
    // Search-window watermark: only advances after a successful poll
    lastPolledAt: timestamp('last_polled_at').notNull(),
    // Last time a poll was attempted (success or failure); drives scheduling and backoff
    lastAttemptAt: timestamp('last_attempt_at'),
    consecutiveFailures: integer('consecutive_failures').default(0).notNull(),
    lastError: text('last_error'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.siteId, table.source] }),
  })
)

// One editable announcement draft per (entry, channel). Regenerating replaces
// it; nothing is ever posted automatically.
export const marketingAnnouncementDraft = pgTable(
  'marketing_announcement_draft',
  {
    id: text('id').primaryKey(),
    entryId: text('entry_id')
      .notNull()
      .references(() => changelogEntry.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    channel: text('channel').$type<AnnouncementChannel>().notNull(),
    content: text('content').notNull(),
    provider: text('provider'),
    model: text('model'),
    edited: boolean('edited').default(false).notNull(),
    createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => ({
    uniqueEntryChannel: uniqueIndex('marketing_announcement_draft_entry_channel_idx').on(table.entryId, table.channel),
    projectIdx: index('marketing_announcement_draft_project_idx').on(table.projectId),
  })
)

// Review and testimonial request settings per product. Off by default.
export const reviewRequestSettings = pgTable('review_request_settings', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => project.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').default(false).notNull(),
  platforms: jsonb('platforms')
    .$type<ReviewPlatform[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  askForTestimonial: boolean('ask_for_testimonial').default(true).notNull(),
  csatTrigger: boolean('csat_trigger').default(true).notNull(),
  // null means the top score of the survey scale
  csatMinRating: integer('csat_min_rating'),
  shippedTrigger: boolean('shipped_trigger').default(true).notNull(),
  shippedStatusValues: text('shipped_status_values')
    .array()
    .notNull()
    .default(sql`'{completed}'::text[]`),
  cooldownDays: integer('cooldown_days').default(90).notNull(),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
})

// `sourceId` is the CSAT response id, feedback id or changelog entry id,
// depending on `trigger`. The unique index stops the same event queuing twice
// (NULL sourceIds, i.e. manual requests, are never deduplicated by it).
export const reviewRequest = pgTable(
  'review_request',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    name: text('name'),
    trigger: text('trigger').$type<ReviewRequestTrigger>().notNull(),
    sourceId: text('source_id'),
    token: text('token').notNull(),
    status: text('status').$type<ReviewRequestStatus>().default('queued').notNull(),
    skipReason: text('skip_reason'),
    error: text('error'),
    sentAt: timestamp('sent_at'),
    clickedAt: timestamp('clicked_at'),
    // When a worker claimed the row (status `sending`); null otherwise.
    claimedAt: timestamp('claimed_at'),
    // Failed send attempts so far; the row is `failed` once this reaches the retry limit.
    attempts: integer('attempts').default(0).notNull(),
    // Earliest time a retry may be claimed; null means immediately.
    nextAttemptAt: timestamp('next_attempt_at'),
    createdAt: createdAtColumn(),
  },
  (table) => ({
    uniqueToken: uniqueIndex('review_request_token_idx').on(table.token),
    uniqueEvent: uniqueIndex('review_request_event_idx').on(
      table.projectId,
      table.trigger,
      table.sourceId,
      table.email
    ),
    projectEmailIdx: index('review_request_project_email_idx').on(table.projectId, table.email, table.createdAt),
    statusIdx: index('review_request_status_idx').on(table.status, table.createdAt),
  })
)

// Per-team marketing email suppression. `email` is lower-cased in app code.
export const marketingEmailSuppression = pgTable(
  'marketing_email_suppression',
  {
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    reason: text('reason').$type<EmailSuppressionReason>().notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.teamId, table.email] }),
  })
)

// `authorEmail` is private and must never be returned by public endpoints.
export const testimonial = pgTable(
  'testimonial',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    reviewRequestId: text('review_request_id').references(() => reviewRequest.id, { onDelete: 'set null' }),
    authorName: text('author_name').notNull(),
    authorTitle: text('author_title'),
    authorCompany: text('author_company'),
    authorEmail: text('author_email'),
    quote: text('quote').notNull(),
    rating: integer('rating'),
    consentPublic: boolean('consent_public').default(false).notNull(),
    status: text('status').$type<TestimonialStatus>().default('pending').notNull(),
    featured: boolean('featured').default(false).notNull(),
    moderatedAt: timestamp('moderated_at'),
    moderatedByUserId: text('moderated_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => ({
    projectStatusIdx: index('testimonial_project_status_idx').on(table.projectId, table.status, table.createdAt),
  })
)

// Team-admin consent before feedback or support text is sent to an LLM provider.
export const marketingDataConsent = pgTable('marketing_data_consent', {
  teamId: text('team_id')
    .primaryKey()
    .references(() => team.id, { onDelete: 'cascade' }),
  allowFeedbackText: boolean('allow_feedback_text').default(false).notNull(),
  allowSupportText: boolean('allow_support_text').default(false).notNull(),
  consentedByUserId: text('consented_by_user_id').references(() => user.id, { onDelete: 'set null' }),
  consentedAt: timestamp('consented_at'),
  updatedAt: updatedAtColumn(),
})

export const customerLanguageInsight = pgTable(
  'customer_language_insight',
  {
    id: text('id').primaryKey(),
    siteId: text('site_id')
      .notNull()
      .references(() => marketingSite.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    itemCount: integer('item_count').notNull(),
    sources: text('sources')
      .array()
      .$type<CustomerLanguageSource[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    phrases: jsonb('phrases')
      .$type<CustomerLanguagePhrase[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    suggestedTerms: jsonb('suggested_terms')
      .$type<CustomerLanguageSuggestedTerm[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    suggestedPrompts: jsonb('suggested_prompts')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    inputTokens: integer('input_tokens').default(0).notNull(),
    outputTokens: integer('output_tokens').default(0).notNull(),
    createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAtColumn(),
  },
  (table) => ({
    siteCreatedIdx: index('customer_language_insight_site_created_idx').on(table.siteId, table.createdAt),
  })
)

// Google Search Console connection per site. The refresh token is the
// versioned envelope from `server/utils/secrets.ts`; never returned by the API.
export const gscConnection = pgTable('gsc_connection', {
  siteId: text('site_id')
    .primaryKey()
    .references(() => marketingSite.id, { onDelete: 'cascade' }),
  encryptedRefreshToken: text('encrypted_refresh_token').notNull(),
  googleAccountEmail: text('google_account_email'),
  // e.g. `sc-domain:acme.com` or `https://acme.com/`
  propertyUrl: text('property_url'),
  status: text('status').$type<GscConnectionStatus>().default('needs_property').notNull(),
  lastSyncAt: timestamp('last_sync_at'),
  lastError: text('last_error'),
  connectedByUserId: text('connected_by_user_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
})

export const gscDailyMetric = pgTable(
  'gsc_daily_metric',
  {
    siteId: text('site_id')
      .notNull()
      .references(() => marketingSite.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    clicks: integer('clicks').notNull(),
    impressions: integer('impressions').notNull(),
    ctr: doublePrecision('ctr').notNull(),
    position: doublePrecision('position').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.siteId, table.date] }),
  })
)

// Top queries for the 28 days ending `periodEnd`.
export const gscQueryStat = pgTable(
  'gsc_query_stat',
  {
    siteId: text('site_id')
      .notNull()
      .references(() => marketingSite.id, { onDelete: 'cascade' }),
    periodEnd: date('period_end', { mode: 'string' }).notNull(),
    query: text('query').notNull(),
    clicks: integer('clicks').notNull(),
    impressions: integer('impressions').notNull(),
    ctr: doublePrecision('ctr').notNull(),
    position: doublePrecision('position').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.siteId, table.periodEnd, table.query] }),
    sitePeriodIdx: index('gsc_query_stat_site_period_idx').on(table.siteId, table.periodEnd),
  })
)

// --- Stage M6 -------------------------------------------------------------

export type LaunchKitStatus = 'todo' | 'in_progress' | 'submitted' | 'live' | 'rejected' | 'skipped'
export type CompetitorWatchKind = 'pricing' | 'changelog' | 'homepage' | 'other'
export type CompetitorWatchStatus = 'active' | 'paused' | 'error' | 'blocked_by_robots'

// Launch kit progress per product. `directoryId` refers to the directory
// catalog in code (`server/services/marketing/launch-kit/directories.ts`), or
// `custom:<uuid>` for a directory the team added itself (then `name` is set).
export const launchKitItem = pgTable(
  'launch_kit_item',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    directoryId: text('directory_id').notNull(),
    name: text('name'),
    url: text('url'),
    status: text('status').$type<LaunchKitStatus>().default('todo').notNull(),
    notes: text('notes'),
    submittedAt: timestamp('submitted_at'),
    liveAt: timestamp('live_at'),
    updatedByUserId: text('updated_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => ({
    uniqueDirectory: uniqueIndex('launch_kit_item_project_directory_idx').on(table.projectId, table.directoryId),
  })
)

// A public competitor page watched for changes (pricing, changelog, home).
// Fetched at most daily through safe-fetch, respecting robots.txt. Only the
// normalised text is kept, capped, to diff against the next fetch.
export const competitorWatch = pgTable(
  'competitor_watch',
  {
    id: text('id').primaryKey(),
    siteId: text('site_id')
      .notNull()
      .references(() => marketingSite.id, { onDelete: 'cascade' }),
    termId: text('term_id')
      .notNull()
      .references(() => marketingTerm.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    kind: text('kind').$type<CompetitorWatchKind>().default('other').notNull(),
    status: text('status').$type<CompetitorWatchStatus>().default('active').notNull(),
    lastCheckedAt: timestamp('last_checked_at'),
    lastChangedAt: timestamp('last_changed_at'),
    lastContentHash: text('last_content_hash'),
    lastText: text('last_text'),
    lastError: text('last_error'),
    consecutiveFailures: integer('consecutive_failures').default(0).notNull(),
    createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => ({
    uniqueUrl: uniqueIndex('competitor_watch_site_url_idx').on(table.siteId, table.url),
    dueIdx: index('competitor_watch_status_checked_idx').on(table.status, table.lastCheckedAt),
  })
)

// One detected change on a watched page. `addedText` / `removedText` are
// capped excerpts of the line diff; `summary` is an optional LLM summary made
// with the team's own key.
export const competitorChange = pgTable(
  'competitor_change',
  {
    id: text('id').primaryKey(),
    watchId: text('watch_id')
      .notNull()
      .references(() => competitorWatch.id, { onDelete: 'cascade' }),
    siteId: text('site_id')
      .notNull()
      .references(() => marketingSite.id, { onDelete: 'cascade' }),
    detectedAt: timestamp('detected_at').notNull(),
    addedText: text('added_text').default('').notNull(),
    removedText: text('removed_text').default('').notNull(),
    summary: text('summary'),
    provider: text('provider'),
    model: text('model'),
    seenAt: timestamp('seen_at'),
    createdAt: createdAtColumn(),
  },
  (table) => ({
    siteDetectedIdx: index('competitor_change_site_detected_idx').on(table.siteId, table.detectedAt),
  })
)
