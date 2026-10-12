import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  log: [] as Array<{ text: string; params: unknown[] }>,
  respond: (_text: string): unknown[][] => [],
  order: [] as string[],
  gscConnection: null as { encryptedRefreshToken: string } | null,
}))

vi.mock('~/server/database/drizzle', async () => {
  const { createFakeDb } = await import('./helpers/fake-db')
  return { db: createFakeDb(state.log, (text) => state.respond(text)) }
})

vi.mock('~/server/services/google/search-console', () => ({
  revokeToken: vi.fn(async (token: string) => {
    state.order.push(`revoke:${token}`)
    return true
  }),
}))

vi.mock('~/server/services/marketing/search/connection', () => ({
  findGscConnection: vi.fn(async () => state.gscConnection),
  gscAad: (siteId: string) => `gsc:${siteId}`,
  removeGscConnection: vi.fn(async (siteId: string) => {
    state.order.push(`remove:${siteId}`)
  }),
}))

vi.mock('~/server/utils/secrets', () => ({
  decryptSecret: vi.fn((payload: string, aad: string) => `plain(${payload}|${aad})`),
}))

const { eraseContact, withdrawTestimonialConsent, deleteProductMarketingData } =
  await import('~/server/services/marketing/privacy')
const { hashEmail } = await import('~/server/utils/marketing-email-hash')
const { exportProductMarketingData } = await import('~/server/services/marketing/data-export')

beforeEach(() => {
  state.log.length = 0
  state.order.length = 0
  state.respond = () => []
  state.gscConnection = null
})

const queries = (needle: string) => state.log.filter((q) => q.text.includes(needle))

describe('eraseContact', () => {
  it('deletes by team and lower-cased email, then keeps a suppression', async () => {
    state.respond = (text) => {
      if (text.startsWith('select')) return [['rr1'], ['rr2']]
      if (text.includes('delete from "testimonial"')) return [['t1']]
      if (text.includes('delete from "review_request"')) return [['rr1'], ['rr2']]
      return []
    }
    const result = await eraseContact('team-1', '  Jane.Doe@Example.COM ')
    expect(result).toEqual({ reviewRequestsDeleted: 2, testimonialsDeleted: 1, suppressed: true })

    const requestDelete = queries('delete from "review_request"')[0]
    expect(requestDelete.text).toContain('"team_id" = $1')
    expect(requestDelete.text).toContain('lower("review_request"."email") = $2')
    // Rows the retention task anonymised only have the keyed hash left
    expect(requestDelete.text).toContain('"review_request"."email_hash" = $3')
    expect(requestDelete.params).toEqual(['team-1', 'jane.doe@example.com', hashEmail('jane.doe@example.com')])

    const testimonialDelete = queries('delete from "testimonial"')[0]
    // Scoped to the team's own products, never to every testimonial with that email
    expect(testimonialDelete.text).toContain('select "id" from "project" where "project"."team_id" = $')
    expect(testimonialDelete.params).toContain('team-1')
    expect(testimonialDelete.params).toContain('jane.doe@example.com')
    expect(testimonialDelete.params).toContain('rr1')
    // By the author's own address or hash (cleared emails keep the hash)
    expect(testimonialDelete.text).toContain('"author_email_hash" = $')
    expect(testimonialDelete.params).toContain(hashEmail('jane.doe@example.com'))

    const suppression = queries('insert into "marketing_email_suppression"')[0]
    expect(suppression.text).toContain('on conflict do nothing')
    expect(suppression.params).toEqual(
      expect.arrayContaining(['team-1', 'jane.doe@example.com', hashEmail('jane.doe@example.com'), 'unsubscribed'])
    )
    // A suppression that only had the address gets its hash
    const backfill = queries('update "marketing_email_suppression"')[0]
    expect(backfill.text).toContain('"email_hash" = $1')
    expect(backfill.text).toContain('"email_hash" is null')
    expect(backfill.params[0]).toBe(hashEmail('jane.doe@example.com'))
  })

  it('finds a person by hash alone (address already anonymised), including testimonials without an address', async () => {
    await eraseContact('team-1', 'Anon@Example.com')
    const hash = hashEmail('anon@example.com')
    expect(queries('delete from "review_request"')[0].params).toContain(hash)
    const testimonialDelete = queries('delete from "testimonial"')[0]
    expect(testimonialDelete.params).toContain(hash)
    expect(hash).toBe(hashEmail('  ANON@example.com '))
  })

  it('the export never contains hashes or redacted placeholders', async () => {
    state.respond = (text) =>
      text.includes('from "review_request"')
        ? [['rr1', 'redacted:rr1', 'Name', 'csat', 'sent', null, null, null, new Date()]]
        : []
    const exported = (await exportProductMarketingData('p1', 'slug')) as {
      reviewRequests: Array<{ email: string | null }>
    }
    expect(exported.reviewRequests[0]?.email).toBeNull()
    const select = queries('from "testimonial"')[0]
    expect(select.text).not.toContain('author_email_hash')
    for (const q of state.log) expect(q.text).not.toContain('"email_hash"')
  })

  it('still suppresses when nothing matches', async () => {
    const result = await eraseContact('team-1', 'nobody@example.com')
    expect(result).toEqual({ reviewRequestsDeleted: 0, testimonialsDeleted: 0, suppressed: true })
    expect(queries('insert into "marketing_email_suppression"')).toHaveLength(1)
    // Without matched requests the testimonial match is by its own email only
    expect(queries('delete from "testimonial"')[0].text).not.toContain('review_request_id')
  })
})

describe('withdrawTestimonialConsent', () => {
  it('turns consent and featuring off for the request, nothing else', async () => {
    state.respond = () => [['t1']]
    expect(await withdrawTestimonialConsent('rr1')).toBe(1)
    const update = queries('update "testimonial"')[0]
    expect(update.text).toContain('"consent_public" = $1')
    expect(update.text).toContain('"featured" = $2')
    expect(update.params.slice(0, 2)).toEqual([false, false])
    expect(update.text).toContain('"review_request_id" = $4')
    expect(update.params[3]).toBe('rr1')
  })
})

describe('deleteProductMarketingData', () => {
  it('revokes the Search Console token through the helpers before deleting rows', async () => {
    state.gscConnection = { encryptedRefreshToken: 'enc-token' }
    state.respond = (text) => {
      if (text.startsWith('select')) return [['site-1']]
      if (text.includes('delete from "marketing_site"')) return [['site-1']]
      return []
    }
    const result = await deleteProductMarketingData('p1')

    expect(state.order).toEqual(['revoke:plain(enc-token|gsc:site-1)', 'remove:site-1'])
    expect(result.searchConsoleRevoked).toBe(true)
    expect(result.siteDeleted).toBe(true)

    const deletes = state.log.filter((q) => q.text.startsWith('delete')).map((q) => q.text.split(' ')[2])
    expect(deletes).toEqual([
      '"marketing_site"',
      '"testimonial"',
      '"review_request"',
      '"launch_kit_item"',
      '"marketing_announcement_draft"',
    ])
    for (const q of state.log.filter((q) => q.text.startsWith('delete'))) expect(q.params).toEqual(['p1'])
  })

  it('does not touch Google when no connection exists', async () => {
    state.respond = (text) => (text.startsWith('select') ? [['site-1']] : [])
    const result = await deleteProductMarketingData('p1')
    expect(state.order).toEqual([])
    expect(result.searchConsoleRevoked).toBe(false)
  })

  it('still deletes when the revoke fails', async () => {
    state.gscConnection = { encryptedRefreshToken: 'enc' }
    state.respond = (text) => (text.startsWith('select') ? [['site-1']] : [])
    const { revokeToken } = await import('~/server/services/google/search-console')
    vi.mocked(revokeToken).mockRejectedValueOnce(new Error('google down'))
    const result = await deleteProductMarketingData('p1')
    expect(result.searchConsoleRevoked).toBe(false)
    expect(state.order).toEqual(['remove:site-1'])
    expect(queries('delete from "marketing_site"')).toHaveLength(1)
  })
})

describe('exportProductMarketingData', () => {
  const siteRow = [
    'site-1',
    'p1',
    't1',
    'https://acme.com',
    'dns',
    'SECRET-VERIFICATION-TOKEN',
    new Date('2026-10-01'),
    null,
    0,
    null,
    new Date('2026-09-01'),
    new Date('2026-09-01'),
  ]

  it('never selects secret columns and omits the verification token', async () => {
    state.respond = (text) => (text.includes('from "marketing_site"') && text.startsWith('select') ? [siteRow] : [])
    const data = await exportProductMarketingData('p1', 'acme')
    const serialized = JSON.stringify(data)

    expect(serialized).not.toContain('SECRET-VERIFICATION-TOKEN')
    expect(data.site).toMatchObject({ id: 'site-1', origin: 'https://acme.com', verified: true })
    expect(data.product).toEqual({ id: 'p1', slug: 'acme' })

    const sql = state.log.map((q) => q.text).join('\n')
    expect(sql).not.toContain('encrypted_refresh_token')
    expect(sql).not.toContain('encrypted_key')
    expect(sql).not.toContain('team_api_credential')
    expect(sql).not.toContain('"token"')
    expect(sql).not.toContain('last_text')
    expect(sql).not.toContain('seo_audit_page"."facts"') // only title is read from facts below
    for (const expected of [
      '"mention"',
      '"testimonial"',
      '"gsc_daily_metric"',
      '"competitor_change"',
      '"launch_kit_item"',
    ]) {
      expect(sql).toContain(expected)
    }
  })

  it('exports review requests without their link tokens, and only a site-less subset without a site', async () => {
    const data = await exportProductMarketingData('p1', 'acme')
    expect(data.site).toBeNull()
    expect(data).toHaveProperty('reviewRequests')
    expect(data).not.toHaveProperty('audits')
    expect(queries('from "review_request"')[0].text).not.toContain('"token"')
  })
})
