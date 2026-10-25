import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { db } from '../../server/database/drizzle'
import { organization } from '../../server/database/schema/auth'

vi.stubGlobal('createError', createError)

const budget = await import('../../server/services/marketing/llm-budget')
const { getUsage, recordUsage } = await import('../../server/utils/marketing-usage')

const orgId = `spend_${randomUUID()}`

async function setCap(cents: number | null) {
  await db
    .update(organization)
    .set({ settings: cents == null ? {} : { [budget.WORKSPACE_SPEND_CAP_SETTING]: cents } })
    .where(eq(organization.id, orgId))
}

beforeAll(async () => {
  await db
    .insert(organization)
    .values({ id: orgId, name: 'Spend', slug: `spend-${randomUUID()}`, createdAt: new Date() })
})

afterAll(async () => {
  await db.delete(organization).where(eq(organization.id, orgId))
})

describe('workspace spend cap', () => {
  it('reads the cap from organization settings', async () => {
    await setCap(null)
    expect(await budget.getWorkspaceSpendCapCents(orgId)).toBeNull()
    await setCap(250)
    expect(await budget.getWorkspaceSpendCapCents(orgId)).toBe(250)
  })

  it('counts settled spend on every provider and refuses once the cap would be exceeded', async () => {
    await setCap(100) // $1.00
    await recordUsage(orgId, budget.costMetric('openai'), 600_000) // $0.60
    await recordUsage(orgId, budget.costMetric('anthropic'), 300_000) // $0.30
    expect(await budget.getWorkspaceSpentMicros(orgId)).toBe(900_000)

    // $0.20 more would reach $1.10
    const refused = await budget.reserveCallBudget(orgId, 'gemini', 200_000, null)
    expect(refused).toEqual({ ok: false, scope: 'workspace', reason: 'cap' })

    // $0.05 fits and is held until settled
    const held = await budget.reserveCallBudget(orgId, 'gemini', 50_000, null)
    expect(held).toEqual({ ok: true, hold: { providerMicros: 0, workspaceMicros: 50_000 } })
    let usage = await getUsage(orgId)
    expect(usage[budget.reservedMetric(budget.WORKSPACE_BUDGET_SCOPE)]).toBe(50_000)

    // While it is in flight, another $0.08 does not fit, but only because of the reservation
    const blocked = await budget.reserveCallBudget(orgId, 'openai', 80_000, null)
    expect(blocked).toEqual({ ok: false, scope: 'workspace', reason: 'in_flight' })

    if (!held.ok) throw new Error('expected a hold')
    await budget.settleCallBudget(orgId, 'gemini', held.hold, 40_000)
    usage = await getUsage(orgId)
    expect(usage[budget.reservedMetric(budget.WORKSPACE_BUDGET_SCOPE)]).toBe(0)
    expect(usage[budget.costMetric('gemini')]).toBe(40_000)
    expect(await budget.getWorkspaceSpentMicros(orgId)).toBe(940_000)
  })

  it('applies the key cap first and gives the workspace hold back on a provider refusal', async () => {
    await setCap(10_000) // plenty of room at workspace level
    const refused = await budget.reserveCallBudget(orgId, 'anthropic', 500_000, 50) // key cap $0.50, already $0.30 spent
    expect(refused).toEqual({ ok: false, scope: 'provider', reason: 'cap' })
    const usage = await getUsage(orgId)
    expect(usage[budget.reservedMetric(budget.WORKSPACE_BUDGET_SCOPE)] ?? 0).toBe(0)
    expect(usage[budget.reservedMetric('anthropic')] ?? 0).toBe(0)
  })

  it('releases both holds when a call spent nothing, and ignores the cap once removed', async () => {
    await setCap(10_000)
    const held = await budget.reserveCallBudget(orgId, 'anthropic', 100_000, 100)
    if (!held.ok) throw new Error('expected a hold')
    await budget.releaseCallBudget(orgId, 'anthropic', held.hold)
    const usage = await getUsage(orgId)
    expect(usage[budget.reservedMetric(budget.WORKSPACE_BUDGET_SCOPE)]).toBe(0)
    expect(usage[budget.reservedMetric('anthropic')]).toBe(0)

    await setCap(null)
    expect(await budget.reserveCallBudget(orgId, 'openai', 99_000_000, null)).toEqual({
      ok: true,
      hold: { providerMicros: 0, workspaceMicros: 0 },
    })
  })
})
