import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '~/server/database/drizzle'
import { gscConnection, gscDailyMetric, gscQueryStat } from '~/server/database/schema/marketing'
import {
  getGoogleOAuthConfig,
  GoogleApiError,
  GoogleAuthError,
  refreshAccessToken,
  type GoogleOAuthConfig,
} from '~/server/services/google/search-console'
import { decryptSecret, isSecretsConfigured, SecretDecryptionError } from '~/server/utils/secrets'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'

export type GscConnectionRow = typeof gscConnection.$inferSelect

export const REVOKED_MESSAGE = 'Google access was revoked — reconnect'

export function gscAad(siteId: string): string {
  return `gsc:${siteId}`
}

export function isGscConfigured(): boolean {
  return getGoogleOAuthConfig() !== null && isSecretsConfigured()
}

/** 503 with a message that tells a self-hoster what to set. */
export function requireGscConfig(): GoogleOAuthConfig {
  const config = getGoogleOAuthConfig()
  if (!config) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      data: createErrorResponse(
        ErrorCode.INTERNAL_ERROR,
        'Search Console is not configured on this server. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and BETTER_AUTH_URL.'
      ),
    })
  }
  if (!isSecretsConfigured()) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      data: createErrorResponse(
        ErrorCode.INTERNAL_ERROR,
        'Search Console needs key encryption. Set SECRETS_ENCRYPTION_KEY on the server.'
      ),
    })
  }
  return config
}

export async function findGscConnection(siteId: string): Promise<GscConnectionRow | null> {
  const [row] = await db.select().from(gscConnection).where(eq(gscConnection.siteId, siteId)).limit(1)
  return row ?? null
}

export async function requireGscConnection(siteId: string): Promise<GscConnectionRow> {
  const row = await findGscConnection(siteId)
  if (!row) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Search Console is not connected'),
    })
  }
  return row
}

export async function markConnectionError(siteId: string, message: string) {
  await db
    .update(gscConnection)
    .set({ status: 'error', lastError: message, updatedAt: new Date() })
    .where(eq(gscConnection.siteId, siteId))
}

/** Metrics belong to one property; drop them when the connection or property changes. */
export async function deleteGscMetrics(siteId: string) {
  await db.delete(gscDailyMetric).where(eq(gscDailyMetric.siteId, siteId))
  await db.delete(gscQueryStat).where(eq(gscQueryStat.siteId, siteId))
}

/**
 * Decrypts the stored refresh token and exchanges it for an access token.
 * Throws GoogleAuthError for a revoked or undecryptable token, so callers can
 * treat both as "reconnect".
 */
export async function getAccessTokenFor(
  conn: Pick<GscConnectionRow, 'siteId' | 'encryptedRefreshToken'>,
  config: GoogleOAuthConfig
): Promise<string> {
  let refreshToken: string
  try {
    refreshToken = decryptSecret(conn.encryptedRefreshToken, gscAad(conn.siteId))
  } catch (error) {
    if (error instanceof SecretDecryptionError) {
      throw new GoogleAuthError('The stored Google token could not be decrypted')
    }
    throw error
  }
  const { accessToken } = await refreshAccessToken(config, refreshToken)
  return accessToken
}

/** Maps Google failures in request handlers to HTTP errors, flagging revoked connections. */
export async function toGoogleHttpError(siteId: string, error: unknown): Promise<never> {
  if (error instanceof GoogleAuthError) {
    await markConnectionError(siteId, REVOKED_MESSAGE)
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(ErrorCode.CONFLICT, REVOKED_MESSAGE),
    })
  }
  if (error instanceof GoogleApiError) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      data: createErrorResponse(ErrorCode.INTERNAL_ERROR, `Google request failed: ${error.message}`),
    })
  }
  throw error
}
