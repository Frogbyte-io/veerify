import { drizzle } from 'drizzle-orm/node-postgres'

export interface CapturedQuery {
  text: string
  params: unknown[]
}

/**
 * A real drizzle instance over a fake pg client: queries are built and rendered by drizzle, recorded in
 * `log`, and answered by `respond` (rows as arrays in selected-column order; empty by default).
 */
export function createFakeDb(log: CapturedQuery[], respond?: (text: string) => unknown[][]) {
  const client = {
    query: async (query: string | { text: string; values?: unknown[] }, params?: unknown[]) => {
      const text = typeof query === 'string' ? query : query.text
      const values = params ?? (typeof query === 'string' ? [] : (query.values ?? []))
      log.push({ text, params: values })
      const rows = respond?.(text) ?? []
      return { rows, rowCount: rows.length, fields: [], command: '', oid: 0 }
    },
  }
  return drizzle(client as never)
}
