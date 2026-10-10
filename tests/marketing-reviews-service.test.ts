import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/server/database/drizzle', () => ({ db: {} }))
vi.mock('~/lib/email', () => ({ sendMarketingReviewRequestEmail: vi.fn() }))

const service = await import('~/server/services/marketing/reviews/service')
const hooks = await import('~/server/services/marketing/reviews/hooks')
type Types = typeof import('~/server/services/marketing/reviews/types')
type ReviewsStore = import('~/server/services/marketing/reviews/types').ReviewsStore
type ReviewSettings = import('~/server/services/marketing/reviews/types').ReviewSettings
type ClaimedReviewRequest = import('~/server/services/marketing/reviews/types').ClaimedReviewRequest
type Inserted = import('~/server/services/marketing/reviews/types').ReviewRequestInsert

const { DEFAULT_REVIEW_SETTINGS } = (await import('~/server/services/marketing/reviews/types')) as Types

const NOW = new Date('2026-10-10T12:00:00Z')

const settings = (overrides: Partial<ReviewSettings> = {}): ReviewSettings => ({
  ...DEFAULT_REVIEW_SETTINGS,
  enabled: true,
  platforms: [{ id: 'g2', label: 'G2', url: 'https://g2.com/products/acme/reviews' }],
  ...overrides,
})

interface FakeState {
  settings: ReviewSettings | null
  teamMarketingEnabled: boolean | null
  projectSettings: Record<string, unknown> | null
  suppressed: Set<string>
  recent: boolean
  recentSent: boolean
  inserted: Inserted[]
  duplicate: boolean
  feedback: {
    projectId: string
    status: string
    title: string
    author: { email: string | null; name: string | null }
    subscribers: string[]
  } | null
  csat: {
    rating: number | null
    scale: 'csat_5' | 'thumbs' | 'nps_10'
    contactEmail: string | null
    contactName: string | null
    projectId: string | null
  } | null
  changelog: { projectId: string; feedbackIds: string[] } | null
  claimed: ClaimedReviewRequest[]
  outcomes: Array<{ id: string; outcome: string; detail?: string }>
  recentSinceArg: Date | null
}

function makeStore(state: FakeState): ReviewsStore {
  return {
    loadProjectContext: async (projectId) => ({
      projectId,
      teamId: 'team-1',
      projectSettings: state.projectSettings,
      teamMarketingEnabled: state.teamMarketingEnabled,
      settings: state.settings,
    }),
    isSuppressed: async (_team, email) => state.suppressed.has(email),
    hasRecentRequest: async (_p, _e, since) => {
      state.recentSinceArg = since
      return state.recent
    },
    hasRecentSentRequest: async () => state.recentSent,
    insertRequest: async (row) => {
      if (state.duplicate) return false
      state.inserted.push(row)
      return true
    },
    claimBatch: async (_limit, run) => {
      await run({
        rows: state.claimed,
        markSent: async (id) => void state.outcomes.push({ id, outcome: 'sent' }),
        markFailed: async (id, error) => void state.outcomes.push({ id, outcome: 'failed', detail: error }),
        markSkipped: async (id, reason) => void state.outcomes.push({ id, outcome: 'skipped', detail: reason }),
      })
      state.claimed = []
    },
    loadFeedbackRecipients: async () => state.feedback,
    loadCsatContext: async () => state.csat,
    loadChangelogFeedbackIds: async () => state.changelog,
  }
}

let state: FakeState
let store: ReviewsStore

beforeEach(() => {
  state = {
    settings: settings(),
    teamMarketingEnabled: true,
    projectSettings: { marketingEnabled: true },
    suppressed: new Set(),
    recent: false,
    recentSent: false,
    inserted: [],
    duplicate: false,
    feedback: null,
    csat: null,
    changelog: null,
    claimed: [],
    outcomes: [],
    recentSinceArg: null,
  }
  store = makeStore(state)
})

const base = {
  projectId: 'p1',
  email: 'Jane@Example.com',
  name: 'Jane Doe',
  trigger: 'manual' as const,
  sourceId: null,
}
const enqueue = (input = base) => service.enqueueReviewRequest(input, { store, now: () => NOW })

describe('enqueueReviewRequest guards', () => {
  it('queues with a lower-cased email and a long url-safe token', async () => {
    const result = await enqueue()
    expect(result).toEqual({ queued: true })
    expect(state.inserted).toHaveLength(1)
    expect(state.inserted[0].email).toBe('jane@example.com')
    expect(state.inserted[0].token).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    expect(state.inserted[0].teamId).toBe('team-1')
  })

  it('does nothing when there is no settings row or it is disabled', async () => {
    state.settings = null
    expect(await enqueue()).toEqual({ queued: false, reason: 'no_settings' })
    state.settings = settings({ enabled: false })
    expect(await enqueue()).toEqual({ queued: false, reason: 'disabled' })
    expect(state.inserted).toHaveLength(0)
  })

  it('does nothing when the trigger is switched off', async () => {
    state.settings = settings({ csatTrigger: false, shippedTrigger: false })
    expect(await enqueue({ ...base, trigger: 'csat' as never })).toEqual({ queued: false, reason: 'trigger_off' })
    expect(await enqueue({ ...base, trigger: 'shipped' as never })).toEqual({ queued: false, reason: 'trigger_off' })
    // manual sends have no trigger switch
    expect((await enqueue()).queued).toBe(true)
  })

  it('does nothing when the team or product marketing toggle is off', async () => {
    state.teamMarketingEnabled = false
    expect(await enqueue()).toEqual({ queued: false, reason: 'marketing_off' })
    state.teamMarketingEnabled = true
    state.projectSettings = { marketingEnabled: false }
    expect(await enqueue()).toEqual({ queued: false, reason: 'marketing_off' })
    expect(state.inserted).toHaveLength(0)
  })

  it('skips suppressed addresses (matched lower-cased)', async () => {
    state.suppressed.add('jane@example.com')
    expect(await enqueue()).toEqual({ queued: false, reason: 'suppressed' })
    expect(state.inserted).toHaveLength(0)
  })

  it('skips addresses with a request inside the cooldown window', async () => {
    state.recent = true
    state.settings = settings({ cooldownDays: 30 })
    expect(await enqueue()).toEqual({ queued: false, reason: 'cooldown' })
    expect(state.recentSinceArg?.toISOString()).toBe(new Date(NOW.getTime() - 30 * 86_400_000).toISOString())
  })

  it('treats a unique violation as a no-op', async () => {
    state.duplicate = true
    expect(await enqueue()).toEqual({ queued: false, reason: 'duplicate' })
  })

  it('rejects malformed addresses', async () => {
    expect(await enqueue({ ...base, email: 'not-an-email' })).toEqual({ queued: false, reason: 'invalid_email' })
    expect(await enqueue({ ...base, email: '' })).toEqual({ queued: false, reason: 'invalid_email' })
  })
})

describe('CSAT threshold', () => {
  it('null minimum means the top of the scale', () => {
    expect(service.csatRatingQualifies(5, 'csat_5', null)).toBe(true)
    expect(service.csatRatingQualifies(4, 'csat_5', null)).toBe(false)
    expect(service.csatRatingQualifies(10, 'nps_10', null)).toBe(true)
    expect(service.csatRatingQualifies(9, 'nps_10', null)).toBe(false)
    expect(service.csatRatingQualifies(2, 'thumbs', null)).toBe(true)
    expect(service.csatRatingQualifies(1, 'thumbs', null)).toBe(false)
  })

  it('uses an explicit minimum, clamped to the scale', () => {
    expect(service.csatRatingQualifies(4, 'csat_5', 4)).toBe(true)
    expect(service.csatRatingQualifies(3, 'csat_5', 4)).toBe(false)
    expect(service.csatRatingQualifies(9, 'nps_10', 9)).toBe(true)
    // a minimum of 4 can never be reached on a thumbs scale, so it falls back to the top score
    expect(service.csatRatingQualifies(2, 'thumbs', 4)).toBe(true)
    expect(service.csatRatingQualifies(null, 'csat_5', 1)).toBe(false)
  })

  it('enqueues the contact for a qualifying rating, with the resolved product', async () => {
    state.csat = { rating: 5, scale: 'csat_5', contactEmail: 'C@x.io', contactName: 'Cee', projectId: 'p1' }
    const result = await service.enqueueForCsatResponse('resp-1', { store, now: () => NOW })
    expect(result.queued).toBe(true)
    expect(state.inserted[0]).toMatchObject({ trigger: 'csat', sourceId: 'resp-1', email: 'c@x.io', projectId: 'p1' })
  })

  it('does not enqueue below the threshold, without a product, or without an email', async () => {
    state.csat = { rating: 4, scale: 'csat_5', contactEmail: 'c@x.io', contactName: null, projectId: 'p1' }
    expect((await service.enqueueForCsatResponse('r', { store, now: () => NOW })).queued).toBe(false)
    state.csat = { rating: 5, scale: 'csat_5', contactEmail: 'c@x.io', contactName: null, projectId: null }
    expect((await service.enqueueForCsatResponse('r', { store, now: () => NOW })).queued).toBe(false)
    state.csat = { rating: 5, scale: 'csat_5', contactEmail: null, contactName: null, projectId: 'p1' }
    expect((await service.enqueueForCsatResponse('r', { store, now: () => NOW })).queued).toBe(false)
    expect(state.inserted).toHaveLength(0)
  })

  it('honours the csat min rating setting', async () => {
    state.settings = settings({ csatMinRating: 4 })
    state.csat = { rating: 4, scale: 'csat_5', contactEmail: 'c@x.io', contactName: null, projectId: 'p1' }
    expect((await service.enqueueForCsatResponse('r', { store, now: () => NOW })).queued).toBe(true)
  })
})

describe('shipped hook', () => {
  const feedbackRow = (status: string) => ({
    projectId: 'p1',
    status,
    title: 'Dark mode',
    author: { email: 'Author@x.io', name: 'Au Thor' },
    subscribers: ['sub1@x.io', 'AUTHOR@x.io', 'Sub2@x.io'],
  })

  it('enqueues the author and each subscriber once when the status is a shipped value', async () => {
    state.feedback = feedbackRow('completed')
    const queued = await service.enqueueForFeedbackStatus('fb-1', { store, now: () => NOW })
    expect(queued).toBe(3)
    expect(state.inserted.map((r) => r.email).sort()).toEqual(['author@x.io', 'sub1@x.io', 'sub2@x.io'])
    expect(state.inserted.every((r) => r.trigger === 'shipped' && r.sourceId === 'fb-1')).toBe(true)
  })

  it('ignores statuses that are not configured as shipped', async () => {
    state.feedback = feedbackRow('in_progress')
    expect(await service.enqueueForFeedbackStatus('fb-1', { store, now: () => NOW })).toBe(0)
    state.settings = settings({ shippedStatusValues: ['released'] })
    state.feedback = feedbackRow('completed')
    expect(await service.enqueueForFeedbackStatus('fb-1', { store, now: () => NOW })).toBe(0)
    expect(state.inserted).toHaveLength(0)
  })

  it('enqueues for feedback linked to a published changelog entry regardless of status', async () => {
    state.feedback = feedbackRow('open')
    state.changelog = { projectId: 'p1', feedbackIds: ['fb-1', 'fb-2'] }
    // Both ids resolve to the same fake feedback, and the fake keeps no history, so no cooldown applies here.
    const queued = await service.enqueueForChangelogEntry('entry-1', { store, now: () => NOW })
    expect(queued).toBe(6)
    expect(new Set(state.inserted.map((r) => r.sourceId))).toEqual(new Set(['fb-1', 'fb-2']))
  })

  it('does nothing for an unpublished or unknown changelog entry', async () => {
    state.changelog = null
    expect(await service.enqueueForChangelogEntry('missing', { store, now: () => NOW })).toBe(0)
  })
})

describe('hooks never throw into host flows', () => {
  it('swallow store failures', async () => {
    // db is mocked to `{}`, so every real store call throws a TypeError
    await expect(hooks.onCsatRatingRecorded('resp-1')).resolves.toBeUndefined()
    await expect(hooks.onFeedbackStatusChanged('fb-1')).resolves.toBeUndefined()
  })
})

describe('processReviewRequests', () => {
  const claimed = (overrides: Partial<ClaimedReviewRequest> = {}): ClaimedReviewRequest => ({
    id: 'rr-1',
    projectId: 'p1',
    teamId: 'team-1',
    email: 'jane@example.com',
    name: 'Jane Doe',
    trigger: 'shipped',
    sourceId: 'fb-1',
    token: 'tok_abcdefghijklmnopqrstuvwxyz0123456789',
    projectName: 'Acme',
    projectSettings: { marketingEnabled: true },
    teamMarketingEnabled: true,
    settings: settings({ platforms: [{ id: 'g2', label: 'G2', url: 'https://g2.com/x' }] }),
    feedbackTitle: 'Dark mode',
    ...overrides,
  })

  const run = (sendEmail = vi.fn(async () => ({ accepted: true, response: 'ok' }))) =>
    service
      .processReviewRequests(
        { budgetMs: 10_000 },
        { store, sendEmail: sendEmail as never, baseUrl: 'https://app.test/' }
      )
      .then((summary) => ({ summary, sendEmail }))

  it('sends tracked links, the testimonial link and an unsubscribe link, then marks sent', async () => {
    state.claimed = [claimed()]
    const { summary, sendEmail } = await run()
    expect(summary).toMatchObject({ claimed: 1, sent: 1, skipped: 0, failed: 0 })
    const args = (sendEmail.mock.calls[0] as unknown[])[0] as Record<string, any>
    expect(args.to).toBe('jane@example.com')
    expect(args.platforms[0].url).toBe(
      'https://app.test/api/marketing/r/tok_abcdefghijklmnopqrstuvwxyz0123456789/go?p=g2'
    )
    expect(args.testimonialUrl).toBe('https://app.test/testimonial/tok_abcdefghijklmnopqrstuvwxyz0123456789')
    expect(args.unsubscribeUrl).toBe(
      'https://app.test/api/marketing/r/tok_abcdefghijklmnopqrstuvwxyz0123456789/unsubscribe'
    )
    expect(args.feedbackTitle).toBe('Dark mode')
    expect(state.outcomes).toEqual([{ id: 'rr-1', outcome: 'sent' }])
  })

  it('omits the testimonial link when askForTestimonial is off', async () => {
    state.claimed = [claimed({ settings: settings({ askForTestimonial: false }) })]
    const { sendEmail } = await run()
    expect(((sendEmail.mock.calls[0] as unknown[])[0] as Record<string, unknown>).testimonialUrl).toBeNull()
  })

  it('re-checks suppression, cooldown, disabled settings and module toggles before sending', async () => {
    state.suppressed.add('jane@example.com')
    state.claimed = [claimed({ id: 'a' })]
    await run()
    state.suppressed.clear()

    state.recentSent = true
    state.claimed = [claimed({ id: 'b' })]
    await run()
    state.recentSent = false

    state.claimed = [claimed({ id: 'c', settings: settings({ enabled: false }) })]
    await run()
    state.claimed = [claimed({ id: 'd', settings: null })]
    await run()
    state.claimed = [claimed({ id: 'e', teamMarketingEnabled: false })]
    const { sendEmail } = await run()

    expect(sendEmail).not.toHaveBeenCalled()
    expect(state.outcomes).toEqual([
      { id: 'a', outcome: 'skipped', detail: 'suppressed' },
      { id: 'b', outcome: 'skipped', detail: 'cooldown' },
      { id: 'c', outcome: 'skipped', detail: 'disabled' },
      { id: 'd', outcome: 'skipped', detail: 'disabled' },
      { id: 'e', outcome: 'skipped', detail: 'marketing_off' },
    ])
  })

  it('marks a request failed when sending throws and keeps going', async () => {
    state.claimed = [claimed({ id: 'x' }), claimed({ id: 'y' })]
    const sendEmail = vi
      .fn()
      .mockRejectedValueOnce(new Error('smtp down'))
      .mockResolvedValueOnce({ accepted: true, response: 'ok' })
    const { summary } = await run(sendEmail as never)
    expect(summary).toMatchObject({ sent: 1, failed: 1 })
    expect(state.outcomes).toEqual([
      { id: 'x', outcome: 'failed', detail: 'smtp down' },
      { id: 'y', outcome: 'sent' },
    ])
  })

  it('treats an unaccepted send result as a failure', async () => {
    state.claimed = [claimed({ id: 'x' })]
    const sendEmail = vi.fn(async () => ({ accepted: false, response: 'mailbox full' }))
    const { summary } = await run(sendEmail as never)
    expect(summary).toMatchObject({ sent: 0, failed: 1 })
    expect(state.outcomes).toEqual([{ id: 'x', outcome: 'failed', detail: 'mailbox full' }])
  })

  it('stops sending once the time budget is spent and leaves the rest queued', async () => {
    state.claimed = [claimed({ id: 'x' }), claimed({ id: 'y' })]
    let tick = 0
    const sendEmail = vi.fn(async () => ({ accepted: true, response: 'ok' }))
    await service.processReviewRequests(
      { budgetMs: 100 },
      { store, sendEmail: sendEmail as never, now: () => new Date(NOW.getTime() + tick++ * 60) }
    )
    expect(sendEmail.mock.calls.length).toBeLessThan(2)
  })
})
