import { and, eq, inArray, isNotNull, isNull, like, lte, ne, or, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import {
  mailForwardDestination,
  supportInbox,
  projectMailAddress,
  projectMailDomain,
} from '~/server/database/schema/support'
import {
  PENDING_TTL_DAYS,
  SUSPENDED_TTL_DAYS,
  applyProviderResult,
  pendingPeriodStart,
} from '~/lib/support-sending-domains'
import type { SendingDomainDnsRecord } from '~/lib/support-sending-domains'
import { catchAllAddressFor } from '~/lib/mail-address'
import { getSendingDomainProvider } from '~/server/services/sending-domains'
import { checkDmarc, checkOwnershipTxt, ownershipRecord } from '~/server/services/sending-domains/ownership'
import {
  SendingDomainProviderError,
  type ProviderDomainResult,
  type SendingDomainProvider,
} from '~/server/services/sending-domains/types'
import {
  isSendingDomainsEnabled,
  resolveSenderPolicy,
  resolveProjectSenderAuthorization,
} from '~/server/utils/sending-domains'
import { resyncForwardOnlyRoutes, syncAddressRoute } from '~/server/utils/inbound-routes'
import { forwardingBrandForDomain, syncForwardingBrand } from '~/server/utils/forwarding-brand'
import { syncDeliveryWebhooks } from '~/server/utils/sending-domain-webhooks'
import { refreshExistingMxHosts } from '~/server/utils/mail-domain-mx'
import { notifyMxRecordNeeded } from '~/server/utils/mail-setup-notifications'
import { recordSupportMetric, type SupportMetricName } from '~/server/utils/support-observability'
import { createLogger } from '~/server/utils/logger'

const logger = createLogger('sending-domain-poller')

/**
 * Background lifecycle for customer sending domains (design §8.2).
 *
 * The pure decision functions (`registerSendingDomainClaim`, `checkSendingDomainClaim`,
 * `removeSendingDomainClaim`) return row patches and never touch the database; the
 * project API routes and the poll pass share them so the status machine lives in one place.
 */

export type SendingDomainRow = typeof projectMailDomain.$inferSelect
export type SendingDomainPatch = Partial<typeof projectMailDomain.$inferInsert>

/** How long a claimed row is invisible to other poll passes. */
export const SENDING_DOMAIN_LEASE_SECONDS = 2 * 60
export const SENDING_DOMAIN_BATCH_SIZE = 25
/** A pass stops starting new work after this long. */
export const SENDING_DOMAIN_PASS_BUDGET_MS = 45_000
/** Consecutive `provider_unavailable` results that stop a pass. */
export const SENDING_DOMAIN_CIRCUIT_BREAKER_THRESHOLD = 3
/** Failed register attempts before a claim waits for an admin to click Verify. */
export const MAX_REGISTER_ATTEMPTS = 8
/**
 * Failed provider removals before a claim is released anyway with an operator
 * cleanup request. With the 6 hour backoff cap this is about two days, so a
 * credential misconfiguration cannot keep a row in `deleting` (and the domain
 * blocked for every other project) indefinitely.
 */
export const MAX_REMOVE_ATTEMPTS = 12
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
  // The cadence follows the current pending period, which a re-registration
  // restarts, not the row's creation (see `pendingPeriodStart`).
  const start = pendingPeriodStart({ createdAt, expiresAt }) ?? createdAt
  const age = now.getTime() - start.getTime()
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

export function suspendedExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + SUSPENDED_TTL_DAYS * DAY_MS)
}

/** Statuses whose `expiresAt` deletes the claim once it passes. */
const EXPIRING_STATUSES: string[] = ['provisioning', 'pending', 'failed', 'suspended']

/**
 * Ownership to record after a successful register. A domain Veerify created is
 * never relabelled `adopted` (that would stop removal and leak the provider
 * domain). A registration that finds the domain already present after one of our
 * own failed attempts (the first call may have created it before the response
 * was lost) is also ours, but only where we could have created and can remove.
 */
function resolveRegisteredOwnership(
  row: Pick<SendingDomainRow, 'providerOwnership' | 'attemptCount'>,
  registered: 'created' | 'adopted',
  provider: SendingDomainProvider
): 'created' | 'adopted' {
  if (row.providerOwnership === 'created') return 'created'
  if (
    registered === 'adopted' &&
    row.providerOwnership === null &&
    row.attemptCount > 0 &&
    provider.capabilities.register &&
    provider.capabilities.remove
  ) {
    return 'created'
  }
  return registered
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
  /**
   * An admin click restarts the failure budget. `row.attemptCount` stays intact
   * because it is also the evidence that an earlier attempt of ours may have
   * created the provider domain.
   */
  restartBudget?: boolean
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
    const attemptCount = (deps.restartBudget ? 0 : row.attemptCount) + 1
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
      providerOwnership: resolveRegisteredOwnership(row, registration.ownership, provider),
      providerState: registration.state,
      receivesViaProvider: registration.receivesMail,
      dnsRecords: buildRecords(row, registration.records, 'unknown', null),
      verifiedAt: null,
      // A (re-)registered provider domain may have lost its webhooks: ensure them again once verified.
      deliveryWebhooksKey: null,
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
      const settled = row.status === 'verified' || row.status === 'suspended'
      const attempts = row.attemptCount + 1
      let nextCheckAt: Date
      if (error.code === 'rate_limited') nextCheckAt = computeRetryAfterAt(error.retryAfterSeconds, now)
      else if (!error.retryable || (settled && attempts >= MAX_REGISTER_ATTEMPTS)) {
        // Retrying cannot help soon: fall back to the normal cadence.
        nextCheckAt = settled
          ? computeVerifiedNextCheckAt(now)
          : computePendingNextCheckAt(row.createdAt, row.expiresAt, now)
      } else nextCheckAt = computeRegisterBackoffAt(attempts, now, deps.random)
      return {
        kind: 'provider_error',
        error,
        patch: {
          // A counter, so repeated blips back off (5 min ... 6 h) instead of
          // retrying every 5 minutes forever. Rate limiting does not count.
          ...(error.code === 'rate_limited' ? {} : { attemptCount: attempts }),
          lastErrorCode: error.code,
          lastError: message,
          lastCheckedAt: now,
          nextCheckAt,
          leaseExpiresAt: null,
          updatedAt: now,
        },
      }
    }
  }

  if (result === null) {
    // A list-only provider (Postmark) cannot register: "not listed" just means the
    // operator has not added the domain yet. It is an unverified answer, so the
    // TXT and DMARC checks still run and the claim stays pending.
    const listOnly = !provider.capabilities.register
    if (!listOnly && (row.status === 'pending' || row.status === 'suspended' || deps.manual)) {
      // The provider domain is gone (or was never created): register it again.
      return { kind: 'needs_register' }
    }
    // A verified claim whose domain vanished counts as the provider reporting it
    // unverified, which feeds the suspension threshold.
    result = {
      domain: row.domain,
      state: 'unverified',
      receivesMail: false,
      records: [],
      message: listOnly
        ? 'The mail provider does not list this domain yet.'
        : 'The mail provider no longer knows this domain.',
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
    // The contested explanation wins; otherwise keep the reason the status machine
    // recorded (e.g. why a claim was just suspended) and clear it only when none.
    ...(result.contested
      ? contestedFields(result)
      : { lastErrorCode: applied.lastErrorCode ?? null, lastError: applied.lastError ?? null }),
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

    const credentials = error.code === 'missing_scope' || error.code === 'unauthorized'
    // A permanent refusal will not change by retrying (design §5.3): release the
    // claim and ask the operator to clean up the provider side.
    if (!credentials && !error.retryable && error.code !== 'rate_limited') {
      return { kind: 'deleted', operatorCleanupRequired: true }
    }

    const message = sanitizeSendingDomainError(error.message)
    const attemptCount = row.attemptCount + 1
    // Bounded retry budget: a row must not stay `deleting` forever (a stuck row
    // blocks the domain for every other project). Rate limiting does not count.
    if (error.code !== 'rate_limited' && attemptCount >= MAX_REMOVE_ATTEMPTS) {
      return { kind: 'deleted', operatorCleanupRequired: true }
    }
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
    if (credentials) return { kind: 'misconfigured', error, patch }
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
      SELECT id FROM project_mail_domain
      WHERE next_check_at IS NOT NULL
        AND next_check_at <= ${isoTimestamp(now)}
        AND (lease_expires_at IS NULL OR lease_expires_at < ${isoTimestamp(now)})
      ORDER BY next_check_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE project_mail_domain AS d
    SET lease_expires_at = ${isoTimestamp(leaseExpiresAt)},
        updated_at = ${isoTimestamp(now)}
    FROM due
    WHERE d.id = due.id
    RETURNING d.id
  `)

  const ids = result.rows.map((row) => row.id)
  if (ids.length === 0) return []
  const rows = await db.select().from(projectMailDomain).where(inArray(projectMailDomain.id, ids))
  return rows.sort((a, b) => (a.nextCheckAt?.getTime() ?? 0) - (b.nextCheckAt?.getTime() ?? 0))
}

export interface SaveSendingDomainHooks {
  policy?: () => 'legacy' | 'project'
  detach?: (row: Pick<SendingDomainRow, 'id' | 'projectId' | 'domain'>, executor?: DetachExecutor) => Promise<number>
  metric?: typeof recordSupportMetric
}

/**
 * Write a patch only if the row still has the status the pass saw (an admin may
 * have moved it meanwhile).
 *
 * This is the single place where a claim becomes `verified` (poller, manual
 * Verify, recovery from `suspended`), so the §8.3 / H2 / M1 detachment of other
 * projects' addresses on the domain runs here, in the same transaction as the
 * status change: if it fails the claim does not verify and is retried.
 */
export async function saveSendingDomainPatch(
  row: Pick<SendingDomainRow, 'id' | 'projectId' | 'domain' | 'status'>,
  patch: SendingDomainPatch,
  hooks: SaveSendingDomainHooks = {}
): Promise<boolean> {
  const guard = and(eq(projectMailDomain.id, row.id), eq(projectMailDomain.status, row.status))
  const becomesVerified = patch.status === 'verified' && row.status !== 'verified'
  const policy = hooks.policy ?? resolveSenderPolicy

  if (!becomesVerified || policy() !== 'project') {
    const updated = await db.update(projectMailDomain).set(patch).where(guard).returning({ id: projectMailDomain.id })
    return updated.length > 0
  }

  const detach = hooks.detach ?? detachForeignAddresses
  const detached = await db.transaction(async (tx) => {
    const updated = await tx.update(projectMailDomain).set(patch).where(guard).returning({ id: projectMailDomain.id })
    if (updated.length === 0) return null
    return detach(row, tx)
  })
  if (detached === null) return false
  if (detached > 0) {
    logger.info("Detached other projects' addresses from a newly verified sending domain", {
      domainId: row.id,
      count: detached,
    })
    ;(hooks.metric ?? recordSupportMetric)('support.sending_domain.address_detached', {
      domainId: row.id,
      count: detached,
    })
  }
  return true
}

/**
 * Delete a claim only if it is still in the state the caller acted on: the status
 * the pass saw and, for expiry, `expiresAt <= expiredBy`. A concurrent manual
 * verify (or a re-registration that restarted the clock) is then left alone.
 * Returns whether a row was deleted.
 */
export async function deleteSendingDomainRow(
  row: Pick<SendingDomainRow, 'id'> & Partial<Pick<SendingDomainRow, 'status'>>,
  opts: { expiredBy?: Date } = {}
): Promise<boolean> {
  const conditions = [eq(projectMailDomain.id, row.id)]
  if (row.status) conditions.push(eq(projectMailDomain.status, row.status))
  if (opts.expiredBy) conditions.push(lte(projectMailDomain.expiresAt, opts.expiredBy))
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(projectMailDomain)
      .where(and(...conditions))
      .returning({ id: projectMailDomain.id, projectId: projectMailDomain.projectId, domain: projectMailDomain.domain })
    if (deleted.length === 0) return false
    // A catch-all only exists on a project mail domain: it goes with the domain,
    // so it cannot keep routing (or block the address) once the domain is released.
    // Exact addresses stay; their domainId is cleared by the foreign key.
    const [gone] = deleted
    await tx
      .delete(projectMailAddress)
      .where(
        and(
          eq(projectMailAddress.projectId, gone.projectId),
          eq(projectMailAddress.address, catchAllAddressFor(gone.domain))
        )
      )
    return true
  })
}

export async function releaseSendingDomainLeases(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await db
    .update(projectMailDomain)
    .set({ leaseExpiresAt: null })
    .where(and(inArray(projectMailDomain.id, ids), isNotNull(projectMailDomain.leaseExpiresAt)))
}

/** Best-effort: delete provider routes created for the project's addresses on this exact domain. */
export async function deleteProviderRoutes(
  row: SendingDomainRow,
  provider: SendingDomainProvider | null
): Promise<void> {
  if (!provider?.deleteInboundRoute || isProviderMismatch(row, provider)) return
  const addresses = await db
    .select({ id: projectMailAddress.id, routeId: projectMailAddress.providerRouteId })
    .from(projectMailAddress)
    .innerJoin(supportInbox, eq(supportInbox.id, projectMailAddress.inboxId))
    .where(
      and(
        eq(supportInbox.projectId, row.projectId),
        isNotNull(projectMailAddress.providerRouteId),
        like(projectMailAddress.address, `%@${row.domain}`)
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
      .update(projectMailAddress)
      .set({ providerRouteId: null, providerRouteStatus: null })
      .where(eq(projectMailAddress.id, address.id))
  }
}

export type DetachExecutor = Pick<typeof db, 'delete' | 'update'>

/**
 * Design §8.3: on a move to `verified`, other projects' custom addresses on this
 * domain or its subdomains (possible only from before enforcement) are detached,
 * and so are other projects' inbox From addresses (`supportInbox.emailAddress`, set
 * to null) on it, so nobody keeps sending as a domain another project just proved
 * it owns. Returns the number of rows changed.
 */
export async function detachForeignAddresses(
  row: Pick<SendingDomainRow, 'id' | 'projectId' | 'domain'>,
  executor: DetachExecutor = db
): Promise<number> {
  const onDomain = (column: typeof projectMailAddress.address | typeof supportInbox.emailAddress) =>
    or(like(sql`lower(${column})`, `%@${row.domain}`), like(sql`lower(${column})`, `%@%.${row.domain}`))

  const detached = await executor
    .delete(projectMailAddress)
    .where(
      and(
        eq(projectMailAddress.kind, 'custom'),
        inArray(
          projectMailAddress.inboxId,
          db.select({ id: supportInbox.id }).from(supportInbox).where(ne(supportInbox.projectId, row.projectId))
        ),
        onDomain(projectMailAddress.address)
      )
    )
    .returning({ id: projectMailAddress.id })

  const cleared = await executor
    .update(supportInbox)
    .set({ emailAddress: null, updatedAt: new Date() })
    .where(
      and(
        ne(supportInbox.projectId, row.projectId),
        isNotNull(supportInbox.emailAddress),
        onDomain(supportInbox.emailAddress)
      )
    )
    .returning({ id: supportInbox.id })

  return detached.length + cleared.length
}

export interface DirectRouteReconciliation {
  created: number
  failed: number
  /** The provider refused route creation for credentials / scope. */
  misconfigured: boolean
}

/**
 * Design §9.2 daily reconcile for a verified claim that receives mail through the
 * provider: retry routes whose creation failed, and create routes for the project's
 * custom addresses on the exact claimed domain that have none (for example
 * addresses added before the claim verified or before receiving was enabled).
 * The domain's catch-all (`*@domain`) is one of them; the provider gives it the
 * domain-wide route at the lowest precedence (`inboundRouteDefinition`).
 * A route failure never throws; the row is left `failed` for the next pass.
 */
export async function reconcileDirectRoutes(
  row: Pick<SendingDomainRow, 'id' | 'projectId' | 'domain'>,
  provider: SendingDomainProvider
): Promise<DirectRouteReconciliation> {
  const result: DirectRouteReconciliation = { created: 0, failed: 0, misconfigured: false }
  if (!provider.capabilities.inboundRoutes || !provider.createInboundRoute) return result

  const addresses = await db
    .select({
      id: projectMailAddress.id,
      inboxId: projectMailAddress.inboxId,
      address: projectMailAddress.address,
      routeId: projectMailAddress.providerRouteId,
    })
    .from(projectMailAddress)
    .innerJoin(supportInbox, eq(supportInbox.id, projectMailAddress.inboxId))
    .where(
      and(
        eq(supportInbox.projectId, row.projectId),
        eq(projectMailAddress.kind, 'custom'),
        like(sql`lower(${projectMailAddress.address})`, `%@${row.domain}`),
        or(isNull(projectMailAddress.providerRouteId), eq(projectMailAddress.providerRouteStatus, 'failed'))
      )
    )

  for (const address of addresses) {
    const synced = await syncAddressRoute(address.id, { provider, claimId: row.id })
    if (synced.errorCode) {
      logger.warn('Inbound route reconcile failed', { domainId: row.id, addressId: address.id, code: synced.errorCode })
      if (synced.errorCode === 'missing_scope' || synced.errorCode === 'unauthorized') {
        result.misconfigured = true
        return result
      }
    }
    if (synced.status === 'active') result.created++
    else if (synced.status === 'failed') result.failed++
  }
  return result
}

export interface ReceivingSyncResult {
  /** `enableReceiving` was called. */
  enabled: boolean
  /** The row's `receiving_status` after the sync (null: not receiving through Frogmail). */
  status: string | null
  /** Frogmail's `last_received_at` after the sync (null: no message yet, or not receiving). */
  lastReceivedAt: Date | null
  /** Local destination rows updated from the provider. */
  destinationsUpdated: number
  /** Why nothing happened or what was left for a later pass. */
  skipped: 'no_forwarding' | 'provider_conflict' | 'receives_elsewhere' | 'error' | null
}

/** The row fields `syncDomainReceiving` reads; the optional ones drive the MX lookup, notice and cadence. */
export type ReceivingSyncRow = Pick<SendingDomainRow, 'id' | 'domain' | 'receivingStatus'> &
  Partial<
    Pick<
      SendingDomainRow,
      'projectId' | 'status' | 'verifiedAt' | 'nextCheckAt' | 'mxNoticeSentAt' | 'lastReceivedAt' | 'existingMxHosts'
    >
  >

export interface ReceivingSyncDeps {
  now?: Date
  /** Look up and store the domain's existing MX hosts (the takeover warning). */
  refreshMx?: typeof refreshExistingMxHosts
  /** Email the project admins that the MX record is the one record left. */
  notifyMx?: typeof notifyMxRecordNeeded
}

/**
 * While a verified claim waits for receiving (Frogmail still verifying, or the MX record is
 * missing), check it more often than the daily verified cadence so the Email tab moves on
 * soon after the MX is published: every 5 minutes for the first hour after verification,
 * every 15 minutes for a day, hourly for a week, then daily.
 */
export function computeReceivingNextCheckAt(verifiedAt: Date | null | undefined, now: Date): Date {
  const age = verifiedAt ? now.getTime() - verifiedAt.getTime() : 0
  const interval = age < HOUR_MS ? 5 * MINUTE_MS : age < DAY_MS ? 15 * MINUTE_MS : age < 7 * DAY_MS ? HOUR_MS : DAY_MS
  return new Date(now.getTime() + interval)
}

/**
 * E3: SES receiving for a registered claim. Enables receiving once (allowed
 * while the claim is still pending), refreshes `receiving_status`, `last_received_at`
 * and the receiving MX record on every pass, and reconciles the local forward
 * destinations from the provider's list (a missed webhook heals here).
 * While receiving is not active it also looks up the domain's existing MX hosts
 * (the takeover warning), checks a verified claim sooner, and once the MX is the
 * one record left (`pending_mx`) emails the project admins (once per domain).
 * `receiving_provider_conflict` leaves the claim on the E2 path;
 * `domain_receives_elsewhere` and transient errors are retried on a later pass.
 * Never throws: a failure here must not fail the claim.
 */
export async function syncDomainReceiving(
  row: ReceivingSyncRow,
  provider: SendingDomainProvider,
  deps: ReceivingSyncDeps = {}
): Promise<ReceivingSyncResult> {
  const result: ReceivingSyncResult = {
    enabled: false,
    status: row.receivingStatus,
    lastReceivedAt: row.lastReceivedAt ?? null,
    destinationsUpdated: 0,
    skipped: null,
  }
  if (!provider.capabilities.forwarding || !provider.enableReceiving || !provider.getReceiving) {
    return { ...result, skipped: 'no_forwarding' }
  }

  const now = deps.now ?? new Date()
  try {
    const brandName = await forwardingBrandForDomain(row.id)
    let state =
      row.receivingStatus && row.receivingStatus !== 'disabled' ? await provider.getReceiving(row.domain) : null
    if (!state || state.status === 'disabled') {
      state = await provider.enableReceiving(row.domain, { brandName })
      result.enabled = true
    }
    await syncForwardingBrand({ provider, domain: row.domain, brandName, reported: state })

    const [current] = await db
      .select({ dnsRecords: projectMailDomain.dnsRecords })
      .from(projectMailDomain)
      .where(eq(projectMailDomain.id, row.id))
      .limit(1)
    const patch: SendingDomainPatch = { receivingStatus: state.status }
    if (state.lastReceivedAt) patch.lastReceivedAt = state.lastReceivedAt
    let records = current?.dnsRecords ?? []
    if (current && state.records.length > 0) {
      records = [...current.dnsRecords.filter((r) => r.purpose !== 'receiving'), ...state.records]
      records.sort((a, b) => RECEIVING_RECORD_ORDER[a.purpose] - RECEIVING_RECORD_ORDER[b.purpose])
      patch.dnsRecords = records
    }
    const waiting = state.status === 'pending_verification' || state.status === 'pending_mx'
    if (waiting && row.status === 'verified') {
      const sooner = computeReceivingNextCheckAt(row.verifiedAt, now)
      if (!row.nextCheckAt || sooner < row.nextCheckAt) patch.nextCheckAt = sooner
    }
    await db.update(projectMailDomain).set(patch).where(eq(projectMailDomain.id, row.id))
    result.status = state.status
    result.lastReceivedAt = state.lastReceivedAt ?? result.lastReceivedAt

    let existingMxHosts = row.existingMxHosts ?? null
    if (state.status !== 'active') {
      const refreshed = await (deps.refreshMx ?? refreshExistingMxHosts)(
        { id: row.id, domain: row.domain, receivingStatus: state.status, dnsRecords: records },
        { now }
      )
      if (refreshed) existingMxHosts = refreshed
    }
    if (state.status === 'pending_mx' && row.status === 'verified' && row.projectId && !row.mxNoticeSentAt) {
      await (deps.notifyMx ?? notifyMxRecordNeeded)(
        {
          id: row.id,
          projectId: row.projectId,
          domain: row.domain,
          mxNoticeSentAt: row.mxNoticeSentAt ?? null,
          dnsRecords: records,
          existingMxHosts,
        },
        { now }
      )
    }

    result.destinationsUpdated = await reconcileForwardDestinations(row, provider)
    // Forward-only addresses: inbox fallback on until a forward is confirmed (idempotent).
    await resyncForwardOnlyRoutes({ domainId: row.id }, { provider })
  } catch (raw) {
    const error = toProviderError(raw)
    if (error.code === 'receiving_provider_conflict') result.skipped = 'provider_conflict'
    else if (error.code === 'domain_receives_elsewhere') result.skipped = 'receives_elsewhere'
    else result.skipped = 'error'
    logger.warn('Receiving sync failed', { domainId: row.id, code: error.code })
  }
  return result
}

const RECEIVING_RECORD_ORDER: Record<SendingDomainDnsRecord['purpose'], number> = {
  ownership: 0,
  sending: 1,
  receiving: 2,
  recommended: 3,
}

/** Mirrors provider destination state onto the local rows (by Frogmail id, else email). Returns rows changed. */
export async function reconcileForwardDestinations(
  row: Pick<SendingDomainRow, 'id' | 'domain'>,
  provider: SendingDomainProvider
): Promise<number> {
  if (!provider.listForwardDestinations) return 0
  const remote = await provider.listForwardDestinations(row.domain)
  const local = await db.select().from(mailForwardDestination).where(eq(mailForwardDestination.domainId, row.id))
  let changed = 0
  for (const item of local) {
    const match =
      remote.find((r) => item.frogmailDestinationId && r.id === item.frogmailDestinationId) ??
      remote.find((r) => r.email.trim().toLowerCase() === item.email)
    if (!match) continue
    const next = {
      frogmailDestinationId: match.id,
      status: match.status,
      statusReason: match.statusReason,
      verificationSentAt: match.verificationSentAt ?? item.verificationSentAt,
      verifiedAt: match.verifiedAt ?? item.verifiedAt,
    }
    const same =
      next.frogmailDestinationId === item.frogmailDestinationId &&
      next.status === item.status &&
      next.statusReason === item.statusReason &&
      next.verificationSentAt?.getTime() === item.verificationSentAt?.getTime() &&
      next.verifiedAt?.getTime() === item.verifiedAt?.getTime()
    if (same) continue
    await db
      .update(mailForwardDestination)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(mailForwardDestination.id, item.id))
    changed++
  }
  return changed
}

/**
 * Design §14 (F-3 mitigation): when the outbox sees the provider refuse a From on
 * a verified claim (SMTP 553 or `sender_not_authorized`), the provider no longer
 * accepts that domain even though it reported it as active. Suspend the project's
 * verified claim covering `address`. The daily check can recover it if the
 * provider and DNS really pass again. Returns whether a claim was suspended.
 */
export async function suspendClaimForSenderRejection(
  projectId: string,
  address: string,
  reason: string,
  deps: { now?: Date; metric?: typeof recordSupportMetric } = {}
): Promise<boolean> {
  const verdict = await resolveProjectSenderAuthorization(projectId, address)
  if (verdict.status !== 'authorized' || !verdict.domain) return false

  const now = deps.now ?? new Date()
  const detail = sanitizeSendingDomainError(reason)
  const [suspended] = await db
    .update(projectMailDomain)
    .set({
      status: 'suspended',
      lastErrorCode: 'sender_rejected',
      lastError: `The mail provider refused to send from this domain: ${detail}`.slice(0, MAX_ERROR_LENGTH),
      expiresAt: suspendedExpiryFrom(now),
      nextCheckAt: computeVerifiedNextCheckAt(now),
      updatedAt: now,
    })
    .where(
      and(
        eq(projectMailDomain.id, verdict.domain.id),
        eq(projectMailDomain.projectId, projectId),
        eq(projectMailDomain.status, 'verified')
      )
    )
    .returning({ id: projectMailDomain.id, provider: projectMailDomain.provider })
  if (!suspended) return false

  logger.warn('Suspended a sending domain after the provider refused its sender', { domainId: suspended.id })
  ;(deps.metric ?? recordSupportMetric)('support.sending_domain.suspended', {
    domainId: suspended.id,
    provider: suspended.provider,
    status: 'suspended',
    reason: 'sender_rejected',
  })
  return true
}

// ---------------------------------------------------------------------------
// The poll pass
// ---------------------------------------------------------------------------

export type SendingDomainPollAbort =
  | 'time_budget'
  | 'circuit_breaker'
  | 'provider_misconfigured'
  | 'rate_limited'
  | 'max_rows'

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
  policy?: () => 'legacy' | 'project'
  /** `undefined` resolves the configured provider; `null` means none is configured. */
  provider?: SendingDomainProvider | null
  claim?: (input: { now: Date; limit: number }) => Promise<SendingDomainRow[]>
  save?: (row: SendingDomainRow, patch: SendingDomainPatch) => Promise<boolean>
  deleteRow?: (row: SendingDomainRow, opts?: { expiredBy?: Date }) => Promise<boolean | undefined>
  release?: (ids: string[]) => Promise<void>
  detach?: SaveSendingDomainHooks['detach']
  /** Create or retry direct-receiving routes for a verified claim (§9.2). */
  reconcileRoutes?: (row: SendingDomainRow, provider: SendingDomainProvider) => Promise<DirectRouteReconciliation>
  /** E3: enable and refresh SES receiving and reconcile forward destinations. */
  syncReceiving?: (row: SendingDomainRow, provider: SendingDomainProvider) => Promise<unknown>
  /** Ensure the delivery webhooks of a verified claim (cheap when its marker matches). */
  syncWebhooks?: (row: SendingDomainRow, provider: SendingDomainProvider) => Promise<unknown>
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
  const metric = deps.metric ?? recordSupportMetric
  const policy = deps.policy ?? resolveSenderPolicy
  const save =
    deps.save ??
    ((row: SendingDomainRow, patch: SendingDomainPatch) =>
      saveSendingDomainPatch(row, patch, { policy, detach: deps.detach, metric }))
  const reconcileRoutes = deps.reconcileRoutes ?? reconcileDirectRoutes
  const syncReceiving = deps.syncReceiving ?? syncDomainReceiving
  const syncWebhooks = deps.syncWebhooks ?? syncDeliveryWebhooks
  const deleteRow = deps.deleteRow ?? deleteSendingDomainRow
  const release = deps.release ?? releaseSendingDomainLeases
  const batchSize = deps.batchSize ?? SENDING_DOMAIN_BATCH_SIZE
  const budgetMs = deps.budgetMs ?? SENDING_DOMAIN_PASS_BUDGET_MS
  const breakerThreshold = deps.breakerThreshold ?? SENDING_DOMAIN_CIRCUIT_BREAKER_THRESHOLD
  const maxRows = deps.maxRows ?? SENDING_DOMAIN_MAX_ROWS_PER_PASS
  const startedAt = clock().getTime()
  let consecutiveUnavailable = 0
  let routeScopeReported = false

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

    // Pending-claim expiry (design §4.2 rule 6) and suspended-claim expiry (§5.3).
    // Verified claims never expire.
    if (EXPIRING_STATUSES.includes(row.status) && row.expiresAt && row.expiresAt <= now) {
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
      await finish(row, {
        status: 'provisioning',
        // A pending claim keeps its clock; a suspended one starts a fresh pending period.
        expiresAt: row.status === 'pending' && row.expiresAt ? row.expiresAt : pendingExpiryFrom(now),
        nextCheckAt: now,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      return
    }
    if (outcome.kind === 'provider_error') {
      return handleProviderError(row, outcome.error, outcome.patch)
    }
    consecutiveUnavailable = 0
    summary.checked++
    const saved = await save(row, outcome.patch)
    if (!saved) return
    // Detaching other projects' addresses happens inside `save` (one place for every
    // verification, including the manual Verify route).
    if (outcome.transition === 'verified') {
      summary.verified++
      emit('support.sending_domain.verified', row, 'verified')
    } else if (outcome.transition === 'suspended') {
      summary.suspended++
      emit('support.sending_domain.suspended', row, 'suspended')
    }
    // Receiving first, so route reconcile sees `receiving_status` and the destinations.
    // It reads the row as just saved (status, verifiedAt, nextCheckAt).
    await receiving({ ...row, ...outcome.patch } as SendingDomainRow)
    if (outcome.patch.status === 'verified') await webhooks(row)
    if (outcome.patch.status === 'verified' && outcome.patch.receivesViaProvider && !routeScopeReported) {
      await reconcile(row)
    }
  }

  /** Receiving sync is best effort: it never fails the row it follows (E3). */
  async function receiving(row: SendingDomainRow) {
    try {
      await syncReceiving(row, provider!)
    } catch (error) {
      logger.warn('Receiving sync failed', { domainId: row.id, error })
    }
  }

  /** Delivery webhooks are best effort: a failure is logged and retried on the next check. */
  async function webhooks(row: SendingDomainRow) {
    try {
      await syncWebhooks(row, provider!)
    } catch (error) {
      logger.warn('Delivery webhook sync failed', { domainId: row.id, error })
    }
  }

  /** Route reconcile is best effort: it never fails the row it follows (§9.2). */
  async function reconcile(row: SendingDomainRow) {
    try {
      const result = await reconcileRoutes(row, provider!)
      if (result.misconfigured) {
        routeScopeReported = true
        logger.error('Sending-domain provider refused inbound route creation', { domainId: row.id })
        metric('support.sending_domain.provider_misconfigured', { provider: provider!.name })
      }
    } catch (error) {
      logger.warn('Inbound route reconcile failed', { domainId: row.id, error })
    }
  }

  async function handleRegister(row: SendingDomainRow, outcome: RegisterOutcome) {
    if (outcome.kind === 'ok') {
      consecutiveUnavailable = 0
      summary.registered++
      await finish(row, outcome.patch)
      await receiving({ ...row, ...outcome.patch } as SendingDomainRow)
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
      await finish(row, outcome.patch)
      // The provider asked everyone to slow down: stop the pass, like the breaker.
      throw new PassAbort('rate_limited')
    }
    summary.failed++
    consecutiveUnavailable++
    emit('support.sending_domain.failed', row, 'failed', outcome.code)
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
    if (error.code === 'rate_limited') throw new PassAbort('rate_limited')
  }

  async function handleRemoval(row: SendingDomainRow, outcome: RemoveOutcome, kind: 'deleted' | 'expired') {
    if (outcome.kind === 'misconfigured') {
      // Unlike a check, a removal that cannot authenticate must count its attempt:
      // the retry budget is what eventually releases the row.
      await finish(row, outcome.patch)
      throw new PassAbort('provider_misconfigured')
    }
    if (outcome.kind === 'retry') {
      if (outcome.patch.lastErrorCode === 'provider_unavailable') consecutiveUnavailable++
      await finish(row, outcome.patch)
      if (outcome.patch.lastErrorCode === 'rate_limited') throw new PassAbort('rate_limited')
      return
    }
    consecutiveUnavailable = 0
    // Guarded by the status the pass saw, and for expiry by `expiresAt <= now`, so
    // a concurrent manual verify or re-registration is not deleted.
    const removed = await deleteRow(row, kind === 'expired' ? { expiredBy: clock() } : undefined)
    if (removed === false) return
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
