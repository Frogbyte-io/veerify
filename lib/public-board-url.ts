type PublicBoardUrlProject = {
  slug?: string | null
  customDomain?: string | null
  settings?: Record<string, unknown> | null
  team?: {
    slug?: string | null
  } | null
}

type PublicBoardUrlInput = {
  project?: PublicBoardUrlProject | null
  teamSlug?: string | null
  projectSlug?: string | null
  appDomain: string
  protocol: string
  port?: string | null
}

function normalizeProtocol(protocol: string) {
  return protocol.endsWith(':') ? protocol : `${protocol}:`
}

function buildPortSuffix(port?: string | null) {
  return port && port !== '80' && port !== '443' ? `:${port}` : ''
}

function isActiveCustomDomain(project?: PublicBoardUrlProject | null) {
  return Boolean(project?.customDomain && project?.settings?.domainStatus === 'active')
}

export function buildPublicBoardUrl(input: PublicBoardUrlInput) {
  const projectSlug = input.projectSlug || input.project?.slug || '...'
  const protocol = normalizeProtocol(input.protocol)
  const portSuffix = buildPortSuffix(input.port)

  if (isActiveCustomDomain(input.project)) {
    return `${protocol}//${input.project!.customDomain}${portSuffix}`
  }

  const teamSlug = input.teamSlug || input.project?.team?.slug || '...'
  return `${protocol}//${teamSlug}.${input.appDomain}${portSuffix}/${projectSlug}`
}
