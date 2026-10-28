import { createHash, randomBytes } from 'node:crypto'
import { getHeader } from 'h3'
import type { H3Event } from 'h3'
import { and, count, eq, gt, isNull, or } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { organization, user } from '~/server/database/schema/auth'
import { userApiKey } from '~/server/database/schema/credentials'
import { project } from '~/server/database/schema/feedback'
import type { AuthSession } from '~/server/utils/auth-middleware'
import { getOrganizationRole, getProjectById, resolveProjectRole } from '~/server/utils/project-access'
import { createLogger } from '~/server/utils/logger'
import { requireRateLimit } from '~/server/utils/rate-limit'
import { ErrorCode, createErrorResponse } from '~/server/utils/response'

export const USER_KEY_PREFIX = 'vfy_usr_'
/** Maximum number of active (unrevoked, unexpired) personal API keys per user. */
export const MAX_ACTIVE_KEYS = 25

const RATE_LIMIT = { maxRequests: 600, windowSeconds: 60, identifier: 'user-api-key' }
/** `lastUsedAt` is only rewritten once it is older than this, to avoid a write per request. */
const LAST_USED_WRITE_INTERVAL_MS = 60_000

const log = createLogger('user-api-keys')

export function hashUserApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export function generateUserApiKey(): { key: string; keyPrefix: string; keyHash: string } {
  const key = USER_KEY_PREFIX + randomBytes(32).toString('base64url')
  return { key, keyPrefix: key.slice(0, 12), keyHash: hashUserApiKey(key) }
}

type Database = typeof db
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/** Counts the user's active keys: not revoked, and without an expiry or expiring in the future. */
export async function countActiveUserApiKeys(userId: string, tx: Database | Transaction = db): Promise<number> {
  const [active] = await tx
    .select({ count: count() })
    .from(userApiKey)
    .where(
      and(
        eq(userApiKey.userId, userId),
        isNull(userApiKey.revokedAt),
        or(isNull(userApiKey.expiresAt), gt(userApiKey.expiresAt, new Date()))
      )
    )
  return Number(active?.count ?? 0)
}

export function readBearerUserApiKey(event: H3Event): string | null {
  const header = event.node.req.headers.authorization
  if (typeof header !== 'string') return null
  const match = /^bearer\s+(.+)$/i.exec(header.trim())
  const token = match?.[1]?.trim()
  return token && token.startsWith(USER_KEY_PREFIX) ? token : null
}

function invalidKey() {
  return createError({
    statusCode: 401,
    statusMessage: 'Unauthorized',
    data: createErrorResponse(ErrorCode.UNAUTHORIZED, 'Invalid API key'),
  })
}

function forbidden(message: string) {
  return createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    data: createErrorResponse(ErrorCode.FORBIDDEN, message),
  })
}

function readContextHeader(event: H3Event, name: string): string | null {
  const value = getHeader(event, name)
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || null
}

/**
 * Resolves a `vfy_usr_` bearer token to the owning user's principal.
 * Returns null when the request carries no personal key. Context headers
 * (X-Veerify-Organization / X-Veerify-Project) override the stored context for
 * this request only, and only to places the user can actually open.
 */
export async function resolveUserApiKeyPrincipal(event: H3Event): Promise<AuthSession | null> {
  const token = readBearerUserApiKey(event)
  if (!token) return null

  const [found] = await db
    .select({ key: userApiKey, owner: user })
    .from(userApiKey)
    .innerJoin(user, eq(userApiKey.userId, user.id))
    .where(eq(userApiKey.keyHash, hashUserApiKey(token)))
    .limit(1)
  if (!found) throw invalidKey()

  const row = found.key
  const owner = found.owner
  if (row.revokedAt) throw invalidKey()
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) throw invalidKey()

  await requireRateLimit(event, { ...RATE_LIMIT, subject: row.id })

  let activeOrganizationId: string | undefined = row.activeOrganizationId ?? undefined
  let activeProjectId: string | null = row.activeProjectId ?? null

  let contextOverride = false
  let headerOrganizationId: string | null = null
  const orgHeader = readContextHeader(event, 'x-veerify-organization')
  if (orgHeader) {
    const [byId] = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, orgHeader))
      .limit(1)
    let org = byId
    if (!org) {
      ;[org] = await db
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.slug, orgHeader))
        .limit(1)
    }
    const role = org ? await getOrganizationRole(org.id, owner.id) : null
    if (!org || !role) throw forbidden('Organization not found or not accessible')
    activeOrganizationId = org.id
    headerOrganizationId = org.id
    contextOverride = true
    // A stored project from another workspace must not survive an org override.
    if (activeProjectId) {
      const stored = await getProjectById(activeProjectId)
      if (!stored || stored.organizationId !== org.id) activeProjectId = null
    }
  }

  const projectHeader = readContextHeader(event, 'x-veerify-project')
  if (projectHeader) {
    let proj = await getProjectById(projectHeader)
    if (!proj && activeOrganizationId) {
      const [bySlug] = await db
        .select()
        .from(project)
        .where(and(eq(project.organizationId, activeOrganizationId), eq(project.slug, projectHeader)))
        .limit(1)
      proj = bySlug ?? null
    }
    const role = proj ? await resolveProjectRole(proj, owner.id) : null
    if (!proj || !role) throw forbidden('Project not found or not accessible')
    if (headerOrganizationId && proj.organizationId !== headerOrganizationId) {
      throw forbidden('Project does not belong to the requested organization')
    }
    activeProjectId = proj.id
    activeOrganizationId = proj.organizationId
    contextOverride = true
  }

  // Fire-and-forget and throttled: a failed bookkeeping write must never fail the request.
  const lastUsedAt = row.lastUsedAt ? row.lastUsedAt.getTime() : null
  if (lastUsedAt === null || Date.now() - lastUsedAt >= LAST_USED_WRITE_INTERVAL_MS) {
    void Promise.resolve()
      .then(() => db.update(userApiKey).set({ lastUsedAt: new Date() }).where(eq(userApiKey.id, row.id)))
      .catch((error: unknown) => {
        log.warn('Failed to record API key use', { keyId: row.id, error })
      })
  }

  return {
    user: {
      id: owner.id,
      email: owner.email,
      name: owner.name,
      emailVerified: owner.emailVerified,
      image: owner.image ?? undefined,
      createdAt: owner.createdAt,
      updatedAt: owner.updatedAt,
    },
    session: {
      id: 'apikey:' + row.id,
      userId: owner.id,
      token: '',
      expiresAt: row.expiresAt ?? new Date(8.64e15),
      activeOrganizationId,
      activeProjectId,
    },
    credential: contextOverride
      ? { kind: 'user_api_key', id: row.id, contextOverride: true }
      : { kind: 'user_api_key', id: row.id },
  }
}
