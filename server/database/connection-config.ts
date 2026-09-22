export type DatabaseEnvironment = Readonly<Record<string, string | undefined>>

export type DatabaseTlsOptions =
  | false
  | {
      rejectUnauthorized: true
      ca?: string
    }

export type DatabaseConnectionConfig = {
  connectionString?: string
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  ssl: DatabaseTlsOptions
}

const SSL_QUERY_PARAMETERS = ['ssl', 'sslcert', 'sslkey', 'sslmode', 'sslpassword', 'sslrootcert', 'uselibpqcompat']

function hasValue(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeConnectionString(connectionString: string) {
  // PostgreSQL also accepts Unix-socket connection strings. They cannot contain
  // URL query options, so preserve them as-is for node-postgres to parse.
  if (connectionString.startsWith('/')) return connectionString

  try {
    const url = new URL(connectionString)
    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
      throw new Error('unsupported protocol')
    }
    for (const parameter of SSL_QUERY_PARAMETERS) url.searchParams.delete(parameter)
    return url.toString()
  } catch {
    // Do not forward malformed or non-PostgreSQL URLs to node-postgres: its
    // parser accepts more forms and could reapply an unsafe SSL query option.
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL or Unix socket path')
  }
}

function resolveTlsOptions(env: DatabaseEnvironment, hasDatabaseUrl: boolean): DatabaseTlsOptions {
  const explicitMode = hasValue(env.DATABASE_SSL_MODE) ? env.DATABASE_SSL_MODE!.trim() : undefined
  if (explicitMode && explicitMode !== 'disable' && explicitMode !== 'verify-full') {
    throw new Error('DATABASE_SSL_MODE must be either "disable" or "verify-full"')
  }

  const ca = hasValue(env.DATABASE_SSL_CA) ? env.DATABASE_SSL_CA : undefined
  const mode = explicitMode || (env.NODE_ENV === 'production' && hasDatabaseUrl ? 'verify-full' : 'disable')

  if (mode === 'disable') {
    if (ca) throw new Error('DATABASE_SSL_CA cannot be used when DATABASE_SSL_MODE is disable')
    return false
  }

  return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true }
}

/**
 * Resolve one safe pg configuration for the app, migrator, and deployment
 * scripts. SSL query parameters and PGSSLMODE are deliberately not allowed to
 * override DATABASE_SSL_MODE or the production DATABASE_URL default.
 */
export function createDatabaseConnectionConfig(env: DatabaseEnvironment = process.env): DatabaseConnectionConfig {
  const databaseUrl = hasValue(env.DATABASE_URL) ? env.DATABASE_URL : undefined
  const ssl = resolveTlsOptions(env, Boolean(databaseUrl))

  if (databaseUrl) {
    return {
      connectionString: normalizeConnectionString(databaseUrl),
      ssl,
    }
  }

  return {
    host: env.PGHOST || 'localhost',
    port: Number(env.PGPORT) || 5432,
    user: env.PGUSER || 'veerify',
    password: env.PGPASSWORD || 'veerifypassword',
    database: env.PGDATABASE || 'veerifydb',
    ssl,
  }
}
