import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CapturedQuery } from './helpers/fake-db'

const state = vi.hoisted(() => ({ log: [] as Array<{ text: string; params: unknown[] }> }))

vi.mock('~/server/database/drizzle', async () => {
  const { createFakeDb } = await import('./helpers/fake-db')
  return { db: createFakeDb(state.log, () => [['x'], ['y']]) }
})

const { retentionCutoffs, runMarketingRetention } = await import('~/server/services/marketing/retention')

const NOW = new Date('2026-10-12T03:30:00Z')

beforeEach(() => {
  state.log.length = 0
})

describe('retentionCutoffs', () => {
  it('computes each window from now', () => {
    const cutoffs = retentionCutoffs(NOW)
    expect(cutoffs.reviewRequests.toISOString()).toBe('2026-04-15T03:30:00.000Z')
    expect(cutoffs.anonymisedRequests.toISOString()).toBe('2023-10-13T03:30:00.000Z')
    expect(cutoffs.queuedRequests.toISOString()).toBe('2026-09-12T03:30:00.000Z')
    expect(cutoffs.testimonialEmails.toISOString()).toBe('2026-04-15T03:30:00.000Z')
    expect(cutoffs.competitorChanges.toISOString()).toBe('2025-10-12T03:30:00.000Z')
    expect(cutoffs.rateLimitRows.toISOString()).toBe('2026-10-10T03:30:00.000Z')
    expect(cutoffs.digestLedgerRows.toISOString()).toBe('2026-10-05T03:30:00.000Z')
    expect(cutoffs.oauthNonceRows.toISOString()).toBe('2026-10-11T03:30:00.000Z')
  })

  it('keeps the current month and the 13 before it in usage', () => {
    expect(retentionCutoffs(NOW).usagePeriod).toBe('2025-09')
    expect(retentionCutoffs(new Date('2026-01-31T00:00:00Z')).usagePeriod).toBe('2024-12')
    expect(retentionCutoffs(new Date('2026-03-31T00:00:00Z')).usagePeriod).toBe('2025-02')
  })
})

describe('runMarketingRetention', () => {
  it('passes the cutoffs to every step, expires queued rows before anonymising, and returns the counts', async () => {
    const calls: Record<string, unknown> = {}
    const order: string[] = []
    const summary = await runMarketingRetention({
      now: () => NOW,
      backfillHashes: async () => (order.push('backfill'), 9),
      expireQueuedRequests: async (c) => (order.push('expire'), (calls.queued = c), 6),
      anonymiseReviewRequests: async (c) => (order.push('anonymise'), (calls.review = c), 1),
      deleteAnonymisedRequests: async (c) => ((calls.anon = c), 7),
      clearTestimonialEmails: async (c) => ((calls.testimonial = c), 2),
      deleteCompetitorChanges: async (c) => ((calls.competitor = c), 3),
      deleteUsageBeforePeriod: async (p) => ((calls.usage = p), 4),
      deleteRateLimitRows: async (c) => ((calls.rate = c), 5),
      deleteLedgerRows: async (prefix, c) => ((calls[prefix] = c), prefix === 'digest:' ? 11 : 12),
    })
    expect(summary).toEqual({
      hashesBackfilled: 9,
      queuedRequestsExpired: 6,
      reviewRequestsAnonymised: 1,
      anonymisedRequestsDeleted: 7,
      testimonialEmailsCleared: 2,
      competitorChangesDeleted: 3,
      usageRowsDeleted: 4,
      rateLimitRowsDeleted: 5,
      digestLedgerRowsDeleted: 11,
      oauthNonceRowsDeleted: 12,
    })
    expect(order).toEqual(['backfill', 'expire', 'anonymise'])
    expect(calls.usage).toBe('2025-09')
    expect((calls.review as Date).toISOString()).toBe('2026-04-15T03:30:00.000Z')
    expect((calls.queued as Date).toISOString()).toBe('2026-09-12T03:30:00.000Z')
    expect((calls.anon as Date).toISOString()).toBe('2023-10-13T03:30:00.000Z')
    expect((calls['digest:'] as Date).toISOString()).toBe('2026-10-05T03:30:00.000Z')
    expect((calls['oauth-nonce:'] as Date).toISOString()).toBe('2026-10-11T03:30:00.000Z')
  })

  it('keeps going when the hash backfill fails (anonymising requires hashes, so nothing is lost early)', async () => {
    const zero = async () => 0
    const summary = await runMarketingRetention({
      now: () => NOW,
      backfillHashes: async () => {
        throw new Error('boom')
      },
      expireQueuedRequests: zero,
      anonymiseReviewRequests: zero,
      deleteAnonymisedRequests: zero,
      clearTestimonialEmails: zero,
      deleteCompetitorChanges: zero,
      deleteUsageBeforePeriod: zero,
      deleteRateLimitRows: zero,
      deleteLedgerRows: zero,
    })
    expect(summary.hashesBackfilled).toBe(0)
  })

  it('issues the expected SQL with the right cutoffs', async () => {
    await runMarketingRetention({ now: () => NOW, backfillHashes: async () => 0 })
    const byText = (needle: string): CapturedQuery => {
      const found = state.log.find((q) => q.text.includes(needle))
      if (!found) throw new Error(`no query containing ${needle}`)
      return found
    }
    const hasDate = (q: CapturedQuery, iso: string) =>
      q.params.some((p) => typeof p === 'string' && p.startsWith(iso)) ||
      q.params.some((p) => p instanceof Date && p.toISOString().startsWith(iso))

    // M-4: queued rows older than 30 days become skipped/expired; `sending` rows are not touched
    const expire = byText('"skip_reason" = $2')
    expect(expire.text).toContain('update "review_request"')
    expect(expire.params.slice(0, 2)).toEqual(['skipped', 'expired'])
    expect(expire.params).toContain('queued')
    expect(expire.params).not.toContain('sending')
    expect(hasDate(expire, '2026-09-12T03:30:00')).toBe(true)

    // M-1: terminal rows are anonymised after 180 days, not deleted
    const anonymise = state.log.find((q) => q.text.includes('update "review_request"') && q.text.includes('"error" ='))!
    expect(anonymise.text).toContain('"name" = $2')
    expect(anonymise.text).toContain('"email_hash" is not null')
    expect(anonymise.text).not.toContain('"token"')
    expect(anonymise.params.slice(0, 3)).toEqual(['redacted:', null, null])
    expect(anonymise.params).toEqual(expect.arrayContaining(['sent', 'failed', 'skipped']))
    expect(anonymise.params).not.toContain('queued')
    expect(hasDate(anonymise, '2026-04-15T03:30:00')).toBe(true)

    // Anonymised rows go after 3 years, and only when no testimonial points at them
    const purge = byText('delete from "review_request"')
    expect(purge.text).toContain(
      'not exists (select 1 from testimonial t where t.review_request_id = "review_request"."id")'
    )
    expect(purge.params).toContain('redacted:%')
    expect(hasDate(purge, '2023-10-13T03:30:00')).toBe(true)

    const testimonials = byText('update "testimonial"')
    expect(testimonials.text).toContain('"author_email" = $1')
    expect(testimonials.params[0]).toBeNull()
    expect(testimonials.text).toContain('"author_email" is not null')
    // Never cleared without the hash, and the hash itself is never written here
    expect(testimonials.text).toContain('"author_email_hash" is not null')
    expect(testimonials.text).not.toContain('"author_email_hash" = $')

    const changes = byText('delete from "competitor_change"')
    expect(new Date(changes.params[0] as string).toISOString()).toBe('2025-10-12T03:30:00.000Z')

    // M-3: ledger rows are pruned by updated_at and metric prefix
    const usage = state.log.filter((q) => q.text.includes('delete from "marketing_usage"'))
    expect(usage).toHaveLength(4)
    expect(usage[0].text).toContain('"period" < $1')
    expect(usage[0].params).toEqual(['2025-09'])
    for (const [metric, expected] of [
      ['ratelimit:%', '2026-10-10T03:30:00.000Z'],
      ['digest:%', '2026-10-05T03:30:00.000Z'],
      ['oauth-nonce:%', '2026-10-11T03:30:00.000Z'],
    ] as const) {
      const q = usage.find((u) => u.params[0] === metric)!
      expect(q.text).toContain('"metric" like $1')
      expect(q.text).toContain('"updated_at" < $2')
      expect(new Date(q.params[1] as string).toISOString()).toBe(expected)
    }
  })
})
