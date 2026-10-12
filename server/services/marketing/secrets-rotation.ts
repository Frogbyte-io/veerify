import { and, asc, eq, gt, notLike, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { gscConnection, teamApiCredential } from '~/server/database/schema/marketing'
import { gscAad } from '~/server/services/marketing/search/connection'
import { createLogger } from '~/server/utils/logger'
import {
  currentKeyId,
  decryptSecret,
  encryptSecret,
  isSecretsConfigured,
  needsReencryption,
} from '~/server/utils/secrets'

/**
 * Re-wraps stored secrets that were encrypted with a key other than the current
 * SECRETS_ENCRYPTION_KEY, so SECRETS_ENCRYPTION_KEY_PREVIOUS can eventually be dropped.
 *
 * Covers team_api_credential.encryptedKey (AAD `team:<teamId>:<provider>`, see team-credentials.ts)
 * and gsc_connection.encryptedRefreshToken (AAD `gsc:<siteId>`, see search/connection.ts).
 * Idempotent: rows already on the current key are never selected. Rows are updated only if the
 * stored value is unchanged since it was read, so a concurrent re-save of the secret wins.
 * Plaintext is never logged; undecryptable rows are reported by id and left untouched.
 */

const logger = createLogger('marketing-secrets-rotation')

export const ROTATION_BATCH_SIZE = 100
export const ROTATION_MAX_ROWS = 2000

export type RotationTable = 'team_api_credential' | 'gsc_connection'

/** A row holding one secret; `id` is the row id (credential id or site id). */
export interface RotationRow {
  id: string
  payload: string
  aad: string
}

export interface RotationStore {
  /** Rows not on the current key with id greater than `afterId`, ordered by id. */
  loadOutdated(table: RotationTable, currentKeyId: string, afterId: string, limit: number): Promise<RotationRow[]>
  /** Replaces the payload only while it still equals `previousPayload`. Returns whether it was replaced. */
  replace(table: RotationTable, id: string, previousPayload: string, nextPayload: string): Promise<boolean>
  countOutdated(currentKeyId: string): Promise<number>
}

export interface RotationFailure {
  table: RotationTable
  id: string
}

export interface RotationSummary {
  skipped: boolean
  scanned: number
  rewrapped: number
  failed: RotationFailure[]
  remaining: number
}

const prefix = (keyId: string) => `v1.${keyId}.%`

export const dbRotationStore: RotationStore = {
  async loadOutdated(table, keyId, afterId, limit) {
    if (table === 'team_api_credential') {
      const rows = await db
        .select({
          id: teamApiCredential.id,
          teamId: teamApiCredential.teamId,
          provider: teamApiCredential.provider,
          payload: teamApiCredential.encryptedKey,
        })
        .from(teamApiCredential)
        .where(and(notLike(teamApiCredential.encryptedKey, prefix(keyId)), gt(teamApiCredential.id, afterId)))
        .orderBy(asc(teamApiCredential.id))
        .limit(limit)
      return rows.map((r) => ({ id: r.id, payload: r.payload, aad: `team:${r.teamId}:${r.provider}` }))
    }
    const rows = await db
      .select({ siteId: gscConnection.siteId, payload: gscConnection.encryptedRefreshToken })
      .from(gscConnection)
      .where(and(notLike(gscConnection.encryptedRefreshToken, prefix(keyId)), gt(gscConnection.siteId, afterId)))
      .orderBy(asc(gscConnection.siteId))
      .limit(limit)
    return rows.map((r) => ({ id: r.siteId, payload: r.payload, aad: gscAad(r.siteId) }))
  },

  async replace(table, id, previousPayload, nextPayload) {
    if (table === 'team_api_credential') {
      const done = await db
        .update(teamApiCredential)
        .set({ encryptedKey: nextPayload })
        .where(and(eq(teamApiCredential.id, id), eq(teamApiCredential.encryptedKey, previousPayload)))
        .returning({ id: teamApiCredential.id })
      return done.length > 0
    }
    const done = await db
      .update(gscConnection)
      .set({ encryptedRefreshToken: nextPayload })
      .where(and(eq(gscConnection.siteId, id), eq(gscConnection.encryptedRefreshToken, previousPayload)))
      .returning({ siteId: gscConnection.siteId })
    return done.length > 0
  },

  async countOutdated(keyId) {
    const [a] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(teamApiCredential)
      .where(notLike(teamApiCredential.encryptedKey, prefix(keyId)))
    const [b] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(gscConnection)
      .where(notLike(gscConnection.encryptedRefreshToken, prefix(keyId)))
    return Number(a?.n ?? 0) + Number(b?.n ?? 0)
  },
}

export async function rotateSecrets(
  options: { batchSize?: number; maxRows?: number } = {},
  store: RotationStore = dbRotationStore
): Promise<RotationSummary> {
  const summary: RotationSummary = { skipped: false, scanned: 0, rewrapped: 0, failed: [], remaining: 0 }
  if (!isSecretsConfigured()) return { ...summary, skipped: true }

  const batchSize = options.batchSize ?? ROTATION_BATCH_SIZE
  const maxRows = options.maxRows ?? ROTATION_MAX_ROWS
  const keyId = currentKeyId()

  for (const table of ['team_api_credential', 'gsc_connection'] as const) {
    let afterId = ''
    while (summary.scanned < maxRows) {
      const batch = await store.loadOutdated(table, keyId, afterId, batchSize)
      if (batch.length === 0) break
      for (const row of batch) {
        afterId = row.id
        summary.scanned += 1
        try {
          // Malformed payloads throw here too and are reported as failures
          if (!needsReencryption(row.payload)) continue
          const next = encryptSecret(decryptSecret(row.payload, row.aad), row.aad)
          if (await store.replace(table, row.id, row.payload, next)) summary.rewrapped += 1
        } catch {
          // Error text is dropped on purpose; only the row identity is reported
          summary.failed.push({ table, id: row.id })
        }
      }
      if (batch.length < batchSize) break
    }
  }

  summary.remaining = await store.countOutdated(keyId)
  if (summary.rewrapped > 0 || summary.failed.length > 0) {
    logger.info('Secrets re-encryption sweep finished', {
      rewrapped: summary.rewrapped,
      failedCount: summary.failed.length,
      failed: summary.failed.slice(0, 20),
      remaining: summary.remaining,
    })
  }
  return summary
}

/** Never throws: housekeeping must not block the task it rides on. */
export async function rotateSecretsSafely(): Promise<RotationSummary | null> {
  try {
    return await rotateSecrets()
  } catch (error) {
    logger.warn('Secrets re-encryption sweep failed', { error: error instanceof Error ? error.name : 'unknown' })
    return null
  }
}

/** Rows still on a non-current key, or null when encryption is not configured or the count fails. */
export async function countOutdatedSecrets(store: RotationStore = dbRotationStore): Promise<number | null> {
  if (!isSecretsConfigured()) return null
  try {
    return await store.countOutdated(currentKeyId())
  } catch {
    return null
  }
}
