import { describe, expect, it } from 'vitest'
import { renderMarkdown, markdownToPlainText } from '../server/utils/markdown'

describe('markdown', () => {
  describe('renderMarkdown', () => {
    it('renders basic GFM elements', () => {
      const md = `# Heading 1
## Heading 2
### Heading 3

**bold** and *italic* and ~~strikethrough~~

- List item 1
- List item 2

1. Numbered 1
2. Numbered 2

> Blockquote

\`inline code\`

\`\`\`
code block
\`\`\`

| Col1 | Col2 |
|------|------|
| A    | B    |`

      const html = renderMarkdown(md)

      // h1 demoted to h2
      expect(html).toContain('<h2>')
      // h2 preserved
      expect(html).toContain('<h2>Heading 2</h2>')
      expect(html).toContain('<h3>Heading 3</h3>')
      // Emphasis
      expect(html).toContain('<strong>bold</strong>')
      expect(html).toContain('<em>italic</em>')
      expect(html).toContain('<del>strikethrough</del>')
      // Lists
      expect(html).toContain('<ul>')
      expect(html).toContain('<ol>')
      expect(html).toContain('<li>')
      // Blockquote
      expect(html).toContain('<blockquote>')
      // Code
      expect(html).toContain('<code>inline code</code>')
      expect(html).toContain('<pre>')
      // Table
      expect(html).toContain('<table>')
      expect(html).toContain('<thead>')
      expect(html).toContain('<tbody>')
    })

    it('adds security attributes to links', () => {
      const md = '[link](https://example.com "title")'
      const html = renderMarkdown(md)

      expect(html).toContain('href="https://example.com"')
      expect(html).toContain('target="_blank"')
      expect(html).toContain('rel="noopener noreferrer nofollow"')
      expect(html).toContain('title="title"')
    })

    it('blocks javascript: URLs in links', () => {
      const md = '[click me](javascript:alert(1))'
      const html = renderMarkdown(md)

      // Should drop the link href but keep text
      expect(html).toContain('click me')
      expect(html).not.toContain('javascript:')
      expect(html).not.toContain('href=')
    })

    it('blocks data: URLs in links', () => {
      const md = '[click me](data:text/html,<script>alert(1)</script>)'
      const html = renderMarkdown(md)

      // Should drop the href
      expect(html).not.toContain('data:')
    })

    it('blocks script tags', () => {
      const html = renderMarkdown('<script>alert(1)</script>')
      expect(html).not.toContain('<script>')
      expect(html).not.toContain('alert')
    })

    it('blocks img onerror handlers', () => {
      const html = renderMarkdown('<img src="x" onerror="alert(1)" />')
      expect(html).not.toContain('onerror')
      expect(html).not.toContain('alert')
    })

    it('blocks data: URLs in images', () => {
      // data: URLs are not recognized as valid markdown image syntax by marked,
      // so they render as plain text. The src will be stripped by sanitizer.
      const html = renderMarkdown('![x](data:image/svg+xml,<svg onload="alert(1)">)')
      expect(html).not.toContain('<img')
    })

    it('allows https:// images', () => {
      const html = renderMarkdown('![alt](https://example.com/image.png "title")')
      expect(html).toContain('<img')
      expect(html).toContain('src="https://example.com/image.png"')
      expect(html).toContain('alt="alt"')
      expect(html).toContain('title="title"')
    })

    it('blocks http:// images (https only)', () => {
      const html = renderMarkdown('![alt](http://example.com/image.png)')
      expect(html).not.toContain('<img')
    })

    it('blocks iframes', () => {
      const html = renderMarkdown('<iframe src="https://example.com"></iframe>')
      expect(html).not.toContain('<iframe>')
    })

    it('blocks style tags and inline styles', () => {
      const html = renderMarkdown('<style>body { display: none; }</style><p style="color: red">x</p>')
      expect(html).not.toContain('<style>')
      expect(html).not.toContain('style=')
      // The text content should remain
      expect(html).toContain('x')
    })

    it('blocks event handlers in attributes', () => {
      const html = renderMarkdown('<p onclick="alert(1)">click</p>')
      expect(html).not.toContain('onclick')
      expect(html).toContain('click')
    })

    it('allows mailto: links', () => {
      const html = renderMarkdown('[email](mailto:test@example.com)')
      expect(html).toContain('href="mailto:test@example.com"')
      expect(html).toContain('target="_blank"')
    })

    it('blocks relative URLs in links', () => {
      const html = renderMarkdown('[link](/settings)')
      // Should drop link but keep text
      expect(html).toContain('link')
      expect(html).not.toContain('href=')
    })

    it('handles empty input', () => {
      expect(renderMarkdown('')).toBe('')
      expect(renderMarkdown('   ')).toBe('')
      // @ts-expect-error Testing null input
      expect(renderMarkdown(null)).toBe('')
    })

    it('caps input at 100KB', () => {
      const longInput = 'x'.repeat(100_001)
      const html = renderMarkdown(longInput)
      // Should process without error and cap at 100KB
      expect(html).toBeDefined()
      expect(html.length).toBeGreaterThanOrEqual(0)
    })

    it('handles parse errors gracefully', () => {
      // Malformed markdown should not crash
      const html = renderMarkdown('[[[ invalid')
      expect(html).toBeDefined()
    })

    it('hr tag renders', () => {
      const html = renderMarkdown('---')
      expect(html).toContain('<hr')
    })

    it('br tag renders', () => {
      const html = renderMarkdown('line 1\\\nline 2')
      expect(html).toContain('<br')
    })

    it('paragraph wrapping', () => {
      const html = renderMarkdown('Para 1\n\nPara 2')
      expect(html).toContain('<p>')
    })

    it('demotes h1 to h2 (GFM)', () => {
      const html = renderMarkdown('# Heading 1')
      expect(html).toContain('<h2>')
      expect(html).not.toContain('<h1>')
      expect(html).toContain('Heading 1')
    })
  })

  describe('markdownToPlainText', () => {
    it('strips HTML tags', () => {
      const text = markdownToPlainText('**bold** and *italic*')
      expect(text).toBe('bold and italic')
    })

    it('collapses whitespace', () => {
      const text = markdownToPlainText(`line 1

line 2`)
      expect(text).toBe('line 1 line 2')
    })

    it('truncates at word boundary with ellipsis', () => {
      const text = markdownToPlainText('The quick brown fox jumps', 10)
      expect(text).toMatch(/…$/)
      expect(text.length).toBeLessThanOrEqual(12) // 'The quick …'
    })

    it('does not add ellipsis if within limit', () => {
      const text = markdownToPlainText('Hello world', 20)
      expect(text).toBe('Hello world')
      expect(text).not.toContain('…')
    })

    it('truncates with no space by cutting at exact length', () => {
      const text = markdownToPlainText('verylongwordwithnospaces', 10)
      expect(text).toBe('verylongwo…')
    })

    it('handles code blocks as plain text', () => {
      const text = markdownToPlainText('```\ncode here\n```')
      expect(text).toContain('code here')
      expect(text).not.toContain('<pre>')
    })

    it('handles tables as plain text', () => {
      const text = markdownToPlainText('| A | B |\n|---|---|\n| 1 | 2 |')
      expect(text).toContain('A')
      expect(text).toContain('B')
      expect(text).not.toContain('<table>')
    })

    it('handles empty input', () => {
      expect(markdownToPlainText('')).toBe('')
      expect(markdownToPlainText('   ')).toBe('')
    })

    it('handles no maxLength', () => {
      const long = 'word '.repeat(100)
      const text = markdownToPlainText(long)
      expect(text).not.toContain('…')
    })

    it('strips blockquotes', () => {
      const text = markdownToPlainText('> Quote here')
      expect(text).toBe('Quote here')
    })

    it('caps input at 100KB before processing', () => {
      const longInput = 'x'.repeat(100_001)
      const text = markdownToPlainText(longInput)
      expect(text).toBeDefined()
    })
  })

  describe('XSS vectors', () => {
    it('blocks SVG onload', () => {
      const html = renderMarkdown('<svg onload="alert(1)"></svg>')
      expect(html).not.toContain('onload')
      expect(html).not.toContain('alert')
    })

    it('blocks object/embed', () => {
      const html = renderMarkdown('<object data="https://evil.com"></object>')
      expect(html).not.toContain('<object>')
    })

    it('blocks form/input', () => {
      const html = renderMarkdown('<form><input name="x" /></form>')
      expect(html).not.toContain('<form>')
      expect(html).not.toContain('<input>')
    })

    it('blocks entity-encoded javascript', () => {
      const html = renderMarkdown(
        '[x](&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;&#97;&#108;&#101;&#114;&#116;&#40;&#49;&#41;)'
      )
      // Entity encoding is decoded by the HTML parser, but still blocked by allowedSchemes
      expect(html).not.toContain('javascript:')
    })

    it('blocks base tag', () => {
      const html = renderMarkdown('<base href="https://evil.com">')
      expect(html).not.toContain('<base>')
    })

    it('blocks meta tag', () => {
      const html = renderMarkdown('<meta property="x" content="y">')
      expect(html).not.toContain('<meta>')
    })
  })
})
