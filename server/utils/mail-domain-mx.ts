/**
 * MX takeover warning (docs/plans/2026-10-28-email-addresses/design.md → UI, "Warn when the apex
 * already has MX records"). Publishing the SES receiving MX moves every message for the domain to
 * Veerify, so the Email tab needs to know which mail hosts the domain uses today.
 *
 * Looked up when a domain is added and on each check while receiving is not active. A DNS failure
 * never fails the caller: the hosts are stored as null ("not known") and the next check retries.
 */
import { resolveMx as nodeResolveMx } from 'node:dns/promises'
import { eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { projectMailDomain } from '~/server/database/schema/support'
import { existingMxHostsFrom } from '~/lib/mail-setup'
import type { SendingDomainDnsRecord } from '~/lib/support-sending-domains'
import { createLogger } from '~/server/utils/logger'

const logger = createLogger('mail-domain-mx')

export const MX_LOOKUP_TIMEOUT_MS = 3_000

export type MxResolver = (hostname: string) => Promise<Array<{ exchange: string; priority: number }>>

/** "The name has no MX records": a real answer (no mail system yet), not a failure. */
const NO_RECORDS = new Set(['ENODATA', 'ENOTFOUND', 'NXDOMAIN'])

/**
 * The domain's current MX hosts, minus our own receiving host. `[]` when it has none,
 * null when the lookup failed or timed out.
 */
export async function lookupExistingMxHosts(
  domain: string,
  opts: { resolveMx?: MxResolver; timeoutMs?: number; exclude?: string[] } = {}
): Promise<string[] | null> {
  const resolveMx = opts.resolveMx ?? nodeResolveMx
  const timeoutMs = opts.timeoutMs ?? MX_LOOKUP_TIMEOUT_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const records = await Promise.race([
      resolveMx(domain),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(Object.assign(new Error('MX lookup timed out'), { code: 'ETIMEOUT' })),
          timeoutMs
        )
      }),
    ])
    return existingMxHostsFrom(records, opts.exclude)
  } catch (error) {
    const code = (error as { code?: unknown })?.code
    if (typeof code === 'string' && NO_RECORDS.has(code)) return []
    logger.warn('MX lookup failed', { domain, code: typeof code === 'string' ? code : 'unknown' })
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Where the receiving MX goes (Frogmail's record name), else the claimed domain itself. */
export function receivingMxTarget(row: { domain: string; dnsRecords?: SendingDomainDnsRecord[] | null }): {
  name: string
  values: string[]
} {
  const mx = (row.dnsRecords ?? []).filter((record) => record.purpose === 'receiving' && record.type === 'MX')
  return { name: mx[0]?.name || row.domain, values: mx.map((record) => record.value) }
}

export interface RefreshExistingMxDeps {
  now?: Date
  resolveMx?: MxResolver
  timeoutMs?: number
  /** Writes the result; defaults to the `project_mail_domain` row. */
  store?: (id: string, patch: { existingMxHosts: string[]; existingMxCheckedAt: Date }) => Promise<void>
}

/**
 * Look up and store a claim's existing MX hosts. Skipped (returns undefined) once receiving
 * is active: the warning only matters before the MX is published. A failed lookup (null)
 * leaves the stored hosts as they were. Never throws.
 */
export async function refreshExistingMxHosts(
  row: {
    id: string
    domain: string
    receivingStatus?: string | null
    dnsRecords?: SendingDomainDnsRecord[] | null
  },
  deps: RefreshExistingMxDeps = {}
): Promise<string[] | null | undefined> {
  if (row.receivingStatus === 'active') return undefined
  const target = receivingMxTarget(row)
  const hosts = await lookupExistingMxHosts(target.name, {
    resolveMx: deps.resolveMx,
    timeoutMs: deps.timeoutMs,
    exclude: target.values,
  })
  // A failed lookup keeps whatever an earlier lookup found.
  if (hosts === null) return null
  const store =
    deps.store ??
    (async (id, patch) => {
      await db.update(projectMailDomain).set(patch).where(eq(projectMailDomain.id, id))
    })
  try {
    await store(row.id, { existingMxHosts: hosts, existingMxCheckedAt: deps.now ?? new Date() })
  } catch (error) {
    logger.warn('Could not store MX lookup', {
      domainId: row.id,
      error: error instanceof Error ? error.message : error,
    })
  }
  return hosts
}
