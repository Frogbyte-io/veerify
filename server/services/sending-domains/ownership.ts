import { resolveTxt as defaultResolveTxt } from 'node:dns/promises'
import { getDomain } from 'tldts'
import {
  OWNERSHIP_RECORD_LABEL,
  OWNERSHIP_RECORD_PREFIX,
  type SendingDomainDnsRecord,
} from '~/lib/support-sending-domains'
import { isFakeSendingDomainMode, isFakeVerifiedDomain } from './providers/fake'
import { normalizeDomainName } from './util'

/**
 * Per-claim ownership proof (design §2.3, §4) and the DMARC recommendation.
 *
 * Fake mode: when `SUPPORT_SENDING_DOMAIN_PROVIDER=fake` is active (never in
 * production), `checkOwnershipTxt` consults the fake and returns `valid` for
 * `*.verify-ok.test` without touching DNS. Callers need no special casing.
 */

export interface OwnershipDnsDeps {
  resolveTxt?: (hostname: string) => Promise<string[][]>
}

const DMARC_RECOMMENDED_VALUE = 'v=DMARC1; p=none;'

/** DNS errors that definitively mean "no such record" rather than "could not look". */
function isNoRecordError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === 'ENOTFOUND' || code === 'ENODATA'
}

export function ownershipRecord(domain: string, token: string): SendingDomainDnsRecord {
  return {
    purpose: 'ownership',
    type: 'TXT',
    name: `${OWNERSHIP_RECORD_LABEL}.${normalizeDomainName(domain)}`,
    value: `${OWNERSHIP_RECORD_PREFIX}${token}`,
    status: 'unknown',
  }
}

export async function checkOwnershipTxt(
  domain: string,
  token: string,
  deps?: OwnershipDnsDeps
): Promise<'valid' | 'invalid' | 'unknown'> {
  if (isFakeSendingDomainMode() && isFakeVerifiedDomain(domain)) return 'valid'

  const record = ownershipRecord(domain, token)
  const resolve = deps?.resolveTxt ?? defaultResolveTxt
  try {
    const records = await resolve(record.name)
    // Long TXT values arrive split into 255-byte chunks.
    return records.some((chunks) => chunks.join('').trim() === record.value) ? 'valid' : 'invalid'
  } catch (error) {
    // NXDOMAIN / no data is a confident "not published"; a resolver failure
    // (SERVFAIL, timeout) says nothing, so the poller must not count it.
    return isNoRecordError(error) ? 'invalid' : 'unknown'
  }
}

/**
 * A `recommended` DMARC row when neither the domain nor its organizational
 * domain publishes a DMARC policy; `null` when one exists. If the lookup
 * itself fails the row is returned with status `unknown`.
 */
export async function checkDmarc(domain: string, deps?: OwnershipDnsDeps): Promise<SendingDomainDnsRecord | null> {
  const name = normalizeDomainName(domain)
  const resolve = deps?.resolveTxt ?? defaultResolveTxt
  const organizational = getDomain(name) || name
  // Receivers fall back to the organizational domain's policy for subdomains.
  const hosts = organizational === name ? [name] : [name, organizational]

  let lookupFailed = false
  for (const host of hosts) {
    try {
      const records = await resolve(`_dmarc.${host}`)
      if (records.some((chunks) => /^v=DMARC1\b/i.test(chunks.join('').trim()))) return null
    } catch (error) {
      if (!isNoRecordError(error)) lookupFailed = true
    }
  }

  return {
    purpose: 'recommended',
    type: 'TXT',
    name: `_dmarc.${name}`,
    value: DMARC_RECOMMENDED_VALUE,
    status: lookupFailed ? 'unknown' : 'invalid',
  }
}
