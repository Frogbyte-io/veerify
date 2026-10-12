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
    expect(cutoffs.testimonialEmails.toISOString()).toBe('2026-04-15T03:30:00.000Z')
    expect(cutoffs.competitorChanges.toISOString()).toBe('2025-10-12T03:30:00.000Z')
    expect(cutoffs.rateLimitRows.toISOString()).toBe('2026-10-10T03:30:00.000Z')
  })

  it('keeps the current month and the 13 before it in usage', () => {
    expect(retentionCutoffs(NOW).usagePeriod).toBe('2025-09')
    expect(retentionCutoffs(new Date('2026-01-31T00:00:00Z')).usagePeriod).toBe('2024-12')
    expect(retentionCutoffs(new Date('2026-03-31T00:00:00Z')).usagePeriod).toBe('2025-02')
  })
})

describe('runMarketingRetention', () => {
  it('passes the cutoffs to every step and returns the counts', async () => {
    const calls: Record<string, unknown> = {}
    const summary = await runMarketingRetention({
      now: () => NOW,
      deleteReviewRequests: async (c) => ((calls.review = c), 1),
      clearTestimonialEmails: async (c) => ((calls.testimonial = c), 2),
      deleteCompetitorChanges: async (c) => ((calls.competitor = c), 3),
      deleteUsageBeforePeriod: async (p) => ((calls.usage = p), 4),
      deleteRateLimitRows: async (c) => ((calls.rate = c), 5),
    })
    expect(summary).toEqual({
      reviewRequestsDeleted: 1,
      testimonialEmailsCleared: 2,
      competitorChangesDeleted: 3,
      usageRowsDeleted: 4,
      rateLimitRowsDeleted: 5,
    })
    expect(calls.usage).toBe('2025-09')
    expect((calls.review as Date).toISOString()).toBe('2026-04-15T03:30:00.000Z')
  })

  it('issues the expected SQL with the right cutoffs', async () => {
    const summary = await runMarketingRetention({ now: () => NOW })
    expect(summary.reviewRequestsDeleted).toBe(2)
    const byText = (needle: string): CapturedQuery => {
      const found = state.log.find((q) => q.text.includes(needle))
      if (!found) throw new Error(`no query containing ${needle}`)
      return found
    }

    const reviews = byText('delete from "review_request"')
    expect(reviews.text).toContain('"status" in ($1, $2, $3)')
    expect(reviews.params.slice(0, 3)).toEqual(['sent', 'failed', 'skipped'])
    expect(reviews.params).not.toContain('queued')
    expect(new Date(reviews.params[3] as string).toISOString()).toBe('2026-04-15T03:30:00.000Z')

    const testimonials = byText('update "testimonial"')
    expect(testimonials.text).toContain('"author_email" = $1')
    expect(testimonials.params[0]).toBeNull()
    expect(testimonials.text).toContain('"author_email" is not null')

    const changes = byText('delete from "competitor_change"')
    expect(new Date(changes.params[0] as string).toISOString()).toBe('2025-10-12T03:30:00.000Z')

    const usage = state.log.filter((q) => q.text.includes('delete from "marketing_usage"'))
    expect(usage).toHaveLength(2)
    expect(usage[0].text).toContain('"period" < $1')
    expect(usage[0].params).toEqual(['2025-09'])
    expect(usage[1].text).toContain('"metric" like $1')
    expect(usage[1].params[0]).toBe('ratelimit:%')
    expect(new Date(usage[1].params[1] as string).toISOString()).toBe('2026-10-10T03:30:00.000Z')
  })
})
