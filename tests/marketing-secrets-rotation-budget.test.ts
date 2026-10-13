import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/server/database/drizzle', () => ({ db: {} }))

const secrets = vi.hoisted(() => ({ bad: new Set<string>() }))

vi.mock('~/server/utils/secrets', () => ({
  isSecretsConfigured: () => true,
  currentKeyId: () => 'k2',
  needsReencryption: () => true,
  decryptSecret: (payload: string) => {
    if (secrets.bad.has(payload)) throw new Error('bad payload')
    return `plain:${payload}`
  },
  encryptSecret: (plain: string) => `v1.k2.${plain}`,
}))

const { rotateSecrets } = await import('~/server/services/marketing/secrets-rotation')
type Store = Parameters<typeof rotateSecrets>[1]
type Table = 'team_api_credential' | 'gsc_connection'

function makeStore(rows: Record<Table, Array<{ id: string; payload: string }>>) {
  const loads: Array<{ table: Table; afterId: string }> = []
  const replaced: Array<{ table: Table; id: string }> = []
  const store: Store = {
    async loadOutdated(table, _keyId, afterId, limit) {
      loads.push({ table, afterId })
      return rows[table]
        .filter((r) => r.id > afterId)
        .slice(0, limit)
        .map((r) => ({ ...r, aad: `aad:${r.id}` }))
    },
    async replace(table, id) {
      replaced.push({ table, id })
      return true
    },
    async countOutdated() {
      return 0
    },
  }
  return { store, loads, replaced }
}

const ids = (prefix: string, count: number, payload: (i: number) => string) =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}${String(i).padStart(3, '0')}`, payload: payload(i) }))

beforeEach(() => secrets.bad.clear())

describe('rotateSecrets budgets', () => {
  it('gives each table its own row budget', async () => {
    const { store, replaced } = makeStore({
      team_api_credential: ids('a', 10, (i) => `ok-a${i}`),
      gsc_connection: ids('b', 10, (i) => `ok-b${i}`),
    })
    const summary = await rotateSecrets({ batchSize: 4, maxRows: 6 }, store)
    // 6 per table, not 6 in total: the second table is not starved by the first
    expect(replaced.filter((r) => r.table === 'team_api_credential')).toHaveLength(6)
    expect(replaced.filter((r) => r.table === 'gsc_connection')).toHaveLength(6)
    expect(summary.rewrapped).toBe(12)
  })

  it('does not let undecryptable rows use up the budget or starve the other table', async () => {
    const credentials = ids('a', 8, (i) => `bad-a${i}`)
    for (const row of credentials) secrets.bad.add(row.payload)
    const { store, replaced } = makeStore({
      team_api_credential: [...credentials, ...ids('c', 3, (i) => `ok-c${i}`)],
      gsc_connection: ids('b', 3, (i) => `ok-b${i}`),
    })
    const summary = await rotateSecrets({ batchSize: 3, maxRows: 5 }, store)
    expect(summary.failed.filter((f) => f.table === 'team_api_credential')).toHaveLength(8)
    // Failures cost nothing: the healthy credentials behind them are still rewrapped
    expect(replaced.filter((r) => r.table === 'team_api_credential').map((r) => r.id)).toEqual(['c000', 'c001', 'c002'])
    expect(replaced.filter((r) => r.table === 'gsc_connection')).toHaveLength(3)
  })

  it('reads a failed row only once per run (the cursor moves past it)', async () => {
    const rows = ids('a', 5, (i) => `bad-a${i}`)
    for (const row of rows) secrets.bad.add(row.payload)
    const { store, loads } = makeStore({ team_api_credential: rows, gsc_connection: [] })
    const summary = await rotateSecrets({ batchSize: 2, maxRows: 3 }, store)
    expect(summary.failed).toHaveLength(5)
    expect(summary.scanned).toBe(5)
    const cursors = loads.filter((l) => l.table === 'team_api_credential').map((l) => l.afterId)
    expect(new Set(cursors).size).toBe(cursors.length)
  })
})
