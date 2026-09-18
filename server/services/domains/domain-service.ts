import { parse } from 'tldts'
import { normalizeDomainHostname, type DomainProviderResult } from './provider'
import { StaticCnameDomainProvider } from './providers/static-cname'
import { VercelDomainProvider } from './providers/vercel'
import { createLogger } from '../../utils/logger'

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

function getDomainProvider() {
  const config = useRuntimeConfig()
  const provider = String(config.domainProvider || 'static-cname')
    .trim()
    .toLowerCase()

  if (provider === 'vercel') {
    return new VercelDomainProvider()
  }

  return new StaticCnameDomainProvider()
}

function getDomainProviderName() {
  const config = useRuntimeConfig()
  return String(config.domainProvider || 'static-cname')
    .trim()
    .toLowerCase()
}

export function buildTeamSubdomainHostname(teamSlug: string, appDomain: string) {
  const normalizedTeamSlug = normalizeDomainHostname(teamSlug)
  const normalizedAppDomain = normalizeDomainHostname(appDomain)

  if (!normalizedTeamSlug || !normalizedAppDomain || normalizedAppDomain === 'localhost') {
    return null
  }

  return `${normalizedTeamSlug}.${normalizedAppDomain}`
}

export async function registerTeamPublicDomain(teamSlug: string) {
  if (getDomainProviderName() !== 'vercel') {
    return null
  }

  const config = useRuntimeConfig()
  const hostname = buildTeamSubdomainHostname(teamSlug, String(config.public.appDomain || 'localhost'))
  if (!hostname) {
    return null
  }

  return getDomainProvider().registerProjectDomain({ hostname })
}

export async function registerTeamPublicDomainBestEffort(teamSlug: string, context: Record<string, unknown> = {}) {
  try {
    await registerTeamPublicDomain(teamSlug)
  } catch (error) {
    logger.error('Failed to register generated team public domain', {
      teamSlug,
      ...context,
      error: error instanceof Error ? error.message : error,
    })
  }
}

export async function registerProjectCustomDomain(hostname: string) {
  return getDomainProvider().registerProjectDomain({
    hostname: normalizeDomainHostname(hostname),
  })
}

export async function getProjectCustomDomainStatus(hostname: string) {
  return getDomainProvider().getProjectDomainStatus({
    hostname: normalizeDomainHostname(hostname),
  })
}

export async function verifyProjectCustomDomain(hostname: string) {
  return getDomainProvider().verifyProjectDomain({
    hostname: normalizeDomainHostname(hostname),
  })
}

export async function removeProjectCustomDomain(hostname: string) {
  return getDomainProvider().removeProjectDomain({
    hostname: normalizeDomainHostname(hostname),
  })
}
