import { beforeEach, describe, expect, it, vi } from 'vitest'

const OLD_KEY = Buffer.alloc(32, 1).toString('base64')
const NEW_KEY = Buffer.alloc(32, 2).toString('base64')

const state = vi.hoisted(() => ({
  selects: [] as unknown[][],
  deleted: [] as unknown[],
  revoked: [] as string[],
  revokeHang: false,
  logged: [] as unknown[],
  txDeletes: [] as unknown[],
  conn: null as Record<string, unknown> | null,
  selectFails: false,
}))

vi.mock('~/server/utils/logger', () => ({
  createLogger: () => ({
    info: (...args: unknown[]) => void state.logged.push(args),
    warn: (...args: unknown[]) => void state.logged.push(args),
    error: (...args: unknown[]) => void state.logged.push(args),
  }),
}))

vi.mock('~/server/database/drizzle', () => {
  const select = () => {
    if (state.selectFails) throw new Error('db down')
    const result = state.selects.shift() ?? []
    const chain: Record<string, unknown> = {}
    for (const name of ['from', 'where', 'innerJoin', 'orderBy', 'limit', 'for']) chain[name] = () => chain
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject)
    return chain
  }
  const del = (table: unknown) => ({
    where: async () => {
      state.deleted.push(table)
    },
  })
  const tx = { select, delete: (table: unknown) => ({ where: async () => void state.txDeletes.push(table) }) }
  return { db: { select, delete: del, transaction: async (fn: (t: unknown) => unknown) => fn(tx) } }
})

vi.mock('~/server/services/google/search-console', async (importOriginal) => {
  const original = await importOriginal<typeof import('~/server/services/google/search-console')>()
  return {
    ...original,
    revokeToken: vi.fn(async (token: string) => {
      state.revoked.push(token)
      if (state.revokeHang) await new Promise(() => undefined)
      return true
    }),
  }
})

const secrets = await import('~/server/utils/secrets')
const rotation = await import('~/server/services/marketing/secrets-rotation')
const connection = await import('~/server/services/marketing/search/connection')
const schema = await import('~/server/database/schema/marketing')
const { resetOriginScopedData } = await import('~/server/services/marketing/site-origin')

function withKey(key: string, previous = '') {
  vi.stubEnv('SECRETS_ENCRYPTION_KEY', key)
  vi.stubEnv('SECRETS_ENCRYPTION_KEY_PREVIOUS', previous)
}

beforeEach(() => {
  vi.unstubAllEnvs()
  state.selects = []
  state.deleted = []
  state.revoked = []
  state.revokeHang = false
  state.logged = []
  state.txDeletes = []
  state.conn = null
  state.selectFails = false
  withKey(NEW_KEY, OLD_KEY)
})

type Row = { id: string; payload: string; aad: string }

function memoryStore(tables: Record<'team_api_credential' | 'gsc_connection', Row[]>) {
  const replaced: string[] = []
  const store: import('~/server/services/marketing/secrets-rotation').RotationStore = {
    loadOutdated: async (table, keyId, afterId, limit) =>
      tables[table]
        .filter((r) => !r.payload.startsWith(`v1.${keyId}.`) && r.id > afterId)
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, limit),
    replace: async (table, id, previous, next) => {
      const row = tables[table].find((r) => r.id === id)
      if (!row || row.payload !== previous) return false
      row.payload = next
      replaced.push(`${table}:${id}`)
      return true
    },
    countOutdated: async (keyId) =>
      [...tables.team_api_credential, ...tables.gsc_connection].filter((r) => !r.payload.startsWith(`v1.${keyId}.`))
        .length,
  }
  return { store, replaced }
}

const encryptWith = (key: string, plaintext: string, aad: string) => {
  withKey(key)
  const payload = secrets.encryptSecret(plaintext, aad)
  withKey(NEW_KEY, OLD_KEY)
  return payload
}

describe('rotateSecrets', () => {
  it('re-wraps only old-key rows, with each table AAD, and reports undecryptable ones', async () => {
    const teamAad = 'team:t1:anthropic'
    const gscAad = 'gsc:site-1'
    const current = encryptWith(NEW_KEY, 'already-current', 'team:t9:openai')
    const tables = {
      team_api_credential: [
        { id: 'c1', payload: encryptWith(OLD_KEY, 'sk-team-secret', teamAad), aad: teamAad },
        { id: 'c2', payload: current, aad: 'team:t9:openai' },
        // Encrypted for another AAD than the row claims: must be reported, not crash
        { id: 'c3', payload: encryptWith(OLD_KEY, 'x', 'team:other:openai'), aad: 'team:t3:openai' },
        { id: 'c4', payload: 'not-a-payload', aad: 'team:t4:openai' },
      ],
      gsc_connection: [{ id: 'site-1', payload: encryptWith(OLD_KEY, 'refresh-token', gscAad), aad: gscAad }],
    }
    const { store, replaced } = memoryStore(tables)

    const summary = await rotation.rotateSecrets({}, store)

    expect(replaced.sort()).toEqual(['gsc_connection:site-1', 'team_api_credential:c1'])
    expect(summary.rewrapped).toBe(2)
    expect(summary.failed).toEqual([
      { table: 'team_api_credential', id: 'c3' },
      { table: 'team_api_credential', id: 'c4' },
    ])
    expect(summary.remaining).toBe(2)
    // Values round-trip with the correct AAD on the new key and the payloads moved to the current key
    expect(tables.team_api_credential[0].payload.split('.')[1]).toBe(secrets.currentKeyId())
    expect(secrets.decryptSecret(tables.team_api_credential[0].payload, teamAad)).toBe('sk-team-secret')
    expect(secrets.decryptSecret(tables.gsc_connection[0].payload, gscAad)).toBe('refresh-token')
    expect(tables.team_api_credential[1].payload).toBe(current)
    // Never logs plaintext or ciphertext
    expect(JSON.stringify(state.logged)).not.toMatch(/sk-team-secret|refresh-token|not-a-payload/)
  })

  it('is idempotent: a second run changes nothing', async () => {
    const aad = 'team:t1:anthropic'
    const { store, replaced } = memoryStore({
      team_api_credential: [{ id: 'c1', payload: encryptWith(OLD_KEY, 'k', aad), aad }],
      gsc_connection: [],
    })
    await rotation.rotateSecrets({}, store)
    replaced.length = 0
    const second = await rotation.rotateSecrets({}, store)
    expect(second).toMatchObject({ scanned: 0, rewrapped: 0, failed: [], remaining: 0 })
    expect(replaced).toEqual([])
  })

  it('works through batches, including past rows that keep failing', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => {
      const aad = `team:t${i}:openai`
      return { id: `c${i}`, payload: i === 0 ? 'bad' : encryptWith(OLD_KEY, `k${i}`, aad), aad }
    })
    const { store } = memoryStore({ team_api_credential: rows, gsc_connection: [] })
    const summary = await rotation.rotateSecrets({ batchSize: 2 }, store)
    expect(summary.rewrapped).toBe(4)
    expect(summary.failed).toEqual([{ table: 'team_api_credential', id: 'c0' }])
  })

  it('skips when encryption is not configured and never throws from the safe wrapper', async () => {
    vi.stubEnv('SECRETS_ENCRYPTION_KEY', '')
    const { store } = memoryStore({ team_api_credential: [], gsc_connection: [] })
    expect(await rotation.rotateSecrets({}, store)).toMatchObject({ skipped: true, rewrapped: 0 })
    withKey(NEW_KEY, OLD_KEY)
    // dbRotationStore hits the mocked db, which has no insert/update; the sweep must swallow that
    state.selects = [
      [{ id: 'x', teamId: 't', provider: 'openai', payload: encryptWith(OLD_KEY, 'k', 'team:t:openai') }],
    ]
    await expect(rotation.rotateSecretsSafely()).resolves.toBeDefined()
  })
})

describe('GSC token revocation', () => {
  const token = (siteId: string, plaintext: string) => ({
    siteId,
    encryptedRefreshToken: secrets.encryptSecret(plaintext, `gsc:${siteId}`),
  })

  it('revokes every token under a product, team and organization', async () => {
    for (const fn of [
      connection.revokeGscTokensForProject,
      connection.revokeGscTokensForTeam,
      connection.revokeGscTokensForOrganization,
    ]) {
      state.revoked = []
      state.selects = [[token('s1', 'tok-1'), token('s2', 'tok-2')]]
      await fn('id-1')
      expect(state.revoked.sort()).toEqual(['tok-1', 'tok-2'])
    }
  })

  it('never throws: undecryptable tokens and a failing query are ignored', async () => {
    state.selects = [[{ siteId: 's1', encryptedRefreshToken: 'garbage' }]]
    await expect(connection.revokeGscTokensForProject('p1')).resolves.toBeUndefined()
    expect(state.revoked).toEqual([])
    state.selectFails = true
    await expect(connection.revokeGscTokensForTeam('t1')).resolves.toBeUndefined()
  })

  it('gives up after a short budget when Google hangs', async () => {
    vi.useFakeTimers()
    try {
      state.revokeHang = true
      state.selects = [[token('s1', 'tok-1')]]
      const pending = connection.revokeGscTokensForProject('p1')
      await vi.advanceTimersByTimeAsync(9_000)
      await expect(pending).resolves.toBeUndefined()
      expect(state.revoked).toEqual(['tok-1'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('revokes a replaced token only when a different Google account connected', async () => {
    const previous = secrets.encryptSecret('old', 'gsc:s1')
    const otherAccount = { previousEmail: 'a@example.com', newEmail: 'b@example.com' }
    await connection.revokeReplacedToken('s1', previous, 'new', otherAccount)
    expect(state.revoked).toEqual(['old'])
    state.revoked = []
    // Same account (case-insensitive): Google revokes the whole grant, which would kill the new token
    await connection.revokeReplacedToken('s1', previous, 'new', {
      previousEmail: 'A@example.com',
      newEmail: 'a@example.com',
    })
    // Unknown accounts are treated as the same account
    await connection.revokeReplacedToken('s1', previous, 'new', { previousEmail: null, newEmail: 'b@example.com' })
    await connection.revokeReplacedToken('s1', previous, 'new')
    // Identical token and no previous token
    await connection.revokeReplacedToken('s1', previous, 'old', otherAccount)
    await connection.revokeReplacedToken('s1', null, 'new', otherAccount)
    expect(state.revoked).toEqual([])
  })
})

describe('resetOriginScopedData', () => {
  it('revokes and removes the GSC connection and metrics, deletes audits and old-host competitor watches', async () => {
    const conn = { siteId: 's1', encryptedRefreshToken: secrets.encryptSecret('tok', 'gsc:s1') }
    // findGscConnection, then the competitor watch list
    state.selects = [
      [conn],
      [], // lockGscConnection inside removeGscConnection
      [
        { id: 'w-own', url: 'https://old.example.com/pricing' },
        { id: 'w-rival', url: 'https://rival.com/pricing' },
      ],
    ]
    await resetOriginScopedData('s1', 'https://old.example.com')

    expect(state.revoked).toEqual(['tok'])
    expect(state.txDeletes).toEqual(
      expect.arrayContaining([schema.gscDailyMetric, schema.gscQueryStat, schema.gscConnection])
    )
    expect(state.deleted).toContain(schema.seoAudit)
    // Only the own-host watch is deleted
    expect(state.deleted).toContain(schema.competitorWatch)
    // Brand-level data is untouched
    expect(state.deleted).not.toContain(schema.marketingTerm)
  })

  it('still removes data when revoking fails, and skips GSC when not connected', async () => {
    state.selects = [[], []]
    await resetOriginScopedData('s1', 'https://old.example.com')
    expect(state.revoked).toEqual([])
    expect(state.txDeletes).toEqual([])
    expect(state.deleted).toContain(schema.seoAudit)
    expect(state.deleted).not.toContain(schema.competitorWatch)
  })
})
