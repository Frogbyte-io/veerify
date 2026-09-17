/**
 * @openapi
 * /api/support/teams/{teamId}/sla:
 *   put:
 *     tags: [Support]
 *     summary: Upsert business-hours and SLA policy settings
 *     operationId: updateSupportSlaSettings
 *     parameters:
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: SLA settings updated }
 *       400: { description: Invalid SLA settings }
 *       403: { description: Team administrator required }
 */
import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { createError } from 'h3'
import { createSuccessResponse, createErrorResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireTeamAdmin } from '~/server/utils/support-access'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { businessHours, slaPolicy, slaTarget } from '~/server/database/schema/support'
import { loadSlaSettings } from '~/server/utils/sla-settings'

const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/)
const windowSchema = z.object({ open: clock, close: clock })
const scheduleSchema = z.record(z.string(), z.array(windowSchema).max(4))
const bodySchema = z.object({
  businessHours: z
    .object({
      id: z.string().min(1).optional(),
      name: z.string().trim().min(1).max(100),
      timezone: z.string().trim().min(1).max(100),
      weeklySchedule: scheduleSchema,
      holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(366),
      isDefault: z.boolean().default(true),
    })
    .optional(),
  policies: z
    .array(
      z.object({
        id: z.string().min(1).optional(),
        name: z.string().trim().min(1).max(100),
        businessHoursId: z.string().min(1).nullable().optional(),
        conditions: z
          .object({
            inboxIds: z.array(z.string().min(1)).optional(),
            priorities: z.array(z.string().min(1)).optional(),
            tagIds: z.array(z.string().min(1)).optional(),
            companyIds: z.array(z.string().min(1)).optional(),
          })
          .default({}),
        escalation: z
          .object({
            notifyAssignee: z.boolean().optional(),
            notifySupervisor: z.boolean().optional(),
            raisePriority: z.enum(['low', 'normal', 'high', 'urgent']).nullable().optional(),
          })
          .default({}),
        isDefault: z.boolean().default(false),
        sortOrder: z.number().int().min(0).max(10000).default(0),
        targets: z
          .array(
            z.object({
              id: z.string().min(1).optional(),
              metric: z.enum(['first_response', 'next_response', 'resolution']),
              priority: z.string().min(1).nullable(),
              targetMinutes: z.number().int().min(1).max(525600),
            })
          )
          .max(12)
          .default([]),
      })
    )
    .max(100)
    .default([]),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const teamId = getRouterParam(event, 'teamId') as string
  await requireTeamAdmin(teamId, session.user.id)
  const body = await validateBody(event, bodySchema)
  const now = new Date()

  await db.transaction(async (tx) => {
    let businessHoursId: string | null = null
    if (body.businessHours) {
      businessHoursId = body.businessHours.id ?? randomUUID()
      if (body.businessHours.id) {
        const [owned] = await tx
          .select({ id: businessHours.id })
          .from(businessHours)
          .where(and(eq(businessHours.id, body.businessHours.id), eq(businessHours.teamId, teamId)))
          .limit(1)
        if (!owned) {
          throw createError({
            statusCode: 400,
            statusMessage: 'Bad Request',
            data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Business-hours schedule is not part of this team'),
          })
        }
      }
      const values = {
        id: businessHoursId,
        teamId,
        name: body.businessHours.name,
        timezone: body.businessHours.timezone,
        weeklySchedule: body.businessHours.weeklySchedule,
        holidays: body.businessHours.holidays,
        isDefault: body.businessHours.isDefault,
        createdAt: now,
        updatedAt: now,
      }
      if (body.businessHours.isDefault) {
        await tx.update(businessHours).set({ isDefault: false, updatedAt: now }).where(eq(businessHours.teamId, teamId))
      }
      await tx
        .insert(businessHours)
        .values(values)
        .onConflictDoUpdate({
          target: businessHours.id,
          set: {
            name: values.name,
            timezone: values.timezone,
            weeklySchedule: values.weeklySchedule,
            holidays: values.holidays,
            isDefault: values.isDefault,
            updatedAt: now,
          },
        })
    }

    const requestedHoursIds = body.policies
      .map((policy) => policy.businessHoursId)
      .filter((id): id is string => Boolean(id))
    if (requestedHoursIds.length > 0) {
      const ownedHours = await tx
        .select({ id: businessHours.id })
        .from(businessHours)
        .where(and(eq(businessHours.teamId, teamId), inArray(businessHours.id, requestedHoursIds)))
      const ownedIds = new Set(ownedHours.map((row) => row.id))
      if (requestedHoursIds.some((id) => id !== businessHoursId && !ownedIds.has(id))) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Bad Request',
          data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Business-hours schedule is not part of this team'),
        })
      }
    }

    const requestedPolicyIds = body.policies.map((policy) => policy.id).filter((id): id is string => Boolean(id))
    if (requestedPolicyIds.length > 0) {
      const ownedPolicies = await tx
        .select({ id: slaPolicy.id })
        .from(slaPolicy)
        .where(and(eq(slaPolicy.teamId, teamId), inArray(slaPolicy.id, requestedPolicyIds)))
      if (ownedPolicies.length !== new Set(requestedPolicyIds).size) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Bad Request',
          data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'SLA policy is not part of this team'),
        })
      }
    }

    for (const policy of body.policies) {
      const policyId = policy.id ?? randomUUID()
      const values = {
        id: policyId,
        teamId,
        name: policy.name,
        businessHoursId: policy.businessHoursId ?? (businessHoursId && policy.isDefault ? businessHoursId : null),
        conditions: policy.conditions,
        escalation: policy.escalation,
        isDefault: policy.isDefault,
        sortOrder: policy.sortOrder,
        createdAt: now,
        updatedAt: now,
      }
      if (policy.isDefault) {
        await tx.update(slaPolicy).set({ isDefault: false, updatedAt: now }).where(eq(slaPolicy.teamId, teamId))
      }
      await tx
        .insert(slaPolicy)
        .values(values)
        .onConflictDoUpdate({
          target: slaPolicy.id,
          set: {
            name: values.name,
            businessHoursId: values.businessHoursId,
            conditions: values.conditions,
            escalation: values.escalation,
            isDefault: values.isDefault,
            sortOrder: values.sortOrder,
            updatedAt: now,
          },
        })
      await tx.delete(slaTarget).where(eq(slaTarget.slaPolicyId, policyId))
      if (policy.targets.length > 0) {
        await tx.insert(slaTarget).values(
          policy.targets.map((target) => ({
            id: target.id ?? randomUUID(),
            slaPolicyId: policyId,
            metric: target.metric,
            priority: target.priority,
            targetMinutes: target.targetMinutes,
          }))
        )
      }
    }
  })

  return createSuccessResponse(await loadSlaSettings(teamId))
})
