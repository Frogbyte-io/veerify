import { describe, expect, it } from 'vitest'
import { resolveCsatInboxScope, type CsatInboxAccess } from '~/server/utils/csat-access'

const projectAccess = (isProjectAdmin: boolean): CsatInboxAccess => ({
  effectiveRole: isProjectAdmin ? 'admin' : 'agent',
  isProjectAdmin,
})

describe('resolveCsatInboxScope', () => {
  it('allows project admins to read all project inboxes without an explicit scope', () => {
    expect(
      resolveCsatInboxScope({
        projectId: 'project-1',
        userId: 'admin-1',
        projectAccess: projectAccess(true),
      })
    ).toEqual({ kind: 'all' })
  })

  it('limits non-admin implicit reads to the caller project inbox memberships', () => {
    expect(
      resolveCsatInboxScope({
        projectId: 'project-1',
        userId: 'agent-1',
        projectAccess: projectAccess(false),
      })
    ).toEqual({ kind: 'member', projectId: 'project-1', userId: 'agent-1' })
  })

  it('allows an explicit inbox only when it belongs to the requested project', () => {
    expect(
      resolveCsatInboxScope({
        projectId: 'project-1',
        userId: 'agent-1',
        projectAccess: projectAccess(false),
        requestedInboxId: 'inbox-1',
        requestedInboxProjectId: 'project-1',
      })
    ).toEqual({ kind: 'explicit', inboxId: 'inbox-1' })

    expect(() =>
      resolveCsatInboxScope({
        projectId: 'project-1',
        userId: 'agent-1',
        projectAccess: projectAccess(false),
        requestedInboxId: 'foreign-inbox',
        requestedInboxProjectId: 'project-2',
      })
    ).toThrowError(expect.objectContaining({ statusCode: 403 }))
  })
})
