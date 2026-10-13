import { describe, expect, it } from 'vitest'
import { marketingReviewRequestTemplate } from '~/lib/email-templates'

const base = {
  productName: 'Acme',
  name: 'Jane Doe',
  trigger: 'shipped' as const,
  feedbackTitle: 'Dark mode',
  platforms: [{ label: 'G2', url: 'https://app.test/api/marketing/r/tok/go?p=g2&x=1' }],
  testimonialUrl: 'https://app.test/testimonial/tok',
  unsubscribeUrl: 'https://app.test/api/marketing/r/tok/unsubscribe',
}

describe('marketingReviewRequestTemplate', () => {
  it('mentions the shipped request, one button per platform, testimonial and unsubscribe links', () => {
    const { subject, html, text } = marketingReviewRequestTemplate(base)
    expect(subject).toContain('Dark mode')
    expect(html).toContain('Hi Jane,')
    expect(html).toContain('Review us on G2')
    expect(html).toContain('href="https://app.test/api/marketing/r/tok/go?p=g2&amp;x=1"')
    expect(html).toContain('Write a short testimonial')
    expect(html).toContain('https://app.test/api/marketing/r/tok/unsubscribe')
    expect(text).toContain('https://app.test/testimonial/tok')
    expect(text).toContain('Unsubscribe from these requests: https://app.test/api/marketing/r/tok/unsubscribe')
  })

  it('uses thanks-for-your-rating copy for csat and omits the testimonial link when not requested', () => {
    const { subject, html, text } = marketingReviewRequestTemplate({ ...base, trigger: 'csat', testimonialUrl: null })
    expect(subject).toBe('Thanks for your feedback on Acme')
    expect(html).toContain('Thanks for your rating')
    expect(html).not.toContain('Write a short testimonial')
    expect(text).not.toContain('testimonial')
  })

  it('escapes product, name, title and platform labels', () => {
    const { html } = marketingReviewRequestTemplate({
      ...base,
      productName: '<img src=x onerror=alert(1)>',
      name: '<script>alert(1)</script>',
      feedbackTitle: '"><svg onload=alert(1)>',
      platforms: [{ label: '<b>G2</b>', url: 'https://a.co/?q="x"' }],
    })
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<svg')
    expect(html).not.toContain('<b>G2</b>')
    expect(html).toContain('&lt;b&gt;G2&lt;/b&gt;')
    expect(html).toContain('q=&quot;x&quot;')
  })

  it('keeps the subject on a single line', () => {
    const { subject } = marketingReviewRequestTemplate({ ...base, feedbackTitle: 'Line one\r\nBcc: evil@x.io' })
    expect(subject).not.toMatch(/[\r\n]/)
  })

  it('appends an escaped withdraw link to the footer only when given', () => {
    const withdrawUrl = 'https://app.test/testimonial/tok?withdraw=1&x="y"'
    const { html, text } = marketingReviewRequestTemplate({ ...base, withdrawUrl })
    expect(html).toContain('Remove my testimonial from the public page')
    expect(html).toContain('href="https://app.test/testimonial/tok?withdraw=1&amp;x=&quot;y&quot;"')
    expect(text).toContain(`Remove my testimonial from the public page: ${withdrawUrl}`)

    const without = marketingReviewRequestTemplate(base)
    expect(without.html).not.toContain('Remove my testimonial')
    expect(without.text).not.toContain('Remove my testimonial')
  })
})
