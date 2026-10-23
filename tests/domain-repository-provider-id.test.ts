import { describe, expect, it, vi } from 'vitest'
import { persistProjectDomainResult } from '../server/services/domains/domain-repository'

vi.mock('~/server/database/drizzle', () => ({ db: {} }))

async function persist(providerDomainId: string | null | undefined) {
  const inserts: Array<Record<string, unknown>> = []
  const conflictSets: Array<Record<string, unknown>> = []
  const chain = {
    set: () => ({ where: async () => undefined }),
    values: (values: Record<string, unknown>) => {
      inserts.push(values)
      return {
        onConflictDoUpdate: async (opts: { set: Record<string, unknown> }) => {
          conflictSets.push(opts.set)
        },
      }
    },
  }
  const database = { update: () => chain, insert: () => chain } as never
  await persistProjectDomainResult(
    'p1',
    {
      hostname: 'feedback.example.com',
      provider: 'cloudflare-saas',
      verified: true,
      status: 'active',
      dnsRecords: [],
      configuredBy: 'CNAME',
      expected: 'cname.veerify.io',
      resolvedTo: [],
      message: null,
      providerDomainId,
    },
    database
  )
  return { insert: inserts[0], conflict: conflictSets[0] }
}

describe('persistProjectDomainResult provider id', () => {
  it('stores the provider id on insert and on conflict', async () => {
    const { insert, conflict } = await persist('cf-1')
    expect(insert.providerDomainId).toBe('cf-1')
    expect(conflict.providerDomainId).toBe('cf-1')
    expect(insert.provider).toBe('cloudflare-saas')
  })

  it('leaves a stored provider id alone when the provider reports none', async () => {
    const { insert, conflict } = await persist(undefined)
    expect('providerDomainId' in insert).toBe(false)
    expect('providerDomainId' in conflict).toBe(false)
  })
})
