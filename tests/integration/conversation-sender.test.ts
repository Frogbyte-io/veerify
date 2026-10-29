import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { db } from '../../server/database/drizzle'
import { organization } from '../../server/database/schema/auth'
import { project } from '../../server/database/schema/feedback'
import { projectMailAddress, projectMailDomain, supportInbox } from '../../server/database/schema/support'
import { resolveConversationSender } from '../../server/utils/conversation-sender'

const run = randomUUID().slice(0, 8)
const ids = {
  org: `sender_org_${run}`,
  project: `sender_project_${run}`,
  inbox: `sender_inbox_${run}`,
  otherInbox: `sender_inbox2_${run}`,
  verified: `sender_domain_v_${run}`,
  pending: `sender_domain_p_${run}`,
}
const verifiedDomain = `verified-${run}.test`
const pendingDomain = `pending-${run}.test`
const inboxAddress = `support@${verifiedDomain}`

async function address(values: { address: string; domainId?: string | null; inboxId?: string; kind?: string }) {
  const id = `sender_address_${randomUUID()}`
  await db.insert(projectMailAddress).values({
    id,
    inboxId: values.inboxId ?? ids.inbox,
    projectId: ids.project,
    address: values.address,
    kind: values.kind ?? 'custom',
    domainId: values.domainId ?? null,
  })
  return id
}

const resolve = (mailAddressId: string | null) =>
  resolveConversationSender({ inboxId: ids.inbox, inboxEmailAddress: inboxAddress, mailAddressId })

beforeAll(async () => {
  await db.insert(organization).values({ id: ids.org, name: 'Sender Org', slug: `sender-${run}` })
  await db.insert(project).values({ id: ids.project, name: 'Sender', slug: `sender-${run}`, organizationId: ids.org })
  await db.insert(supportInbox).values([
    { id: ids.inbox, projectId: ids.project, name: 'Main', slug: `main-${run}`, emailAddress: inboxAddress },
    { id: ids.otherInbox, projectId: ids.project, name: 'Other', slug: `other-${run}` },
  ])
  await db.insert(projectMailDomain).values([
    {
      id: ids.verified,
      projectId: ids.project,
      domain: verifiedDomain,
      registrableDomain: verifiedDomain,
      status: 'verified',
      provider: 'mailgun',
      ownershipToken: 'tok',
    },
    {
      id: ids.pending,
      projectId: ids.project,
      domain: pendingDomain,
      registrableDomain: pendingDomain,
      status: 'pending',
      provider: 'mailgun',
      ownershipToken: 'tok',
    },
  ])
})

afterAll(async () => {
  await db.delete(organization).where(eq(organization.id, ids.org))
})

describe('resolveConversationSender (real Postgres)', () => {
  it('replies from the receiving address on a verified project domain', async () => {
    const id = await address({ address: `hello@${verifiedDomain}`, domainId: ids.verified })
    expect(await resolve(id)).toBe(`hello@${verifiedDomain}`)
  })

  it('falls back to the inbox address otherwise', async () => {
    const pending = await address({ address: `hello@${pendingDomain}`, domainId: ids.pending })
    const catchAll = await address({ address: `*@${verifiedDomain}`, domainId: ids.verified })
    const forwardedIn = await address({ address: `help-${run}@gmail.example` })
    const otherInbox = await address({
      address: `sales@${verifiedDomain}`,
      domainId: ids.verified,
      inboxId: ids.otherInbox,
    })

    expect(await resolve(pending)).toBe(inboxAddress)
    expect(await resolve(catchAll)).toBe(inboxAddress)
    expect(await resolve(forwardedIn)).toBe(inboxAddress)
    expect(await resolve(otherInbox)).toBe(inboxAddress)
    expect(await resolve(null)).toBe(inboxAddress)
  })

  it('returns null when nothing qualifies and the inbox has no sending address', async () => {
    expect(
      await resolveConversationSender({ inboxId: ids.otherInbox, inboxEmailAddress: null, mailAddressId: null })
    ).toBeNull()
  })
})
