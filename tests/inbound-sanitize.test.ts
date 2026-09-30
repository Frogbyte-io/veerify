import { describe, expect, it } from 'vitest'

import { sanitizeInboundHtml } from '../server/utils/inbound-sanitize'

/**
 * Inbound HTML is rendered into an authenticated agent's session, so these
 * cover the bypasses that actually matter, not just the obvious `<script>`.
 */
describe('sanitizeInboundHtml', () => {
  it('returns null for empty input', () => {
    expect(sanitizeInboundHtml(null)).toBeNull()
    expect(sanitizeInboundHtml('')).toBeNull()
    expect(sanitizeInboundHtml('   ')).toBeNull()
  })

  it('keeps ordinary formatting intact', () => {
    const clean = sanitizeInboundHtml('<p>Hello <strong>there</strong>, see <em>below</em>.</p>')
    expect(clean).toContain('<strong>there</strong>')
    expect(clean).toContain('<em>below</em>')
  })

  it('keeps list and table structure', () => {
    const clean = sanitizeInboundHtml('<table><tr><td colspan="2">Cell</td></tr></table><ul><li>One</li></ul>')
    expect(clean).toContain('<td colspan="2">')
    expect(clean).toContain('<li>One</li>')
  })

  it('removes script elements and their contents', () => {
    const clean = sanitizeInboundHtml('<p>Hi</p><script>alert(document.cookie)</script>')
    expect(clean).not.toContain('script')
    expect(clean).not.toContain('document.cookie')
    expect(clean).toContain('Hi')
  })

  it('removes inline event handlers', () => {
    const clean = sanitizeInboundHtml('<p onclick="alert(1)" onmouseover="alert(2)">Text</p>')
    expect(clean).not.toContain('onclick')
    expect(clean).not.toContain('onmouseover')
    expect(clean).toContain('Text')
  })

  it('strips javascript: URLs', () => {
    const clean = sanitizeInboundHtml('<a href="javascript:alert(1)">Click</a>')
    expect(clean).not.toContain('javascript')
  })

  it('strips javascript: hidden behind entity encoding and whitespace', () => {
    // The classic bypass a naive regex sanitizer misses.
    expect(sanitizeInboundHtml('<a href="java&#115;cript:alert(1)">x</a>')).not.toContain('alert')
    expect(sanitizeInboundHtml('<a href="  JaVaScRiPt:alert(1)">x</a>')).not.toContain('alert')
  })

  it('strips data: URLs, which can carry script or spoofed content', () => {
    const clean = sanitizeInboundHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>')
    expect(clean).not.toContain('data:')
    expect(clean).not.toContain('alert')
  })

  it('keeps http, https, and mailto links', () => {
    expect(sanitizeInboundHtml('<a href="https://example.com">x</a>')).toContain('https://example.com')
    expect(sanitizeInboundHtml('<a href="mailto:a@b.com">x</a>')).toContain('mailto:a@b.com')
  })

  it('marks surviving links noopener, noreferrer, and target blank', () => {
    // noopener stops window.opener access; noreferrer stops the agent's URL --
    // which contains a conversation id -- leaking to the linked site.
    const clean = sanitizeInboundHtml('<a href="https://example.com">x</a>') ?? ''
    expect(clean).toContain('rel="noopener noreferrer nofollow"')
    expect(clean).toContain('target="_blank"')
  })

  it('removes iframes, objects, embeds, and forms', () => {
    const clean = sanitizeInboundHtml(
      '<iframe src="https://evil.test"></iframe><object data="x"></object><embed src="x"><form action="https://evil.test"><input name="password"></form><p>Body</p>'
    )
    expect(clean).not.toContain('iframe')
    expect(clean).not.toContain('object')
    expect(clean).not.toContain('embed')
    expect(clean).not.toContain('form')
    expect(clean).not.toContain('input')
    expect(clean).toContain('Body')
  })

  it('removes style elements and style attributes', () => {
    // CSS can overlay the UI and exfiltrate via attribute selectors.
    const clean = sanitizeInboundHtml('<style>body{display:none}</style><p style="position:fixed;top:0">Text</p>')
    expect(clean).not.toContain('<style')
    expect(clean).not.toContain('display:none')
    expect(clean).not.toContain('position:fixed')
    expect(clean).toContain('Text')
  })

  it('removes images, so a tracking pixel cannot fire when a ticket is opened', () => {
    const clean = sanitizeInboundHtml('<p>Hi</p><img src="https://tracker.test/p.gif">')
    expect(clean).not.toContain('img')
    expect(clean).toContain('Hi')
  })

  it('removes svg, a common foreign-content XSS vector', () => {
    const clean = sanitizeInboundHtml('<svg><script>alert(1)</script></svg><p>Body</p>')
    expect(clean).not.toContain('svg')
    expect(clean).not.toContain('alert')
    expect(clean).toContain('Body')
  })

  it('removes base and meta, which hijack relative URLs and redirect', () => {
    const clean = sanitizeInboundHtml(
      '<base href="https://evil.test/"><meta http-equiv="refresh" content="0;url=https://evil.test"><p>Body</p>'
    )
    expect(clean).not.toContain('base')
    expect(clean).not.toContain('refresh')
    expect(clean).toContain('Body')
  })

  it('drops protocol-relative and relative URLs rather than resolving them to our origin', () => {
    expect(sanitizeInboundHtml('<a href="//evil.test/x">x</a>')).not.toContain('evil.test')
    expect(sanitizeInboundHtml('<a href="/settings">x</a>')).not.toContain('href="/settings"')
  })

  it('returns null when the whole body sanitizes down to nothing', () => {
    // The caller must be able to tell this apart from "no HTML part" so it can
    // fall back to the plain-text body rather than rendering blank.
    expect(sanitizeInboundHtml('<script>alert(1)</script>')).toBeNull()
    expect(sanitizeInboundHtml('<table><tr><td></td></tr></table>')).toBeNull()
  })

  it('is idempotent — sanitizing already-clean output changes nothing', () => {
    const once = sanitizeInboundHtml('<p>Hello <a href="https://example.com">link</a></p>')
    expect(sanitizeInboundHtml(once)).toBe(once)
  })
})
