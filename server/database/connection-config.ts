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
const IDENTITY_QUERY_PARAMETERS = ['host', 'port', 'user', 'password']
const ALLOWED_QUERY_PARAMETERS = new Set([...SSL_QUERY_PARAMETERS, ...IDENTITY_QUERY_PARAMETERS])

function hasValue(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeConnectionString(connectionString: string) {
  // PostgreSQL also accepts Unix-socket connection strings, so preserve those
  // as-is while normalizing URL-form SSL options below.
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

function decodeUrlPart(value: string, decode: typeof decodeURIComponent = decodeURIComponent) {
  try {
    return decode(value)
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL or Unix socket path')
  }
}

function parseUrlCredentials(connectionString: string, env: DatabaseEnvironment) {
  if (connectionString.startsWith('/')) {
    const [host, database] = connectionString.split(' ', 2)
    return {
      host,
      port: Number(env.PGPORT) || 5432,
      user: env.PGUSER || 'veerify',
      password: env.PGPASSWORD,
      database: database || env.PGDATABASE || 'veerifydb',
    }
  }

  const url = new URL(connectionString)
  for (const [key] of url.searchParams) {
    if (!ALLOWED_QUERY_PARAMETERS.has(key)) {
      throw new Error('DATABASE_URL contains an unsupported query parameter')
    }
  }
  const lastQueryValue = (key: string) => {
    const values = url.searchParams.getAll(key)
    return values.at(-1) ?? null
  }
  const queryHost = lastQueryValue('host')
  const queryPort = lastQueryValue('port')
  const queryUser = lastQueryValue('user')
  const queryPassword = lastQueryValue('password')
  const user = queryUser || decodeUrlPart(url.username)
  const password = queryPassword || decodeUrlPart(url.password)
  const host = (queryHost || url.hostname).replace(/^\[|\]$/g, '')
  const portValue = queryPort || url.port || env.PGPORT || '5432'
  const port = Number(portValue)
  if (!/^\d+$/.test(portValue) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL or Unix socket path')
  }

  const databasePath = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname
  const database = decodeUrlPart(databasePath) || env.PGDATABASE || user || env.PGUSER || env.USER || 'veerifydb'

  return {
    host: host || env.PGHOST || 'localhost',
    port,
    user: user || env.PGUSER || env.USER || 'veerify',
    password: password || env.PGPASSWORD,
    database,
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
      ...parseUrlCredentials(databaseUrl, env),
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
