import { randomBytes } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  inserted: undefined as Record<string, unknown> | undefined,
  conflictSet: undefined as Record<string, unknown> | undefined,
  selectRows: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
}))

vi.mock('~/server/database/drizzle', () => {
  const chain = (rows: () => unknown[]) => {
    const query = {
      from: () => query,
      where: () => query,
      limit: () => Promise.resolve(rows()),
      then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows()).then(resolve),
    }
    return query
  }
  return {
    db: {
      select: () => chain(() => state.selectRows),
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          state.inserted = values
          return {
            onConflictDoUpdate: (config: { set: Record<string, unknown> }) => {
              state.conflictSet = config.set
              return { returning: () => Promise.resolve([values]) }
            },
          }
        },
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          state.updates.push(values)
          return { where: () => ({ returning: () => Promise.resolve([{ id: 'c1' }]) }) }
        },
      }),
    },
  }
})

process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('base64')

const { getTeamApiKey, markCredentialInvalid, saveTeamCredential, isApiCredentialProvider } =
  await import('~/server/utils/team-credentials')

beforeEach(() => {
  state.inserted = undefined
  state.conflictSet = undefined
  state.selectRows = []
  state.updates = []
})

describe('team credentials', () => {
  it('stores only an encrypted envelope and a hint', async () => {
    const summary = await saveTeamCredential({
      teamId: 'team-1',
      provider: 'anthropic',
      apiKey: 'sk-ant-secret-value-1234',
      userId: 'user-1',
      status: 'valid',
    })

    expect(state.inserted?.encryptedKey).not.toContain('sk-ant-secret-value')
    expect(summary).not.toHaveProperty('encryptedKey')
    expect(summary.keyHint).toBe('…1234')
    // Replacing a key without a budget must not clear the existing budget
    expect(state.conflictSet).not.toHaveProperty('monthlyBudgetCents')
  })

  it('decrypts for the same team and provider only', async () => {
    await saveTeamCredential({
      teamId: 'team-1',
      provider: 'openai',
      apiKey: 'sk-openai-abcdef',
      userId: 'u',
      status: 'valid',
    })
    state.selectRows = [{ encryptedKey: state.inserted?.encryptedKey, status: 'valid', monthlyBudgetCents: null }]

    await expect(getTeamApiKey('team-1', 'openai')).resolves.toMatchObject({ apiKey: 'sk-openai-abcdef' })
    // Same envelope read as another team's row: associated data mismatch
    await expect(getTeamApiKey('team-2', 'openai')).resolves.toBeNull()
    await expect(getTeamApiKey('team-1', 'anthropic')).resolves.toBeNull()
  })

  it('returns null when no key is stored', async () => {
    await expect(getTeamApiKey('team-1', 'firecrawl')).resolves.toBeNull()
  })

  it('reports only the transition into invalid', async () => {
    state.selectRows = [{ status: 'valid' }]
    await expect(markCredentialInvalid('team-1', 'anthropic', 'revoked')).resolves.toBe(true)
    state.selectRows = [{ status: 'invalid' }]
    await expect(markCredentialInvalid('team-1', 'anthropic', 'revoked')).resolves.toBe(false)
    state.selectRows = []
    await expect(markCredentialInvalid('team-1', 'anthropic', 'revoked')).resolves.toBe(false)
  })

  it('recognises provider ids', () => {
    expect(isApiCredentialProvider('pagespeed')).toBe(true)
    expect(isApiCredentialProvider('mistral')).toBe(false)
  })
})
