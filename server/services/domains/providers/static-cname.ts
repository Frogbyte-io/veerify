import { promises as dns } from 'dns'
import {
  dedupeDnsRecords,
  normalizeDomainHostname,
  type DomainProvider,
  type DomainProviderResult,
} from '../provider'

function buildPendingResult(hostname: string, target: string): DomainProviderResult {
  return {
    hostname,
    provider: 'static-cname',
    verified: false,
    status: 'dns_required',
    dnsRecords: dedupeDnsRecords([
      {
        type: 'CNAME',
        name: hostname,
        value: target,
      },
    ]),
    configuredBy: 'CNAME',
    expected: target,
    resolvedTo: [],
    message: null,
  }
}

export class StaticCnameDomainProvider implements DomainProvider {
  private getTarget() {
    const config = useRuntimeConfig()
    return normalizeDomainHostname(String(config.public.cnameTarget || 'cname.veerify.com'))
  }

  async registerProjectDomain(input: { hostname: string }) {
    const hostname = normalizeDomainHostname(input.hostname)
    return buildPendingResult(hostname, this.getTarget())
  }

  async getProjectDomainStatus(input: { hostname: string }) {
    const hostname = normalizeDomainHostname(input.hostname)
    const expected = this.getTarget()

    try {
      const cnames = await dns.resolveCname(hostname)
      const resolvedTo = cnames.map((value) => normalizeDomainHostname(value))
      const verified = resolvedTo.some((value) => value === expected)

      return {
        hostname,
        provider: 'static-cname',
        verified,
        status: verified ? 'active' : 'dns_required',
        dnsRecords: dedupeDnsRecords([
          {
            type: 'CNAME',
            name: hostname,
            value: expected,
          },
        ]),
        configuredBy: 'CNAME',
        expected,
        resolvedTo,
        message: null,
      } satisfies DomainProviderResult
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException
      if (err.code === 'ENOTFOUND' || err.code === 'ENODATA' || err.code === 'ESERVFAIL') {
        return buildPendingResult(hostname, expected)
      }
      throw createError({ statusCode: 500, statusMessage: 'DNS lookup failed' })
    }
  }

  async verifyProjectDomain(input: { hostname: string }) {
    return this.getProjectDomainStatus(input)
  }

  async removeProjectDomain(_input: { hostname: string }) {
    return
  }
}
