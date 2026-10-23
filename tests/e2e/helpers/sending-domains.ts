import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { supportSendingDomain } from '../../../server/database/schema/index'
import { db } from './db'

/**
 * Give a team a verified sending-domain claim on `domain` (default
 * `example.com`), so specs that send replies keep working when the suite runs
 * with `SUPPORT_SENDING_DOMAINS_ENABLED=true` (team sender policy). The claim
 * matches the fake provider's identity (`fake` / `fake-account`). Idempotent;
 * throws if another team already owns the domain.
 */
export async function ensureVerifiedSendingDomain(teamId: string, domain = 'example.com'): Promise<void> {
  const now = new Date()
  await db
    .insert(supportSendingDomain)
    .values({
      id: `e2e_sd_${randomUUID()}`,
      teamId,
      domain,
      registrableDomain: domain,
      status: 'verified',
      provider: 'fake',
      providerAccountKey: 'fake-account',
      providerOwnership: 'adopted',
      providerState: 'active',
      ownershipToken: `e2e-${randomUUID()}`,
      ownershipVerifiedAt: now,
      verifiedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: supportSendingDomain.domain })

  const [row] = await db
    .select({ teamId: supportSendingDomain.teamId })
    .from(supportSendingDomain)
    .where(eq(supportSendingDomain.domain, domain))
  if (row?.teamId !== teamId) {
    throw new Error(`E2E sending domain ${domain} is owned by another team`)
  }
}
