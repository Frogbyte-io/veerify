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
 *
 * An agent can also pick one of those addresses explicitly (`fromAddressId` on
 * a reply); `resolveSendFromAddress` applies the same rule and says why an
 * address does not qualify.
 */
import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { projectMailAddress, projectMailDomain } from '~/server/database/schema/support'
import { isCatchAllAddress, splitMailAddress } from '~/lib/mail-address'

type Executor = Pick<typeof db, 'select'>

export interface SendFromAddressRow {
  address: string
  kind: string
  inboxId: string
  projectId: string
}

export type SendFromAddressRejection = 'NOT_IN_INBOX' | 'NOT_CUSTOM' | 'CATCH_ALL' | 'DOMAIN_NOT_VERIFIED'

export const SEND_FROM_REJECTION_MESSAGES: Record<SendFromAddressRejection, string> = {
  NOT_IN_INBOX: 'That address does not belong to this inbox',
  NOT_CUSTOM: 'Only an address you added yourself can be used to send from, not a platform forwarding address',
  CATCH_ALL: 'A catch-all address cannot be used to send from',
  DOMAIN_NOT_VERIFIED: "That address's domain is not a verified email domain of this project",
}

/** The project's verified mail domains, lowercase, as a set. */
export async function loadVerifiedMailDomains(projectId: string, executor: Executor = db): Promise<Set<string>> {
  const rows = await executor
    .select({ domain: projectMailDomain.domain })
    .from(projectMailDomain)
    .where(and(eq(projectMailDomain.projectId, projectId), eq(projectMailDomain.status, 'verified')))
  return new Set(rows.map((row) => row.domain))
}

/**
 * Why `row` cannot be used to send from on `inboxId`, or null when it can. Pure:
 * the address is matched by its own domain rather than `domainId`, so addresses
 * created before that column existed qualify too.
 */
export function sendFromRejection(
  row: SendFromAddressRow,
  inboxId: string,
  verifiedDomains: ReadonlySet<string>
): SendFromAddressRejection | null {
  if (row.inboxId !== inboxId) return 'NOT_IN_INBOX'
  if (row.kind !== 'custom') return 'NOT_CUSTOM'
  if (isCatchAllAddress(row.address)) return 'CATCH_ALL'
  const domain = splitMailAddress(row.address)?.domain
  if (!domain || !verifiedDomains.has(domain)) return 'DOMAIN_NOT_VERIFIED'
  return null
}

/** The address to send from for `mailAddressId`, or why it does not qualify. */
export async function resolveSendFromAddress(
  mailAddressId: string,
  inboxId: string,
  executor: Executor = db
): Promise<{ ok: true; address: string } | { ok: false; reason: SendFromAddressRejection }> {
  const [row] = await executor
    .select({
      address: projectMailAddress.address,
      kind: projectMailAddress.kind,
      inboxId: projectMailAddress.inboxId,
      projectId: projectMailAddress.projectId,
    })
    .from(projectMailAddress)
    .where(eq(projectMailAddress.id, mailAddressId))
    .limit(1)
  if (!row) return { ok: false, reason: 'NOT_IN_INBOX' }
  const reason = sendFromRejection(row, inboxId, await loadVerifiedMailDomains(row.projectId, executor))
  return reason ? { ok: false, reason } : { ok: true, address: row.address }
}

export async function resolveConversationSender(
  input: {
    inboxId: string
    inboxEmailAddress: string | null
    mailAddressId: string | null | undefined
  },
  executor: Executor = db
): Promise<string | null> {
  if (input.mailAddressId) {
    const resolved = await resolveSendFromAddress(input.mailAddressId, input.inboxId, executor)
    if (resolved.ok) return resolved.address
  }
  return input.inboxEmailAddress
}
