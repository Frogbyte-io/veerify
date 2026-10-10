import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '~/server/database/drizzle'
import { marketingDataConsent } from '~/server/database/schema/marketing'
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
