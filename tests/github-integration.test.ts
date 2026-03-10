import { beforeEach, describe, expect, it, vi } from 'vitest'
import { githubIntegration } from '../server/database/schema/feedback'

const mocks = vi.hoisted(() => {
  const returningMock = vi.fn()
  const whereMock = vi.fn(() => ({ returning: returningMock }))
  const setMock = vi.fn(() => ({ where: whereMock }))
  const updateMock = vi.fn(() => ({ set: setMock }))

  return {
    returningMock,
    whereMock,
    setMock,
    updateMock,
  }
})

async function loadGithubIntegrationUtils() {
  return import('../server/utils/github-integration')
}

describe('github integration utils', () => {
  beforeEach(() => {
    mocks.returningMock.mockReset()
    mocks.whereMock.mockClear()
    mocks.setMock.mockClear()
    mocks.updateMock.mockClear()
  })

  it('detects a connected github account from either persisted or oauth token state', async () => {
    const { hasGithubIntegrationAccessToken } = await loadGithubIntegrationUtils()

    expect(hasGithubIntegrationAccessToken({ persistedAccessToken: 'persisted-token', oauthToken: null })).toBe(true)
    expect(hasGithubIntegrationAccessToken({ persistedAccessToken: null, oauthToken: 'oauth-token' })).toBe(true)
    expect(hasGithubIntegrationAccessToken({ persistedAccessToken: null, oauthToken: null })).toBe(false)
  })

  it('persists a refreshed oauth token for an existing integration', async () => {
    const { persistGithubIntegrationAccessToken } = await loadGithubIntegrationUtils()
    const updatedAt = new Date('2026-03-09T00:00:00.000Z')
    mocks.returningMock.mockResolvedValue([{ id: 'integration-1' }])
    const database = {
      update: mocks.updateMock,
    } as unknown as Parameters<typeof persistGithubIntegrationAccessToken>[3]

    const result = await persistGithubIntegrationAccessToken('project-1', 'new-token', updatedAt, database)

    expect(result).toBe(true)
    expect(mocks.updateMock).toHaveBeenCalledWith(githubIntegration)
    expect(mocks.setMock).toHaveBeenCalledWith({
      accessToken: 'new-token',
      updatedAt,
    })
    expect(mocks.whereMock).toHaveBeenCalledTimes(1)
  })

  it('skips persistence when project id or token is missing', async () => {
    const { persistGithubIntegrationAccessToken } = await loadGithubIntegrationUtils()

    expect(await persistGithubIntegrationAccessToken('', 'token')).toBe(false)
    expect(await persistGithubIntegrationAccessToken('project-1', '')).toBe(false)
    expect(mocks.updateMock).not.toHaveBeenCalled()
  })
})
