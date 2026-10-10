// Team-supplied provider keys (bring your own key) for the marketing module.
//
// Keys are encrypted with `server/utils/secrets.ts` and bound to their row by
// associated data (`team:<teamId>:<provider>`), so an envelope copied into
// another team's row fails to decrypt. Nothing here returns or logs a key
// except `getTeamApiKey`, whose callers pass it straight to a provider.

import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { teamApiCredential, type ApiCredentialProvider } from '~/server/database/schema/marketing'
import { decryptSecret, encryptSecret, keyHint } from '~/server/utils/secrets'
import { createLogger } from '~/server/utils/logger'

const logger = createLogger('marketing:credentials')

export const API_CREDENTIAL_PROVIDERS: readonly ApiCredentialProvider[] = [
  'anthropic',
  'openai',
  'firecrawl',
  'pagespeed',
]

/** Providers whose usage is metered in tokens and can carry a monthly budget */
export const LLM_CREDENTIAL_PROVIDERS: readonly ApiCredentialProvider[] = ['anthropic', 'openai']

export function isApiCredentialProvider(value: unknown): value is ApiCredentialProvider {
  return typeof value === 'string' && (API_CREDENTIAL_PROVIDERS as readonly string[]).includes(value)
}

function associatedData(teamId: string, provider: ApiCredentialProvider) {
  return `team:${teamId}:${provider}`
}

/** Error text stored on the row; provider messages are already key-free but may be long */
function truncateError(message: string) {
  return message.length > 300 ? `${message.slice(0, 297)}...` : message
}

export interface TeamCredentialSummary {
  provider: ApiCredentialProvider
  keyHint: string
  status: 'valid' | 'invalid' | 'unchecked'
  monthlyBudgetCents: number | null
  lastValidatedAt: Date | null
  lastError: string | null
  updatedAt: Date
}

/** Safe to return from the API: hints and status only, never key material. */
export async function listTeamCredentials(teamId: string): Promise<TeamCredentialSummary[]> {
  const rows = await db
    .select({
      provider: teamApiCredential.provider,
      keyHint: teamApiCredential.keyHint,
      status: teamApiCredential.status,
      monthlyBudgetCents: teamApiCredential.monthlyBudgetCents,
      lastValidatedAt: teamApiCredential.lastValidatedAt,
      lastError: teamApiCredential.lastError,
      updatedAt: teamApiCredential.updatedAt,
    })
    .from(teamApiCredential)
    .where(eq(teamApiCredential.teamId, teamId))

  return rows
}

export interface TeamApiKey {
  apiKey: string
  status: 'valid' | 'invalid' | 'unchecked'
  monthlyBudgetCents: number | null
}

/**
 * Decrypts a team's key for one provider. Returns null when none is stored or
 * when the stored envelope cannot be decrypted (wrong/rotated-away instance
 * key) — the latter is logged without key material and surfaces to the team
 * as a missing key rather than a crash in a scheduled task.
 */
export async function getTeamApiKey(teamId: string, provider: ApiCredentialProvider): Promise<TeamApiKey | null> {
  const [row] = await db
    .select({
      encryptedKey: teamApiCredential.encryptedKey,
      status: teamApiCredential.status,
      monthlyBudgetCents: teamApiCredential.monthlyBudgetCents,
    })
    .from(teamApiCredential)
    .where(and(eq(teamApiCredential.teamId, teamId), eq(teamApiCredential.provider, provider)))
    .limit(1)

  if (!row) return null

  try {
    return {
      apiKey: decryptSecret(row.encryptedKey, associatedData(teamId, provider)),
      status: row.status,
      monthlyBudgetCents: row.monthlyBudgetCents,
    }
  } catch (err) {
    logger.warn('Stored team API key could not be decrypted', {
      teamId,
      provider,
      error: err instanceof Error ? err.name : 'unknown',
    })
    return null
  }
}

export interface SaveTeamCredentialInput {
  teamId: string
  provider: ApiCredentialProvider
  apiKey: string
  userId: string
  /** Result of validating the key against the provider before saving */
  status: 'valid' | 'invalid' | 'unchecked'
  lastError?: string | null
  monthlyBudgetCents?: number | null
}

export async function saveTeamCredential(input: SaveTeamCredentialInput): Promise<TeamCredentialSummary> {
  const now = new Date()
  const encryptedKey = encryptSecret(input.apiKey, associatedData(input.teamId, input.provider))
  const hint = keyHint(input.apiKey)
  const validatedAt = input.status === 'unchecked' ? null : now
  const lastError = input.lastError ? truncateError(input.lastError) : null

  const [row] = await db
    .insert(teamApiCredential)
    .values({
      id: randomUUID(),
      teamId: input.teamId,
      provider: input.provider,
      encryptedKey,
      keyHint: hint,
      status: input.status,
      lastValidatedAt: validatedAt,
      lastError,
      monthlyBudgetCents: input.monthlyBudgetCents ?? null,
      createdByUserId: input.userId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [teamApiCredential.teamId, teamApiCredential.provider],
      set: {
        encryptedKey,
        keyHint: hint,
        status: input.status,
        lastValidatedAt: validatedAt,
        lastError,
        // Replacing a key keeps the existing budget unless one is supplied
        ...(input.monthlyBudgetCents !== undefined ? { monthlyBudgetCents: input.monthlyBudgetCents } : {}),
        updatedAt: now,
      },
    })
    .returning()

  return {
    provider: row.provider,
    keyHint: row.keyHint,
    status: row.status,
    monthlyBudgetCents: row.monthlyBudgetCents,
    lastValidatedAt: row.lastValidatedAt,
    lastError: row.lastError,
    updatedAt: row.updatedAt,
  }
}

export async function updateCredentialBudget(
  teamId: string,
  provider: ApiCredentialProvider,
  monthlyBudgetCents: number | null
): Promise<boolean> {
  const rows = await db
    .update(teamApiCredential)
    .set({ monthlyBudgetCents, updatedAt: new Date() })
    .where(and(eq(teamApiCredential.teamId, teamId), eq(teamApiCredential.provider, provider)))
    .returning({ id: teamApiCredential.id })
  return rows.length > 0
}

export async function deleteTeamCredential(teamId: string, provider: ApiCredentialProvider): Promise<boolean> {
  const rows = await db
    .delete(teamApiCredential)
    .where(and(eq(teamApiCredential.teamId, teamId), eq(teamApiCredential.provider, provider)))
    .returning({ id: teamApiCredential.id })
  return rows.length > 0
}

/**
 * Called when a provider rejects the key (401/403) during scheduled work.
 * Returns true only on the transition into `invalid`, so callers notify team
 * admins once instead of on every failing run.
 */
export async function markCredentialInvalid(
  teamId: string,
  provider: ApiCredentialProvider,
  message: string
): Promise<boolean> {
  const now = new Date()
  const current = await db
    .select({ status: teamApiCredential.status })
    .from(teamApiCredential)
    .where(and(eq(teamApiCredential.teamId, teamId), eq(teamApiCredential.provider, provider)))
    .limit(1)

  if (current.length === 0) return false

  await db
    .update(teamApiCredential)
    .set({ status: 'invalid', lastError: truncateError(message), lastValidatedAt: now, updatedAt: now })
    .where(and(eq(teamApiCredential.teamId, teamId), eq(teamApiCredential.provider, provider)))

  return current[0].status !== 'invalid'
}

export async function markCredentialValid(teamId: string, provider: ApiCredentialProvider): Promise<void> {
  const now = new Date()
  await db
    .update(teamApiCredential)
    .set({ status: 'valid', lastError: null, lastValidatedAt: now, updatedAt: now })
    .where(and(eq(teamApiCredential.teamId, teamId), eq(teamApiCredential.provider, provider)))
}
