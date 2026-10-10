/**
 * Announcement drafts for published changelog entries. Drafts are written with
 * the team's own LLM key, edited by hand and copied out; Veerify never posts.
 */

import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { team } from '~/server/database/schema/auth'
import { feedback } from '~/server/database/schema/feedback'
import { changelogEntry, changelogEntryFeedback } from '~/server/database/schema/changelog'
import { marketingAnnouncementDraft } from '~/server/database/schema/marketing'
import { teamModuleSettings } from '~/server/database/schema/teams'
import { DEFAULT_TEAM_MODULES, resolveProductModules } from '~/lib/modules'
import { buildPublicBoardUrl } from '~/lib/public-board-url'
import { markdownToPlainText } from '~/server/utils/markdown'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { listTeamCredentials } from '~/server/utils/team-credentials'
import { ErrorCode } from '~/server/utils/response'
import { callTeamLlm, failWith } from '~/server/services/marketing/llm-call'
import { pickSuggestionProvider } from '~/server/services/marketing/visibility/prompts'
import {
  ANNOUNCEMENT_CHANNELS,
  ANNOUNCEMENT_SCHEMA,
  CHANNEL_LIMITS,
  GenerationOutputError,
  buildAnnouncementInput,
  buildAnnouncementSystemPrompt,
  parseAnnouncementOutput,
  type AnnouncementChannel,
} from './prompt'

export const ANNOUNCEMENTS_PAGE_SIZE = 20
/** Hand edits may run a little past the channel limit; the UI shows the counter in red */
export const EDIT_LIMIT_FACTOR = 1.5

export function isAnnouncementChannel(value: unknown): value is AnnouncementChannel {
  return typeof value === 'string' && (ANNOUNCEMENT_CHANNELS as readonly string[]).includes(value)
}

export function maxEditLength(channel: AnnouncementChannel): number {
  return Math.floor(CHANNEL_LIMITS[channel] * EDIT_LIMIT_FACTOR)
}

export interface AnnouncementDraftView {
  channel: AnnouncementChannel
  content: string
  edited: boolean
  provider: string | null
  model: string | null
  updatedAt: string
}

function serializeDraft(row: typeof marketingAnnouncementDraft.$inferSelect): AnnouncementDraftView {
  return {
    channel: row.channel,
    content: row.content,
    edited: row.edited,
    provider: row.provider,
    model: row.model,
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** The entry must belong to the product; anything else reads as not found. */
export async function requireProductEntry(projectId: string, entryId: string) {
  const [entry] = await db
    .select()
    .from(changelogEntry)
    .where(and(eq(changelogEntry.id, entryId), eq(changelogEntry.projectId, projectId)))
    .limit(1)
  if (!entry) failWith(404, 'Not Found', ErrorCode.NOT_FOUND, 'Changelog entry not found')
  return entry
}

function encodeCursor(entry: { publishedAt: Date | null; createdAt: Date; id: string }) {
  return `${(entry.publishedAt ?? entry.createdAt).getTime()}_${entry.id}`
}

function decodeCursor(cursor: string): { at: Date; id: string } | null {
  const index = cursor.indexOf('_')
  if (index < 1) return null
  const ms = Number(cursor.slice(0, index))
  const id = cursor.slice(index + 1)
  if (!Number.isFinite(ms) || !id) return null
  return { at: new Date(ms), id }
}

export interface AnnouncementList {
  changelogEnabled: boolean
  hasUsableKey: boolean
  limits: Record<AnnouncementChannel, number>
  entries: {
    id: string
    title: string
    slug: string
    summary: string | null
    labels: string[]
    publishedAt: string | null
    drafts: AnnouncementDraftView[]
  }[]
  nextCursor: string | null
}

export async function listAnnouncements(
  project: { id: string; settings: unknown },
  teamId: string,
  cursor?: string | null
): Promise<AnnouncementList> {
  const [moduleRow] = await db
    .select({ changelogEnabled: teamModuleSettings.changelogEnabled })
    .from(teamModuleSettings)
    .where(eq(teamModuleSettings.teamId, teamId))
    .limit(1)
  const teamEnabled = moduleRow ? moduleRow.changelogEnabled === true : DEFAULT_TEAM_MODULES.changelogEnabled
  const changelogEnabled =
    teamEnabled && resolveProductModules(project.settings as Record<string, unknown> | null).changelogEnabled === true

  const credentials = await listTeamCredentials(teamId)
  const hasUsableKey = pickSuggestionProvider(credentials) !== null

  const base = { changelogEnabled, hasUsableKey, limits: CHANNEL_LIMITS }
  if (!changelogEnabled) return { ...base, entries: [], nextCursor: null }

  const sortKey = sql`coalesce(${changelogEntry.publishedAt}, ${changelogEntry.createdAt})`
  const conditions = [eq(changelogEntry.projectId, project.id), eq(changelogEntry.status, 'published')]
  const decoded = cursor ? decodeCursor(cursor) : null
  if (cursor && !decoded) {
    failWith(400, 'Bad Request', ErrorCode.VALIDATION_ERROR, 'Invalid cursor')
  }
  if (decoded) {
    conditions.push(
      or(lt(sortKey, decoded.at), and(sql`${sortKey} = ${decoded.at}`, lt(changelogEntry.id, decoded.id)))!
    )
  }

  const rows = await db
    .select()
    .from(changelogEntry)
    .where(and(...conditions))
    .orderBy(desc(sortKey), desc(changelogEntry.id))
    .limit(ANNOUNCEMENTS_PAGE_SIZE + 1)

  const page = rows.slice(0, ANNOUNCEMENTS_PAGE_SIZE)
  const draftRows = page.length
    ? await db
        .select()
        .from(marketingAnnouncementDraft)
        .where(
          and(
            eq(marketingAnnouncementDraft.projectId, project.id),
            inArray(
              marketingAnnouncementDraft.entryId,
              page.map((e) => e.id)
            )
          )
        )
    : []

  return {
    ...base,
    entries: page.map((entry) => ({
      id: entry.id,
      title: entry.title,
      slug: entry.slug,
      summary: entry.summary,
      labels: entry.labels,
      publishedAt: entry.publishedAt ? entry.publishedAt.toISOString() : null,
      drafts: ANNOUNCEMENT_CHANNELS.flatMap((channel) =>
        draftRows.filter((d) => d.entryId === entry.id && d.channel === channel).map(serializeDraft)
      ),
    })),
    nextCursor: rows.length > ANNOUNCEMENTS_PAGE_SIZE ? encodeCursor(page[page.length - 1]) : null,
  }
}

export interface GenerateOptions {
  userId: string
  /** When set, the entry must belong to this product (route calls) */
  projectId?: string
  /** Defaults to every channel */
  channels?: AnnouncementChannel[]
  /** Request URL, for the protocol and port of the public link; falls back to BETTER_AUTH_URL */
  requestUrl?: URL
}

function publicEntryUrl(
  project: {
    slug: string
    customDomain: string | null
    settings: unknown
  },
  teamSlug: string | null,
  entrySlug: string,
  requestUrl?: URL
): string {
  const origin = requestUrl ?? new URL(process.env.BETTER_AUTH_URL || 'http://localhost:3000')
  const base = buildPublicBoardUrl({
    project: {
      slug: project.slug,
      customDomain: project.customDomain,
      settings: project.settings as Record<string, unknown> | null,
    },
    teamSlug,
    projectSlug: project.slug,
    appDomain: useRuntimeConfig().public.appDomain || 'localhost',
    protocol: origin.protocol,
    port: origin.port,
  })
  return `${base.replace(/\/+$/, '')}/changelog/${entrySlug}`
}

/**
 * Generates (or regenerates) drafts for a published entry. Regenerating
 * overwrites existing drafts, hand edits included, and resets `edited`.
 * Callers are responsible for rate limiting.
 */
export async function generateAnnouncementDrafts(
  entryId: string,
  options: GenerateOptions
): Promise<AnnouncementDraftView[]> {
  const [found] = await db.select().from(changelogEntry).where(eq(changelogEntry.id, entryId)).limit(1)
  if (!found || (options.projectId && found.projectId !== options.projectId)) {
    failWith(404, 'Not Found', ErrorCode.NOT_FOUND, 'Changelog entry not found')
  }
  const entry = found

  const { project, teamId } = await requireMarketingAccess(entry.projectId, options.userId)

  if (entry.status !== 'published') {
    failWith(409, 'Conflict', ErrorCode.CONFLICT, 'Publish the entry before generating announcement drafts')
  }

  const channels = options.channels?.length
    ? ANNOUNCEMENT_CHANNELS.filter((c) => options.channels!.includes(c))
    : [...ANNOUNCEMENT_CHANNELS]

  const [[owner], linked] = await Promise.all([
    db.select({ slug: team.slug }).from(team).where(eq(team.id, teamId)).limit(1),
    db
      .select({ title: feedback.title })
      .from(changelogEntryFeedback)
      .innerJoin(feedback, eq(feedback.id, changelogEntryFeedback.feedbackId))
      .where(eq(changelogEntryFeedback.entryId, entry.id)),
  ])

  const link = publicEntryUrl(project, owner?.slug ?? null, entry.slug, options.requestUrl)

  const result = await callTeamLlm<unknown>(
    teamId,
    {
      system: buildAnnouncementSystemPrompt(),
      input: buildAnnouncementInput({
        productName: project.name,
        productDescription: project.description ?? '',
        entryTitle: entry.title,
        entrySummary: entry.summary ?? '',
        entryBody: markdownToPlainText(entry.body),
        labels: entry.labels,
        linkedFeedbackTitles: linked.map((row) => row.title),
      }),
      schema: ANNOUNCEMENT_SCHEMA,
      schemaName: 'announcement_drafts',
    },
    {
      noKey: 'Add a valid Anthropic or OpenAI API key in Marketing settings to generate drafts',
      upstream: 'The AI provider could not generate drafts. Try again',
    }
  )

  let parsed: Record<AnnouncementChannel, string>
  try {
    parsed = parseAnnouncementOutput(result.data, link)
  } catch (err) {
    if (err instanceof GenerationOutputError) {
      failWith(502, 'Bad Gateway', 'UPSTREAM_ERROR', 'The model returned an unusable draft, try again')
    }
    throw err
  }

  const now = new Date()
  const rows = await Promise.all(
    channels.map(async (channel) => {
      const [row] = await db
        .insert(marketingAnnouncementDraft)
        .values({
          id: randomUUID(),
          entryId: entry.id,
          projectId: entry.projectId,
          channel,
          content: parsed[channel],
          provider: result.provider,
          model: result.model,
          edited: false,
          createdByUserId: options.userId,
        })
        .onConflictDoUpdate({
          target: [marketingAnnouncementDraft.entryId, marketingAnnouncementDraft.channel],
          set: {
            content: parsed[channel],
            provider: result.provider,
            model: result.model,
            edited: false,
            updatedAt: now,
          },
        })
        .returning()
      return row
    })
  )

  return rows.map(serializeDraft)
}

/** Saves a hand edit. Creates the draft when none exists. */
export async function saveAnnouncementEdit(input: {
  projectId: string
  entryId: string
  channel: AnnouncementChannel
  content: string
  userId: string
}): Promise<AnnouncementDraftView> {
  const entry = await requireProductEntry(input.projectId, input.entryId)
  const [row] = await db
    .insert(marketingAnnouncementDraft)
    .values({
      id: randomUUID(),
      entryId: entry.id,
      projectId: entry.projectId,
      channel: input.channel,
      content: input.content,
      edited: true,
      createdByUserId: input.userId,
    })
    .onConflictDoUpdate({
      target: [marketingAnnouncementDraft.entryId, marketingAnnouncementDraft.channel],
      set: { content: input.content, edited: true, updatedAt: new Date() },
    })
    .returning()
  return serializeDraft(row)
}

export async function deleteAnnouncementDraft(input: {
  projectId: string
  entryId: string
  channel: AnnouncementChannel
}): Promise<void> {
  const entry = await requireProductEntry(input.projectId, input.entryId)
  await db
    .delete(marketingAnnouncementDraft)
    .where(and(eq(marketingAnnouncementDraft.entryId, entry.id), eq(marketingAnnouncementDraft.channel, input.channel)))
}
