import { Client } from 'pg'
import { describe, expect, it } from 'vitest'
import { createDatabaseConnectionConfig } from '../server/database/connection-config'

type ResolvedConnection = {
  ssl: false | { rejectUnauthorized?: boolean; ca?: string }
}

function resolveWithPg(config: ConstructorParameters<typeof Client>[0]): ResolvedConnection['ssl'] {
  const client = new Client(config)
  return (client as unknown as { connectionParameters: ResolvedConnection }).connectionParameters.ssl
}

describe('database connection TLS configuration', () => {
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
