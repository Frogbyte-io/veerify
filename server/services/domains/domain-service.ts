import { parse } from 'tldts'
import { normalizeDomainHostname, type DomainProvider, type DomainProviderResult } from './provider'
import { resolveDomainProviderName, type DomainProviderName } from './provider-name'
import { CloudflareSaasDomainProvider } from './providers/cloudflare-saas'
import { StaticCnameDomainProvider } from './providers/static-cname'
import { VercelDomainProvider } from './providers/vercel'
import { createLogger } from '../../utils/logger'

export { resolveDomainProviderName }

type ProjectSettings = Record<string, unknown>

const logger = createLogger('domains')

export function normalizeCustomDomainInput(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = normalizeDomainHostname(value)
  return normalized || null
}

export function getCustomDomainValidationError(
  hostname: string,
  options: { appDomain: string; dashboardDomain: string }
): string | null {
  const normalized = normalizeDomainHostname(hostname)
  if (!normalized || normalized.length > 253) {
    return 'Enter a valid domain name'
  }

  const labels = normalized.split('.')
  if (labels.some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
    return 'Enter a valid domain name'
  }

  const appDomain = normalizeDomainHostname(options.appDomain)
  const dashboardDomain = normalizeDomainHostname(options.dashboardDomain)
  const isLocalDevelopmentDomain = appDomain === 'localhost' && normalized.endsWith('.localhost') && labels.length >= 3

  if (!isLocalDevelopmentDomain) {
    if (
      normalized === appDomain ||
      normalized === dashboardDomain ||
      (appDomain && normalized.endsWith(`.${appDomain}`))
    ) {
      return 'Use the Veerify URL for platform domains instead of adding one as a custom domain'
    }

    const parsed = parse(normalized, { allowPrivateDomains: false })
    if (parsed.hostname !== normalized || parsed.isIp || !parsed.isIcann || !parsed.domain) {
      return 'Enter a domain with a valid public suffix'
    }
    if (!parsed.subdomain) {
      return 'A custom subdomain is required; apex domains are not supported yet'
    }
  }

  return null
}

export function validateProjectCustomDomain(hostname: string): string {
  const normalized = normalizeDomainHostname(hostname)
  const config = useRuntimeConfig()
  const appDomain = String(config.public.appDomain || 'localhost')
  const dashboardDomain = String(
    config.public.dashboardDomain || (appDomain === 'localhost' ? 'localhost' : `app.${appDomain}`)
  )
  const error = getCustomDomainValidationError(normalized, { appDomain, dashboardDomain })

  if (error) {
    throw createError({ statusCode: 400, statusMessage: error })
  }

  return normalized
}

export function normalizeDomainSettings(value: unknown): ProjectSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return { ...(value as ProjectSettings) }
}

export function buildDomainSettingsPatch(
  currentSettings: unknown,
  result: DomainProviderResult | null
): ProjectSettings {
  const nextSettings = normalizeDomainSettings(currentSettings)

  delete nextSettings.domainProvider
  delete nextSettings.domainStatus
  delete nextSettings.domainDnsRecords
  delete nextSettings.domainResolvedTo
  delete nextSettings.domainExpected
  delete nextSettings.domainConfiguredBy
  delete nextSettings.domainMessage
  delete nextSettings.domainLastCheckedAt
  delete nextSettings.domainVerifiedAt
  delete nextSettings.domainConnectedEmailSentFor
  delete nextSettings.domainConnectedEmailSentAt
  delete nextSettings.domainVerifiedEmailSentFor
  delete nextSettings.domainVerifiedEmailSentAt

  if (!result) {
    return nextSettings
  }

  nextSettings.domainProvider = result.provider
  nextSettings.domainStatus = result.status
  nextSettings.domainDnsRecords = result.dnsRecords
  nextSettings.domainResolvedTo = result.resolvedTo
  nextSettings.domainExpected = result.expected
  nextSettings.domainConfiguredBy = result.configuredBy
  nextSettings.domainMessage = result.message
  nextSettings.domainLastCheckedAt = new Date().toISOString()

  if (result.verified) {
    nextSettings.domainVerifiedAt = new Date().toISOString()
  }

  return nextSettings
}

export function createDomainProvider(name: DomainProviderName): DomainProvider {
  if (name === 'vercel') return new VercelDomainProvider()
  if (name === 'cloudflare-saas') return new CloudflareSaasDomainProvider()
  return new StaticCnameDomainProvider()
}

function getDomainProvider() {
  return createDomainProvider(getDomainProviderName())
}

function getDomainProviderName() {
  return resolveDomainProviderName(useRuntimeConfig().domainProvider)
}

/**
 * Decide whether the "domain verified" email should go out after a check.
 * Never for a domain that was already active (e.g. a pre-existing static-cname
 * row adopted by a new provider), nor when it was already sent for this domain.
 */
export function shouldSendDomainVerifiedEmail(input: {
  verified: boolean
  domain: string
  settings: ProjectSettings
  previousStatus?: string | null
}): boolean {
  if (!input.verified) return false
  if (input.settings.domainVerifiedEmailSentFor === input.domain) return false
  if (input.previousStatus === 'active' || input.settings.domainStatus === 'active') return false
  return true
}

export function buildOrgSubdomainHostname(orgSlug: string, appDomain: string) {
  const normalizedOrgSlug = normalizeDomainHostname(orgSlug)
  const normalizedAppDomain = normalizeDomainHostname(appDomain)

  if (!normalizedOrgSlug || !normalizedAppDomain || normalizedAppDomain === 'localhost') {
    return null
  }

  return `${normalizedOrgSlug}.${normalizedAppDomain}`
}

export async function registerOrgPublicDomain(orgSlug: string) {
  if (getDomainProviderName() !== 'vercel') {
    return null
  }

  const config = useRuntimeConfig()
  const hostname = buildOrgSubdomainHostname(orgSlug, String(config.public.appDomain || 'localhost'))
  if (!hostname) {
    return null
  }

  return getDomainProvider().registerProjectDomain({ hostname })
}

export async function registerOrgPublicDomainBestEffort(orgSlug: string, context: Record<string, unknown> = {}) {
  try {
    await registerOrgPublicDomain(orgSlug)
  } catch (error) {
    logger.error('Failed to register generated workspace public domain', {
      orgSlug,
      ...context,
      error: error instanceof Error ? error.message : error,
    })
  }
}

type ProviderRef = { providerDomainId?: string | null }

export async function registerProjectCustomDomain(hostname: string) {
  return getDomainProvider().registerProjectDomain({
    hostname: normalizeDomainHostname(hostname),
  })
}

export async function getProjectCustomDomainStatus(hostname: string, ref: ProviderRef = {}) {
  return getDomainProvider().getProjectDomainStatus({
    hostname: normalizeDomainHostname(hostname),
    providerDomainId: ref.providerDomainId,
  })
}

export async function verifyProjectCustomDomain(hostname: string, ref: ProviderRef = {}) {
  return getDomainProvider().verifyProjectDomain({
    hostname: normalizeDomainHostname(hostname),
    providerDomainId: ref.providerDomainId,
  })
}

export async function removeProjectCustomDomain(hostname: string, ref: ProviderRef = {}) {
  return getDomainProvider().removeProjectDomain({
    hostname: normalizeDomainHostname(hostname),
    providerDomainId: ref.providerDomainId,
  })
}
