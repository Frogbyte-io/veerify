import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireOrganizationAdmin: vi.fn(), requireOrganizationMember: vi.fn() }))
vi.mock('~/server/utils/project-access', () => mocks)
vi.mock('~/server/database/drizzle', () => ({ db: {} }))

const { requireCredentialAdmin, requireCredentialMember } = await import('~/server/utils/marketing-credential-routes')

const genericForbidden = () =>
  Object.assign(new Error('x'), {
    statusCode: 403,
    data: { error: { message: 'Only organization owners and admins can do this' } },
  })

describe('credential route access', () => {
  it('rewrites the generic 403 for non-admins', async () => {
    mocks.requireOrganizationAdmin.mockRejectedValueOnce(genericForbidden())
    const err = await requireCredentialAdmin('o1', 'u1').catch((e) => e)
    expect(err.statusCode).toBe(403)
    expect(JSON.stringify(err.data)).toContain('Only workspace owners and admins can manage marketing API keys')
  })

  it('rewrites the 403 for non-members', async () => {
    mocks.requireOrganizationMember.mockRejectedValueOnce(genericForbidden())
    const err = await requireCredentialMember('o1', 'u1').catch((e) => e)
    expect(err.statusCode).toBe(403)
    expect(JSON.stringify(err.data)).toContain('You do not have access to this workspace')
  })

  it('passes through other errors and successes', async () => {
    const boom = Object.assign(new Error('db down'), { statusCode: 500 })
    mocks.requireOrganizationAdmin.mockRejectedValueOnce(boom)
    await expect(requireCredentialAdmin('o1', 'u1')).rejects.toBe(boom)
    mocks.requireOrganizationMember.mockResolvedValueOnce('admin')
    await expect(requireCredentialMember('o1', 'u1')).resolves.toBe('admin')
  })
})
