import { eq, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import {
  gscConnection,
  gscDailyMetric,
  gscQueryStat,
  marketingSite,
  marketingUsage,
} from '~/server/database/schema/marketing'
import {
  getGoogleOAuthConfig,
  GoogleApiError,
  GoogleAuthError,
  refreshAccessToken,
  revokeToken,
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
): Promise<{ previousEncryptedToken: string | null }> {
  return db.transaction(async (tx) => {
    const existing = await lockGscConnection(tx, siteId)
    // A different account or property must not mix into old numbers
    if (existing && existing.propertyUrl !== (values.propertyUrl ?? null)) await deleteGscMetrics(siteId, tx)
    await tx
      .insert(gscConnection)
      .values({ siteId, ...values, createdAt: now })
      .onConflictDoUpdate({ target: gscConnection.siteId, set: values })
    return { previousEncryptedToken: existing?.encryptedRefreshToken ?? null }
  })
}

/** Best-effort revoke of one stored token; never throws. Returns whether Google confirmed. */
export async function revokeStoredToken(encryptedRefreshToken: string, siteId: string): Promise<boolean> {
  try {
    return await revokeToken(decryptSecret(encryptedRefreshToken, gscAad(siteId)))
  } catch {
    // Undecryptable (key lost) or Google unreachable: nothing more can be done
    return false
  }
}

/**
 * After a reconnect, revokes the token the new one replaced. Skipped when Google handed back the
 * same token (revoking it would kill the new connection). Never throws.
 */
export async function revokeReplacedToken(siteId: string, previousEncrypted: string | null, newRefreshToken: string) {
  if (!previousEncrypted) return
  try {
    if (decryptSecret(previousEncrypted, gscAad(siteId)) === newRefreshToken) return
  } catch {
    return
  }
  await revokeStoredToken(previousEncrypted, siteId)
}

const REVOKE_ALL_BUDGET_MS = 8_000
const REVOKE_ALL_MAX_TOKENS = 50

async function revokeConnections(rows: Array<{ siteId: string; encryptedRefreshToken: string }>) {
  if (rows.length === 0) return
  const work = Promise.allSettled(
    rows.slice(0, REVOKE_ALL_MAX_TOKENS).map((row) => revokeStoredToken(row.encryptedRefreshToken, row.siteId))
  )
  // Deleting must never wait long on Google: give up after the budget and carry on
  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, REVOKE_ALL_BUDGET_MS).unref?.())])
}

/** Best-effort revoke of every GSC token under a product, before it is deleted. Never throws. */
export async function revokeGscTokensForProject(projectId: string): Promise<void> {
  try {
    const rows = await db
      .select({ siteId: gscConnection.siteId, encryptedRefreshToken: gscConnection.encryptedRefreshToken })
      .from(gscConnection)
      .innerJoin(marketingSite, eq(marketingSite.id, gscConnection.siteId))
      .where(eq(marketingSite.projectId, projectId))
    await revokeConnections(rows)
  } catch {
    // Best effort
  }
}

/** Best-effort revoke of every GSC token under a team, before it is deleted. Never throws. */
export async function revokeGscTokensForTeam(teamId: string): Promise<void> {
  try {
    const rows = await db
      .select({ siteId: gscConnection.siteId, encryptedRefreshToken: gscConnection.encryptedRefreshToken })
      .from(gscConnection)
      .innerJoin(marketingSite, eq(marketingSite.id, gscConnection.siteId))
      .where(eq(marketingSite.teamId, teamId))
    await revokeConnections(rows)
  } catch {
    // Best effort
  }
}

/** Best-effort revoke of every GSC token under an organization (all its products), before deletion. Never throws. */
export async function revokeGscTokensForOrganization(organizationId: string): Promise<void> {
  try {
    const rows = await db
      .select({ siteId: gscConnection.siteId, encryptedRefreshToken: gscConnection.encryptedRefreshToken })
      .from(gscConnection)
      .innerJoin(marketingSite, eq(marketingSite.id, gscConnection.siteId))
      .innerJoin(project, eq(project.id, marketingSite.projectId))
      .where(eq(project.organizationId, organizationId))
    await revokeConnections(rows)
  } catch {
    // Best effort
  }
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

const NONCE_PERIOD = 'oauth'
const NONCE_PREFIX = 'oauth-nonce:'
const NONCE_RETENTION_MS = 24 * 60 * 60 * 1000

/**
 * Makes an OAuth state single-use. The nonce is recorded as a `marketing_usage` row keyed
 * `oauth-nonce:<nonce>` (period `oauth`, so it never mixes with monthly usage) with ON CONFLICT DO
 * NOTHING; returns false when it was already consumed, so a replayed callback URL is rejected.
 * States expire after 10 minutes; consumed rows older than a day are pruned opportunistically.
 */
export async function consumeOAuthNonce(teamId: string, nonce: string, now: Date = new Date()): Promise<boolean> {
  const metric = `${NONCE_PREFIX}${nonce}`
  const inserted = await db
    .insert(marketingUsage)
    .values({ teamId, period: NONCE_PERIOD, metric, units: 1 })
    .onConflictDoNothing()
    .returning({ metric: marketingUsage.metric })
  try {
    const cutoff = new Date(now.getTime() - NONCE_RETENTION_MS)
    await db
      .delete(marketingUsage)
      .where(
        sql`${marketingUsage.period} = ${NONCE_PERIOD} and ${marketingUsage.updatedAt} < ${cutoff.toISOString()}::timestamptz`
      )
  } catch {
    // Pruning is housekeeping only
  }
  return inserted.length > 0
}
