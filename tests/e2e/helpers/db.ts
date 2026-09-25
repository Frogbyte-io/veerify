import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from '../../../server/database/schema/index'

/**
 * A drizzle client owned by the E2E suite, for fixture setup and teardown.
 *
 * **Do not import `~/server/database/drizzle` from a spec.** That module pulls
 * in `server/utils/logger.ts`, which does
 * `import { createConsola } from 'consola'`. Playwright resolves consola's
 * `require` condition to `lib/index.cjs`, whose exports are assigned in a
 * dynamic loop (`module.exports[key] = lib[key]`). `cjs-module-lexer` cannot
 * detect those statically, so the ESM named import fails and **the whole spec
 * file fails to collect** — reported only as `No tests found`, which reads like
 * a bad path rather than a broken import. Node and Nuxt resolve the `.mjs`
 * build instead, so the application itself is unaffected. See delta D-33.
 *
 * Importing the schema directly is safe: it depends on `drizzle-orm/pg-core`
 * and nothing else of the app's.
 *
 * Connection settings mirror `server/database/drizzle.ts` so the suite talks to
 * the same database the app under test is using.
 */
const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.PGHOST || 'localhost',
        port: Number(process.env.PGPORT) || 5432,
        user: process.env.PGUSER || 'veerify',
        password: process.env.PGPASSWORD || 'veerifypassword',
        database: process.env.PGDATABASE || 'veerifydb',
      }
)

export const db = drizzle(pool, { schema })
