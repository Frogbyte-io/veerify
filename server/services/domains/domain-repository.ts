import { and, eq, ne, or } from 'drizzle-orm'
import { normalizeDomainHostname, type DomainProviderResult } from './provider'
import { db } from '~/server/database/drizzle'
import { project, projectDomain } from '~/server/database/schema/feedback'

type DomainDatabase = Pick<typeof db, 'insert' | 'update'>

export async function assertProjectDomainAvailable(hostname: string, projectId?: string) {
  const normalizedHostname = normalizeDomainHostname(hostname)
  const [existing] = await db
    .select({ projectId: projectDomain.projectId })
    .from(projectDomain)
    .where(
      and(
        eq(projectDomain.hostname, normalizedHostname),
        or(ne(projectDomain.status, 'detached'), eq(projectDomain.projectId, projectId || ''))
      )
    )
    .limit(1)

  if (existing && existing.projectId !== projectId) {
    throw createError({ statusCode: 409, statusMessage: 'This custom domain is already connected to another project' })
  }

  const [legacyProject] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.customDomain, normalizedHostname), projectId ? ne(project.id, projectId) : undefined))
    .limit(1)

  if (legacyProject) {
    throw createError({ statusCode: 409, statusMessage: 'This custom domain is already connected to another project' })
  }
}

export async function persistProjectDomainResult(
  projectId: string,
  result: DomainProviderResult,
  database: DomainDatabase = db
) {
  const now = new Date()
  const hostname = normalizeDomainHostname(result.hostname)

  await database
    .update(projectDomain)
    .set({ isPrimary: false, updatedAt: now })
    .where(and(eq(projectDomain.projectId, projectId), ne(projectDomain.hostname, hostname)))

  await database
    .insert(projectDomain)
    .values({
      id: crypto.randomUUID(),
      projectId,
      hostname,
      kind: 'custom_subdomain',
      provider: result.provider,
      status: result.status,
      isPrimary: true,
      verificationPayload: {
        configuredBy: result.configuredBy,
        expected: result.expected,
        resolvedTo: result.resolvedTo,
      },
      dnsRecords: result.dnsRecords,
      lastCheckedAt: now,
      activatedAt: result.verified ? now : null,
      errorMessage: result.status === 'error' ? result.message : null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: projectDomain.hostname,
      set: {
        projectId,
        provider: result.provider,
        status: result.status,
        isPrimary: true,
        verificationPayload: {
          configuredBy: result.configuredBy,
          expected: result.expected,
          resolvedTo: result.resolvedTo,
        },
        dnsRecords: result.dnsRecords,
        lastCheckedAt: now,
        activatedAt: result.verified ? now : null,
        errorMessage: result.status === 'error' ? result.message : null,
        updatedAt: now,
      },
    })
}

export async function detachProjectDomain(projectId: string, hostname: string, database: DomainDatabase = db) {
  await database
    .update(projectDomain)
    .set({ status: 'detached', isPrimary: false, updatedAt: new Date() })
    .where(and(eq(projectDomain.projectId, projectId), eq(projectDomain.hostname, normalizeDomainHostname(hostname))))
}
