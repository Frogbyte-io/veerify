import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { db } from '../../server/database/drizzle'
import { organization, team } from '../../server/database/schema/auth'
import { supportCounter } from '../../server/database/schema/support'
import { allocateConversationDisplayId } from '../../server/utils/support-counter'

/**
 * The concurrency property `allocateConversationDisplayId` exists for -
 * `SELECT … FOR UPDATE` actually serializing racing transactions - can't be
 * exercised by the fake-tx unit tests in `tests/support-counter.test.ts`,
 * since those run one branch at a time on a single fake connection. This
 * needs a real Postgres connection pool with genuinely overlapping
 * transactions. Guarded like the Redis integration suite: skips cleanly when
 * no database is reachable.
 */

describe('allocateConversationDisplayId (real Postgres)', () => {
  const orgId = `org_counter_test_${randomUUID()}`
  const teamId = `team_counter_test_${randomUUID()}`

  beforeAll(async () => {
    await db.insert(organization).values({
      id: orgId,
      name: 'Support Counter Integration Test Org',
      slug: `support-counter-test-org-${randomUUID()}`,
    })
    await db.insert(team).values({
      id: teamId,
      name: 'Support Counter Integration Test Team',
      slug: `support-counter-test-team-${randomUUID()}`,
      organizationId: orgId,
    })
  })

  afterAll(async () => {
    // Cascades: organization -> team -> support_counter.
    await db.delete(organization).where(eq(organization.id, orgId))
  })

  it('allocates 100 distinct sequential displayIds under real concurrency, no duplicates or gaps', async () => {
    const allocations = await Promise.all(
      Array.from({ length: 100 }, () => db.transaction((tx) => allocateConversationDisplayId(tx, teamId)))
    )

    const sorted = [...allocations].sort((a, b) => a - b)
    expect(sorted).toEqual(Array.from({ length: 100 }, (_, i) => i + 1))

    const [counter] = await db.select().from(supportCounter).where(eq(supportCounter.teamId, teamId)).limit(1)
    expect(counter?.nextConversationDisplayId).toBe(101)
  })
})
