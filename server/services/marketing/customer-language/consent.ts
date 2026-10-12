import { and, eq, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '~/server/database/drizzle'
import {
  customerLanguageInsight,
  marketingDataConsent,
  marketingSite,
  type CustomerLanguageSource,
} from '~/server/database/schema/marketing'
import { user } from '~/server/database/schema/auth'
import { requireTeamAdmin, requireTeamMembership } from '~/server/utils/support-access'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'

export interface DataConsent {
  allowFeedbackText: boolean
  allowSupportText: boolean
}

/** The team's current consent. Missing row means no consent. */
export async function readConsent(teamId: string): Promise<DataConsent> {
  const [row] = await db
    .select({
      allowFeedbackText: marketingDataConsent.allowFeedbackText,
      allowSupportText: marketingDataConsent.allowSupportText,
    })
    .from(marketingDataConsent)
    .where(eq(marketingDataConsent.teamId, teamId))
    .limit(1)
  return { allowFeedbackText: row?.allowFeedbackText === true, allowSupportText: row?.allowSupportText === true }
}

export async function getConsentSummary(teamId: string) {
  const [row] = await db
    .select({
      allowFeedbackText: marketingDataConsent.allowFeedbackText,
      allowSupportText: marketingDataConsent.allowSupportText,
      consentedAt: marketingDataConsent.consentedAt,
      consentedBy: user.name,
    })
    .from(marketingDataConsent)
    .leftJoin(user, eq(user.id, marketingDataConsent.consentedByUserId))
    .where(eq(marketingDataConsent.teamId, teamId))
    .limit(1)

  return {
    allowFeedbackText: row?.allowFeedbackText === true,
    allowSupportText: row?.allowSupportText === true,
    consentedBy: row?.consentedBy ?? null,
    consentedAt: row?.consentedAt ?? null,
  }
}

export async function setConsent(
  teamId: string,
  userId: string,
  value: { allowFeedbackText: boolean; allowSupportText: boolean }
) {
  const now = new Date()
  const previous = await readConsent(teamId)
  const set = {
    allowFeedbackText: value.allowFeedbackText,
    allowSupportText: value.allowSupportText,
    consentedByUserId: userId,
    consentedAt: now,
    updatedAt: now,
  }
  await db
    .insert(marketingDataConsent)
    .values({ teamId, ...set })
    .onConflictDoUpdate({ target: marketingDataConsent.teamId, set })

  // Revoking consent also removes what the withdrawn source produced: an insight is derived from the
  // text of every source listed in `sources`, so it goes as soon as any of those sources is switched off.
  const revoked: CustomerLanguageSource[] = []
  if (previous.allowFeedbackText && !value.allowFeedbackText) revoked.push('feedback')
  if (previous.allowSupportText && !value.allowSupportText) revoked.push('support')
  if (revoked.length > 0) await purgeInsightsForSources(teamId, revoked)
}

/** Deletes the team's customer language insights built from any of `sources`. */
export async function purgeInsightsForSources(teamId: string, sources: CustomerLanguageSource[]): Promise<void> {
  if (sources.length === 0) return
  const teamSites = db.select({ id: marketingSite.id }).from(marketingSite).where(eq(marketingSite.teamId, teamId))
  await db.delete(customerLanguageInsight).where(
    and(
      sql`${customerLanguageInsight.siteId} in (${teamSites})`,
      sql`${customerLanguageInsight.sources} && ARRAY[${sql.join(
        sources.map((source) => sql`${source}`),
        sql`, `
      )}]::text[]`
    )
  )
}

function forbidden(message: string): never {
  throw createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    data: createErrorResponse(ErrorCode.FORBIDDEN, message),
  })
}

export async function requireConsentMember(teamId: string, userId: string) {
  try {
    return await requireTeamMembership(teamId, userId)
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 403) forbidden('You do not have access to this team')
    throw error
  }
}

export async function requireConsentAdmin(teamId: string, userId: string) {
  try {
    await requireTeamAdmin(teamId, userId)
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 403) {
      forbidden('Only team admins can change what data is sent to AI providers')
    }
    throw error
  }
}
