import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Route-level enforcement of the team sender policy (design §4.5, §9). The WP1
 * helpers and the WP2 provider are mocked; the database is a queue of rows.
 * Postgres-backed coverage lives in tests/integration/sender-enforcement.test.ts.
 */

const state = vi.hoisted(() => ({
  body: {} as Record<string, unknown>,
  params: { id: 'inbox-1', addressId: 'address-1' } as Record<string, string>,
  queuedRows: [] as unknown[][],
  inbox: { id: 'inbox-1', teamId: 'team-1', slug: 'support', emailAddress: 'support@acme.com' } as Record<
    string,
    unknown
  >,
  driverVerdict: { status: 'unauthorized' } as Record<string, unknown>,
}))

const sendingDomains = vi.hoisted(() => ({
  resolveSenderPolicy: vi.fn<() => 'legacy' | 'team'>(() => 'legacy'),
  resolveEffectiveSenderPolicy: vi.fn(async (): Promise<'legacy' | 'team'> => 'legacy'),
  isDomainClaimedByOtherTeam: vi.fn(async () => false),
  isSendingDomainsEnabled: vi.fn(() => false),
  resolveTeamSenderAuthorization: vi.fn(),
  assertSenderAddressAllowedForInbox: vi.fn(async () => undefined),
  assertReceivingAddressAllowed: vi.fn(async () => undefined),
}))
sendingDomains.resolveEffectiveSenderPolicy.mockImplementation(async () => sendingDomains.resolveSenderPolicy())
const provider = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }))
const platform = vi.hoisted(() => ({
  findPlatformAddress: vi.fn(),
  ensurePlatformAddress: vi.fn(),
  getPlatformMailDomain: vi.fn<() => string | null>(() => null),
}))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRouterParam', (_event: unknown, name: string) => state.params[name])
vi.stubGlobal('readBody', async () => state.body)
vi.stubGlobal('createError', (input: Record<string, unknown>) =>
  Object.assign(new Error(String(input.statusMessage)), input)
)

vi.mock('h3', () => ({
  createError: (input: Record<string, unknown>) => Object.assign(new Error(String(input.statusMessage)), input),
  getRouterParam: (_event: unknown, name: string) => state.params[name],
}))
vi.mock('~/server/utils/auth-middleware', () => ({ requireAuth: vi.fn(async () => ({ user: { id: 'user-1' } })) }))
vi.mock('~/server/utils/support-access', () => ({
  requireInboxRole: vi.fn(async () => ({ ...state.inbox })),
  requireConversationAccess: vi.fn(async () => ({
    id: 'conversation-1',
    teamId: 'team-1',
    inboxId: 'inbox-1',
    contactId: 'contact-1',
    subject: 'Hi',
  })),
  requireTeamAdmin: vi.fn(async () => ({ id: 'tm-1', role: 'admin' })),
}))
vi.mock('~/server/utils/sending-domains', () => sendingDomains)
vi.mock('~/server/services/sending-domains', () => ({ getSendingDomainProvider: () => provider.current }))
vi.mock('~/server/utils/platform-address', () => platform)
vi.mock('~/server/utils/inbound-routes', () => ({
  createDirectRouteForAddress: vi.fn(async () => null),
  deleteDirectRouteForAddress: vi.fn(async () => undefined),
}))
vi.mock('~/server/services/support-channels', () => ({
  getConfiguredChannelDriver: vi.fn(() => ({
    checkSendingAuthorization: vi.fn(async () => state.driverVerdict),
  })),
}))
vi.mock('~/server/utils/support-realtime', () => ({ publishConversationEvent: vi.fn() }))
vi.mock('~/server/utils/outbound-reply', () => ({ buildOutgoingReply: vi.fn() }))
vi.mock('~/server/utils/outbound-delivery', () => ({ runOutboundDeliveryWorker: vi.fn(async () => undefined) }))
vi.mock('~/server/utils/automation-engine', () => ({ triggerAutomationEvent: vi.fn() }))
vi.mock('~/server/utils/support-attachment-finalization', () => ({
  commitMessageWithAttachments: vi.fn(),
  markAttachmentCleanupRequired: vi.fn(),
  reserveAttachmentFinalization: vi.fn(async () => []),
}))
vi.mock('~/server/utils/support-observability', () => ({ recordSupportMetric: vi.fn() }))

vi.mock('~/server/database/drizzle', () => {
  const chain = (): Record<string, unknown> => {
    const result = Promise.resolve(state.queuedRows.shift() ?? [])
    const fluent: Record<string, unknown> = {
      from: () => fluent,
      innerJoin: () => fluent,
      where: () => fluent,
      set: () => fluent,
      values: () => fluent,
      orderBy: () => fluent,
      limit: () => result,
      returning: () => result,
      then: (...args: Parameters<Promise<unknown>['then']>) => result.then(...args),
    }
    return fluent
  }
  const db = {
    select: () => chain(),
    insert: () => chain(),
    update: () => chain(),
    delete: () => chain(),
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(db),
  }
  return { db }
})

const sendingStatus = (await import('~/server/api/support/inboxes/[id]/sending-status.get')).default
const inboxUpdate = (await import('~/server/api/support/inboxes/[id].put')).default
const addressCreate = (await import('~/server/api/support/inboxes/[id]/addresses/index.post')).default
const addressDelete = (await import('~/server/api/support/inboxes/[id]/addresses/[addressId].delete')).default
const platformCreate = (await import('~/server/api/support/inboxes/[id]/addresses/platform.post')).default
const messageCreate = (await import('~/server/api/support/conversations/[id]/messages/index.post')).default

const event = {} as never

beforeEach(() => {
  vi.clearAllMocks()
  state.body = {}
  state.params = { id: 'inbox-1', addressId: 'address-1' }
  state.queuedRows = []
  state.inbox = { id: 'inbox-1', teamId: 'team-1', slug: 'support', emailAddress: 'support@acme.com' }
  state.driverVerdict = { status: 'unauthorized' }
  sendingDomains.resolveSenderPolicy.mockReturnValue('legacy')
  sendingDomains.isSendingDomainsEnabled.mockReturnValue(false)
  provider.current = null
  platform.getPlatformMailDomain.mockReturnValue(null)
})

describe('sending-status', () => {
  it('under legacy policy reshapes the driver verdict and never carries a domain list', async () => {
    const response = (await sendingStatus(event)) as { data: Record<string, any> }

    expect(response.data).toEqual({
      address: 'support@acme.com',
      policy: 'legacy',
      authorization: { status: 'unauthorized', reason: 'not_owned', teamDomains: [] },
    })
    expect(JSON.stringify(response)).not.toContain('verifiedDomains')
    expect(sendingDomains.resolveTeamSenderAuthorization).not.toHaveBeenCalled()
  })

  it('passes a legacy authorized and unknown verdict through', async () => {
    state.driverVerdict = { status: 'authorized' }
    expect(((await sendingStatus(event)) as any).data.authorization).toEqual({ status: 'authorized', domain: null })

    state.driverVerdict = { status: 'unknown', reason: 'no credential' }
    expect(((await sendingStatus(event)) as any).data.authorization).toEqual({
      status: 'unknown',
      reason: 'no credential',
    })
  })

  it('under team policy returns the team-scoped verdict, ignoring the provider-wide driver verdict', async () => {
    sendingDomains.resolveSenderPolicy.mockReturnValue('team')
    state.driverVerdict = { status: 'authorized' }
    sendingDomains.resolveTeamSenderAuthorization.mockResolvedValue({
      status: 'unauthorized',
      reason: 'not_owned',
      teamDomains: ['mine.com'],
    })

    const response = (await sendingStatus(event)) as { data: Record<string, any> }

    expect(response.data.policy).toBe('team')
    expect(response.data.authorization).toEqual({
      status: 'unauthorized',
      reason: 'not_owned',
      teamDomains: ['mine.com'],
    })
    expect(sendingDomains.resolveTeamSenderAuthorization).toHaveBeenCalledWith('team-1', 'support@acme.com', {})
  })

  it('has nothing to check without an address', async () => {
    state.inbox = { ...state.inbox, emailAddress: null }

    expect(((await sendingStatus(event)) as any).data).toEqual({
      address: null,
      policy: 'legacy',
      authorization: null,
    })
  })
})

describe('inbox update', () => {
  it.each(['Acme <ceo@acme.com>', 'ceo@acme.com', 'Say "hi"', 'Line\nbreak', 'Tab\there', 'a>b'])(
    'rejects the sender name %j with a 400 before writing',
    async (fromName) => {
      state.body = { fromName }
      state.queuedRows = [[{ id: 'inbox-1' }]]

      await expect(inboxUpdate(event)).rejects.toMatchObject({ statusCode: 400 })

      expect(state.queuedRows).toHaveLength(1)
    }
  )

  it('accepts an ordinary sender name and null', async () => {
    for (const fromName of ["Acme Support (EU) - O'Neil & Co.", null]) {
      state.body = { fromName }
      state.queuedRows = [[{ id: 'inbox-1' }]]
      await expect(inboxUpdate(event)).resolves.toMatchObject({ success: true })
    }
  })

  it('leaves the legacy decision to the ownership helper', async () => {
    state.body = { emailAddress: 'anything@other.com' }
    state.queuedRows = [[{ id: 'inbox-1' }]]

    await inboxUpdate(event)

    expect(sendingDomains.assertSenderAddressAllowedForInbox).toHaveBeenCalledWith('team-1', 'anything@other.com')
  })

  it('under team policy refuses an address the team does not own, before writing', async () => {
    sendingDomains.resolveSenderPolicy.mockReturnValue('team')
    sendingDomains.assertSenderAddressAllowedForInbox.mockRejectedValueOnce(
      Object.assign(new Error('nope'), { statusCode: 422 })
    )
    state.body = { emailAddress: 'support@teamb.com' }
    state.queuedRows = [[{ id: 'inbox-1' }]]

    await expect(inboxUpdate(event)).rejects.toMatchObject({ statusCode: 422 })

    expect(sendingDomains.assertSenderAddressAllowedForInbox).toHaveBeenCalledWith('team-1', 'support@teamb.com')
    // The update was never reached: the queued row is still there.
    expect(state.queuedRows).toHaveLength(1)
  })

  it('under team policy skips the check for an unchanged address and for clearing it', async () => {
    sendingDomains.resolveSenderPolicy.mockReturnValue('team')

    state.body = { emailAddress: 'Support@Acme.com'.toLowerCase(), name: 'x' }
    state.queuedRows = [[{ id: 'inbox-1' }]]
    await inboxUpdate(event)

    state.body = { emailAddress: null }
    state.queuedRows = [[{ id: 'inbox-1' }]]
    await inboxUpdate(event)

    expect(sendingDomains.assertSenderAddressAllowedForInbox).not.toHaveBeenCalled()
  })
})

describe('receiving address creation', () => {
  it('under team policy refuses a domain claimed by another team before inserting', async () => {
    sendingDomains.resolveSenderPolicy.mockReturnValue('team')
    sendingDomains.assertReceivingAddressAllowed.mockRejectedValueOnce(
      Object.assign(new Error('claimed'), { statusCode: 409 })
    )
    state.body = { address: 'support@teamb.com' }
    state.queuedRows = [[{ id: 'a1', address: 'support@teamb.com' }]]

    await expect(addressCreate(event)).rejects.toMatchObject({ statusCode: 409 })

    expect(sendingDomains.assertReceivingAddressAllowed).toHaveBeenCalledWith('team-1', 'support@teamb.com')
    expect(state.queuedRows).toHaveLength(1)
  })

  it('leaves the legacy decision to the receiving-address helper', async () => {
    state.body = { address: 'support@teamb.com' }
    state.queuedRows = [[{ id: 'a1', address: 'support@teamb.com' }]]

    await expect(addressCreate(event)).resolves.toMatchObject({ success: true })

    expect(sendingDomains.assertReceivingAddressAllowed).toHaveBeenCalledWith('team-1', 'support@teamb.com')
  })
})

describe('receiving address deletion', () => {
  it('refuses to delete a platform address', async () => {
    state.queuedRows = [[{ kind: 'platform' }], [{ id: 'address-1' }]]

    await expect(addressDelete(event)).rejects.toMatchObject({ statusCode: 409 })

    // Only the lookup ran; the delete's queued row is untouched.
    expect(state.queuedRows).toHaveLength(1)
  })

  it('still deletes a custom address and reports not found for a missing one', async () => {
    state.queuedRows = [[{ kind: 'custom' }], [{ id: 'address-1', providerRouteId: null }]]
    await expect(addressDelete(event)).resolves.toMatchObject({ success: true, data: { deleted: true } })

    state.queuedRows = [[], []]
    await expect(addressDelete(event)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('platform address creation', () => {
  it('is 404 when no platform domain is configured', async () => {
    await expect(platformCreate(event)).rejects.toMatchObject({ statusCode: 404 })
    expect(platform.ensurePlatformAddress).not.toHaveBeenCalled()
  })

  it('is idempotent: returns the existing address without creating another', async () => {
    platform.getPlatformMailDomain.mockReturnValue('veerifymail.com')
    platform.findPlatformAddress.mockResolvedValue({ id: 'p1', address: 'acme-support-abcdef@veerifymail.com' })

    const response = (await platformCreate(event)) as { data: Record<string, any> }

    expect(response.data).toEqual({
      address: { id: 'p1', address: 'acme-support-abcdef@veerifymail.com' },
      created: false,
    })
    expect(platform.ensurePlatformAddress).not.toHaveBeenCalled()
  })

  it('creates the address for an inbox that predates the feature', async () => {
    platform.getPlatformMailDomain.mockReturnValue('veerifymail.com')
    platform.findPlatformAddress.mockResolvedValue(null)
    platform.ensurePlatformAddress.mockResolvedValue({ id: 'p2', address: 'acme-support-zzzzzz@veerifymail.com' })
    state.queuedRows = [[{ slug: 'acme' }]]

    const response = (await platformCreate(event)) as { data: Record<string, any> }

    expect(response.data.created).toBe(true)
    expect(platform.ensurePlatformAddress).toHaveBeenCalledWith(
      expect.anything(),
      { id: 'inbox-1', slug: 'support' },
      'acme',
      { regenerate: false }
    )
  })

  it('regenerates on request, without looking up the existing row first', async () => {
    platform.getPlatformMailDomain.mockReturnValue('veerifymail.com')
    platform.ensurePlatformAddress.mockResolvedValue({ id: 'p3', address: 'acme-support-new000@veerifymail.com' })
    state.body = { regenerate: true }
    state.queuedRows = [[{ slug: 'acme' }]]

    await platformCreate(event)

    expect(platform.findPlatformAddress).not.toHaveBeenCalled()
    expect(platform.ensurePlatformAddress).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'acme', {
      regenerate: true,
    })
  })

  it('rejects unknown body fields', async () => {
    platform.getPlatformMailDomain.mockReturnValue('veerifymail.com')
    state.body = { regenerate: true, extra: 1 }

    await expect(platformCreate(event)).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('agent reply', () => {
  const reply = { kind: 'outgoing', body: 'Hello' }

  it('under team policy answers 409 SENDER_NOT_VERIFIED before reserving or writing anything', async () => {
    sendingDomains.resolveSenderPolicy.mockReturnValue('team')
    sendingDomains.resolveTeamSenderAuthorization.mockResolvedValue({
      status: 'pending',
      domain: { id: 'd1', domain: 'acme.com', status: 'pending' },
    })
    state.body = reply
    state.queuedRows = [[{ id: 'inbox-1', emailAddress: 'support@acme.com' }]]

    await expect(messageCreate(event)).rejects.toMatchObject({
      statusCode: 409,
      data: {
        error: {
          code: 'SENDER_NOT_VERIFIED',
          message: 'Replies from support@acme.com are blocked until acme.com is verified in Support settings',
        },
      },
    })
  })

  it('does not check the sender for an internal note', async () => {
    sendingDomains.resolveSenderPolicy.mockReturnValue('team')
    state.body = { kind: 'note', body: 'private' }

    // No database rows are queued: a note never reaches the inbox lookup, so
    // this fails later (mocked commit returns nothing) - what matters is that
    // the sender check never ran.
    await messageCreate(event).catch(() => undefined)

    expect(sendingDomains.resolveTeamSenderAuthorization).not.toHaveBeenCalled()
  })
})
