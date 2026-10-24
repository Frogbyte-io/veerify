import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../../server/database/drizzle'
import { supportInbox } from '../../server/database/schema/support'
import { deleteOrganization, seedOrganization, seedProjectWithInbox, type SeededProject } from './helpers/sender-seed'

/**
 * Platform addresses with the real sending-domain rules: regeneration keeping
 * the inbox From valid (#15), and an operator who sets the platform mail domain
 * equal to APP_DOMAIN (`veerify.io`).
 */

const provider = vi.hoisted(() => ({
  current: { name: 'mailgun', accountKey: 'acct', capabilities: { authorizesSubdomains: true } },
}))
vi.mock('../../server/services/sending-domains', () => ({ getSendingDomainProvider: () => provider.current }))

const sendingDomains = await import('../../server/utils/sending-domains')
const { ensurePlatformAddress, findPlatformAddress } = await import('../../server/utils/platform-address')

const savedEnv = { ...process.env }
let orgId: string
let projectA: SeededProject
let projectB: SeededProject

async function inboxFrom(seed: SeededProject) {
  const [row] = await db
    .select({ emailAddress: supportInbox.emailAddress })
    .from(supportInbox)
    .where(eq(supportInbox.id, seed.inboxId))
  return row.emailAddress
}

async function rejection(promise: Promise<unknown>) {
  return (await promise.then(
    () => null,
    (e: unknown) => e
  )) as { statusCode?: number; data?: { code?: string } } | null
}

beforeAll(async () => {
  orgId = await seedOrganization('platreg')
  projectA = await seedProjectWithInbox(orgId, 'platrega', 'support@custom-a.example.net')
  projectB = await seedProjectWithInbox(orgId, 'platregb', 'support@custom-b.example.net')
})

afterAll(async () => {
  process.env = savedEnv
  await deleteOrganization(orgId)
})

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('SUPPORT_SENDING_DOMAINS_ENABLED', 'true')
  vi.stubEnv('SUPPORT_CHANNEL_PROVIDER', 'mailgun')
  vi.stubEnv('SUPPORT_MAILGUN_ACCOUNT_KEY', 'acct')
  vi.stubEnv('SUPPORT_PLATFORM_MAIL_DOMAIN', 'veerifymail.test')
})

const create = (seed: SeededProject, regenerate = false) =>
  db.transaction((tx) =>
    ensurePlatformAddress(tx, { id: seed.inboxId, slug: seed.inboxSlug, projectId: seed.projectId }, seed.projectSlug, {
      regenerate,
    })
  )

describe('regenerating the platform address', () => {
  it('moves the inbox From along when it was the old platform address, in the same transaction', async () => {
    const first = await create(projectA)
    await db.update(supportInbox).set({ emailAddress: first!.address }).where(eq(supportInbox.id, projectA.inboxId))

    const second = await create(projectA, true)

    expect(second!.address).not.toBe(first!.address)
    expect(await inboxFrom(projectA)).toBe(second!.address)
    expect((await findPlatformAddress(projectA.inboxId))!.address).toBe(second!.address)
    // The moved From still authorizes (the old address is gone, the new one is the project's platform address).
    expect(await sendingDomains.resolveProjectSenderAuthorization(projectA.projectId, second!.address)).toMatchObject({
      status: 'authorized',
      platform: true,
    })
  })

  it('leaves a custom From untouched', async () => {
    await create(projectB)
    await create(projectB, true)
    expect(await inboxFrom(projectB)).toBe('support@custom-b.example.net')
  })

  it('rolls the From back with the transaction when regeneration fails', async () => {
    const first = await create(projectB)
    await db.update(supportInbox).set({ emailAddress: first!.address }).where(eq(supportInbox.id, projectB.inboxId))

    await expect(
      db.transaction(async (tx) => {
        await ensurePlatformAddress(
          tx,
          { id: projectB.inboxId, slug: projectB.inboxSlug, projectId: projectB.projectId },
          projectB.projectSlug,
          {
            regenerate: true,
          }
        )
        throw new Error('abort')
      })
    ).rejects.toThrow('abort')

    expect(await inboxFrom(projectB)).toBe(first!.address)
    await db
      .update(supportInbox)
      .set({ emailAddress: 'support@custom-b.example.net' })
      .where(eq(supportInbox.id, projectB.inboxId))
  })
})

describe('platform mail domain equal to APP_DOMAIN', () => {
  beforeEach(() => {
    vi.stubEnv('SUPPORT_PLATFORM_MAIL_DOMAIN', 'veerify.io')
    vi.stubEnv('APP_DOMAIN', 'veerify.io')
  })

  it('lists the domain once as reserved', () => {
    const reserved = sendingDomains.reservedSendingDomains().filter((domain) => domain === 'veerify.io')
    expect(reserved).toEqual(['veerify.io'])
  })

  it('refuses a customer claim of the domain and of its subdomains', async () => {
    for (const domain of ['veerify.io', 'mail.veerify.io', 'a.b.veerify.io']) {
      const error = await rejection(
        sendingDomains.createSendingDomainClaim({
          projectId: projectA.projectId,
          domain,
          userId: 'nobody',
          provider: 'mailgun',
          providerAccountKey: 'acct',
        })
      )
      expect(error?.statusCode).toBe(422)
      expect(error?.data?.code).toBe('DOMAIN_REJECTED')
    }
  })

  it('still issues platform addresses on it, and only the owning project may send as one', async () => {
    const address = (await create(projectA, true))!.address
    expect(address).toMatch(/@veerify\.io$/)

    expect(await sendingDomains.resolveProjectSenderAuthorization(projectA.projectId, address)).toMatchObject({
      status: 'authorized',
      platform: true,
    })
    await expect(
      sendingDomains.assertSenderAddressAllowedForInbox(projectA.projectId, address)
    ).resolves.toBeUndefined()

    expect(await sendingDomains.resolveProjectSenderAuthorization(projectB.projectId, address)).toMatchObject({
      status: 'unauthorized',
    })
    await expect(sendingDomains.assertSenderAddressAllowedForInbox(projectB.projectId, address)).rejects.toMatchObject({
      statusCode: 422,
    })
  })

  it('refuses hand-entered receiving addresses on it, and on its subdomains', async () => {
    for (const address of ['support@veerify.io', 'support@help.veerify.io']) {
      await expect(sendingDomains.assertReceivingAddressAllowed(projectA.projectId, address)).rejects.toMatchObject({
        statusCode: 422,
        data: { code: 'ADDRESS_DOMAIN_RESERVED' },
      })
    }
  })

  it('refuses any other From on the domain for every project', async () => {
    await expect(
      sendingDomains.assertSenderAddressAllowedForInbox(projectA.projectId, 'ceo@veerify.io')
    ).rejects.toMatchObject({ statusCode: 422 })
  })
})
