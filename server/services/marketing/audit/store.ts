/**
 * Persistence for the audit runner. The runner talks to this interface so its
 * state machine can be tested against an in-memory implementation; the
 * drizzle implementation below is the only place that touches the database.
 */
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, notInArray, or, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import {
  marketingSite,
  seoAudit,
  seoAuditPage,
  seoIssue,
  type SeoAuditStatus,
} from '~/server/database/schema/marketing'
import { isModuleEnabled } from '~/lib/modules'
import type { PageFacts } from './types'

export type AuditRow = typeof seoAudit.$inferSelect
export type NewAuditRow = typeof seoAudit.$inferInsert

export interface AuditSite {
  id: string
  projectId: string
  organizationId: string
  origin: string
  verifiedAt: Date | null
  /** Marketing switched on for the project */
  marketingEnabled: boolean
}

export interface StoredPage {
  id: string
  url: string
  facts: PageFacts
}

export interface NewPageRow {
  id: string
  auditId: string
  url: string
  statusCode: number
  facts: PageFacts
}

export interface NewIssueRow {
  id: string
  auditId: string
  pageId: string | null
  pageUrl: string | null
  ruleId: string
  severity: string
  details: Record<string, unknown>
}

export interface ScheduleCandidate {
  siteId: string
  lastAuditAt: Date | null
}

export const ACTIVE_STATUSES: SeoAuditStatus[] = ['queued', 'crawling', 'analyzing']

export interface AuditStore {
  loadSite(siteId: string): Promise<AuditSite | null>
  hasActiveAudit(siteId: string): Promise<boolean>
  /** createdAt of manual audits since `since`, oldest first */
  manualAuditTimes(siteId: string, since: Date): Promise<Date[]>
  insertAudit(row: NewAuditRow): Promise<void>
  getAudit(auditId: string): Promise<AuditRow | null>
  /** Atomically lease one active audit not in `excludeIds`; null when none is due */
  claimDue(excludeIds: string[], now: Date, leaseUntil: Date): Promise<AuditRow | null>
  /**
   * Pushes the lease out to `leaseUntil` but only while this worker still holds it (the stored lease
   * has not lapsed at `now`) and the audit is active. False means another worker may own the audit,
   * so the caller must stop writing.
   */
  extendLease(auditId: string, now: Date, leaseUntil: Date): Promise<boolean>
  /** Update only while the audit is still active (never resurrects cancelled/failed/done) */
  updateAudit(auditId: string, patch: Partial<NewAuditRow>): Promise<boolean>
  /** Returns how many rows were new */
  insertPages(rows: NewPageRow[]): Promise<number>
  loadPages(auditId: string): Promise<StoredPage[]>
  /** URLs already stored for the audit */
  pageUrls(auditId: string): Promise<string[]>
  /** Remove all issues of an audit (finishing must be re-entrant) */
  deleteIssues(auditId: string): Promise<void>
  insertIssues(rows: NewIssueRow[]): Promise<void>
  /** Keep only the `keep` most recent audits of a site */
  pruneAudits(siteId: string, keep: number): Promise<void>
  /** Verified, Marketing-on sites with no audit, or none newer than `olderThan`, no active audit; never audited first */
  scheduleCandidates(olderThan: Date, limit: number): Promise<ScheduleCandidate[]>
}

const CHUNK = 200

function chunks<T>(rows: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK))
  return out
}

export const drizzleAuditStore: AuditStore = {
  async loadSite(siteId) {
    const [row] = await db
      .select({
        id: marketingSite.id,
        projectId: marketingSite.projectId,
        organizationId: project.organizationId,
        origin: marketingSite.origin,
        verifiedAt: marketingSite.verifiedAt,
        settings: project.settings,
      })
      .from(marketingSite)
      .innerJoin(project, eq(project.id, marketingSite.projectId))
      .where(eq(marketingSite.id, siteId))
      .limit(1)
    if (!row) return null
    return {
      id: row.id,
      projectId: row.projectId,
      organizationId: row.organizationId,
      origin: row.origin,
      verifiedAt: row.verifiedAt,
      marketingEnabled: isModuleEnabled(row.settings as Record<string, unknown> | null, 'marketingEnabled'),
    }
  },

  async hasActiveAudit(siteId) {
    const rows = await db
      .select({ id: seoAudit.id })
      .from(seoAudit)
      .where(and(eq(seoAudit.siteId, siteId), inArray(seoAudit.status, ACTIVE_STATUSES)))
      .limit(1)
    return rows.length > 0
  },

  async manualAuditTimes(siteId, since) {
    const rows = await db
      .select({ createdAt: seoAudit.createdAt })
      .from(seoAudit)
      .where(and(eq(seoAudit.siteId, siteId), eq(seoAudit.trigger, 'manual'), gte(seoAudit.createdAt, since)))
      .orderBy(seoAudit.createdAt)
    return rows.map((r) => r.createdAt)
  },

  async insertAudit(row) {
    await db.insert(seoAudit).values(row)
  },

  async getAudit(auditId) {
    const [row] = await db.select().from(seoAudit).where(eq(seoAudit.id, auditId)).limit(1)
    return row ?? null
  },

  async claimDue(excludeIds, now, leaseUntil) {
    const exclude = excludeIds.length
      ? sql`AND id NOT IN (${sql.join(
          excludeIds.map((id) => sql`${id}`),
          sql`, `
        )})`
      : sql``
    // The lease lives in site_facts._runtime.leaseUntil (no schema change). SKIP LOCKED keeps
    // concurrent passes from blocking on, or double-claiming, the same row.
    const result = await db.execute<{ id: string }>(sql`
      UPDATE seo_audit
      SET site_facts = COALESCE(site_facts, '{}'::jsonb) || jsonb_build_object(
        '_runtime',
        COALESCE(site_facts->'_runtime', '{}'::jsonb) || jsonb_build_object('leaseUntil', ${leaseUntil.toISOString()}::text)
      )
      WHERE id = (
        SELECT id FROM seo_audit
        WHERE status IN ('queued', 'crawling', 'analyzing')
          ${exclude}
          AND (
            site_facts->'_runtime'->>'leaseUntil' IS NULL
            OR (site_facts->'_runtime'->>'leaseUntil')::timestamptz < ${now.toISOString()}::timestamptz
          )
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id
    `)
    const id = result.rows[0]?.id
    if (!id) return null
    return this.getAudit(id)
  },

  async extendLease(auditId, now, leaseUntil) {
    const result = await db.execute<{ id: string }>(sql`
      UPDATE seo_audit
      SET site_facts = COALESCE(site_facts, '{}'::jsonb) || jsonb_build_object(
        '_runtime',
        COALESCE(site_facts->'_runtime', '{}'::jsonb) || jsonb_build_object('leaseUntil', ${leaseUntil.toISOString()}::text)
      )
      WHERE id = ${auditId}
        AND status IN ('queued', 'crawling', 'analyzing')
        AND (site_facts->'_runtime'->>'leaseUntil')::timestamptz >= ${now.toISOString()}::timestamptz
      RETURNING id
    `)
    return result.rows.length > 0
  },

  async updateAudit(auditId, patch) {
    const rows = await db
      .update(seoAudit)
      .set(patch)
      .where(and(eq(seoAudit.id, auditId), inArray(seoAudit.status, ACTIVE_STATUSES)))
      .returning({ id: seoAudit.id })
    return rows.length > 0
  },

  async insertPages(rows) {
    let inserted = 0
    for (const batch of chunks(rows)) {
      const result = await db
        .insert(seoAuditPage)
        .values(batch)
        .onConflictDoNothing({ target: [seoAuditPage.auditId, seoAuditPage.url] })
        .returning({ id: seoAuditPage.id })
      inserted += result.length
    }
    return inserted
  },

  async loadPages(auditId) {
    return db
      .select({ id: seoAuditPage.id, url: seoAuditPage.url, facts: seoAuditPage.facts })
      .from(seoAuditPage)
      .where(eq(seoAuditPage.auditId, auditId))
      .orderBy(seoAuditPage.createdAt, seoAuditPage.url)
  },

  async pageUrls(auditId) {
    const rows = await db.select({ url: seoAuditPage.url }).from(seoAuditPage).where(eq(seoAuditPage.auditId, auditId))
    return rows.map((r) => r.url)
  },

  async deleteIssues(auditId) {
    await db.delete(seoIssue).where(eq(seoIssue.auditId, auditId))
  },

  async insertIssues(rows) {
    for (const batch of chunks(rows)) {
      await db.insert(seoIssue).values(batch)
    }
  },

  async pruneAudits(siteId, keep) {
    const recent = await db
      .select({ id: seoAudit.id })
      .from(seoAudit)
      .where(eq(seoAudit.siteId, siteId))
      .orderBy(desc(seoAudit.createdAt))
      .limit(keep)
    if (recent.length < keep) return
    await db.delete(seoAudit).where(
      and(
        eq(seoAudit.siteId, siteId),
        notInArray(
          seoAudit.id,
          recent.map((r) => r.id)
        )
      )
    )
  },

  async scheduleCandidates(olderThan, limit) {
    // mapWith decodes the raw timestamp as UTC, matching how drizzle writes `timestamp` columns
    const lastAudit =
      sql<Date | null>`(SELECT max(${seoAudit.createdAt}) FROM ${seoAudit} WHERE ${seoAudit.siteId} = ${marketingSite.id})`.mapWith(
        seoAudit.createdAt
      )
    // Raw SQL does not go through column mappers: bind UTC ISO text, not a Date (pg would use local time)
    const olderThanSql = sql`${olderThan.toISOString()}::timestamp`
    const hasActive = sql`EXISTS (SELECT 1 FROM ${seoAudit} WHERE ${seoAudit.siteId} = ${marketingSite.id} AND ${inArray(seoAudit.status, ACTIVE_STATUSES)})`
    const rows = await db
      .select({
        siteId: marketingSite.id,
        lastAuditAt: lastAudit,
      })
      .from(marketingSite)
      .innerJoin(project, eq(project.id, marketingSite.projectId))
      .where(
        and(
          isNotNull(marketingSite.verifiedAt),
          // The Marketing switch is in the query (not filtered afterwards), so sites with
          // Marketing off never fill the LIMIT or get re-selected every hour
          sql`${project.settings}->>'marketingEnabled' = 'true'`,
          sql`NOT ${hasActive}`,
          or(isNull(lastAudit), lt(lastAudit, olderThanSql))
        )
      )
      // Never-audited sites first, then the longest-waiting, so a backlog drains fairly
      .orderBy(sql`${lastAudit} asc nulls first`, marketingSite.id)
      .limit(limit)

    return rows.map((row) => ({ siteId: row.siteId, lastAuditAt: row.lastAuditAt ? new Date(row.lastAuditAt) : null }))
  },
}
