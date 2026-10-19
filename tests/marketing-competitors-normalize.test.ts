import { describe, expect, it } from 'vitest'
import {
  MAX_EXCERPT_CHARS,
  MAX_TEXT_BYTES,
  diffLines,
  hashText,
  isNoise,
  normalizeHtml,
  stripVolatile,
} from '~/server/services/marketing/competitors/normalize'

describe('normalizeHtml', () => {
  it('keeps visible text, one block per line, and drops script, style, nav, footer and svg', () => {
    const html = `<html><head><title>T</title><style>.a{}</style></head><body>
      <nav><a>Home</a></nav>
      <h1>Pricing</h1>
      <p>Pro   plan\n costs   $29</p>
      <ul><li>Feature A</li><li>Feature B</li></ul>
      <script>var x = 1</script><svg><text>icon</text></svg>
      <footer>Copyright</footer></body></html>`
    expect(normalizeHtml(html)).toBe('Pricing\nPro plan costs $29\nFeature A\nFeature B')
  })

  it('strips volatile tokens so equal pages hash equal', () => {
    const a =
      '<p>Plan $29</p><p>Rendered 2026-10-10T12:00:00Z</p><input value="0123456789abcdef0123456789abcdef"><p>v 1760000000123</p>'
    const b =
      '<p>Plan $29</p><p>Rendered 2026-10-11T08:30:11Z</p><input value="fedcba9876543210fedcba9876543210"><p>v 1760099999999</p>'
    expect(hashText(normalizeHtml(a))).toBe(hashText(normalizeHtml(b)))
    expect(stripVolatile('Updated 14:03:22 today')).toBe('Updated today')
  })

  it('keeps prices and short numbers', () => {
    expect(normalizeHtml('<p>$1,200 per year, 10 seats</p>')).toBe('$1,200 per year, 10 seats')
  })

  it('caps the text at 50 KB', () => {
    const html = Array.from({ length: 5000 }, (_, i) => `<p>line number ${i} with some padding text here</p>`).join('')
    const text = normalizeHtml(html)
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(MAX_TEXT_BYTES)
    expect(text.endsWith('here')).toBe(true)
  })
})

describe('diffLines', () => {
  it('returns added and removed lines', () => {
    const diff = diffLines('a\nb\nc\nd', 'a\nB\nc\nd\ne')
    expect(diff.removed).toEqual(['b'])
    expect(diff.added).toEqual(['B', 'e'])
  })

  it('handles an insertion in the middle without reporting the shifted lines', () => {
    const before = ['one', 'two', 'three', 'four'].join('\n')
    const after = ['one', 'two', 'new', 'three', 'four'].join('\n')
    expect(diffLines(before, after)).toEqual({ added: ['new'], removed: [] })
  })

  it('caps each side to 4 KB', () => {
    const after = Array.from({ length: 400 }, (_, i) => `added line ${i} ${'x'.repeat(40)}`).join('\n')
    const diff = diffLines('same', `same\n${after}`)
    expect(diff.added.join('\n').length).toBeLessThanOrEqual(MAX_EXCERPT_CHARS)
    expect(diff.added.length).toBeGreaterThan(10)
  })
})

describe('isNoise', () => {
  it('ignores a single short line', () => {
    expect(isNoise({ added: ['v2'], removed: [] })).toBe(true)
  })
  it('reports two changed lines (a price change)', () => {
    expect(isNoise({ added: ['$39'], removed: ['$29'] })).toBe(false)
  })
  it('reports one long line', () => {
    expect(isNoise({ added: ['x'.repeat(60)], removed: [] })).toBe(false)
  })
})
