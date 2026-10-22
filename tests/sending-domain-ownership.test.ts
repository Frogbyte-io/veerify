import { afterEach, describe, expect, it, vi } from 'vitest'

import { checkDmarc, checkOwnershipTxt, ownershipRecord } from '../server/services/sending-domains/ownership'

function dnsError(code: string) {
  return Object.assign(new Error(code), { code })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('ownershipRecord', () => {
  it('builds the TXT row on the _veerify-mail label', () => {
    expect(ownershipRecord('Acme.com.', 'tok123')).toEqual({
      purpose: 'ownership',
      type: 'TXT',
      name: '_veerify-mail.acme.com',
      value: 'veerify-mail-verification=tok123',
      status: 'unknown',
    })
  })
})

describe('checkOwnershipTxt', () => {
  it('is valid when the record matches, and queries the label host', async () => {
    const resolveTxt = vi.fn(async () => [['unrelated'], ['veerify-mail-verification=tok']])
    expect(await checkOwnershipTxt('acme.com', 'tok', { resolveTxt })).toBe('valid')
    expect(resolveTxt).toHaveBeenCalledWith('_veerify-mail.acme.com')
  })

  it('joins chunked TXT values', async () => {
    const resolveTxt = vi.fn(async () => [['veerify-mail-verif', 'ication=tok']])
    expect(await checkOwnershipTxt('acme.com', 'tok', { resolveTxt })).toBe('valid')
  })

  it('is invalid for a different token or an empty answer', async () => {
    expect(
      await checkOwnershipTxt('acme.com', 'tok', { resolveTxt: async () => [['veerify-mail-verification=old']] })
    ).toBe('invalid')
    expect(await checkOwnershipTxt('acme.com', 'tok', { resolveTxt: async () => [] })).toBe('invalid')
  })

  it('does not accept a token that merely contains the expected value', async () => {
    const resolveTxt = async () => [['veerify-mail-verification=tok-extra']]
    expect(await checkOwnershipTxt('acme.com', 'tok', { resolveTxt })).toBe('invalid')
  })

  it('NXDOMAIN and no-data are invalid', async () => {
    for (const code of ['ENOTFOUND', 'ENODATA']) {
      const resolveTxt = vi.fn(async () => {
        throw dnsError(code)
      })
      expect(await checkOwnershipTxt('acme.com', 'tok', { resolveTxt })).toBe('invalid')
    }
  })

  it('SERVFAIL, timeout and refused are unknown', async () => {
    for (const code of ['ESERVFAIL', 'ETIMEOUT', 'ECONNREFUSED']) {
      const resolveTxt = vi.fn(async () => {
        throw dnsError(code)
      })
      expect(await checkOwnershipTxt('acme.com', 'tok', { resolveTxt })).toBe('unknown')
    }
  })

  it('fake mode accepts *.verify-ok.test without DNS', async () => {
    vi.stubEnv('SUPPORT_SENDING_DOMAIN_PROVIDER', 'fake')
    const resolveTxt = vi.fn(async () => {
      throw dnsError('ENOTFOUND')
    })
    expect(await checkOwnershipTxt('acme.verify-ok.test', 'tok', { resolveTxt })).toBe('valid')
    expect(resolveTxt).not.toHaveBeenCalled()
    expect(await checkOwnershipTxt('acme.other.test', 'tok', { resolveTxt })).toBe('invalid')
  })

  it('fake mode is ignored in production', async () => {
    vi.stubEnv('SUPPORT_SENDING_DOMAIN_PROVIDER', 'fake')
    vi.stubEnv('NODE_ENV', 'production')
    const resolveTxt = vi.fn(async () => {
      throw dnsError('ENOTFOUND')
    })
    expect(await checkOwnershipTxt('acme.verify-ok.test', 'tok', { resolveTxt })).toBe('invalid')
  })

  it('does not special-case *.verify-ok.test outside fake mode', async () => {
    const resolveTxt = async () => {
      throw dnsError('ENOTFOUND')
    }
    expect(await checkOwnershipTxt('acme.verify-ok.test', 'tok', { resolveTxt })).toBe('invalid')
  })
})

describe('checkDmarc', () => {
  it('returns null when a DMARC policy exists', async () => {
    const resolveTxt = vi.fn(async () => [['v=DMARC1; p=reject']])
    expect(await checkDmarc('acme.com', { resolveTxt })).toBeNull()
    expect(resolveTxt).toHaveBeenCalledWith('_dmarc.acme.com')
  })

  it('recommends a record when none exists', async () => {
    const resolveTxt = vi.fn(async () => {
      throw dnsError('ENOTFOUND')
    })
    expect(await checkDmarc('acme.com', { resolveTxt })).toEqual({
      purpose: 'recommended',
      type: 'TXT',
      name: '_dmarc.acme.com',
      value: 'v=DMARC1; p=none;',
      status: 'invalid',
    })
  })

  it('ignores unrelated TXT records', async () => {
    const resolveTxt = async () => [['some other text']]
    expect((await checkDmarc('acme.com', { resolveTxt }))?.purpose).toBe('recommended')
  })

  it('accepts the organizational domain policy for a subdomain', async () => {
    const resolveTxt = vi.fn(async (host: string) => {
      if (host === '_dmarc.acme.com') return [['v=DMARC1; p=none']]
      throw dnsError('ENOTFOUND')
    })
    expect(await checkDmarc('mail.acme.com', { resolveTxt })).toBeNull()
  })

  it('marks the recommendation unknown when the lookup itself fails', async () => {
    const resolveTxt = async () => {
      throw dnsError('ESERVFAIL')
    }
    expect((await checkDmarc('acme.com', { resolveTxt }))?.status).toBe('unknown')
  })
})
