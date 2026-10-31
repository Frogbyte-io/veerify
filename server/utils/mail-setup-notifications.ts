/**
 * Emails to project admins about the custom-domain email setup:
 *
 * - "One more DNS record to add" when a domain's receiving reaches `pending_mx`. Sent once per
 *   domain: `mx_notice_sent_at` is claimed with a guarded update before anything is sent.
 * - Forwarding paused / resumed for the month (`mail-forward-usage.ts`). Those are sent only by
 *   the pass whose guarded update actually changed the domain, so they are once per transition.
 *
 * Mail goes through the system channel (`sendEmail` default). A failed send is logged and never
 * fails the caller.
 */
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { member, user } from '~/server/database/schema/auth'
import { project, projectMember } from '~/server/database/schema/feedback'
import { projectMailDomain } from '~/server/database/schema/support'
import { sendMailDomainMxNeededEmail, sendMailForwardingPausedEmail, sendMailForwardingResumedEmail } from '~/lib/email'
import type { SendingDomainDnsRecord } from '~/lib/support-sending-domains'
import { createLogger } from '~/server/utils/logger'

const logger = createLogger('mail-setup-notifications')

export interface ProjectAdminRecipient {
  email: string
  name: string | null
}

/** Where the notices link: Project settings → Email. */
export function emailSettingsUrl(): string {
  const base = (process.env.BETTER_AUTH_URL || '').trim().replace(/\/$/, '')
  return `${base}/project/settings?tab=email`
}

/** Workspace owners/admins plus project members with the `admin` role, deduplicated by email. */
export async function listProjectAdminRecipients(projectId: string): Promise<{
  projectName: string
  recipients: ProjectAdminRecipient[]
} | null> {
  const [proj] = await db
    .select({ id: project.id, name: project.name, organizationId: project.organizationId })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1)
  if (!proj) return null

  const rows = await db
    .selectDistinct({ email: user.email, name: user.name })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(projectMember, and(eq(projectMember.userId, member.userId), eq(projectMember.projectId, proj.id)))
    .where(
      and(
        eq(member.organizationId, proj.organizationId),
        or(inArray(member.role, ['owner', 'admin']), eq(projectMember.role, 'admin'))
      )
    )

  const seen = new Set<string>()
  const recipients: ProjectAdminRecipient[] = []
  for (const row of rows) {
    const email = row.email?.trim().toLowerCase()
    if (!email || seen.has(email)) continue
    seen.add(email)
    recipients.push({ email: row.email, name: row.name ?? null })
  }
  return { projectName: proj.name, recipients }
}

export interface NotificationDeps {
  listRecipients?: typeof listProjectAdminRecipients
  sendMxNeeded?: typeof sendMailDomainMxNeededEmail
  sendPaused?: typeof sendMailForwardingPausedEmail
  sendResumed?: typeof sendMailForwardingResumedEmail
  /** Atomically marks the MX notice as sent; true only for the caller that set it. */
  claimMxNotice?: (domainId: string, now: Date) => Promise<boolean>
  now?: Date
}

async function claimMxNoticeInDb(domainId: string, now: Date): Promise<boolean> {
  const claimed = await db
    .update(projectMailDomain)
    .set({ mxNoticeSentAt: now })
    .where(and(eq(projectMailDomain.id, domainId), isNull(projectMailDomain.mxNoticeSentAt)))
    .returning({ id: projectMailDomain.id })
  return claimed.length > 0
}

async function sendToAll(
  recipients: ProjectAdminRecipient[],
  send: (to: string) => Promise<unknown>,
  context: Record<string, unknown>
): Promise<number> {
  let sent = 0
  for (const recipient of recipients) {
    try {
      await send(recipient.email)
      sent += 1
    } catch (error) {
      logger.warn('Could not send a mail setup notice', {
        ...context,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return sent
}

/**
 * Tell the project's admins that the MX record is the one record left. Returns the number of
 * emails sent: 0 when another pass (or an earlier one) already sent the notice.
 */
export async function notifyMxRecordNeeded(
  row: {
    id: string
    projectId: string
    domain: string
    mxNoticeSentAt?: Date | null
    dnsRecords?: SendingDomainDnsRecord[] | null
    existingMxHosts?: string[] | null
  },
  deps: NotificationDeps = {}
): Promise<number> {
  if (row.mxNoticeSentAt) return 0
  const now = deps.now ?? new Date()
  try {
    if (!(await (deps.claimMxNotice ?? claimMxNoticeInDb)(row.id, now))) return 0
    const target = await (deps.listRecipients ?? listProjectAdminRecipients)(row.projectId)
    if (!target || target.recipients.length === 0) return 0
    const mxRecord = (row.dnsRecords ?? []).find((record) => record.purpose === 'receiving' && record.type === 'MX')
    const send = deps.sendMxNeeded ?? sendMailDomainMxNeededEmail
    return await sendToAll(
      target.recipients,
      (to) =>
        send({
          to,
          projectName: target.projectName,
          domain: row.domain,
          mx: mxRecord ? { host: mxRecord.name, value: mxRecord.value, priority: mxRecord.priority ?? null } : null,
          existingMxHosts: row.existingMxHosts ?? null,
          settingsUrl: emailSettingsUrl(),
        }),
      { domainId: row.id, notice: 'mx_needed' }
    )
  } catch (error) {
    logger.warn('MX notice failed', { domainId: row.id, error: error instanceof Error ? error.message : error })
    return 0
  }
}

/** Email the admins of each project that just had forwarding paused or resumed. */
export async function notifyForwardingChange(
  change: 'paused' | 'resumed',
  projectIds: string[],
  opts: { forwardsPerMonth: number },
  deps: NotificationDeps = {}
): Promise<number> {
  let sent = 0
  for (const projectId of [...new Set(projectIds)]) {
    try {
      const target = await (deps.listRecipients ?? listProjectAdminRecipients)(projectId)
      if (!target) continue
      const settingsUrl = emailSettingsUrl()
      const sendPaused = deps.sendPaused ?? sendMailForwardingPausedEmail
      const sendResumed = deps.sendResumed ?? sendMailForwardingResumedEmail
      sent += await sendToAll(
        target.recipients,
        (to) =>
          change === 'paused'
            ? sendPaused({ to, projectName: target.projectName, forwardsPerMonth: opts.forwardsPerMonth, settingsUrl })
            : sendResumed({ to, projectName: target.projectName, settingsUrl }),
        { projectId, notice: `forwarding_${change}` }
      )
    } catch (error) {
      logger.warn('Forwarding notice failed', { projectId, error: error instanceof Error ? error.message : error })
    }
  }
  return sent
}
