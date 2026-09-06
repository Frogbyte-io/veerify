import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  body: {} as Record<string, unknown>,
  params: { id: 'inbox-1', memberId: 'member-1', addressId: 'address-1', teamId: 'team-1' } as Record<string, string>,
  query: { inboxId: 'inbox-1' } as Record<string, unknown>,
  queuedRows: [] as unknown[][],
  rawBody: '',
  headers: {} as Record<string, string>,
  session: { user: { id: 'user-1' } },
}))

const forbidden = () => Promise.reject(Object.assign(new Error('forbidden'), { statusCode: 403 }))

const providerState = vi.hoisted(() => ({
  driver: {
    name: 'postmark',
    verifySignature: vi.fn(() => false),
    extractEventId: vi.fn(() => 'inbound-event-1'),
    extractDeliveryEventId: vi.fn(() => 'delivery-event-1'),
    parseDeliveryEvent: vi.fn(() => ({
      providerEventId: 'delivery-event-1',
      providerAccountKey: 'server-1',
      correlationKey: null,
      providerMessageId: null,
      recordType: 'delivered',
      recipient: 'customer@example.com',
      occurredAt: new Date('2026-08-20T10:00:00Z'),
      error: null,
      bounceType: null,
      description: null,
    })),
  },
}))

const storageState = vi.hoisted(() => ({
  putObject: vi.fn(async () => undefined),
  getObject: vi.fn(async () => Buffer.from('attachment')),
}))

const uploadState = vi.hoisted(() => ({
  verifySupportUploadToken: vi.fn(),
}))

const access = vi.hoisted(() => ({
  requireTeamAdmin: vi.fn(async () => ({ id: 'team-member-1', role: 'admin' })),
  requireInboxRole: vi.fn(async (inboxId: string, _userId: string, minimumRole: string) => ({
    id: inboxId,
    teamId: 'team-1',
    emailAddress: null,
    effectiveRole: minimumRole,
    isTeamAdmin: false,
  })),
  requireSupportTeamRole: vi.fn(async () => ({ effectiveRole: 'supervisor', isTeamAdmin: false })),
  requireTeamMembership: vi.fn(async () => ({ id: 'team-member-1', role: 'member' })),
  requireInboxAccess: vi.fn(async (inboxId: string) => ({ id: inboxId, teamId: 'team-1' })),
  requireContactAccess: vi.fn(async (contactId: string) => ({ id: contactId, teamId: 'team-1' })),
  requireCompanyAccess: vi.fn(async (companyId: string) => ({ id: companyId, teamId: 'team-1' })),
  requireConversationAccess: vi.fn(async (conversationId: string) => ({ id: conversationId, inboxId: 'inbox-1' })),
  resolveSupportTeamRole: vi.fn(async () => ({ effectiveRole: 'agent', isTeamAdmin: false })),
  capabilitiesForRole: vi.fn(() => ({
    canWorkConversations: true,
    canManageTagVocabulary: false,
    canManageMembers: false,
    canManageInbox: false,
    canManageTeamSupport: false,
  })),
}))

const contactLinkTransaction = vi.hoisted(() => ({
  deleteContactLinkInTransaction: vi.fn(async () => ({ deleted: true })),
}))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRouterParam', (_event: unknown, name: string) => state.params[name as keyof typeof state.params])
vi.stubGlobal('getQuery', () => state.query)
vi.stubGlobal('readBody', async () => state.body)
vi.stubGlobal('getHeader', (_event: unknown, name: string) => state.headers[name.toLowerCase()])
vi.stubGlobal('readRawBody', async () => state.rawBody)
vi.stubGlobal('createError', (input: Record<string, unknown>) =>
  Object.assign(new Error(String(input.statusMessage)), input)
)
vi.stubGlobal('useRuntimeConfig', () => ({ uploadTokenSecret: 'test-upload-secret' }))

vi.mock('h3', () => ({
  createError: (input: Record<string, unknown>) => Object.assign(new Error(String(input.statusMessage)), input),
  getRouterParam: (_event: unknown, name: string) => state.params[name as keyof typeof state.params],
  getQuery: () => state.query,
  readRawBody: async () => state.rawBody,
  getHeaders: () => state.headers,
  getHeader: (_event: unknown, name: string) => state.headers[name.toLowerCase()],
  setResponseHeader: vi.fn(),
  setResponseStatus: vi.fn(),
}))

vi.mock('~/server/utils/auth-middleware', () => ({
  requireAuth: vi.fn(async () => state.session),
}))

vi.mock('~/server/utils/team-context', () => ({
  requireAuthWithResolvedTeam: vi.fn(async () => ({ session: state.session, activeTeam: { id: 'team-1' } })),
}))

vi.mock('~/server/utils/support-access', () => access)

vi.mock('~/server/utils/contact-link-transaction', () => contactLinkTransaction)

vi.mock('~/server/services/support-channels', () => ({
  SUPPORT_CHANNEL_PROVIDERS: ['postmark', 'mailgun'],
  getConfiguredChannelDriver: vi.fn(() => null),
  getConfiguredChannelProviderName: vi.fn(() => 'postmark'),
  getChannelDriver: vi.fn(() => providerState.driver),
  emailDomain: vi.fn(() => null),
}))

vi.mock('~/server/utils/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => true),
}))

vi.mock('~/server/services/rate-limit', () => ({
  getRateLimitStore: vi.fn(() => null),
}))

const inboundEvents = vi.hoisted(() => ({
  claimInboundEvent: vi.fn(async () => ({ outcome: 'duplicate' as const })),
  attachInboundEventInbox: vi.fn(),
  completeInboundEvent: vi.fn(),
  failInboundEvent: vi.fn(),
  recordInboundRawKey: vi.fn(),
  rejectInboundEvent: vi.fn(),
}))
const deliveryEvents = vi.hoisted(() => ({
  claimDeliveryEvent: vi.fn(async () => ({ outcome: 'duplicate' as const })),
  completeDeliveryEvent: vi.fn(),
  failDeliveryEvent: vi.fn(),
}))

vi.mock('~/server/utils/inbound-events', () => ({
  ...inboundEvents,
}))

vi.mock('~/server/utils/delivery-events', () => ({
  ...deliveryEvents,
}))

vi.mock('~/server/utils/storage', () => ({
  getStorageProvider: vi.fn(() => ({ driver: 'local', ...storageState })),
}))

vi.mock('~/server/utils/support-attachments', async () => {
  const actual = await vi.importActual<typeof import('~/server/utils/support-attachments')>(
    '~/server/utils/support-attachments'
  )
  return {
    ...actual,
    verifySupportUploadToken: (token: string) => {
      uploadState.verifySupportUploadToken(token)
      return actual.verifySupportUploadToken(token)
    },
  }
})

vi.mock('~/server/database/drizzle', () => {
  type MockDb = {
    select: () => Record<string, unknown>
    insert: () => Record<string, unknown>
    update: () => Record<string, unknown>
    delete: () => Record<string, unknown>
    transaction: (...args: unknown[]) => Promise<unknown>
  }
  const nextRows = () => state.queuedRows.shift() ?? []
  const chain = (): Record<string, unknown> => {
    const current = nextRows()
    const result = Promise.resolve(current)
    const fluent: Record<string, unknown> = {
      from: () => fluent,
      innerJoin: () => fluent,
      leftJoin: () => fluent,
      where: () => fluent,
      set: () => fluent,
      values: () => fluent,
      onConflictDoUpdate: () => fluent,
      for: () => fluent,
      orderBy: () => fluent,
      limit: () => result,
      returning: () => result,
      then: (...args: Parameters<Promise<unknown>['then']>) => result.then(...args),
    }
    return fluent
  }
  const db: MockDb = {
    select: () => chain(),
    insert: () => chain(),
    update: () => chain(),
    delete: () => chain(),
    transaction: async (...args: unknown[]) => (args[0] as (tx: MockDb) => Promise<unknown>)(db),
  }
  return { db }
})

const inboxCreate = (await import('~/server/api/support/inboxes/index.post')).default
const inboxUpdate = (await import('~/server/api/support/inboxes/[id].put')).default
const inboxDelete = (await import('~/server/api/support/inboxes/[id].delete')).default
const addressCreate = (await import('~/server/api/support/inboxes/[id]/addresses/index.post')).default
const addressDelete = (await import('~/server/api/support/inboxes/[id]/addresses/[addressId].delete')).default
const memberCreate = (await import('~/server/api/support/inboxes/[id]/members/index.post')).default
const memberDelete = (await import('~/server/api/support/inboxes/[id]/members/[memberId].delete')).default
const sendingStatus = (await import('~/server/api/support/inboxes/[id]/sending-status.get')).default
const tagCreate = (await import('~/server/api/support/tags/index.post')).default
const tagDelete = (await import('~/server/api/support/tags/[id].delete')).default
const channelStatus = (await import('~/server/api/support/channel-status.get')).default
const supportSettings = (await import('~/server/api/support/teams/[teamId]/settings.put')).default
const teamModules = (await import('~/server/api/teams/[teamId]/modules.put')).default

const inboxList = (await import('~/server/api/support/inboxes/index.get')).default
const inboxDetail = (await import('~/server/api/support/inboxes/[id].get')).default
const addressList = (await import('~/server/api/support/inboxes/[id]/addresses/index.get')).default
const memberList = (await import('~/server/api/support/inboxes/[id]/members/index.get')).default
const tagList = (await import('~/server/api/support/tags/index.get')).default
const supportSettingsGet = (await import('~/server/api/support/teams/[teamId]/settings.get')).default

const contactList = (await import('~/server/api/support/contacts/index.get')).default
const contactCreate = (await import('~/server/api/support/contacts/index.post')).default
const contactGet = (await import('~/server/api/support/contacts/[id].get')).default
const contactUpdate = (await import('~/server/api/support/contacts/[id].put')).default
const contactDelete = (await import('~/server/api/support/contacts/[id].delete')).default
const contactMerge = (await import('~/server/api/support/contacts/[id]/merge.post')).default
const companyList = (await import('~/server/api/support/companies/index.get')).default
const companyCreate = (await import('~/server/api/support/companies/index.post')).default
const companyGet = (await import('~/server/api/support/companies/[id].get')).default
const companyUpdate = (await import('~/server/api/support/companies/[id].put')).default
const companyDelete = (await import('~/server/api/support/companies/[id].delete')).default
const contactTimeline = (await import('~/server/api/support/contacts/[id]/timeline.get')).default
const contactLinkCreate = (await import('~/server/api/support/contacts/[id]/links.post')).default
const contactLinkDelete = (await import('~/server/api/support/contacts/[id]/links/[linkId].delete')).default
const conversationList = (await import('~/server/api/support/conversations/index.get')).default
const conversationCreate = (await import('~/server/api/support/conversations/index.post')).default
const conversationGet = (await import('~/server/api/support/conversations/[id].get')).default
const conversationUpdate = (await import('~/server/api/support/conversations/[id].patch')).default
const participantCreate = (await import('~/server/api/support/conversations/[id]/participants/index.post')).default
const participantDelete = (await import('~/server/api/support/conversations/[id]/participants/[participantId].delete'))
  .default
const messageList = (await import('~/server/api/support/conversations/[id]/messages/index.get')).default
const messageCreate = (await import('~/server/api/support/conversations/[id]/messages/index.post')).default
const messageRetry = (await import('~/server/api/support/conversations/[id]/messages/[messageId]/retry.post')).default
const conversationTagList = (await import('~/server/api/support/conversations/[id]/tags/index.get')).default
const conversationTagCreate = (await import('~/server/api/support/conversations/[id]/tags/index.post')).default
const conversationTagDelete = (await import('~/server/api/support/conversations/[id]/tags/[tagId].delete')).default
const attachmentPresign = (await import('~/server/api/support/attachments/presign.post')).default
const attachmentGet = (await import('~/server/api/support/attachments/[id].get')).default
const attachmentComplete = (await import('~/server/api/support/attachments/[uploadId]/complete.post')).default
const attachmentUpload = (await import('~/server/api/support/attachments/upload/[token].put')).default
const inboundWebhook = (await import('~/server/api/support/inbound/[provider].post')).default
const deliveryWebhook = (await import('~/server/api/support/delivery/[provider].post')).default
const { signSupportUploadToken } = await import('~/server/utils/support-attachments')

// This import is intentionally optional in the RED phase: the route is the
// production change being driven by this test.
const memberPatch = await import('~/server/api/support/inboxes/[id]/members/[memberId].patch')
  .then((module) => module.default)
  .catch(() => null)

const event = {} as never

beforeEach(() => {
  state.body = {}
  state.params = { id: 'inbox-1', memberId: 'member-1', addressId: 'address-1', teamId: 'team-1' }
  state.query = { inboxId: 'inbox-1' }
  state.rawBody = ''
  state.headers = {}
  state.queuedRows = []
  providerState.driver.verifySignature.mockReturnValue(false)
  inboundEvents.claimInboundEvent.mockResolvedValue({ outcome: 'duplicate' })
  deliveryEvents.claimDeliveryEvent.mockResolvedValue({ outcome: 'duplicate' })
  vi.clearAllMocks()
})

describe('support route authorization inventory', () => {
  it.each([
    ['inbox creation', inboxCreate, 'requireTeamAdmin', 'team-1', 'team-admin'],
    ['inbox settings', inboxUpdate, 'requireInboxRole', 'inbox-1', 'admin'],
    ['inbox deletion', inboxDelete, 'requireInboxRole', 'inbox-1', 'admin'],
    ['address creation', addressCreate, 'requireInboxRole', 'inbox-1', 'admin'],
    ['address deletion', addressDelete, 'requireInboxRole', 'inbox-1', 'admin'],
    ['member creation', memberCreate, 'requireInboxRole', 'inbox-1', 'admin'],
    ['member deletion', memberDelete, 'requireInboxRole', 'inbox-1', 'admin'],
    ['sending status', sendingStatus, 'requireInboxRole', 'inbox-1', 'agent'],
    ['shared tag creation', tagCreate, 'requireSupportTeamRole', 'team-1', 'supervisor'],
    ['team support settings', supportSettings, 'requireTeamAdmin', 'team-1', 'team-admin'],
    ['team module toggles', teamModules, 'requireTeamAdmin', 'team-1', 'team-admin'],
  ] as const)('requires the exact minimum role for %s', async (_name, handler, helper, scope, role) => {
    if (helper === 'requireTeamAdmin') {
      access.requireTeamAdmin.mockImplementationOnce(() => forbidden())
      state.body =
        scope === 'team-1' ? { teamId: 'team-1', name: 'Support', slug: 'support' } : { autoLinkFeedback: true }
    } else if (helper === 'requireInboxRole') {
      access.requireInboxRole.mockImplementationOnce(() => forbidden())
      state.body =
        _name === 'address creation'
          ? { address: 'support@example.com' }
          : _name === 'member creation'
            ? { userId: 'user-2', role: 'agent' }
            : scope === 'inbox-1' && role === 'admin'
              ? { name: 'Support' }
              : {}
    } else {
      access.requireSupportTeamRole.mockImplementationOnce(() => forbidden())
      state.body = { teamId: 'team-1', name: 'vip' }
      state.queuedRows = [[{ id: 'tag-1', teamId: 'team-1' }]]
    }

    await expect(handler(event)).rejects.toMatchObject({ statusCode: 403 })

    if (helper === 'requireTeamAdmin') {
      expect(access.requireTeamAdmin).toHaveBeenCalledWith(scope, 'user-1')
    } else if (helper === 'requireInboxRole') {
      expect(access.requireInboxRole).toHaveBeenCalledWith(scope, 'user-1', role)
    } else {
      expect(access.requireSupportTeamRole).toHaveBeenCalledWith(scope, 'user-1', role)
    }
  })

  it('requires supervisor support-team access to delete a shared tag', async () => {
    state.queuedRows = [[{ id: 'tag-1', teamId: 'team-1' }]]
    access.requireSupportTeamRole.mockImplementationOnce(() => forbidden())

    await expect(tagDelete(event)).rejects.toMatchObject({ statusCode: 403 })
    expect(access.requireSupportTeamRole).toHaveBeenCalledWith('team-1', 'user-1', 'supervisor')
  })

  it('requires an inbox id and agent access before exposing channel configuration names', async () => {
    state.query = {}
    await expect(channelStatus(event)).rejects.toMatchObject({ statusCode: 400 })
    expect(access.requireInboxRole).not.toHaveBeenCalled()

    state.query = { inboxId: 'inbox-1' }
    access.requireInboxRole.mockImplementationOnce(() => forbidden())
    await expect(channelStatus(event)).rejects.toMatchObject({ statusCode: 403 })
    expect(access.requireInboxRole).toHaveBeenCalledWith('inbox-1', 'user-1', 'agent')
  })

  it('validates member role writes against the exact three-value enum', async () => {
    expect(memberPatch).toBeTypeOf('function')
    state.body = { role: 'owner' }

    await expect(memberPatch?.(event)).rejects.toMatchObject({ statusCode: 400 })
    expect(access.requireInboxRole).not.toHaveBeenCalled()
  })

  it('returns a successful member-role update only for the route inbox row', async () => {
    expect(memberPatch).toBeTypeOf('function')
    state.body = { role: 'supervisor' }
    state.queuedRows = [[{ id: 'member-1', inboxId: 'inbox-1', userId: 'user-2', role: 'supervisor' }]]

    await expect(memberPatch?.(event)).resolves.toMatchObject({
      success: true,
      data: { member: { id: 'member-1', inboxId: 'inbox-1', role: 'supervisor' } },
    })
    expect(access.requireInboxRole).toHaveBeenCalledWith('inbox-1', 'user-1', 'admin')
  })

  it('denies a member id that belongs to another inbox without exposing that row', async () => {
    expect(memberPatch).toBeTypeOf('function')
    state.body = { role: 'supervisor' }
    state.queuedRows = [[]]

    await expect(memberPatch?.(event)).rejects.toMatchObject({ statusCode: 404 })
    expect(access.requireInboxRole).toHaveBeenCalledWith('inbox-1', 'user-1', 'admin')
  })

  it('does not delete a member id from another inbox', async () => {
    state.params = { ...state.params, id: 'inbox-1', memberId: 'member-from-inbox-2' }
    state.queuedRows = [[]]

    await expect(memberDelete(event)).rejects.toMatchObject({ statusCode: 404 })
    expect(access.requireInboxRole).toHaveBeenCalledWith('inbox-1', 'user-1', 'admin')
  })

  it('does not delete an address id from another inbox', async () => {
    state.params = { ...state.params, id: 'inbox-1', addressId: 'address-from-inbox-2' }
    state.queuedRows = [[]]

    await expect(addressDelete(event)).rejects.toMatchObject({ statusCode: 404 })
    expect(access.requireInboxRole).toHaveBeenCalledWith('inbox-1', 'user-1', 'admin')
  })

  it('allows a team-admin bypass through the admin minimum for inbox mutation', async () => {
    access.requireInboxRole.mockResolvedValueOnce({
      id: 'inbox-1',
      teamId: 'team-1',
      emailAddress: null,
      effectiveRole: 'admin',
      isTeamAdmin: true,
    })
    state.body = { name: 'Renamed inbox' }

    await expect(inboxUpdate(event)).resolves.toMatchObject({ success: true })
    expect(access.requireInboxRole).toHaveBeenCalledWith('inbox-1', 'user-1', 'admin')
  })

  it('rejects legacy attachment metadata instead of silently stripping it', async () => {
    state.params = { ...state.params, id: 'conversation-1' }
    state.body = {
      kind: 'outgoing',
      body: 'Reply',
      attachments: [{ uploadId: 'upload-1', storageKey: 'client-controlled-key' }],
    }

    await expect(messageCreate(event)).rejects.toMatchObject({ statusCode: 400 })
    expect(access.requireConversationAccess).not.toHaveBeenCalled()
  })
})

type BoundaryHandler = (event: never) => Promise<unknown>
type BoundaryHelper = keyof typeof access
type BoundaryCase = {
  name: string
  handler: BoundaryHandler
  helper: BoundaryHelper
  args: unknown[]
  body?: Record<string, unknown>
  query?: Record<string, unknown>
  params?: Record<string, string>
  queuedRows?: unknown[][]
}

const boundary = (
  handler: unknown,
  helper: BoundaryHelper,
  args: unknown[],
  fixture?: Omit<BoundaryCase, 'name' | 'handler' | 'helper' | 'args'>
) => ({
  handler: handler as BoundaryHandler,
  helper,
  args,
  ...fixture,
})

const executableBoundaryCases: BoundaryCase[] = [
  {
    name: 'inboxes/index.get',
    ...boundary(inboxList, 'requireTeamMembership', ['team-1', 'user-1'], { query: { teamId: 'team-1' } }),
  },
  {
    name: 'inboxes/[id].get',
    ...boundary(inboxDetail, 'requireInboxAccess', ['inbox-1', 'user-1'], { params: { id: 'inbox-1' } }),
  },
  {
    name: 'inboxes/index.post',
    ...boundary(inboxCreate, 'requireTeamAdmin', ['team-1', 'user-1'], {
      body: { teamId: 'team-1', name: 'Support', slug: 'support' },
    }),
  },
  {
    name: 'inboxes/[id].put',
    ...boundary(inboxUpdate, 'requireInboxRole', ['inbox-1', 'user-1', 'admin'], {
      params: { id: 'inbox-1' },
      body: { name: 'Support' },
    }),
  },
  {
    name: 'inboxes/[id].delete',
    ...boundary(inboxDelete, 'requireInboxRole', ['inbox-1', 'user-1', 'admin'], { params: { id: 'inbox-1' } }),
  },
  {
    name: 'inboxes/[id]/addresses/index.get',
    ...boundary(addressList, 'requireInboxAccess', ['inbox-1', 'user-1'], { params: { id: 'inbox-1' } }),
  },
  {
    name: 'inboxes/[id]/addresses/index.post',
    ...boundary(addressCreate, 'requireInboxRole', ['inbox-1', 'user-1', 'admin'], {
      params: { id: 'inbox-1' },
      body: { address: 'support@example.com' },
    }),
  },
  {
    name: 'inboxes/[id]/addresses/[addressId].delete',
    ...boundary(addressDelete, 'requireInboxRole', ['inbox-1', 'user-1', 'admin'], {
      params: { id: 'inbox-1', addressId: 'address-1' },
    }),
  },
  {
    name: 'inboxes/[id]/members/index.get',
    ...boundary(memberList, 'requireInboxAccess', ['inbox-1', 'user-1'], { params: { id: 'inbox-1' } }),
  },
  {
    name: 'inboxes/[id]/members/index.post',
    ...boundary(memberCreate, 'requireInboxRole', ['inbox-1', 'user-1', 'admin'], {
      params: { id: 'inbox-1' },
      body: { userId: 'user-2', role: 'agent' },
    }),
  },
  {
    name: 'inboxes/[id]/members/[memberId].delete',
    ...boundary(memberDelete, 'requireInboxRole', ['inbox-1', 'user-1', 'admin'], {
      params: { id: 'inbox-1', memberId: 'member-1' },
    }),
  },
  {
    name: 'inboxes/[id]/members/[memberId].patch',
    ...boundary(memberPatch, 'requireInboxRole', ['inbox-1', 'user-1', 'admin'], {
      params: { id: 'inbox-1', memberId: 'member-1' },
      body: { role: 'supervisor' },
    }),
  },
  {
    name: 'inboxes/[id]/sending-status.get',
    ...boundary(sendingStatus, 'requireInboxRole', ['inbox-1', 'user-1', 'agent'], { params: { id: 'inbox-1' } }),
  },
  {
    // Support-team access, not bare team membership: the design gates reading the
    // shared tag vocabulary behind support access, and creation/deletion already
    // use the same helper at `supervisor`.
    name: 'tags/index.get',
    ...boundary(tagList, 'requireSupportTeamRole', ['team-1', 'user-1', 'agent'], { query: { teamId: 'team-1' } }),
  },
  {
    name: 'tags/index.post',
    ...boundary(tagCreate, 'requireSupportTeamRole', ['team-1', 'user-1', 'supervisor'], {
      body: { teamId: 'team-1', name: 'vip' },
    }),
  },
  {
    name: 'tags/[id].delete',
    ...boundary(tagDelete, 'requireSupportTeamRole', ['team-1', 'user-1', 'supervisor'], {
      params: { id: 'tag-1' },
      queuedRows: [[{ id: 'tag-1', teamId: 'team-1' }]],
    }),
  },
  {
    name: 'teams/[teamId]/settings.get',
    ...boundary(supportSettingsGet, 'resolveSupportTeamRole', ['team-1', 'user-1'], { params: { teamId: 'team-1' } }),
  },
  {
    name: 'teams/[teamId]/settings.put',
    ...boundary(supportSettings, 'requireTeamAdmin', ['team-1', 'user-1'], {
      params: { teamId: 'team-1' },
      body: { autoLinkFeedback: true },
    }),
  },
  {
    name: 'contacts/index.get',
    ...boundary(contactList, 'requireTeamMembership', ['team-1', 'user-1'], { query: { teamId: 'team-1' } }),
  },
  {
    name: 'contacts/index.post',
    ...boundary(contactCreate, 'requireTeamMembership', ['team-1', 'user-1'], {
      body: { teamId: 'team-1', name: 'Customer' },
    }),
  },
  {
    name: 'contacts/[id].get',
    ...boundary(contactGet, 'requireContactAccess', ['contact-1', 'user-1'], { params: { id: 'contact-1' } }),
  },
  {
    name: 'contacts/[id].put',
    ...boundary(contactUpdate, 'requireContactAccess', ['contact-1', 'user-1'], {
      params: { id: 'contact-1' },
      body: { name: 'Updated' },
    }),
  },
  {
    name: 'contacts/[id].delete',
    ...boundary(contactDelete, 'requireContactAccess', ['contact-1', 'user-1'], { params: { id: 'contact-1' } }),
  },
  {
    name: 'contacts/[id]/merge.post',
    ...boundary(contactMerge, 'requireContactAccess', ['contact-1', 'user-1'], {
      params: { id: 'contact-1' },
      body: { sourceContactId: 'contact-2' },
    }),
  },
  {
    name: 'contacts/[id]/timeline.get',
    ...boundary(contactTimeline, 'requireContactAccess', ['contact-1', 'user-1'], { params: { id: 'contact-1' } }),
  },
  {
    name: 'contacts/[id]/links.post',
    ...boundary(contactLinkCreate, 'requireContactAccess', ['contact-1', 'user-1'], {
      params: { id: 'contact-1' },
      body: { entityType: 'feedback', entityId: 'feedback-1' },
    }),
  },
  {
    name: 'companies/index.get',
    ...boundary(companyList, 'requireTeamMembership', ['team-1', 'user-1'], { query: { teamId: 'team-1' } }),
  },
  {
    name: 'companies/index.post',
    ...boundary(companyCreate, 'requireTeamMembership', ['team-1', 'user-1'], {
      body: { teamId: 'team-1', name: 'Acme' },
    }),
  },
  {
    name: 'companies/[id].get',
    ...boundary(companyGet, 'requireCompanyAccess', ['company-1', 'user-1'], { params: { id: 'company-1' } }),
  },
  {
    name: 'companies/[id].put',
    ...boundary(companyUpdate, 'requireCompanyAccess', ['company-1', 'user-1'], {
      params: { id: 'company-1' },
      body: {},
    }),
  },
  {
    name: 'companies/[id].delete',
    ...boundary(companyDelete, 'requireCompanyAccess', ['company-1', 'user-1'], { params: { id: 'company-1' } }),
  },
  {
    name: 'conversations/index.get',
    ...boundary(conversationList, 'requireInboxAccess', ['inbox-1', 'user-1'], { query: { inboxId: 'inbox-1' } }),
  },
  {
    name: 'conversations/index.post',
    ...boundary(conversationCreate, 'requireInboxAccess', ['inbox-1', 'user-1'], {
      body: { inboxId: 'inbox-1', contactId: 'contact-1' },
    }),
  },
  {
    name: 'conversations/[id].get',
    ...boundary(conversationGet, 'requireConversationAccess', ['conversation-1', 'user-1'], {
      params: { id: 'conversation-1' },
    }),
  },
  {
    name: 'conversations/[id].patch',
    ...boundary(conversationUpdate, 'requireConversationAccess', ['conversation-1', 'user-1'], {
      params: { id: 'conversation-1' },
      body: { status: 'open' },
    }),
  },
  {
    name: 'conversations/[id]/participants/index.post',
    ...boundary(participantCreate, 'requireConversationAccess', ['conversation-1', 'user-1'], {
      params: { id: 'conversation-1' },
      body: { userId: 'user-2', role: 'follower' },
    }),
  },
  {
    name: 'conversations/[id]/participants/[participantId].delete',
    ...boundary(participantDelete, 'requireConversationAccess', ['conversation-1', 'user-1'], {
      params: { id: 'conversation-1', participantId: 'participant-1' },
    }),
  },
  {
    name: 'conversations/[id]/messages/index.get',
    ...boundary(messageList, 'requireConversationAccess', ['conversation-1', 'user-1'], {
      params: { id: 'conversation-1' },
      query: { limit: '20' },
    }),
  },
  {
    name: 'conversations/[id]/messages/index.post',
    ...boundary(messageCreate, 'requireConversationAccess', ['conversation-1', 'user-1'], {
      params: { id: 'conversation-1' },
      body: { kind: 'note', body: 'A note' },
    }),
  },
  {
    name: 'conversations/[id]/messages/[messageId]/retry.post',
    ...boundary(messageRetry, 'requireConversationAccess', ['conversation-1', 'user-1'], {
      params: { id: 'conversation-1', messageId: 'message-1' },
    }),
  },
  {
    name: 'conversations/[id]/tags/index.get',
    ...boundary(conversationTagList, 'requireConversationAccess', ['conversation-1', 'user-1'], {
      params: { id: 'conversation-1' },
    }),
  },
  {
    name: 'conversations/[id]/tags/index.post',
    ...boundary(conversationTagCreate, 'requireConversationAccess', ['conversation-1', 'user-1'], {
      params: { id: 'conversation-1' },
      body: { tagId: 'tag-1' },
    }),
  },
  {
    name: 'conversations/[id]/tags/[tagId].delete',
    ...boundary(conversationTagDelete, 'requireConversationAccess', ['conversation-1', 'user-1'], {
      params: { id: 'conversation-1', tagId: 'tag-1' },
    }),
  },
  {
    name: 'attachments/presign.post',
    ...boundary(attachmentPresign, 'requireConversationAccess', ['conversation-1', 'user-1'], {
      body: { conversationId: 'conversation-1', filename: 'file.txt', contentType: 'text/plain', sizeBytes: 10 },
    }),
  },
  {
    name: 'attachments/[id].get',
    ...boundary(attachmentGet, 'requireConversationAccess', ['conversation-1', 'user-1'], {
      params: { id: 'attachment-1' },
      queuedRows: [
        [
          {
            storageKey: 'key',
            fileName: 'file.txt',
            contentType: 'text/plain',
            isInline: false,
            conversationId: 'conversation-1',
          },
        ],
      ],
    }),
  },
  {
    name: 'attachments/[uploadId]/complete.post',
    ...boundary(attachmentComplete, 'requireConversationAccess', ['conversation-1', 'user-1'], {
      params: { uploadId: 'upload-1' },
      queuedRows: [
        [
          {
            id: 'upload-1',
            conversationId: 'conversation-1',
            userId: 'user-1',
            expiresAt: new Date(Date.now() + 60_000),
            status: 'pending',
          },
        ],
      ],
    }),
  },
]

function collectSupportRouteFiles(directory: string, prefix = ''): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativeName = join(prefix, entry.name)
    if (entry.isDirectory()) return collectSupportRouteFiles(join(directory, entry.name), relativeName)
    return entry.name.endsWith('.ts') ? [relativeName.replace(/\\/g, '/').replace(/\.ts$/, '')] : []
  })
}

describe('executable support route authorization inventory', () => {
  it('invokes every authenticated support route at its intended access boundary', async () => {
    expect(executableBoundaryCases).toHaveLength(46)

    for (const route of executableBoundaryCases) {
      state.body = route.body ?? {}
      state.query = route.query ?? { inboxId: 'inbox-1' }
      state.params = { ...state.params, ...(route.params ?? {}) }
      state.queuedRows = route.queuedRows ?? []

      const helper = access[route.helper] as unknown as {
        mockClear: () => void
        mockImplementationOnce: (implementation: () => Promise<never>) => unknown
      }
      helper.mockClear()
      helper.mockImplementationOnce(() => forbidden())

      await expect(route.handler(event), route.name).rejects.toMatchObject({ statusCode: 403 })
      expect(helper).toHaveBeenCalledTimes(1)
      expect(helper, route.name).toHaveBeenLastCalledWith(...route.args)
    }
  })

  it('authorizes link deletion inside its transaction boundary', async () => {
    state.params = { ...state.params, id: 'contact-1', linkId: 'link-1' }
    contactLinkTransaction.deleteContactLinkInTransaction.mockImplementationOnce(() => forbidden())

    await expect(contactLinkDelete(event)).rejects.toMatchObject({ statusCode: 403 })
    expect(contactLinkTransaction.deleteContactLinkInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      'contact-1',
      'link-1',
      'user-1'
    )
  })

  it('matches every support route file to one executable or explicit boundary case', () => {
    const routeFiles = collectSupportRouteFiles(resolve(process.cwd(), 'server/api/support')).sort()
    const inventoryEntries = [
      ...executableBoundaryCases.map((route) => route.name),
      'contacts/[id]/links/[linkId].delete',
      'channel-status.get',
      'inbound/[provider].post',
      'delivery/[provider].post',
      'attachments/upload/[token].put',
    ]
    const inventoryNames = [...new Set(inventoryEntries)].sort()

    expect(inventoryEntries).toHaveLength(inventoryNames.length)
    expect(inventoryNames).toEqual(routeFiles)
  })

  it('rejects provider webhooks at signature verification before claim or processing', async () => {
    state.params = { ...state.params, provider: 'postmark' }
    state.rawBody = '{}'
    state.headers = {}

    await expect(inboundWebhook(event)).rejects.toMatchObject({ statusCode: 401 })
    expect(providerState.driver.verifySignature).toHaveBeenCalledTimes(1)
    expect(providerState.driver.verifySignature).toHaveBeenLastCalledWith({
      rawBody: '{}',
      headers: {},
      authorization: undefined,
    })
    expect(inboundEvents.claimInboundEvent).not.toHaveBeenCalled()
    expect(inboundEvents.attachInboundEventInbox).not.toHaveBeenCalled()
    expect(inboundEvents.completeInboundEvent).not.toHaveBeenCalled()
    expect(inboundEvents.failInboundEvent).not.toHaveBeenCalled()
    expect(inboundEvents.recordInboundRawKey).not.toHaveBeenCalled()
    expect(inboundEvents.rejectInboundEvent).not.toHaveBeenCalled()

    providerState.driver.verifySignature.mockClear()
    await expect(deliveryWebhook(event)).rejects.toMatchObject({ statusCode: 401 })
    expect(providerState.driver.verifySignature).toHaveBeenCalledTimes(1)
    expect(providerState.driver.verifySignature).toHaveBeenLastCalledWith({
      rawBody: '{}',
      headers: {},
      authorization: undefined,
    })
    expect(deliveryEvents.claimDeliveryEvent).not.toHaveBeenCalled()
    expect(deliveryEvents.completeDeliveryEvent).not.toHaveBeenCalled()
    expect(deliveryEvents.failDeliveryEvent).not.toHaveBeenCalled()
  })

  it('claims provider events before accepting duplicate webhook deliveries', async () => {
    state.params = { ...state.params, provider: 'postmark' }
    state.rawBody = '{}'
    providerState.driver.verifySignature.mockReturnValue(true)

    await expect(inboundWebhook(event)).resolves.toMatchObject({ data: { reason: 'duplicate-delivery' } })
    expect(providerState.driver.verifySignature).toHaveBeenCalledTimes(1)
    expect(providerState.driver.verifySignature).toHaveBeenLastCalledWith({
      rawBody: '{}',
      headers: {},
      authorization: undefined,
    })
    expect(inboundEvents.claimInboundEvent).toHaveBeenCalledTimes(1)
    expect(inboundEvents.claimInboundEvent).toHaveBeenLastCalledWith({
      provider: 'postmark',
      providerEventId: 'inbound-event-1',
    })

    providerState.driver.verifySignature.mockClear()
    deliveryEvents.claimDeliveryEvent.mockClear()
    await expect(deliveryWebhook(event)).resolves.toMatchObject({ data: { reason: 'duplicate-event' } })
    expect(providerState.driver.verifySignature).toHaveBeenCalledTimes(1)
    expect(providerState.driver.verifySignature).toHaveBeenLastCalledWith({
      rawBody: '{}',
      headers: {},
      authorization: undefined,
    })
    expect(deliveryEvents.claimDeliveryEvent).toHaveBeenCalledTimes(1)
    expect(deliveryEvents.claimDeliveryEvent).toHaveBeenLastCalledWith({
      provider: 'postmark',
      providerAccountKey: 'server-1',
      providerEventId: 'delivery-event-1',
      correlationKey: null,
      recordType: 'delivered',
      recipient: 'customer@example.com',
      messageId: null,
      occurredAt: new Date('2026-08-20T10:00:00Z'),
    })
  })

  it('keeps upload token, content-type, and body validation at separate boundaries', async () => {
    state.params = { ...state.params, token: '' }
    await expect(attachmentUpload(event)).rejects.toMatchObject({ statusCode: 400 })
    expect(uploadState.verifySupportUploadToken).not.toHaveBeenCalled()
    expect(storageState.putObject).not.toHaveBeenCalled()

    state.params = { ...state.params, token: 'invalid.signature' }
    state.headers = { 'content-type': 'text/plain' }
    state.rawBody = 'bytes'
    await expect(attachmentUpload(event)).rejects.toMatchObject({ statusCode: 400 })
    expect(uploadState.verifySupportUploadToken).toHaveBeenCalledTimes(1)
    expect(uploadState.verifySupportUploadToken).toHaveBeenLastCalledWith('invalid.signature')
    expect(storageState.putObject).not.toHaveBeenCalled()

    const token = signSupportUploadToken({ uploadId: 'upload-1', expiresAt: new Date(Date.now() + 60_000) })

    uploadState.verifySupportUploadToken.mockClear()
    state.params = { ...state.params, token }
    state.headers = { 'content-type': 'application/pdf' }
    state.rawBody = 'bytes'
    await expect(attachmentUpload(event)).rejects.toMatchObject({ statusCode: 404 })
    expect(uploadState.verifySupportUploadToken).toHaveBeenCalledWith(token)
    expect(storageState.putObject).not.toHaveBeenCalled()

    uploadState.verifySupportUploadToken.mockClear()
    state.headers = { 'content-type': 'text/plain' }
    state.rawBody = ''
    await expect(attachmentUpload(event)).rejects.toMatchObject({ statusCode: 404 })
    expect(uploadState.verifySupportUploadToken).toHaveBeenCalledWith(token)
    expect(storageState.putObject).not.toHaveBeenCalled()

    uploadState.verifySupportUploadToken.mockClear()
    state.rawBody = 'bytes'
    await expect(attachmentUpload(event)).rejects.toMatchObject({ statusCode: 404 })
    expect(uploadState.verifySupportUploadToken).toHaveBeenCalledTimes(1)
    expect(uploadState.verifySupportUploadToken).toHaveBeenLastCalledWith(token)
    expect(storageState.putObject).not.toHaveBeenCalled()
  })
})
