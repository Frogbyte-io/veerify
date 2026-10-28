import { and, eq } from 'drizzle-orm'
import { getRequestURL, type H3Event } from 'h3'
import { db } from '~/server/database/drizzle'
import { organization } from '~/server/database/schema/auth'
import { project } from '~/server/database/schema/feedback'
import { buildPublicBoardUrl } from '~/lib/public-board-url'
import { appDomains } from '~/server/utils/public-host'
import { loadPublicProjectSnapshot, type PublicProjectSnapshot } from './snapshot'
import type { OrgProjectLink, ProjectUrls } from './render'

/** Request origin as the visitor sees it (TLS usually terminates at the proxy). */
export function requestOrigin(event: H3Event) {
  return getRequestURL(event, { xForwardedProto: true }).origin
}

function boardUrl(
  event: H3Event,
  orgSlug: string,
  proj: { slug: string; customDomain: string | null; settings: Record<string, unknown> | null }
) {
  const url = getRequestURL(event, { xForwardedProto: true })
  return buildPublicBoardUrl({
    project: proj,
    orgSlug,
    projectSlug: proj.slug,
    appDomain: appDomains().appDomain,
    protocol: url.protocol,
    port: url.port,
  })
}

export function projectUrls(event: H3Event, s: PublicProjectSnapshot): ProjectUrls {
  const base = boardUrl(event, s.organization.slug, s.project)
  return {
    base,
    rss: s.modules.changelogEnabled
      ? `${new URL(base).origin}/api/public/o/${s.organization.slug}/${s.project.slug}/changelog.rss`
      : null,
  }
}

/** Public snapshot and URLs of a project, or null when it does not exist or is not public. */
export async function loadPublicProjectContext(event: H3Event, orgSlug: string, projectSlug: string) {
  try {
    const snapshot = await loadPublicProjectSnapshot(orgSlug, projectSlug)
    return { snapshot, urls: projectUrls(event, snapshot) }
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode
    if (status === 403 || status === 404) return null
    throw error
  }
}

/** A workspace and its public projects, or null when the workspace does not exist. */
export async function loadPublicOrganization(event: H3Event, orgSlug: string) {
  const [org] = await db.select().from(organization).where(eq(organization.slug, orgSlug)).limit(1)
  if (!org) return null
  const projects = await db
    .select()
    .from(project)
    .where(and(eq(project.organizationId, org.id), eq(project.isPublic, true)))
    .orderBy(project.createdAt)
  const links: Array<OrgProjectLink & { slug: string }> = projects.map((p) => ({
    name: p.name,
    slug: p.slug,
    description: p.description,
    url: boardUrl(event, orgSlug, {
      slug: p.slug,
      customDomain: p.customDomain,
      settings: (p.settings as Record<string, unknown> | null) ?? null,
    }),
  }))
  return { organization: { name: org.name, slug: orgSlug }, projects: links }
}
