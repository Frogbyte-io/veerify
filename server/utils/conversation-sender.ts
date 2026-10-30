/**
 * The From address for mail Veerify sends on a conversation (agent replies,
 * auto-replies, CSAT surveys).
 *
 * A conversation that arrived on one of the project's own addresses replies
 * from that address, so `hello@newsite.com` answers as `hello@newsite.com`.
 * That only applies to a custom, non-catch-all address on the same inbox whose
 * domain is a verified project mail domain: anything else (a catch-all, a
 * platform forwarding address, an address forwarded in from Google Workspace,
 * an address since moved to another inbox) falls back to the inbox's sending
 * address. Callers still run the project sender policy on the result.
 * See docs/plans/2026-10-28-email-addresses/design.md → Decisions → Replies.
 */
import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { projectMailAddress, projectMailDomain } from '~/server/database/schema/support'
import { isCatchAllAddress, splitMailAddress } from '~/lib/mail-address'

export async function resolveConversationSender(
  input: {
    inboxId: string
    inboxEmailAddress: string | null
    mailAddressId: string | null | undefined
  },
  executor: Pick<typeof db, 'select'> = db
): Promise<string | null> {
  if (input.mailAddressId) {
    const [row] = await executor
      .select({
        address: projectMailAddress.address,
        kind: projectMailAddress.kind,
        inboxId: projectMailAddress.inboxId,
        projectId: projectMailAddress.projectId,
      })
      .from(projectMailAddress)
      .where(eq(projectMailAddress.id, input.mailAddressId))
      .limit(1)
    const domain = row ? splitMailAddress(row.address)?.domain : undefined
    if (row && domain && row.kind === 'custom' && row.inboxId === input.inboxId && !isCatchAllAddress(row.address)) {
      // Matched by the address's own domain rather than `domainId`, so addresses
      // created before that column existed qualify too.
      const [verified] = await executor
        .select({ id: projectMailDomain.id })
        .from(projectMailDomain)
        .where(
          and(
            eq(projectMailDomain.projectId, row.projectId),
            eq(projectMailDomain.domain, domain),
            eq(projectMailDomain.status, 'verified')
          )
        )
        .limit(1)
      if (verified) return row.address
    }
  }
  return input.inboxEmailAddress
}
