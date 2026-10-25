import { eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { organization } from '~/server/database/schema/auth'
import { buildPublicBoardUrl } from '~/lib/public-board-url'

/** The workspace slug that forms the default public subdomain; null when the workspace is gone. */
export async function getOrganizationSlug(organizationId: string): Promise<string | null> {
  const [row] = await db
    .select({ slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)
  return row?.slug ?? null
}

/**
 * Public base URL of a project's site (custom domain once active, otherwise
 * `<org-slug>.<app domain>/<project-slug>`). `requestUrl` supplies protocol and port.
 */
export function buildMarketingPublicUrl(
  project: { slug: string; customDomain: string | null; settings: unknown },
  orgSlug: string | null,
  requestUrl?: URL
): string {
  const origin = requestUrl ?? new URL(process.env.BETTER_AUTH_URL || 'http://localhost:3000')
  const settings = project.settings as Record<string, unknown> | null
  return buildPublicBoardUrl({
    orgSlug,
    projectSlug: project.slug,
    customDomain: project.customDomain && settings?.domainStatus === 'active' ? project.customDomain : null,
    appDomain: useRuntimeConfig().public.appDomain || 'localhost',
    protocol: origin.protocol,
    port: origin.port,
  })
}
