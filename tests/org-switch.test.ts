import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pickTeamForOrganization, shouldLeaveRouteOnOrgSwitch } from '~/lib/org-switch'

const state = vi.hoisted(() => ({
  membership: [] as unknown[],
  teams: [] as Array<{ id: string; name: string; organizationId: string }>,
  updates: [] as unknown[],
}))

vi.mock('~/server/database/drizzle', () => {
  // The member lookup ends in limit(); the user-teams lookup ends in orderBy().
  const chain: Record<string, unknown> = {}
  chain.from = () => chain
  chain.innerJoin = () => chain
  chain.where = () => chain
  chain.limit = () => Promise.resolve(state.membership)
  chain.orderBy = () => Promise.resolve(state.teams)
  return {
    db: {
      select: () => chain,
      update: () => ({
        set: (values: unknown) => ({
          where: () => {
            state.updates.push(values)
            return Promise.resolve()
          },
        }),
      }),
    },
  }
})
vi.mock('~/lib/auth', () => ({ auth: { api: {} } }))
vi.stubGlobal('createError', (input: Record<string, unknown>) =>
  Object.assign(new Error(String(input.statusMessage)), input)
)

const { setActiveOrganizationForSession } = await import('~/server/utils/team-context')

const teams = [
  { id: 'a-default', name: 'Default', organizationId: 'org-a' },
  { id: 'b-support', name: 'Support', organizationId: 'org-b' },
  { id: 'b-default', name: 'Default', organizationId: 'org-b' },
]

describe('pickTeamForOrganization', () => {
  it('prefers the last-used team when it belongs to the organization', () => {
    expect(pickTeamForOrganization(teams, 'org-b', 'b-support')?.id).toBe('b-support')
  })

  it('ignores a hinted team from another organization and falls back to Default', () => {
    expect(pickTeamForOrganization(teams, 'org-b', 'a-default')?.id).toBe('b-default')
  })

  it('falls back to the first team when there is no Default', () => {
    expect(pickTeamForOrganization(teams.slice(1, 2), 'org-b')?.id).toBe('b-support')
  })

  it('returns null when the user has no team in the organization', () => {
    expect(pickTeamForOrganization(teams, 'org-c')).toBeNull()
  })
})

describe('shouldLeaveRouteOnOrgSwitch', () => {
  it('keeps top-level, dashboard and settings pages', () => {
    for (const path of ['/dashboard', '/support', '/feedback?x=1', '/dashboard/roadmap', '/settings#team']) {
      expect(shouldLeaveRouteOnOrgSwitch(path)).toBe(false)
    }
  })

  it('leaves record/detail pages', () => {
    expect(shouldLeaveRouteOnOrgSwitch('/support/conv-1')).toBe(true)
    expect(shouldLeaveRouteOnOrgSwitch('/feedback/abc')).toBe(true)
  })
})

describe('setActiveOrganizationForSession', () => {
  beforeEach(() => {
    state.membership = [{ id: 'm1' }]
    // The query is already scoped to the organization in SQL; the helper re-filters defensively.
    state.teams = [teams[1]!, teams[2]!]
    state.updates = []
  })

  const params = { sessionToken: 'tok', userId: 'u1', organizationId: 'org-b' }

  it('rejects a non-member of the organization without touching the session', async () => {
    state.membership = []
    await expect(setActiveOrganizationForSession(params)).rejects.toMatchObject({ statusCode: 403 })
    expect(state.updates).toEqual([])
  })

  it('sets organization and team together, honouring a valid hint', async () => {
    const result = await setActiveOrganizationForSession({ ...params, preferredTeamId: 'b-support' })
    expect(result.id).toBe('b-support')
    expect(state.updates).toEqual([{ activeTeamId: 'b-support', activeOrganizationId: 'org-b' }])
  })

  it('never activates a team from another organization', async () => {
    state.teams = [teams[0]!, teams[1]!, teams[2]!]
    const result = await setActiveOrganizationForSession({ ...params, preferredTeamId: 'a-default' })
    expect(result.organizationId).toBe('org-b')
    expect(state.updates).toEqual([{ activeTeamId: 'b-default', activeOrganizationId: 'org-b' }])
  })

  it('returns 409 when the user is an org member with no team in it', async () => {
    state.teams = []
    await expect(setActiveOrganizationForSession(params)).rejects.toMatchObject({ statusCode: 409 })
    expect(state.updates).toEqual([])
  })
})
