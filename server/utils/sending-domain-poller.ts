import { and, eq, inArray, isNotNull, like, ne, or, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { supportInbox, supportInboxAddress, supportSendingDomain } from '~/server/database/schema/support'
import { PENDING_TTL_DAYS, applyProviderResult } from '~/lib/support-sending-domains'
import type { SendingDomainDnsRecord } from '~/lib/support-sending-domains'
import { getSendingDomainProvider } from '~/server/services/sending-domains'
import { checkDmarc, checkOwnershipTxt, ownershipRecord } from '~/server/services/sending-domains/ownership'
import {
  SendingDomainProviderError,
  type ProviderDomainResult,
  type SendingDomainProvider,
} from '~/server/services/sending-domains/types'
import { isSendingDomainsEnabled, resolveSenderPolicy } from '~/server/utils/sending-domains'
import { recordSupportMetric, type SupportMetricName } from '~/server/utils/support-observability'
import { createLogger } from '~/server/utils/logger'

const logger = createLogger('sending-domain-poller')

/**
 * Background lifecycle for customer sending domains (design §8.2).
 *
 * The pure decision functions (`registerSendingDomainClaim`, `checkSendingDomainClaim`,
 * `removeSendingDomainClaim`) return row patches and never touch the database; the
 * team API routes and the poll pass share them so the status machine lives in one place.
 */

export type SendingDomainRow = typeof supportSendingDomain.$inferSelect
export type SendingDomainPatch = Partial<typeof supportSendingDomain.$inferInsert>

/** How long a claimed row is invisible to other poll passes. */
export const SENDING_DOMAIN_LEASE_SECONDS = 2 * 60
export const SENDING_DOMAIN_BATCH_SIZE = 25
/** A pass stops starting new work after this long. */
export const SENDING_DOMAIN_PASS_BUDGET_MS = 45_000
/** Consecutive `provider_unavailable` results that stop a pass. */
export const SENDING_DOMAIN_CIRCUIT_BREAKER_THRESHOLD = 3
/** Failed register attempts before a claim waits for an admin to click Verify. */
export const MAX_REGISTER_ATTEMPTS = 8
/** Hard cap on rows handled by one pass, so a runaway queue cannot loop forever. */
export const SENDING_DOMAIN_MAX_ROWS_PER_PASS = 500

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const MAX_REGISTER_BACKOFF_MS = 6 * HOUR_MS
const DEFAULT_RETRY_AFTER_SECONDS = 60
const MAX_RETRY_AFTER_SECONDS = 6 * 60 * 60
const MAX_ERROR_LENGTH = 500

// ---------------------------------------------------------------------------
// Scheduling (pure)
// ---------------------------------------------------------------------------

/**
 * Pending claims: every 5 minutes for the first hour, every 15 minutes until 24
 * hours, then hourly. Never later than `expiresAt`, so expiry runs promptly.
 */
export function computePendingNextCheckAt(createdAt: Date, expiresAt: Date | null, now: Date): Date {
  const age = now.getTime() - createdAt.getTime()
  const interval = age < HOUR_MS ? 5 * MINUTE_MS : age < DAY_MS ? 15 * MINUTE_MS : HOUR_MS
  let next = now.getTime() + interval
  if (expiresAt && expiresAt.getTime() > now.getTime() && expiresAt.getTime() < next) {
    next = expiresAt.getTime()
  }
  return new Date(next)
}

/** Verified and suspended claims are re-checked once a day. */
export function computeVerifiedNextCheckAt(now: Date): Date {
  return new Date(now.getTime() + DAY_MS)
}

/**
 * Failed registrations: 5, 10, 20 ... minutes up to 6 hours, with +-20% jitter
 * (same shape as `computeNextAttemptAt` for the outbox). `attemptCount` is the
 * number of failed attempts including the one that just happened.
 */
export function computeRegisterBackoffAt(attemptCount: number, now: Date, random: () => number = Math.random): Date {
  const base = Math.min(5 * MINUTE_MS * 2 ** Math.max(0, attemptCount - 1), MAX_REGISTER_BACKOFF_MS)
  const jitter = 0.8 + Math.min(1, Math.max(0, random())) * 0.4
  return new Date(now.getTime() + Math.round(base * jitter))
}

/** `Retry-After` handling: honour the header, clamp to a sane range. */
export function computeRetryAfterAt(retryAfterSeconds: number | undefined, now: Date): Date {
  const seconds =
    typeof retryAfterSeconds === 'number' && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? Math.min(Math.ceil(retryAfterSeconds), MAX_RETRY_AFTER_SECONDS)
      : DEFAULT_RETRY_AFTER_SECONDS
  return new Date(now.getTime() + seconds * 1000)
}

export function sanitizeSendingDomainError(message: unknown): string {
  const text = typeof message === 'string' ? message : message instanceof Error ? message.message : 'Unknown error'
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_ERROR_LENGTH) || 'Unknown error'
}

export function pendingExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + PENDING_TTL_DAYS * DAY_MS)
}

export function isProviderMismatch(
  row: Pick<SendingDomainRow, 'provider' | 'providerAccountKey'>,
  provider: SendingDomainProvider
) {
  return row.provider !== provider.name || row.providerAccountKey !== provider.accountKey
}

function toProviderError(error: unknown): SendingDomainProviderError {
  if (error instanceof SendingDomainProviderError) return error
  // A network failure that escaped the adapter is transient by definition.
  return new SendingDomainProviderError('provider_unavailable', sanitizeSendingDomainError(error), true)
}

/** Row columns that carry the "another service sends from this domain" explanation. */
function contestedFields(result: Pick<ProviderDomainResult, 'contested' | 'message'>) {
  return result.contested
    ? { lastErrorCode: 'owned_elsewhere', lastError: sanitizeSendingDomainError(result.message ?? CONTESTED_FALLBACK) }
    : { lastErrorCode: null, lastError: null }
}

const CONTESTED_FALLBACK = 'Another service already sends from this domain.'

function buildRecords(
  row: Pick<SendingDomainRow, 'domain' | 'ownershipToken'>,
  providerRecords: SendingDomainDnsRecord[],
  ownership: 'valid' | 'invalid' | 'unknown',
  dmarc: SendingDomainDnsRecord | null
): SendingDomainDnsRecord[] {
  const own: SendingDomainDnsRecord = { ...ownershipRecord(row.domain, row.ownershipToken), status: ownership }
  return [
    own,
    ...providerRecords.filter((r) => r.purpose === 'sending'),
    ...providerRecords.filter((r) => r.purpose === 'receiving'),
    ...(dmarc ? [dmarc] : []),
  ]
}

// ---------------------------------------------------------------------------
// Register (provisioning / failed)
// ---------------------------------------------------------------------------

export type RegisterOutcome =
  | { kind: 'ok'; patch: SendingDomainPatch }
  /** Retry later. `patch` carries the backoff; rate limiting does not count as an attempt. */
  | { kind: 'transient'; patch: SendingDomainPatch; code: string; message: string; rateLimited: boolean }
  /** Nothing can make this registration succeed (design §4.3 rows 3 and 4). */
  | { kind: 'rejected'; code: 'owned_elsewhere' | 'invalid_domain' | 'unknown'; message: string }
  /** Operator misconfiguration (design §4.3 row 5); the row is not changed. */
  | { kind: 'misconfigured'; code: 'missing_scope' | 'unauthorized'; message: string }

export interface RegisterDeps {
  now?: Date
  random?: () => number
}

export async function registerSendingDomainClaim(
  row: SendingDomainRow,
  provider: SendingDomainProvider,
  deps: RegisterDeps = {}
): Promise<RegisterOutcome> {
  const now = deps.now ?? new Date()
  let registration
  try {
    registration = await provider.register(row.domain)
  } catch (raw) {
    const error = toProviderError(raw)
    const message = sanitizeSendingDomainError(error.message)

    if (error.code === 'missing_scope' || error.code === 'unauthorized') {
      return { kind: 'misconfigured', code: error.code, message }
    }
    if (error.code === 'owned_elsewhere') return { kind: 'rejected', code: 'owned_elsewhere', message }
    if (error.code === 'rate_limited') {
      return {
        kind: 'transient',
        code: error.code,
        message,
        rateLimited: true,
        patch: {
          status: 'failed',
          expiresAt: row.expiresAt ?? pendingExpiryFrom(now),
          lastErrorCode: error.code,
          lastError: message,
          lastCheckedAt: now,
          nextCheckAt: computeRetryAfterAt(error.retryAfterSeconds, now),
          leaseExpiresAt: null,
          updatedAt: now,
        },
      }
    }
    // `already_exists` should have been adopted by the adapter; `not_found` right after
    // an adopt and `receiving_enabled` on register are provider hiccups, not verdicts.
    const retryable =
      error.retryable ||
      error.code === 'already_exists' ||
      error.code === 'not_found' ||
      error.code === 'receiving_enabled'
    if (!retryable) {
      return { kind: 'rejected', code: error.code === 'invalid_domain' ? 'invalid_domain' : 'unknown', message }
    }
    const attemptCount = row.attemptCount + 1
    return {
      kind: 'transient',
      code: error.code,
      message,
      rateLimited: false,
      patch: {
        status: 'failed',
        expiresAt: row.expiresAt ?? pendingExpiryFrom(now),
        attemptCount,
        lastErrorCode: error.code,
        lastError: message,
        lastCheckedAt: now,
        // Exhausted: no more automatic attempts until an admin clicks Verify. The
        // next wake-up is the claim's expiry, so a stuck claim cannot squat forever.
        nextCheckAt:
          attemptCount >= MAX_REGISTER_ATTEMPTS
            ? (row.expiresAt ?? pendingExpiryFrom(now))
            : computeRegisterBackoffAt(attemptCount, now, deps.random),
        leaseExpiresAt: null,
        updatedAt: now,
      },
    }
  }

  const keepExpiry = ['provisioning', 'pending', 'failed'].includes(row.status) && row.expiresAt
  const expiresAt = keepExpiry ? row.expiresAt : pendingExpiryFrom(now)
  return {
    kind: 'ok',
    patch: {
      status: 'pending',
      provider: provider.name,
      providerAccountKey: provider.accountKey,
      providerOwnership: registration.ownership,
      providerState: registration.state,
      receivesViaProvider: registration.receivesMail,
      dnsRecords: buildRecords(row, registration.records, 'unknown', null),
      verifiedAt: null,
      attemptCount: 0,
      ownershipFailures: 0,
      providerFailures: 0,
      ...contestedFields(registration),
      lastCheckedAt: now,
      nextCheckAt: computePendingNextCheckAt(row.createdAt, expiresAt, now),
      expiresAt,
      leaseExpiresAt: null,
      updatedAt: now,
    },
  }
}

// ---------------------------------------------------------------------------
// Check (pending / verified / suspended)
// ---------------------------------------------------------------------------

export type CheckOutcome =
  | { kind: 'checked'; patch: SendingDomainPatch; transition: 'verified' | 'suspended' | null }
  /** The provider no longer knows the domain; the claim must be registered again. */
  | { kind: 'needs_register' }
  /**
   * The provider call failed. `patch` carries the reschedule (null for
   * misconfiguration, where no row may change).
   */
  | { kind: 'provider_error'; error: SendingDomainProviderError; patch: SendingDomainPatch | null }

export interface CheckDeps {
  now?: Date
  /** Admin clicked Verify: use the provider's on-demand re-check when it has one. */
  manual?: boolean
  random?: () => number
  checkOwnership?: typeof checkOwnershipTxt
  checkDmarcRecord?: typeof checkDmarc
}

export async function checkSendingDomainClaim(
  row: SendingDomainRow,
  provider: SendingDomainProvider,
  deps: CheckDeps = {}
): Promise<CheckOutcome> {
  const now = deps.now ?? new Date()
  let result: ProviderDomainResult | null
  try {
    result =
      deps.manual && provider.capabilities.verifyNow
        ? await provider.verify(row.domain)
        : await provider.get(row.domain)
  } catch (raw) {
    const error = toProviderError(raw)
    if (error.code === 'not_found') {
      result = null
    } else if (error.code === 'missing_scope' || error.code === 'unauthorized') {
      return { kind: 'provider_error', error, patch: null }
    } else {
      const message = sanitizeSendingDomainError(error.message)
      return {
        kind: 'provider_error',
        error,
        patch: {
          lastErrorCode: error.code,
          lastError: message,
          lastCheckedAt: now,
          // Rate limiting honours Retry-After; other failures retry on a short
          // backoff so a daily check does not wait a day after one blip.
          nextCheckAt:
            error.code === 'rate_limited'
              ? computeRetryAfterAt(error.retryAfterSeconds, now)
              : computeRegisterBackoffAt(1, now, deps.random),
          leaseExpiresAt: null,
          updatedAt: now,
        },
      }
    }
  }

  if (result === null) {
    if (row.status === 'pending') return { kind: 'needs_register' }
    // A verified or suspended claim whose domain vanished counts as the provider
    // reporting it unverified, which feeds the suspension threshold.
    result = {
      domain: row.domain,
      state: 'unverified',
      receivesMail: false,
      records: [],
      message: 'The mail provider no longer knows this domain.',
    }
  }

  const checkOwnership = deps.checkOwnership ?? checkOwnershipTxt
  const checkDmarcRecord = deps.checkDmarcRecord ?? checkDmarc
  const ownership = await checkOwnership(row.domain, row.ownershipToken).catch(() => 'unknown' as const)
  const dmarc = await checkDmarcRecord(row.domain).catch(() => null)

  const applied = applyProviderResult(row, result, ownership, now) as SendingDomainPatch
  const status = (applied.status ?? row.status) as SendingDomainRow['status']
  const verified = status === 'verified'
  const transition =
    verified && row.status !== 'verified'
      ? 'verified'
      : status === 'suspended' && row.status !== 'suspended'
        ? 'suspended'
        : null

  const patch: SendingDomainPatch = {
    ...applied,
    status,
    providerState: applied.providerState ?? result.state,
    receivesViaProvider: result.receivesMail,
    dnsRecords: buildRecords(row, result.records, ownership, dmarc),
    attemptCount: 0,
    ...contestedFields(result),
    lastCheckedAt: now,
    nextCheckAt:
      status === 'verified' || status === 'suspended'
        ? computeVerifiedNextCheckAt(now)
        : computePendingNextCheckAt(row.createdAt, row.expiresAt, now),
    leaseExpiresAt: null,
    updatedAt: now,
  }
  if (verified) {
    patch.verifiedAt = applied.verifiedAt ?? row.verifiedAt ?? now
    patch.expiresAt = null
  }
  return { kind: 'checked', patch, transition }
}

// ---------------------------------------------------------------------------
// Removal (design §8.4)
// ---------------------------------------------------------------------------

export type RemoveOutcome =
  /** Row can be deleted now. `operatorCleanupRequired` when the provider refused because it receives mail. */
  | { kind: 'deleted'; operatorCleanupRequired: boolean }
  /** Transient failure: keep the row and retry with `patch`. */
  | { kind: 'retry'; patch: SendingDomainPatch }
  | { kind: 'misconfigured'; error: SendingDomainProviderError; patch: SendingDomainPatch }

export interface RemoveDeps {
  now?: Date
  random?: () => number
  /** Best-effort removal of provider routes for the domain; never throws. */
  deleteRoutes?: (row: SendingDomainRow, provider: SendingDomainProvider | null) => Promise<void>
  /** Keep `status` untouched on retry (used by expiry, which is not a delete request). */
  keepStatus?: boolean
}

export async function removeSendingDomainClaim(
  row: SendingDomainRow,
  provider: SendingDomainProvider | null,
  deps: RemoveDeps = {}
): Promise<RemoveOutcome> {
  const now = deps.now ?? new Date()
  const deleteRoutes = deps.deleteRoutes ?? deleteProviderRoutes
  await deleteRoutes(row, provider).catch((error) =>
    logger.warn('Provider route cleanup failed', { domainId: row.id, error })
  )

  // Only a domain Veerify created, in the project it is currently configured for,
  // is ours to remove. Adopted domains and other projects' domains are never touched.
  const mayRemove =
    provider !== null &&
    row.providerOwnership === 'created' &&
    provider.capabilities.remove &&
    !isProviderMismatch(row, provider)
  if (!mayRemove) return { kind: 'deleted', operatorCleanupRequired: false }

  try {
    await provider!.remove(row.domain)
    return { kind: 'deleted', operatorCleanupRequired: false }
  } catch (raw) {
    const error = toProviderError(raw)
    if (error.code === 'not_found') return { kind: 'deleted', operatorCleanupRequired: false }
    if (error.code === 'receiving_enabled') return { kind: 'deleted', operatorCleanupRequired: true }

    const message = sanitizeSendingDomainError(error.message)
    const attemptCount = row.attemptCount + 1
    const patch: SendingDomainPatch = {
      ...(deps.keepStatus ? {} : { status: 'deleting' }),
      attemptCount: error.code === 'rate_limited' ? row.attemptCount : attemptCount,
      lastErrorCode: error.code,
      lastError: message,
      lastCheckedAt: now,
      nextCheckAt:
        error.code === 'rate_limited'
          ? computeRetryAfterAt(error.retryAfterSeconds, now)
          : computeRegisterBackoffAt(attemptCount, now, deps.random),
      leaseExpiresAt: null,
      updatedAt: now,
    }
    if (error.code === 'missing_scope' || error.code === 'unauthorized') {
      return { kind: 'misconfigured', error, patch }
    }
    return { kind: 'retry', patch }
  }
}

// ---------------------------------------------------------------------------
// Database-backed defaults
// ---------------------------------------------------------------------------

function isoTimestamp(date: Date) {
  return sql`${date.toISOString()}::timestamp`
}

/**
 * Claim due rows. Same shape as `claimNextOutboundDelivery`: one atomic UPDATE
 * over a `FOR UPDATE SKIP LOCKED` selection, so a concurrent pass never sees
 * (or waits for) a row this one holds. The selection is a MATERIALIZED CTE
 * rather than `id IN (subselect)`: with `LIMIT` the planner may otherwise
 * re-evaluate the subselect per row and lock more rows than the limit.
 */
export async function claimDueSendingDomains(
  options: { now?: Date; limit?: number; leaseSeconds?: number } = {}
): Promise<SendingDomainRow[]> {
  const now = options.now ?? new Date()
  const limit = options.limit ?? SENDING_DOMAIN_BATCH_SIZE
  const leaseExpiresAt = new Date(now.getTime() + (options.leaseSeconds ?? SENDING_DOMAIN_LEASE_SECONDS) * 1000)

  const result = await db.execute<{ id: string }>(sql`
    WITH due AS MATERIALIZED (
      SELECT id FROM support_sending_domain
      WHERE next_check_at IS NOT NULL
        AND next_check_at <= ${isoTimestamp(now)}
        AND (lease_expires_at IS NULL OR lease_expires_at < ${isoTimestamp(now)})
      ORDER BY next_check_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE support_sending_domain AS d
    SET lease_expires_at = ${isoTimestamp(leaseExpiresAt)},
        updated_at = ${isoTimestamp(now)}
    FROM due
    WHERE d.id = due.id
    RETURNING d.id
  `)

  const ids = result.rows.map((row) => row.id)
  if (ids.length === 0) return []
  const rows = await db.select().from(supportSendingDomain).where(inArray(supportSendingDomain.id, ids))
  return rows.sort((a, b) => (a.nextCheckAt?.getTime() ?? 0) - (b.nextCheckAt?.getTime() ?? 0))
}

/** Write a patch only if the row still has the status the pass saw (an admin may have moved it meanwhile). */
export async function saveSendingDomainPatch(row: SendingDomainRow, patch: SendingDomainPatch): Promise<boolean> {
  const updated = await db
    .update(supportSendingDomain)
    .set(patch)
    .where(and(eq(supportSendingDomain.id, row.id), eq(supportSendingDomain.status, row.status)))
    .returning({ id: supportSendingDomain.id })
  return updated.length > 0
}

export async function deleteSendingDomainRow(row: Pick<SendingDomainRow, 'id'>): Promise<void> {
  await db.delete(supportSendingDomain).where(eq(supportSendingDomain.id, row.id))
}

export async function releaseSendingDomainLeases(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await db
    .update(supportSendingDomain)
    .set({ leaseExpiresAt: null })
    .where(and(inArray(supportSendingDomain.id, ids), isNotNull(supportSendingDomain.leaseExpiresAt)))
}

/** Best-effort: delete provider routes created for the team's addresses on this exact domain. */
export async function deleteProviderRoutes(
  row: SendingDomainRow,
  provider: SendingDomainProvider | null
): Promise<void> {
  if (!provider?.deleteInboundRoute || isProviderMismatch(row, provider)) return
  const addresses = await db
    .select({ id: supportInboxAddress.id, routeId: supportInboxAddress.providerRouteId })
    .from(supportInboxAddress)
    .innerJoin(supportInbox, eq(supportInbox.id, supportInboxAddress.inboxId))
    .where(
      and(
        eq(supportInbox.teamId, row.teamId),
        isNotNull(supportInboxAddress.providerRouteId),
        like(supportInboxAddress.address, `%@${row.domain}`)
      )
    )
  for (const address of addresses) {
    if (!address.routeId) continue
    try {
      await provider.deleteInboundRoute(address.routeId)
    } catch (raw) {
      if (toProviderError(raw).code !== 'not_found') {
        logger.warn('Could not delete provider inbound route', { domainId: row.id, addressId: address.id })
      }
    }
    await db
      .update(supportInboxAddress)
      .set({ providerRouteId: null, providerRouteStatus: null })
      .where(eq(supportInboxAddress.id, address.id))
  }
}

/**
 * Design §8.3: on a move to `verified`, other teams' custom addresses on this
 * domain or its subdomains (possible only from before enforcement) are detached.
 */
export async function detachForeignAddresses(row: Pick<SendingDomainRow, 'id' | 'teamId' | 'domain'>): Promise<number> {
  const detached = await db
    .delete(supportInboxAddress)
    .where(
      and(
        eq(supportInboxAddress.kind, 'custom'),
        inArray(
          supportInboxAddress.inboxId,
          db.select({ id: supportInbox.id }).from(supportInbox).where(ne(supportInbox.teamId, row.teamId))
        ),
        or(
          like(sql`lower(${supportInboxAddress.address})`, `%@${row.domain}`),
          like(sql`lower(${supportInboxAddress.address})`, `%@%.${row.domain}`)
        )
      )
    )
    .returning({ id: supportInboxAddress.id, inboxId: supportInboxAddress.inboxId })
  return detached.length
}

// ---------------------------------------------------------------------------
// The poll pass
// ---------------------------------------------------------------------------

export type SendingDomainPollAbort = 'time_budget' | 'circuit_breaker' | 'provider_misconfigured' | 'max_rows'

export interface SendingDomainPollSummary {
  skipped: 'disabled' | 'provider_unconfigured' | null
  claimed: number
  processed: number
  registered: number
  checked: number
  verified: number
  suspended: number
  expired: number
  deleted: number
  failed: number
  rateLimited: number
  aborted: SendingDomainPollAbort | null
}

export interface SendingDomainPollDeps {
  clock?: () => Date
  random?: () => number
  enabled?: () => boolean
  policy?: () => 'legacy' | 'team'
  /** `undefined` resolves the configured provider; `null` means none is configured. */
  provider?: SendingDomainProvider | null
  claim?: (input: { now: Date; limit: number }) => Promise<SendingDomainRow[]>
  save?: (row: SendingDomainRow, patch: SendingDomainPatch) => Promise<boolean>
  deleteRow?: (row: SendingDomainRow) => Promise<void>
  release?: (ids: string[]) => Promise<void>
  detach?: (row: SendingDomainRow) => Promise<number>
  deleteRoutes?: RemoveDeps['deleteRoutes']
  checkOwnership?: typeof checkOwnershipTxt
  checkDmarcRecord?: typeof checkDmarc
  metric?: typeof recordSupportMetric
  batchSize?: number
  budgetMs?: number
  breakerThreshold?: number
  maxRows?: number
}

class PassAbort extends Error {
  constructor(public reason: SendingDomainPollAbort) {
    super(reason)
  }
}

export async function runSendingDomainPoll(deps: SendingDomainPollDeps = {}): Promise<SendingDomainPollSummary> {
  const clock = deps.clock ?? (() => new Date())
  const summary: SendingDomainPollSummary = {
    skipped: null,
    claimed: 0,
    processed: 0,
    registered: 0,
    checked: 0,
    verified: 0,
    suspended: 0,
    expired: 0,
    deleted: 0,
    failed: 0,
    rateLimited: 0,
    aborted: null,
  }

  if (!(deps.enabled ?? isSendingDomainsEnabled)()) return { ...summary, skipped: 'disabled' }
  const provider = deps.provider !== undefined ? deps.provider : getSendingDomainProvider()
  if (!provider || !provider.isConfigured().configured) return { ...summary, skipped: 'provider_unconfigured' }

  const claim = deps.claim ?? ((input) => claimDueSendingDomains({ now: input.now, limit: input.limit }))
  const save = deps.save ?? saveSendingDomainPatch
  const deleteRow = deps.deleteRow ?? deleteSendingDomainRow
  const release = deps.release ?? releaseSendingDomainLeases
  const detach = deps.detach ?? detachForeignAddresses
  const metric = deps.metric ?? recordSupportMetric
  const policy = deps.policy ?? resolveSenderPolicy
  const batchSize = deps.batchSize ?? SENDING_DOMAIN_BATCH_SIZE
  const budgetMs = deps.budgetMs ?? SENDING_DOMAIN_PASS_BUDGET_MS
  const breakerThreshold = deps.breakerThreshold ?? SENDING_DOMAIN_CIRCUIT_BREAKER_THRESHOLD
  const maxRows = deps.maxRows ?? SENDING_DOMAIN_MAX_ROWS_PER_PASS
  const startedAt = clock().getTime()
  let consecutiveUnavailable = 0

  const emit = (name: SupportMetricName, row: SendingDomainRow, status: string, outcome?: string) =>
    metric(name, { domainId: row.id, provider: row.provider, status, outcome })

  const finish = async (row: SendingDomainRow, patch: SendingDomainPatch) => {
    await save(row, patch)
  }

  async function processRow(row: SendingDomainRow, now: Date) {
    const base = { now, random: deps.random }

    // Deletion requests (and their retries).
    if (row.status === 'deleting') {
      const outcome = await removeSendingDomainClaim(row, provider, { ...base, deleteRoutes: deps.deleteRoutes })
      return handleRemoval(row, outcome, 'deleted')
    }

    // Pending-claim expiry (design §4.2 rule 6). Verified claims never expire.
    if (['provisioning', 'pending', 'failed'].includes(row.status) && row.expiresAt && row.expiresAt <= now) {
      const outcome = await removeSendingDomainClaim(row, provider, {
        ...base,
        deleteRoutes: deps.deleteRoutes,
        keepStatus: true,
      })
      return handleRemoval(row, outcome, 'expired')
    }

    const mismatch = isProviderMismatch(row, provider!)
    if (mismatch && (row.status === 'verified' || row.status === 'suspended')) {
      // Authorization already denies a mismatched claim. Do not call a provider
      // project this claim was never registered in; an admin re-registers it.
      await finish(row, { leaseExpiresAt: null, nextCheckAt: computeVerifiedNextCheckAt(now), updatedAt: now })
      return
    }

    if (row.status === 'provisioning' || row.status === 'failed' || (mismatch && row.status === 'pending')) {
      const outcome = await registerSendingDomainClaim(row, provider!, base)
      return handleRegister(row, outcome)
    }

    // pending / verified / suspended
    const outcome = await checkSendingDomainClaim(row, provider!, {
      ...base,
      checkOwnership: deps.checkOwnership,
      checkDmarcRecord: deps.checkDmarcRecord,
    })
    if (outcome.kind === 'needs_register') {
      await finish(row, { status: 'provisioning', nextCheckAt: now, leaseExpiresAt: null, updatedAt: now })
      return
    }
    if (outcome.kind === 'provider_error') {
      return handleProviderError(row, outcome.error, outcome.patch)
    }
    consecutiveUnavailable = 0
    summary.checked++
    const saved = await save(row, outcome.patch)
    if (!saved) return
    if (outcome.transition === 'verified') {
      summary.verified++
      emit('support.sending_domain.verified', row, 'verified')
      if (policy() === 'team') {
        const count = await detach(row)
        if (count > 0) {
          logger.info("Detached other teams' addresses from a newly verified sending domain", {
            domainId: row.id,
            count,
          })
          metric('support.sending_domain.address_detached', { domainId: row.id, count })
        }
      }
    } else if (outcome.transition === 'suspended') {
      summary.suspended++
      emit('support.sending_domain.suspended', row, 'suspended')
    }
  }

  async function handleRegister(row: SendingDomainRow, outcome: RegisterOutcome) {
    if (outcome.kind === 'ok') {
      consecutiveUnavailable = 0
      summary.registered++
      await finish(row, outcome.patch)
      return
    }
    if (outcome.kind === 'misconfigured') {
      throw new PassAbort('provider_misconfigured')
    }
    if (outcome.kind === 'rejected') {
      // A permanent refusal leaves nothing claimed (design §4.3).
      summary.failed++
      emit('support.sending_domain.failed', row, 'failed', outcome.code)
      await deleteRow(row)
      return
    }
    if (outcome.rateLimited) {
      summary.rateLimited++
    } else {
      summary.failed++
      consecutiveUnavailable++
      emit('support.sending_domain.failed', row, 'failed', outcome.code)
    }
    await finish(row, outcome.patch)
  }

  async function handleProviderError(
    row: SendingDomainRow,
    error: SendingDomainProviderError,
    patch: SendingDomainPatch | null
  ) {
    if (error.code === 'missing_scope' || error.code === 'unauthorized') throw new PassAbort('provider_misconfigured')
    if (error.code === 'rate_limited') summary.rateLimited++
    else {
      summary.failed++
      if (error.code === 'provider_unavailable') consecutiveUnavailable++
    }
    if (patch) await finish(row, patch)
  }

  async function handleRemoval(row: SendingDomainRow, outcome: RemoveOutcome, kind: 'deleted' | 'expired') {
    if (outcome.kind === 'misconfigured') throw new PassAbort('provider_misconfigured')
    if (outcome.kind === 'retry') {
      if (outcome.patch.lastErrorCode === 'provider_unavailable') consecutiveUnavailable++
      await finish(row, outcome.patch)
      return
    }
    consecutiveUnavailable = 0
    await deleteRow(row)
    if (kind === 'expired') summary.expired++
    else summary.deleted++
    emit(`support.sending_domain.${kind}`, row, row.status)
    if (outcome.operatorCleanupRequired) {
      emit('support.sending_domain.operator_cleanup_required', row, row.status)
    }
  }

  try {
    while (summary.claimed < maxRows) {
      if (clock().getTime() - startedAt >= budgetMs) throw new PassAbort('time_budget')

      const batch = await claim({ now: clock(), limit: batchSize })
      if (batch.length === 0) break
      summary.claimed += batch.length

      for (let i = 0; i < batch.length; i++) {
        const row = batch[i]!
        try {
          if (clock().getTime() - startedAt >= budgetMs) throw new PassAbort('time_budget')
          if (consecutiveUnavailable >= breakerThreshold) throw new PassAbort('circuit_breaker')
          await processRow(row, clock())
          summary.processed++
        } catch (error) {
          if (error instanceof PassAbort) {
            // Unprocessed rows keep their state; only the lease is given back.
            await release(batch.slice(i).map((r) => r.id))
            throw error
          }
          // One bad row must not stall the rest; retry it later.
          summary.failed++
          logger.error('Sending-domain check failed unexpectedly', { domainId: row.id, error })
          const now = clock()
          await save(row, {
            lastErrorCode: 'internal_error',
            lastError: sanitizeSendingDomainError(error),
            nextCheckAt: new Date(now.getTime() + 15 * MINUTE_MS),
            leaseExpiresAt: null,
            updatedAt: now,
          }).catch(() => false)
        }
      }
      if (consecutiveUnavailable >= breakerThreshold) throw new PassAbort('circuit_breaker')
    }
    if (summary.claimed >= maxRows) summary.aborted = 'max_rows'
  } catch (error) {
    if (!(error instanceof PassAbort)) throw error
    summary.aborted = error.reason
    if (error.reason === 'provider_misconfigured') {
      logger.error('Sending-domain provider is misconfigured; stopping the poll pass')
      metric('support.sending_domain.provider_misconfigured', { provider: provider.name })
    } else {
      logger.warn('Sending-domain poll pass stopped early', { reason: error.reason })
    }
  }

  return summary
}
