import { describe, expect, it } from 'vitest'
import { StaticCnameDomainProvider } from '~/server/services/domains/providers/static-cname'

describe('StaticCnameDomainProvider', () => {
  it('activates localhost domains for local development', async () => {
    const result = await new StaticCnameDomainProvider().registerProjectDomain({ hostname: 'Feedback.Demo.Localhost.' })

    expect(result).toMatchObject({
      hostname: 'feedback.demo.localhost',
      status: 'active',
      verified: true,
      configuredBy: 'local-development',
    })
  })

  it('keeps localhost domains active when their status is checked again', async () => {
    const result = await new StaticCnameDomainProvider().getProjectDomainStatus({
      hostname: 'Feedback.Demo.Localhost.',
    })

    expect(result).toMatchObject({
      hostname: 'feedback.demo.localhost',
      status: 'active',
      verified: true,
      configuredBy: 'local-development',
    })
  })
})
