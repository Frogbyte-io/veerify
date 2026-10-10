import { eq, inArray, isNotNull, lt } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import {
  marketingSite,
  marketingTerm,
  mention,
  mentionSourceCursor,
  type MentionKind,
  type MentionSource,
} from '~/server/database/schema/marketing'
import { teamModuleSettings } from '~/server/database/schema/teams'
import { DEFAULT_TEAM_MODULES, resolveProductModules } from '~/lib/modules'
import type { MatchTerm } from '~/server/services/social-sources'

export interface CandidateSite {
  siteId: string
  teamId: string
  projectId: string
  projectName: string
  projectSlug: string
  projectSettings: Record<string, unknown> | null
  /** `null` when the team never opened the Tools tab (registry default applies) */
  teamMarketingEnabled: boolean | null
}

export interface MentionInsert {
  id: string
  siteId: string
  termId: string | null
  source: MentionSource
  externalId: string
  url: string
  author: string | null
  title: string | null
  excerpt: string
  score: number | null
  kind: MentionKind
  publishedAt: Date
}

export interface SourceCursorRow {
  siteId: string
  source: MentionSource
  lastPolledAt: Date
}

/** Both module switches must be on (D-31); a missing team row reads as the registry default. */
export function isMarketingOn(site: CandidateSite): boolean {
  const teamOn = site.teamMarketingEnabled ?? DEFAULT_TEAM_MODULES.marketingEnabled
  return teamOn && resolveProductModules(site.projectSettings).marketingEnabled === true
}

/** Persistence seam for the mentions poller and digest, so both can be tested without a database. */
export interface MentionsStore {
  /** Verified sites with their module switches; callers filter with `isMarketingOn`. */
  loadVerifiedSites(): Promise<CandidateSite[]>
  loadTerms(siteIds: string[]): Promise<Map<string, MatchTerm[]>>
  loadCursors(siteIds: string[]): Promise<SourceCursorRow[]>
  insertMentions(rows: MentionInsert[]): Promise<number>
  saveCursor(siteId: string, source: MentionSource, lastPolledAt: Date, lastError: string | null): Promise<void>
  deleteOlderThan(cutoff: Date, batchSize: number): Promise<number>
}

export const dbMentionsStore: MentionsStore = {
  async loadVerifiedSites() {
    const rows = await db
      .select({
        siteId: marketingSite.id,
        teamId: marketingSite.teamId,
        projectId: project.id,
        projectName: project.name,
        projectSlug: project.slug,
        projectSettings: project.settings,
        teamMarketingEnabled: teamModuleSettings.marketingEnabled,
      })
      .from(marketingSite)
      .innerJoin(project, eq(project.id, marketingSite.projectId))
      .leftJoin(teamModuleSettings, eq(teamModuleSettings.teamId, marketingSite.teamId))
      .where(isNotNull(marketingSite.verifiedAt))

    return rows.map((row) => ({
      ...row,
      projectSettings: (row.projectSettings as Record<string, unknown> | null) ?? null,
      teamMarketingEnabled: row.teamMarketingEnabled ?? null,
    }))
  },

  async loadTerms(siteIds) {
    const result = new Map<string, MatchTerm[]>()
    if (siteIds.length === 0) return result
    const rows = await db
      .select({
        id: marketingTerm.id,
        siteId: marketingTerm.siteId,
        kind: marketingTerm.kind,
        label: marketingTerm.label,
        aliases: marketingTerm.aliases,
      })
      .from(marketingTerm)
      .where(inArray(marketingTerm.siteId, siteIds))
      .orderBy(marketingTerm.createdAt)

    for (const row of rows) {
      const list = result.get(row.siteId) ?? []
      list.push({ id: row.id, kind: row.kind, label: row.label, aliases: row.aliases ?? [] })
      result.set(row.siteId, list)
    }
    return result
  },

  async loadCursors(siteIds) {
    if (siteIds.length === 0) return []
    return db
      .select({
        siteId: mentionSourceCursor.siteId,
        source: mentionSourceCursor.source,
        lastPolledAt: mentionSourceCursor.lastPolledAt,
      })
      .from(mentionSourceCursor)
      .where(inArray(mentionSourceCursor.siteId, siteIds))
  },

  async insertMentions(rows) {
    if (rows.length === 0) return 0
    const inserted = await db
      .insert(mention)
      .values(rows)
      .onConflictDoNothing({ target: [mention.siteId, mention.source, mention.externalId] })
      .returning({ id: mention.id })
    return inserted.length
  },

  async saveCursor(siteId, source, lastPolledAt, lastError) {
    await db
      .insert(mentionSourceCursor)
      .values({ siteId, source, lastPolledAt, lastError })
      .onConflictDoUpdate({
        target: [mentionSourceCursor.siteId, mentionSourceCursor.source],
        set: { lastPolledAt, lastError },
      })
  },

  async deleteOlderThan(cutoff, batchSize) {
    const doomed = db.select({ id: mention.id }).from(mention).where(lt(mention.publishedAt, cutoff)).limit(batchSize)
    const deleted = await db.delete(mention).where(inArray(mention.id, doomed)).returning({ id: mention.id })
    return deleted.length
  },
}
