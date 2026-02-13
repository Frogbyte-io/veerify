/**
 * Create Organization Endpoint
 * Creates a new organization
 *
 * @openapi
 * /api/orgs:
 *   post:
 *     tags: [Organizations]
 *     summary: Create organization
 *     description: Creates a new organization and makes the current user an owner
 *     operationId: createOrganization
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - slug
 *             properties:
 *               name:
 *                 type: string
 *                 description: Organization name
 *                 example: Acme Inc.
 *               slug:
 *                 type: string
 *                 description: URL-friendly unique identifier
 *                 pattern: ^[a-z0-9-]+$
 *                 example: acme-inc
 *               logo:
 *                 type: string
 *                 format: uri
 *                 description: Organization logo URL
 *                 nullable: true
 *     responses:
 *       201:
 *         description: Organization created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Organization'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       409:
 *         description: Organization slug already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       501:
 *         description: Not implemented
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */

import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { validateBody, commonSchemas } from '~/server/utils/validation'
import { requireRateLimit, rateLimits } from '~/server/utils/rate-limit'
import { db } from '~/server/database/drizzle'
import { member, organization, session as sessionTable, team, teamMember } from '~/server/database/schema/auth'
import { assertOrganizationSlugAvailable } from '~/server/utils/organization-access'
import { DEFAULT_TEAM_NAME } from '~/server/utils/team-context'

const createOrganizationSchema = z.object({
  name: z.string()
    .min(1, 'Organization name is required')
    .max(100, 'Organization name too long'),
  slug: commonSchemas.slug,
  logo: commonSchemas.url.optional().nullable()
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  await requireRateLimit(event, rateLimits.standard)
  const body = await validateBody(event, createOrganizationSchema)

  await assertOrganizationSlugAvailable(body.slug)

  const ownedOrganizations = await db
    .select()
    .from(member)
    .where(and(eq(member.userId, session.user.id), eq(member.role, 'owner')))

  const ORGANIZATION_LIMIT = 5
  if (ownedOrganizations.length >= ORGANIZATION_LIMIT) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(
        ErrorCode.CONFLICT,
        `Organization limit reached (${ORGANIZATION_LIMIT}).`
      )
    })
  }

  const now = new Date()
  const organizationId = randomUUID()
  const defaultTeamId = randomUUID()

  const createdOrganization = await db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organization)
      .values({
        id: organizationId,
        name: body.name.trim(),
        slug: body.slug,
        logo: body.logo ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    await tx.insert(member).values({
      id: randomUUID(),
      organizationId,
      userId: session.user.id,
      role: 'owner',
      createdAt: now,
      updatedAt: now,
    })

    await tx.insert(team).values({
      id: defaultTeamId,
      name: DEFAULT_TEAM_NAME,
      slug: body.slug,
      organizationId,
      createdAt: now,
      updatedAt: now,
    })

    await tx.insert(teamMember).values({
      id: randomUUID(),
      teamId: defaultTeamId,
      userId: session.user.id,
      createdAt: now,
    })

    await tx
      .update(sessionTable)
      .set({
        activeOrganizationId: organizationId,
        activeTeamId: defaultTeamId,
      })
      .where(eq(sessionTable.token, session.session.token))

    return org
  })

  setResponseStatus(event, 201)

  return createSuccessResponse({
    ...createdOrganization,
    defaultTeamId,
  })
})
