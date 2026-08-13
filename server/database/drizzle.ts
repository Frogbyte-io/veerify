import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool, type PoolConfig } from 'pg'
import * as schema from './schema/index'
import { createLogger } from '../utils/logger'
import { isDatabaseConnectionError, summarizeDatabaseConnectionError } from '../utils/database-errors'
import 'dotenv/config'

const log = createLogger('db')

const poolConfig: PoolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    }
  : {
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT) || 5432,
      user: process.env.PGUSER || 'veerify',
      password: process.env.PGPASSWORD || 'veerifypassword',
      database: process.env.PGDATABASE || 'veerifydb',
      ssl: false,
    }

const pool = new Pool(poolConfig)

pool.on('error', (err: Error & { code?: string }) => {
  if (isDatabaseConnectionError(err)) {
    const summary = summarizeDatabaseConnectionError(err)
    log.warn(
      'PostgreSQL is unavailable. The dev server can still start, but database-backed routes will return 503 until the database is reachable. Start it with: docker compose -f docker-compose-dev.yml up -d',
      summary
    )
    return
  }
  log.error('PostgreSQL pool error', { error: err.message, code: err.code })
})

if (process.env.NODE_ENV !== 'test') {
  void pool.query('select 1').catch((error: unknown) => {
    if (isDatabaseConnectionError(error)) {
      log.warn(
        'Initial PostgreSQL connection check failed. The app will keep running, but any auth or data requests will fail until the database is available.',
        summarizeDatabaseConnectionError(error)
      )
      return
    }

    log.error('Initial PostgreSQL connection check failed with an unexpected error', summarizeDatabaseConnectionError(error))
  })
}

// Export the drizzle instance with schema
export const db = drizzle(pool, { schema })

// Export the promise version for backwards compatibility
export const dbPromise = Promise.resolve(db)
