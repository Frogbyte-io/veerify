type PublicBoardUrlProject = {
  slug?: string | null
  customDomain?: string | null
  settings?: Record<string, unknown> | null
}

type PublicBoardUrlInput = {
  orgSlug?: string | null
  projectSlug?: string | null
  /** Link to one product's board: `/<project>/<product>` (custom domain: `/<product>`) */
  productSlug?: string | null
  /**
   * A custom domain that is already verified/active. Takes precedence over the
   * workspace subdomain. The project's board then lives at the domain root.
   */
  customDomain?: string | null
  /**
   * Alternative to `customDomain`: the project row. Its `customDomain` is used
   * only when `settings.domainStatus === 'active'`.
   */
  project?: PublicBoardUrlProject | null
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

function resolveActiveCustomDomain(input: PublicBoardUrlInput): string | null {
  if (input.customDomain) return input.customDomain
  const project = input.project
  if (project?.customDomain && project.settings?.domainStatus === 'active') return project.customDomain
  return null
}

/**
 * Public URL of a project's board (or of one product's board). No trailing slash.
 *
 *   custom domain:       https://feedback.acme.com[/<product>]
 *   workspace subdomain: https://<org>.<appDomain>/<project>[/<product>]
 */
export function buildPublicBoardUrl(input: PublicBoardUrlInput) {
  const projectSlug = input.projectSlug || input.project?.slug || '...'
  const protocol = normalizeProtocol(input.protocol)
  const portSuffix = buildPortSuffix(input.port)
  const productPart = input.productSlug ? `/${input.productSlug}` : ''

  const customDomain = resolveActiveCustomDomain(input)
  if (customDomain) {
    return `${protocol}//${customDomain}${portSuffix}${productPart}`
  }

  const orgSlug = input.orgSlug || '...'
  return `${protocol}//${orgSlug}.${input.appDomain}${portSuffix}/${projectSlug}${productPart}`
}
