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

export type DbExecutor = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'>

/** Metrics belong to one property; drop them when the connection or property changes. */
export async function deleteGscMetrics(siteId: string, executor: DbExecutor = db) {
  await executor.delete(gscDailyMetric).where(eq(gscDailyMetric.siteId, siteId))
  await executor.delete(gscQueryStat).where(eq(gscQueryStat.siteId, siteId))
}

/**
 * Locks the connection row for the rest of the transaction. The sync takes the
 * same lock before writing, so a property change or reconnect and a running
 * sync never interleave: the sync either writes first (and the change then
 * deletes its rows) or sees the new property and skips its write.
 */
async function lockGscConnection(tx: DbExecutor, siteId: string): Promise<GscConnectionRow | null> {
  const [row] = await tx.select().from(gscConnection).where(eq(gscConnection.siteId, siteId)).for('update').limit(1)
  return row ?? null
}

/** Connects (or reconnects) a site. A different property drops the old property's metrics, atomically. */
export async function saveGscConnection(
  siteId: string,
  values: Omit<typeof gscConnection.$inferInsert, 'siteId' | 'createdAt'>,
  now: Date
) {
  await db.transaction(async (tx) => {
    const existing = await lockGscConnection(tx, siteId)
    // A different account or property must not mix into old numbers
    if (existing && existing.propertyUrl !== (values.propertyUrl ?? null)) await deleteGscMetrics(siteId, tx)
    await tx
      .insert(gscConnection)
      .values({ siteId, ...values, createdAt: now })
      .onConflictDoUpdate({ target: gscConnection.siteId, set: values })
  })
}

/** Selects the property of an existing connection; a changed property drops the old metrics, atomically. */
export async function setGscProperty(siteId: string, propertyUrl: string) {
  await db.transaction(async (tx) => {
    const existing = await lockGscConnection(tx, siteId)
    if (existing && existing.propertyUrl !== propertyUrl) await deleteGscMetrics(siteId, tx)
    await tx
      .update(gscConnection)
      .set({
        propertyUrl,
        status: 'connected',
        lastError: null,
        // Null lastSyncAt queues an immediate sync for the next task tick
        lastSyncAt: null,
        updatedAt: new Date(),
      })
      .where(eq(gscConnection.siteId, siteId))
  })
}

/** Disconnects: metrics and connection go together, serialised with a running sync. */
export async function removeGscConnection(siteId: string) {
  await db.transaction(async (tx) => {
    await lockGscConnection(tx, siteId)
    await deleteGscMetrics(siteId, tx)
    await tx.delete(gscConnection).where(eq(gscConnection.siteId, siteId))
  })
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
