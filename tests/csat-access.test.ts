import { describe, expect, it } from 'vitest'
import { resolveCsatInboxScope, type CsatInboxAccess } from '~/server/utils/csat-access'

const teamAccess = (isTeamAdmin: boolean): CsatInboxAccess => ({
  effectiveRole: isTeamAdmin ? 'admin' : 'agent',
  isTeamAdmin,
})

describe('resolveCsatInboxScope', () => {
  it('allows team admins to read all team inboxes without an explicit scope', () => {
    expect(
      resolveCsatInboxScope({
        teamId: 'team-1',
        userId: 'admin-1',
        teamAccess: teamAccess(true),
      })
    ).toEqual({ kind: 'all' })
  })

  it('limits non-admin implicit reads to the caller team inbox memberships', () => {
    expect(
      resolveCsatInboxScope({
        teamId: 'team-1',
        userId: 'agent-1',
        teamAccess: teamAccess(false),
      })
    ).toEqual({ kind: 'member', teamId: 'team-1', userId: 'agent-1' })
  })

  it('allows an explicit inbox only when it belongs to the requested team', () => {
    expect(
      resolveCsatInboxScope({
        teamId: 'team-1',
        userId: 'agent-1',
        teamAccess: teamAccess(false),
        requestedInboxId: 'inbox-1',
        requestedInboxTeamId: 'team-1',
      })
    ).toEqual({ kind: 'explicit', inboxId: 'inbox-1' })

    expect(() =>
      resolveCsatInboxScope({
        teamId: 'team-1',
        userId: 'agent-1',
        teamAccess: teamAccess(false),
        requestedInboxId: 'foreign-inbox',
        requestedInboxTeamId: 'team-2',
      })
    ).toThrowError(expect.objectContaining({ statusCode: 403 }))
  })
})
