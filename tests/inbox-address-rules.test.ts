import { describe, expect, it, vi } from 'vitest'

const queued: unknown[][] = []
vi.mock('~/server/database/drizzle', () => {
  const chain = () => {
    const result = queued.shift() ?? []
    const thenable = {
      from: () => thenable,
      where: () => thenable,
      limit: () => Promise.resolve(result),
    }
    return thenable
  }
  return { db: { select: chain } }
})

const { parseReceivingAddress, resolveAddressDomainId, assertProductInProject, toInboxAddressResponse } =
  await import('~/server/utils/inbox-address-rules')

describe('parseReceivingAddress', () => {
  it('normalizes an ordinary address', () => {
    expect(parseReceivingAddress('  Hello@NewSite.com ')).toEqual({
      ok: true,
      address: 'hello@newsite.com',
      domain: 'newsite.com',
      isCatchAll: false,
    })
  })

  it('accepts the catch-all form *@domain, which zod .email() alone would reject', () => {
    expect(parseReceivingAddress('*@Mail.NewSite.com')).toEqual({
      ok: true,
      address: '*@mail.newsite.com',
      domain: 'mail.newsite.com',
      isCatchAll: true,
    })
  })

  it.each([
    '*',
    '*@',
    '@newsite.com',
    '**@newsite.com',
    'a*@newsite.com',
    '*a@newsite.com',
    '*.*@newsite.com',
    '*@newsite',
    '*@*.newsite.com',
    '*@new site.com',
    '*@newsite..com',
    'not-an-address',
    `${'a'.repeat(310)}@newsite.com`,
  ])('rejects %j', (value) => {
    expect(parseReceivingAddress(value).ok).toBe(false)
  })

  it('rejects non-strings', () => {
    expect(parseReceivingAddress(undefined).ok).toBe(false)
    expect(parseReceivingAddress(42).ok).toBe(false)
  })
})

describe('resolveAddressDomainId', () => {
  it('links an exact address to the project mail domain it sits on, or to none', async () => {
    queued.push([{ id: 'domain-1', status: 'verified' }])
    await expect(resolveAddressDomainId('p1', { domain: 'newsite.com', isCatchAll: false })).resolves.toBe('domain-1')
    queued.push([])
    await expect(resolveAddressDomainId('p1', { domain: 'gmail.com', isCatchAll: false })).resolves.toBeNull()
  })

  it('accepts a catch-all on a project mail domain (pending included)', async () => {
    queued.push([{ id: 'domain-2', status: 'pending' }])
    await expect(resolveAddressDomainId('p1', { domain: 'newsite.com', isCatchAll: true })).resolves.toBe('domain-2')
  })

  it('refuses a catch-all on a domain that is not one of the project mail domains with 422 CATCH_ALL_DOMAIN_REQUIRED', async () => {
    queued.push([])
    await expect(resolveAddressDomainId('p1', { domain: 'other.com', isCatchAll: true })).rejects.toMatchObject({
      statusCode: 422,
      data: { code: 'CATCH_ALL_DOMAIN_REQUIRED', error: { code: 'CATCH_ALL_DOMAIN_REQUIRED' } },
    })
  })
})

describe('assertProductInProject', () => {
  it('passes for a product of the project and is 422 PRODUCT_NOT_IN_PROJECT otherwise', async () => {
    queued.push([{ id: 'prod-1' }])
    await expect(assertProductInProject('p1', 'prod-1')).resolves.toBeUndefined()
    queued.push([])
    await expect(assertProductInProject('p1', 'prod-of-other-project')).rejects.toMatchObject({
      statusCode: 422,
      data: { code: 'PRODUCT_NOT_IN_PROJECT' },
    })
  })
})

describe('toInboxAddressResponse', () => {
  it('flags catch-alls', () => {
    const base = { id: 'a', address: 'hello@newsite.com' } as Parameters<typeof toInboxAddressResponse>[0]
    expect(toInboxAddressResponse(base).isCatchAll).toBe(false)
    expect(toInboxAddressResponse({ ...base, address: '*@newsite.com' }).isCatchAll).toBe(true)
  })
})
