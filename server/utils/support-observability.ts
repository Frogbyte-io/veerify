import { createLogger } from '~/server/utils/logger'

/**
 * Structured support metrics (Task 16).
 *
 * Every counter the support platform needs in production is derived from logs
 * rather than a metrics client: there is no metrics backend in this deployment,
 * and both target platforms (Vercel and the self-hosted Docker/Caddy path) can
 * build log-based counters from a stable structured record. That makes the log
 * line the contract, so it is typed and validated instead of hand-written at
 * each call site.
 *
 * Two rules make this safe to leave enabled everywhere:
 *
 * 1. **The metric name is a closed set.** A counter whose name drifts silently
 *    stops matching its log filter, so the filter reports zero rather than an
 *    error - the failure mode is an alert that never fires.
 * 2. **Fields are an allowlist of identifiers, statuses, and counts.** Support
 *    payloads carry customer email bodies, filenames, storage keys, and provider
 *    credentials. Logs are retained longer and read more widely than the database,
 *    so the boundary fails closed: anything not explicitly allowed is rejected,
 *    rather than denying a list of known-bad keys and hoping it stays complete.
 *
 * `recordSupportMetric` never throws. A metric that breaks a delivery or cleanup
 * path is strictly worse than a missing counter.
 */

const logger = createLogger('support-metrics')

/** Every metric this module will emit. Adding one is a deliberate contract change. */
export const SUPPORT_METRIC_NAMES = [
  'support.delivery.queued',
  'support.delivery.sent',
  'support.delivery.delivered',
  'support.delivery.failed',
  'support.delivery.bounced',
  'support.delivery.uncorrelated',
  'support.attachment.expired',
  'support.attachment.cleanup_failed',
] as const

export type SupportMetricName = (typeof SUPPORT_METRIC_NAMES)[number]

/**
 * The only field keys a metric may carry: opaque identifiers, closed-vocabulary
 * statuses, and numeric counts.
 *
 * Deliberately absent, and not to be added without re-reading the rule above:
 * `recipient`, `to`, `from`, `email`, `subject`, `body`, `filename`, and any
 * storage key. A recipient address is the one that looks harmless and is not -
 * it is contact PII, and no counter needs it to count.
 */
export const SUPPORT_METRIC_FIELDS = [
  // Identifiers. Opaque to anyone reading the log; useful for correlating one
  // counter back to a row while debugging.
  'deliveryId',
  'messageId',
  'conversationId',
  'eventId',
  'uploadId',
  'providerMessageId',
  // Closed vocabularies. Provider and account key are non-secret routing
  // identity (Task 12); the rest are enum-like columns.
  'provider',
  'providerAccountKey',
  'kind',
  'recordType',
  'status',
  'bounceType',
  'reason',
  'outcome',
  // Counts and flags.
  'attemptCount',
  'count',
  'durationMs',
  'terminal',
] as const

export type SupportMetricField = (typeof SUPPORT_METRIC_FIELDS)[number]

export type SupportMetricValue = string | number | boolean | null | undefined

export type SupportMetricFields = Partial<Record<SupportMetricField, SupportMetricValue>>

/**
 * A status or reason code, not a sentence. Anything longer is a payload that
 * reached a field it should not have, so it is rejected rather than truncated -
 * truncating would leave a partial customer message in the log.
 */
export const MAX_SUPPORT_METRIC_STRING_LENGTH = 120

const metricNames: ReadonlySet<string> = new Set(SUPPORT_METRIC_NAMES)
const metricFields: ReadonlySet<string> = new Set(SUPPORT_METRIC_FIELDS)

export interface SupportMetricRecord {
  metric: SupportMetricName
  fields: Record<string, string | number | boolean>
}

export type SupportMetricValidation = { ok: true; record: SupportMetricRecord } | { ok: false; reason: string }

/**
 * Pure validation half, exported so the contract can be tested without asserting
 * on log output.
 *
 * `null`/`undefined` values are dropped rather than rejected: call sites pass
 * nullable columns straight through, and a missing identifier is not a contract
 * violation - it just adds nothing to a counter.
 */
export function validateSupportMetric(name: string, fields: SupportMetricFields = {}): SupportMetricValidation {
  if (!metricNames.has(name)) {
    return { ok: false, reason: `Unknown support metric name: ${name}` }
  }

  const validated: Record<string, string | number | boolean> = {}

  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue

    if (!metricFields.has(key)) {
      return { ok: false, reason: `Disallowed support metric field: ${key}` }
    }

    if (typeof value === 'string') {
      if (value.length > MAX_SUPPORT_METRIC_STRING_LENGTH) {
        return { ok: false, reason: `Support metric field exceeds the length limit: ${key}` }
      }
      validated[key] = value
      continue
    }

    if (typeof value === 'boolean') {
      validated[key] = value
      continue
    }

    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        return { ok: false, reason: `Support metric field is not a finite number: ${key}` }
      }
      validated[key] = value
      continue
    }

    // Objects, arrays, and functions are how a whole payload arrives by accident.
    return { ok: false, reason: `Support metric field has an unsupported type: ${key}` }
  }

  return { ok: true, record: { metric: name as SupportMetricName, fields: validated } }
}

/**
 * Emit one metric record. Safe to call from any delivery or cleanup path: it
 * never throws, and a rejected record is logged as a warning so a broken call
 * site is visible rather than silently uncounted.
 *
 * The name is repeated as both the log message and a `metric` field so a
 * log-based counter can match on whichever its backend indexes.
 */
export function recordSupportMetric(name: SupportMetricName, fields: SupportMetricFields = {}): boolean {
  try {
    const result = validateSupportMetric(name, fields)

    if (!result.ok) {
      logger.warn('Rejected an invalid support metric', { reason: result.reason })
      return false
    }

    logger.info(result.record.metric, { metric: result.record.metric, ...result.record.fields })
    return true
  } catch {
    // Nothing here is worth failing a send or a cleanup pass over.
    return false
  }
}
