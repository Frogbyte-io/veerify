import { Client, Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { createDatabaseConnectionConfig } from '../server/database/connection-config'

type ResolvedConnection = {
  ssl: false | { rejectUnauthorized?: boolean; ca?: string }
  host: string
  port: number
  user: string
  database: string
  password?: string | null
}

function resolveParametersWithPg(config: ConstructorParameters<typeof Client>[0]): ResolvedConnection {
  const hostConfig = { ...((config || {}) as Record<string, unknown>) }
  delete hostConfig.connectionString
  const client = new Client(hostConfig)
  return (client as unknown as { connectionParameters: ResolvedConnection }).connectionParameters
}

function resolveWithPg(config: ConstructorParameters<typeof Client>[0]): ResolvedConnection['ssl'] {
  return resolveParametersWithPg(config).ssl
}

describe('database connection TLS configuration', () => {
  it('gives Drizzle Kit decoded host credentials instead of URL credentials', async () => {
    const previousEnvironment = {
      DATABASE_URL: process.env.DATABASE_URL,
      DATABASE_SSL_MODE: process.env.DATABASE_SSL_MODE,
      DATABASE_SSL_CA: process.env.DATABASE_SSL_CA,
      NODE_ENV: process.env.NODE_ENV,
    }

    try {
      delete process.env.DATABASE_URL
      delete process.env.DATABASE_SSL_MODE
      delete process.env.DATABASE_SSL_CA
      delete process.env.NODE_ENV
      process.env.DATABASE_URL = 'postgresql://enc%40user:p%40ss%3Aword@db.example.test:6543/app%20db?sslmode=require'
      process.env.NODE_ENV = 'production'
      vi.resetModules()

      const config = (await import('../drizzle.config')).default
      const credentials = config.dbCredentials as Record<string, unknown>

      expect(credentials).not.toHaveProperty('url')
      expect(credentials).toMatchObject({
        host: 'db.example.test',
        port: 6543,
        user: 'enc@user',
        password: 'p@ss:word',
        database: 'app db',
        ssl: { rejectUnauthorized: true },
      })

      const migrationPool = new Pool({ ...credentials, max: 1 } as ConstructorParameters<typeof Pool>[0])
      try {
        expect(migrationPool.options).not.toHaveProperty('connectionString')
        expect(resolveWithPg(migrationPool.options)).toEqual({ rejectUnauthorized: true })
      } finally {
        await migrationPool.end()
      }
    } finally {
      if (previousEnvironment.DATABASE_URL === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previousEnvironment.DATABASE_URL
      if (previousEnvironment.DATABASE_SSL_MODE === undefined) delete process.env.DATABASE_SSL_MODE
      else process.env.DATABASE_SSL_MODE = previousEnvironment.DATABASE_SSL_MODE
      if (previousEnvironment.DATABASE_SSL_CA === undefined) delete process.env.DATABASE_SSL_CA
      else process.env.DATABASE_SSL_CA = previousEnvironment.DATABASE_SSL_CA
      if (previousEnvironment.NODE_ENV === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previousEnvironment.NODE_ENV
    }
  })

  it('uses verified TLS for production URLs even when provider URL options request weaker TLS', () => {
    const config = createDatabaseConnectionConfig({
      DATABASE_URL: 'postgresql://user:password@db.example.test:5432/app?sslmode=require&ssl=no-verify',
      NODE_ENV: 'production',
      PGSSLMODE: 'no-verify',
    })

    expect(config.connectionString).not.toContain('sslmode')
    expect(config.connectionString).not.toContain('ssl=')
    expect(resolveWithPg(config)).toEqual({ rejectUnauthorized: true })
  })

  it('preserves pg URL query credential overrides and normalizes IPv6 host identity', () => {
    const overridden = createDatabaseConnectionConfig({
      DATABASE_URL:
        'postgresql://url%40user:urlpass@[::1]:5432/app?host=db.example.test&port=6432&user=query%40user&password=query%3Apass',
      NODE_ENV: 'production',
    })

    expect(overridden).toMatchObject({
      host: 'db.example.test',
      port: 6432,
      user: 'query@user',
      password: 'query:pass',
      database: 'app',
    })
    expect(resolveParametersWithPg(overridden)).toMatchObject({
      host: 'db.example.test',
      port: 6432,
      user: 'query@user',
      password: 'query:pass',
      database: 'app',
    })

    const ipv6 = createDatabaseConnectionConfig({
      DATABASE_URL: 'postgresql://user:password@[::1]:5432/app',
      NODE_ENV: 'production',
    })

    expect(ipv6.host).toBe('::1')
    expect(resolveParametersWithPg(ipv6).host).toBe('::1')
  })

  it('keeps explicit PG fallback identity when a URL omits user and database', () => {
    const config = createDatabaseConnectionConfig({
      DATABASE_URL: 'postgresql://db.example.test',
      PGHOST: 'db.example.test',
      PGPORT: '6543',
      PGUSER: 'fallback-user',
      PGPASSWORD: 'fallback-password',
      PGDATABASE: 'fallback-database',
      NODE_ENV: 'production',
    })

    expect(config).toMatchObject({
      host: 'db.example.test',
      port: 6543,
      user: 'fallback-user',
      password: 'fallback-password',
      database: 'fallback-database',
    })
  })

  it('rejects unsupported URL query options instead of dropping them for host clients', () => {
    expect(() =>
      createDatabaseConnectionConfig({
        DATABASE_URL: 'postgresql://user:password@db.example.test/app?application_name=veerify',
        NODE_ENV: 'production',
      })
    ).toThrow(/unsupported query parameter/)
  })

  it('preserves the host and database from a Unix-socket connection string', () => {
    const config = createDatabaseConnectionConfig({
      DATABASE_URL: '/var/run/postgresql veerifydb',
      NODE_ENV: 'development',
    })

    expect(config).toMatchObject({
      host: '/var/run/postgresql',
      database: 'veerifydb',
      ssl: false,
    })
  })

  it('uses a supplied CA with verified TLS and keeps it in the pg-resolved options', () => {
    const ca = '-----BEGIN CERTIFICATE-----\ntrusted\n-----END CERTIFICATE-----\n'
    const config = createDatabaseConnectionConfig({
      DATABASE_URL: 'postgresql://user:password@db.example.test:5432/app?sslmode=disable',
      DATABASE_SSL_CA: ca,
      DATABASE_SSL_MODE: 'verify-full',
      NODE_ENV: 'production',
    })

    expect(resolveWithPg(config)).toEqual({ rejectUnauthorized: true, ca })
  })

  it('keeps local and PG-variable-only defaults non-TLS without an explicit mode', () => {
    expect(
      resolveWithPg(
        createDatabaseConnectionConfig({
          DATABASE_URL: 'postgresql://user:password@localhost:5432/app',
          NODE_ENV: 'development',
        })
      )
    ).toBe(false)

    expect(
      resolveWithPg(
        createDatabaseConnectionConfig({
          PGHOST: 'localhost',
          PGPORT: '5432',
          PGUSER: 'user',
          PGPASSWORD: 'password',
          PGDATABASE: 'app',
          NODE_ENV: 'production',
        })
      )
    ).toBe(false)
  })

  it('applies explicit verified TLS to PG-variable connections despite PGSSLMODE', () => {
    const ca = '-----BEGIN CERTIFICATE-----\npg-vars\n-----END CERTIFICATE-----\n'
    const config = createDatabaseConnectionConfig({
      PGHOST: 'db.example.test',
      PGPORT: '5432',
      PGUSER: 'user',
      PGPASSWORD: 'password',
      PGDATABASE: 'app',
      DATABASE_SSL_MODE: 'verify-full',
      DATABASE_SSL_CA: ca,
      PGSSLMODE: 'disable',
    })

    expect(resolveWithPg(config)).toEqual({ rejectUnauthorized: true, ca })
  })

  it('allows explicit disable for a production URL and normalizes conflicting URL and PG options', () => {
    const config = createDatabaseConnectionConfig({
      DATABASE_URL: 'postgresql://user:password@db.example.test:5432/app?sslmode=require',
      DATABASE_SSL_MODE: 'disable',
      NODE_ENV: 'production',
      PGSSLMODE: 'verify-full',
    })

    expect(resolveWithPg(config)).toBe(false)
  })

  it('rejects invalid modes and a CA paired with disable', () => {
    expect(() =>
      createDatabaseConnectionConfig({
        DATABASE_URL: 'postgresql://user:password@db.example.test:5432/app',
        DATABASE_SSL_MODE: 'require',
        NODE_ENV: 'production',
      })
    ).toThrow(/DATABASE_SSL_MODE/)

    expect(() =>
      createDatabaseConnectionConfig({
        DATABASE_URL: 'postgresql://user:password@db.example.test:5432/app',
        DATABASE_SSL_MODE: 'disable',
        DATABASE_SSL_CA: '-----BEGIN CERTIFICATE-----',
        NODE_ENV: 'production',
      })
    ).toThrow(/DATABASE_SSL_CA/)
  })

  it('rejects malformed or non-PostgreSQL URLs without echoing credentials', () => {
    const malformed = 'postgresql://user:super-secret@[not-a-host]/app?sslmode=no-verify'
    const nonPostgres = 'mysql://user:super-secret@db.example.test/app?sslmode=no-verify'

    expect(() => createDatabaseConnectionConfig({ DATABASE_URL: malformed })).toThrow(/DATABASE_URL/)
    expect(() => createDatabaseConnectionConfig({ DATABASE_URL: nonPostgres })).toThrow(/DATABASE_URL/)

    try {
      createDatabaseConnectionConfig({ DATABASE_URL: malformed })
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).not.toContain('super-secret')
    }
  })
})
