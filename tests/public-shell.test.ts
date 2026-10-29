import { describe, expect, it } from 'vitest'
import { projectPaths, shellTitle } from '~/lib/public-shell'
import { isModuleOffMessage } from '~/lib/changelog-editor'

describe('projectPaths', () => {
  it('addresses sub-pages without the project slug on a custom domain', () => {
    const paths = projectPaths('acme', true)
    expect(paths).toMatchObject({
      feedback: '/',
      roadmap: '/roadmap',
      changelog: '/changelog',
      testimonials: '/testimonials',
    })
    expect(paths.product('decker')).toBe('/decker')
    expect(paths.post({ id: '3f2b8c1e-6a4d-4e2f-9b1a-0c7d5e8f9a21', title: 'Dark mode' })).toBe(
      '/p/dark-mode-3f2b8c1e-6a4d-4e2f-9b1a-0c7d5e8f9a21'
    )
  })

  it('prefixes the project slug on workspace subdomains', () => {
    const paths = projectPaths('acme', false)
    expect(paths).toMatchObject({
      feedback: '/acme',
      roadmap: '/acme/roadmap',
      changelog: '/acme/changelog',
      testimonials: '/acme/testimonials',
    })
    expect(paths.product('decker')).toBe('/acme/decker')
    expect(paths.post({ id: 'seed_1', title: 'X' })).toBe('/acme/p/seed_1')
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
    expect(isModuleOffMessage('Changelog is not enabled for this project')).toBe(true)
    expect(isModuleOffMessage('You do not have access to this project')).toBe(false)
    expect(isModuleOffMessage('')).toBe(false)
  })
})
