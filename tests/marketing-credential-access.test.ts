import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireTeamAdmin: vi.fn(), requireTeamMembership: vi.fn() }))
vi.mock('~/server/utils/support-access', () => mocks)
vi.mock('~/server/database/drizzle', () => ({ db: {} }))

const { requireCredentialAdmin, requireCredentialMember } = await import('~/server/utils/marketing-credential-routes')

const supportForbidden = () =>
  Object.assign(new Error('x'), {
    statusCode: 403,
    data: { error: { message: 'You do not have access to this support inbox' } },
  })

describe('credential route access', () => {
  it('rewrites the support-inbox 403 for non-admins', async () => {
    mocks.requireTeamAdmin.mockRejectedValueOnce(supportForbidden())
    const err = await requireCredentialAdmin('t1', 'u1').catch((e) => e)
    expect(err.statusCode).toBe(403)
    expect(JSON.stringify(err.data)).toContain('Only team admins can manage marketing API keys')
    expect(JSON.stringify(err.data)).not.toContain('support inbox')
  })

  it('rewrites the 403 for non-members without mentioning inboxes', async () => {
    mocks.requireTeamMembership.mockRejectedValueOnce(supportForbidden())
    const err = await requireCredentialMember('t1', 'u1').catch((e) => e)
    expect(err.statusCode).toBe(403)
    expect(JSON.stringify(err.data)).not.toContain('support inbox')
  })

  it('passes through other errors and successes', async () => {
    const boom = Object.assign(new Error('db down'), { statusCode: 500 })
    mocks.requireTeamAdmin.mockRejectedValueOnce(boom)
    await expect(requireCredentialAdmin('t1', 'u1')).rejects.toBe(boom)
    mocks.requireTeamMembership.mockResolvedValueOnce({ role: 'admin' })
    await expect(requireCredentialMember('t1', 'u1')).resolves.toEqual({ role: 'admin' })
  })
})
