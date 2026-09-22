import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema/index'
import { createDatabaseConnectionConfig } from './connection-config'
import { createLogger } from '../utils/logger'
import 'dotenv/config'

const log = createLogger('db')

const poolConfig = createDatabaseConnectionConfig()

const pool = new Pool(poolConfig)

pool.on('error', (err: Error & { code?: string }) => {
  if (err.code === 'ECONNREFUSED') {
    log.error(
      'Could not connect to PostgreSQL. Make sure the database is running: docker compose -f docker-compose-dev.yml up -d',
      { code: err.code }
    )
  } else {
    log.error('PostgreSQL pool error', { error: err.message, code: err.code })
  }
})

// Export the drizzle instance with schema
export const db = drizzle(pool, { schema })

// Export the promise version for backwards compatibility
export const dbPromise = Promise.resolve(db)
