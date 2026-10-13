import { describe, expect, it } from 'vitest'
import { projectPaths, shellTitle } from '~/lib/public-shell'
import { isModuleOffMessage } from '~/lib/changelog-editor'

describe('projectPaths', () => {
  it('addresses sub-pages without the product slug on a custom domain', () => {
    expect(projectPaths('acme', true)).toEqual({
      feedback: '/',
      roadmap: '/roadmap',
      changelog: '/changelog',
      testimonials: '/testimonials',
    })
  })

  it('prefixes the product slug on team subdomains', () => {
    expect(projectPaths('acme', false)).toEqual({
      feedback: '/acme',
      roadmap: '/acme/roadmap',
      changelog: '/acme/changelog',
      testimonials: '/acme/testimonials',
    })
  })
})

describe('shellTitle', () => {
  it('builds list and entry titles, omitting unknown parts', () => {
    expect(shellTitle('changelog', 'Acme')).toBe('Changelog · Acme')
    expect(shellTitle('changelog', 'Acme', 'v1.2 released')).toBe('v1.2 released · Changelog · Acme')
    expect(shellTitle('testimonials', undefined)).toBe('Testimonials')
  })
})

describe('isModuleOffMessage', () => {
  it('separates "module off" from a non-member 403', () => {
    expect(isModuleOffMessage('Changelog is not enabled for this team')).toBe(true)
    expect(isModuleOffMessage('Changelog is not enabled for this product')).toBe(true)
    expect(isModuleOffMessage('You do not have access to this project')).toBe(false)
    expect(isModuleOffMessage('')).toBe(false)
  })
})
