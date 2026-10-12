import { describe, expect, it } from 'vitest'

import { validateLlmsTxt } from '~/server/services/marketing/audit/llms-txt'

const GOOD = `# Veerify

> Feedback and support for small SaaS teams.

Extra details about the product, in free text.

## Docs

- [Quickstart](https://veerify.com/docs/quickstart): Get going in five minutes
- [API](https://veerify.com/docs/api)

## Optional

- [Changelog](https://veerify.com/changelog): What shipped
`

describe('validateLlmsTxt', () => {
  it('accepts a spec-conforming file', () => {
    const r = validateLlmsTxt(GOOD)
    expect(r.valid).toBe(true)
    expect(r.problems).toEqual([])
    expect(r.title).toBe('Veerify')
    expect(r.summary).toBe('Feedback and support for small SaaS teams.')
    expect(r.sections.map((s) => s.title)).toEqual(['Docs', 'Optional'])
    expect(r.sections[0].links).toEqual([
      {
        name: 'Quickstart',
        url: 'https://veerify.com/docs/quickstart',
        notes: 'Get going in five minutes',
      },
      { name: 'API', url: 'https://veerify.com/docs/api', notes: null },
    ])
  })

  it('treats the summary as optional', () => {
    const r = validateLlmsTxt('# Site\n\n## Pages\n\n- [Home](https://e.com/)\n')
    expect(r.valid).toBe(true)
    expect(r.summary).toBeNull()
  })

  it('rejects an empty file', () => {
    const r = validateLlmsTxt('  \n')
    expect(r.valid).toBe(false)
    expect(r.problems[0]).toMatch(/empty/i)
  })

  it('rejects HTML served in place of the file', () => {
    const r = validateLlmsTxt('<!DOCTYPE html><html><body>Not found</body></html>')
    expect(r.valid).toBe(false)
    expect(r.problems[0]).toMatch(/HTML/)
  })

  it('requires an H1 first', () => {
    const r = validateLlmsTxt('## Docs\n\n- [A](https://e.com/a)\n')
    expect(r.valid).toBe(false)
    expect(r.title).toBeNull()
    expect(r.problems.join(' ')).toMatch(/H1/)
  })

  it('flags a second H1', () => {
    const r = validateLlmsTxt('# One\n\n## S\n\n- [A](https://e.com/a)\n\n# Two\n')
    expect(r.valid).toBe(false)
    expect(r.problems.join(' ')).toMatch(/Only one H1/)
  })

  it('flags files without sections or links', () => {
    expect(validateLlmsTxt('# Name\n\n> sum\n').problems.join(' ')).toMatch(/No H2 sections/)
    expect(validateLlmsTxt('# Name\n\n## Docs\n\nJust text\n').problems.join(' ')).toMatch(/No links/)
  })

  it('flags malformed list items and links outside a section', () => {
    const r = validateLlmsTxt(
      '# Name\n\n- [Early](https://e.com/early)\n\n## Docs\n\n- plain item\n- [Ok](https://e.com/ok)\n- [Bad]()\n'
    )
    expect(r.valid).toBe(false)
    expect(r.problems.some((p) => p.includes('before any H2'))).toBe(true)
    expect(r.problems.some((p) => p.includes('not a link'))).toBe(true)
    expect(r.problems.some((p) => p.includes('invalid URL') || p.includes('not a link'))).toBe(true)
    expect(r.sections[0].links).toHaveLength(1)
  })

  it('handles CRLF line endings and multi-line summaries', () => {
    const r = validateLlmsTxt('# N\r\n> line one\r\n> line two\r\n\r\n## S\r\n- [A](/a): note\r\n')
    expect(r.valid).toBe(true)
    expect(r.summary).toBe('line one line two')
    expect(r.sections[0].links[0].url).toBe('/a')
  })
})
