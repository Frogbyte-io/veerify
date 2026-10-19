import type { Config } from 'drizzle-kit'
import { createDatabaseConnectionConfig } from './server/database/connection-config'

const connection = createDatabaseConnectionConfig()

export default {
  schema: './server/database/schema/index.ts',
  out: './server/database/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    host: connection.host || 'localhost',
    port: connection.port ?? 5432,
    user: connection.user || (connection.connectionString ? undefined : 'veerify'),
    password: connection.password || (connection.connectionString ? undefined : 'veerifypassword'),
    database: connection.database || 'veerifydb',
    ssl: connection.ssl,
  },
} satisfies Config
