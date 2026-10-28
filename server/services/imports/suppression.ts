/**
 * Marketing email suppression as seen by imports. Contact erasure (`eraseContact`) leaves a suppression row with the
 * address's keyed hash as the durable trace of the person. An import must not bring that person's data back, so a NEW
 * imported person whose email is suppressed in the organization is created already tombstoned (no name, email or
 * avatar; `erasedAt` set). The preview and the commit use the same check.
 */
import { and, eq, inArray, or } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import { marketingEmailSuppression } from '~/server/database/schema/marketing'
import { hashEmailCandidates, normalizeMarketingEmail } from '~/server/utils/marketing-email-hash'

type Executor = Pick<typeof db, 'select'>

const CHUNK = 1000

export async function organizationOfProject(projectId: string, executor: Executor = db): Promise<string | null> {
  const [row] = await executor
    .select({ organizationId: project.organizationId })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1)
  return row?.organizationId ?? null
}

/** The given emails (normalized: trimmed, lower case) that are suppressed in the organization, by address or hash. */
export async function suppressedEmails(
  organizationId: string | null,
  emails: readonly (string | null | undefined)[],
  executor: Executor = db
): Promise<Set<string>> {
  const suppressed = new Set<string>()
  if (!organizationId) return suppressed
  const unique = [...new Set(emails.filter((e): e is string => !!e).map(normalizeMarketingEmail))]
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK)
    const inChunk = new Set(chunk)
    const emailByHash = new Map<string, string>()
    for (const email of chunk) for (const hash of hashEmailCandidates(email)) emailByHash.set(hash, email)
    const rows = await executor
      .select({ email: marketingEmailSuppression.email, emailHash: marketingEmailSuppression.emailHash })
      .from(marketingEmailSuppression)
      .where(
        and(
          eq(marketingEmailSuppression.organizationId, organizationId),
          or(
            inArray(marketingEmailSuppression.email, chunk),
            inArray(marketingEmailSuppression.emailHash, [...emailByHash.keys()])
          )
        )
      )
    for (const row of rows) {
      const byEmail = normalizeMarketingEmail(row.email)
      if (inChunk.has(byEmail)) suppressed.add(byEmail)
      const byHash = row.emailHash ? emailByHash.get(row.emailHash) : undefined
      if (byHash) suppressed.add(byHash)
    }
  }
  return suppressed
}

export async function isEmailSuppressed(
  organizationId: string | null,
  email: string | null | undefined,
  executor: Executor = db
): Promise<boolean> {
  if (!email) return false
  return (await suppressedEmails(organizationId, [email], executor)).size > 0
}
