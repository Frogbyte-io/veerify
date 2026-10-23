// Workspace-supplied provider keys (bring your own key) for the marketing module.
//
// Keys are encrypted with `server/utils/secrets.ts` and bound to their row by
// associated data (`org:<organizationId>:<provider>`), so an envelope copied into
// another workspace's row fails to decrypt. Nothing here returns or logs a key
// except `getOrgApiKey`, whose callers pass it straight to a provider.

import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { organizationApiCredential, type ApiCredentialProvider } from '~/server/database/schema/marketing'
import { decryptSecret, encryptSecret, keyHint } from '~/server/utils/secrets'
import { createLogger } from '~/server/utils/logger'

const logger = createLogger('marketing:credentials')

export const API_CREDENTIAL_PROVIDERS: readonly ApiCredentialProvider[] = [
  'anthropic',
  'openai',
  'perplexity',
  'gemini',
  'firecrawl',
  'pagespeed',
]

/** Providers whose usage is metered in tokens and can carry a monthly budget */
export const LLM_CREDENTIAL_PROVIDERS: readonly ApiCredentialProvider[] = [
  'anthropic',
  'openai',
  'perplexity',
  'gemini',
]

export function isApiCredentialProvider(value: unknown): value is ApiCredentialProvider {
  return typeof value === 'string' && (API_CREDENTIAL_PROVIDERS as readonly string[]).includes(value)
}

function associatedData(organizationId: string, provider: ApiCredentialProvider) {
  return `org:${organizationId}:${provider}`
}

/** Error text stored on the row; provider messages are already key-free but may be long */
function truncateError(message: string) {
  return message.length > 300 ? `${message.slice(0, 297)}...` : message
}

export interface OrgCredentialSummary {
  provider: ApiCredentialProvider
  keyHint: string
  status: 'valid' | 'invalid' | 'unchecked'
  monthlyBudgetCents: number | null
  lastValidatedAt: Date | null
  lastError: string | null
  updatedAt: Date
}

/** Safe to return from the API: hints and status only, never key material. */
export async function listOrgCredentials(organizationId: string): Promise<OrgCredentialSummary[]> {
  const rows = await db
    .select({
      provider: organizationApiCredential.provider,
      keyHint: organizationApiCredential.keyHint,
      status: organizationApiCredential.status,
      monthlyBudgetCents: organizationApiCredential.monthlyBudgetCents,
      lastValidatedAt: organizationApiCredential.lastValidatedAt,
      lastError: organizationApiCredential.lastError,
      updatedAt: organizationApiCredential.updatedAt,
    })
    .from(organizationApiCredential)
    .where(eq(organizationApiCredential.organizationId, organizationId))

  return rows
}

export interface OrgApiKey {
  apiKey: string
  status: 'valid' | 'invalid' | 'unchecked'
  monthlyBudgetCents: number | null
  /** Hint of the stored key; pass back to markCredential* so a replaced key is not touched */
  keyHint: string
}

/**
 * Decrypts a workspace's key for one provider. Returns null when none is stored or
 * when the stored envelope cannot be decrypted (wrong/rotated-away instance
 * key) — the latter is logged without key material and surfaces to the team
 * as a missing key rather than a crash in a scheduled task.
 */
export async function getOrgApiKey(organizationId: string, provider: ApiCredentialProvider): Promise<OrgApiKey | null> {
  const [row] = await db
    .select({
      encryptedKey: organizationApiCredential.encryptedKey,
      keyHint: organizationApiCredential.keyHint,
      status: organizationApiCredential.status,
      monthlyBudgetCents: organizationApiCredential.monthlyBudgetCents,
    })
    .from(organizationApiCredential)
    .where(
      and(
        eq(organizationApiCredential.organizationId, organizationId),
        eq(organizationApiCredential.provider, provider)
      )
    )
    .limit(1)

  if (!row) return null

  try {
    return {
      apiKey: decryptSecret(row.encryptedKey, associatedData(organizationId, provider)),
      status: row.status,
      monthlyBudgetCents: row.monthlyBudgetCents,
      keyHint: row.keyHint,
    }
  } catch (err) {
    logger.warn('Stored workspace API key could not be decrypted', {
      organizationId,
      provider,
      error: err instanceof Error ? err.name : 'unknown',
    })
    return null
  }
}

export interface SaveOrgCredentialInput {
  organizationId: string
  provider: ApiCredentialProvider
  apiKey: string
  userId: string
  /** Result of validating the key against the provider before saving */
  status: 'valid' | 'invalid' | 'unchecked'
  lastError?: string | null
  monthlyBudgetCents?: number | null
}

export async function saveOrgCredential(input: SaveOrgCredentialInput): Promise<OrgCredentialSummary> {
  const now = new Date()
  const encryptedKey = encryptSecret(input.apiKey, associatedData(input.organizationId, input.provider))
  const hint = keyHint(input.apiKey)
  const validatedAt = input.status === 'unchecked' ? null : now
  const lastError = input.lastError ? truncateError(input.lastError) : null

  const [row] = await db
    .insert(organizationApiCredential)
    .values({
      id: randomUUID(),
      organizationId: input.organizationId,
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
      target: [organizationApiCredential.organizationId, organizationApiCredential.provider],
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
  organizationId: string,
  provider: ApiCredentialProvider,
  monthlyBudgetCents: number | null
): Promise<boolean> {
  const rows = await db
    .update(organizationApiCredential)
    .set({ monthlyBudgetCents, updatedAt: new Date() })
    .where(
      and(
        eq(organizationApiCredential.organizationId, organizationId),
        eq(organizationApiCredential.provider, provider)
      )
    )
    .returning({ id: organizationApiCredential.id })
  return rows.length > 0
}

export async function deleteOrgCredential(organizationId: string, provider: ApiCredentialProvider): Promise<boolean> {
  const rows = await db
    .delete(organizationApiCredential)
    .where(
      and(
        eq(organizationApiCredential.organizationId, organizationId),
        eq(organizationApiCredential.provider, provider)
      )
    )
    .returning({ id: organizationApiCredential.id })
  return rows.length > 0
}

/**
 * Called when a provider rejects the key (401/403) during scheduled work.
 * Returns true only on the transition into `invalid`, so callers notify team
 * admins once instead of on every failing run. `expectedKeyHint` guards against
 * marking a key the workspace replaced while the call was in flight: when given and
 * the stored hint differs, nothing changes and false is returned.
 */
export async function markCredentialInvalid(
  organizationId: string,
  provider: ApiCredentialProvider,
  message: string,
  expectedKeyHint?: string
): Promise<boolean> {
  const now = new Date()
  const current = await db
    .select({ status: organizationApiCredential.status, keyHint: organizationApiCredential.keyHint })
    .from(organizationApiCredential)
    .where(
      and(
        eq(organizationApiCredential.organizationId, organizationId),
        eq(organizationApiCredential.provider, provider)
      )
    )
    .limit(1)

  if (current.length === 0) return false
  if (expectedKeyHint !== undefined && current[0].keyHint !== expectedKeyHint) return false

  await db
    .update(organizationApiCredential)
    .set({ status: 'invalid', lastError: truncateError(message), lastValidatedAt: now, updatedAt: now })
    .where(
      and(
        eq(organizationApiCredential.organizationId, organizationId),
        eq(organizationApiCredential.provider, provider),
        ...(expectedKeyHint !== undefined ? [eq(organizationApiCredential.keyHint, expectedKeyHint)] : [])
      )
    )

  return current[0].status !== 'invalid'
}

export async function markCredentialValid(
  organizationId: string,
  provider: ApiCredentialProvider,
  expectedKeyHint?: string
): Promise<void> {
  const now = new Date()
  await db
    .update(organizationApiCredential)
    .set({ status: 'valid', lastError: null, lastValidatedAt: now, updatedAt: now })
    .where(
      and(
        eq(organizationApiCredential.organizationId, organizationId),
        eq(organizationApiCredential.provider, provider),
        ...(expectedKeyHint !== undefined ? [eq(organizationApiCredential.keyHint, expectedKeyHint)] : [])
      )
    )
}
