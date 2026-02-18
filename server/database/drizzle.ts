import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool, type PoolConfig } from 'pg'
import * as schema from './schema/index'
import 'dotenv/config'

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
  if (err.code === 'ECONNREFUSED') {
    console.error(
      '\n' +
        '╔══════════════════════════════════════════════════════════════╗\n' +
        '║  ❌ Could not connect to PostgreSQL                        ║\n' +
        '║                                                            ║\n' +
        '║  Make sure the database is running:                        ║\n' +
        '║    docker compose -f docker-compose-dev.yml up -d          ║\n' +
        '║                                                            ║\n' +
        '║  Then restart the dev server:                              ║\n' +
        '║    yarn dev                                                ║\n' +
        '╚══════════════════════════════════════════════════════════════╝\n'
    )
  } else {
    console.error('PostgreSQL pool error:', err)
  }
})

// Export the drizzle instance with schema
export const db = drizzle(pool, { schema })

// Export the promise version for backwards compatibility
export const dbPromise = Promise.resolve(db)
