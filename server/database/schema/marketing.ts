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
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { user, team } from './auth'
import { project } from './feedback'
import type { PageFacts } from '../../services/marketing/audit/types'

export type MarketingVerificationMethod = 'dns' | 'meta' | 'file' | 'domain'
export type ApiCredentialProvider = 'anthropic' | 'openai' | 'firecrawl' | 'pagespeed'
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
