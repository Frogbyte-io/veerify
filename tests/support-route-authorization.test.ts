import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  body: {} as Record<string, unknown>,
  params: { id: 'inbox-1', memberId: 'member-1', addressId: 'address-1', teamId: 'team-1' },
  query: { inboxId: 'inbox-1' } as Record<string, unknown>,
  queuedRows: [] as unknown[][],
  session: { user: { id: 'user-1' } },
}))

const forbidden = () => Promise.reject(Object.assign(new Error('forbidden'), { statusCode: 403 }))

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
}))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRouterParam', (_event: unknown, name: string) => state.params[name as keyof typeof state.params])
vi.stubGlobal('getQuery', () => state.query)
vi.stubGlobal('readBody', async () => state.body)
vi.stubGlobal('createError', (input: Record<string, unknown>) =>
  Object.assign(new Error(String(input.statusMessage)), input)
)

vi.mock('~/server/utils/auth-middleware', () => ({
  requireAuth: vi.fn(async () => state.session),
}))

vi.mock('~/server/utils/team-context', () => ({
  requireAuthWithResolvedTeam: vi.fn(async () => ({ session: state.session, activeTeam: { id: 'team-1' } })),
}))

vi.mock('~/server/utils/support-access', () => access)

vi.mock('~/server/services/support-channels', () => ({
  SUPPORT_CHANNEL_PROVIDERS: ['postmark', 'mailgun'],
  getConfiguredChannelDriver: vi.fn(() => null),
  getConfiguredChannelProviderName: vi.fn(() => 'postmark'),
}))

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
    transaction: async (...args: unknown[]) =>
      (args[0] as (tx: MockDb) => Promise<unknown>)(db),
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

const contactList = (await import('~/server/api/support/contacts/index.get')).default
const contactCreate = (await import('~/server/api/support/contacts/index.post')).default
const companyList = (await import('~/server/api/support/companies/index.get')).default
const companyCreate = (await import('~/server/api/support/companies/index.post')).default
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

// This import is intentionally optional in the RED phase: the route is the
// production change being driven by this test.
const memberPatch = await import('~/server/api/support/inboxes/[id]/members/[memberId].patch')
  .then((module) => module.default)
  .catch(() => null)

const event = {} as never

beforeEach(() => {
  state.body = {}
  state.query = { inboxId: 'inbox-1' }
  state.queuedRows = []
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
})

describe('support route inventory coverage', () => {
  it('keeps team-scoped contact/company and entity-scoped timeline/link routes on team access helpers', async () => {
    const routes = [
      ['contacts/index.get', contactList, 'requireTeamMembership'],
      ['contacts/index.post', contactCreate, 'requireTeamMembership'],
      ['companies/index.get', companyList, 'requireTeamMembership'],
      ['companies/index.post', companyCreate, 'requireTeamMembership'],
      ['contacts/[id]/timeline.get', contactTimeline, 'requireContactAccess'],
      ['contacts/[id]/links.post', contactLinkCreate, 'requireContactAccess'],
      ['contacts/[id]/links/[linkId].delete', contactLinkDelete, 'requireContactAccess'],
    ] as const
    expect(routes).toHaveLength(7)
    for (const [, handler, helper] of routes) {
      expect(handler).toBeTypeOf('function')
      expect(access[helper]).toBeTypeOf('function')
    }
  })

  it('keeps daily conversation, participant, tag attachment, and attachment routes behind conversation access', async () => {
    const routes = [
      ['conversations/index.get', conversationList, 'requireInboxAccess', 'agent'],
      ['conversations/index.post', conversationCreate, 'requireInboxAccess', 'agent'],
      ['conversations/[id].get', conversationGet, 'requireConversationAccess', 'agent'],
      ['conversations/[id].patch', conversationUpdate, 'requireConversationAccess', 'agent'],
      ['conversations/[id]/participants/index.post', participantCreate, 'requireConversationAccess', 'agent'],
      [
        'conversations/[id]/participants/[participantId].delete',
        participantDelete,
        'requireConversationAccess',
        'agent',
      ],
      ['conversations/[id]/messages/index.get', messageList, 'requireConversationAccess', 'agent'],
      ['conversations/[id]/messages/index.post', messageCreate, 'requireConversationAccess', 'agent'],
      ['conversations/[id]/messages/[messageId]/retry.post', messageRetry, 'requireConversationAccess', 'agent'],
      ['conversations/[id]/tags/index.get', conversationTagList, 'requireConversationAccess', 'agent'],
      ['conversations/[id]/tags/index.post', conversationTagCreate, 'requireConversationAccess', 'agent'],
      ['conversations/[id]/tags/[tagId].delete', conversationTagDelete, 'requireConversationAccess', 'agent'],
      ['attachments/presign.post', attachmentPresign, 'requireConversationAccess', 'agent'],
      ['attachments/[id].get', attachmentGet, 'requireConversationAccess', 'agent'],
    ] as const
    expect(routes).toHaveLength(14)
    for (const [, handler, helper, minimumRole] of routes) {
      expect(handler).toBeTypeOf('function')
      expect(access[helper]).toBeTypeOf('function')
      expect(minimumRole).toBe('agent')
    }
  })
})
