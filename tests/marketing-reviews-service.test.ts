import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/server/database/drizzle', () => ({ db: {} }))
vi.mock('~/lib/email', () => ({ sendMarketingReviewRequestEmail: vi.fn() }))

const service = await import('~/server/services/marketing/reviews/service')
const hooks = await import('~/server/services/marketing/reviews/hooks')
const errors = await import('~/server/services/marketing/reviews/errors')
const guards = await import('~/server/services/marketing/reviews/guards')
type Types = typeof import('~/server/services/marketing/reviews/types')
type ReviewsStore = import('~/server/services/marketing/reviews/types').ReviewsStore
type ReviewSettings = import('~/server/services/marketing/reviews/types').ReviewSettings
type ClaimedReviewRequest = import('~/server/services/marketing/reviews/types').ClaimedReviewRequest
type Inserted = import('~/server/services/marketing/reviews/types').ReviewRequestInsert
type FeedbackRecipients = import('~/server/services/marketing/reviews/types').FeedbackRecipients

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
  /** `${projectId}:${email}` of committed sends; `markSent` adds to it */
  committedSent: Set<string>
  /** When false, the committed-state cooldown check always says "nothing recent" */
  cooldownStoreWorks: boolean
  inserted: Inserted[]
  insertOptions: Array<{ dedupeSince?: Date } | undefined>
  duplicate: boolean
  feedback: FeedbackRecipients[]
  loadedFeedbackIds: string[][]
  csat: {
    rating: number | null
    scale: 'csat_5' | 'thumbs' | 'nps_10'
    contactEmail: string | null
    contactName: string | null
    projectId: string | null
  } | null
  changelog: { projectId: string; feedbackIds: string[] } | null
  claimed: ClaimedReviewRequest[]
  allClaimed: ClaimedReviewRequest[]
  claimCalls: number
  sweepResult: number
  sweepArgs: Array<[number, number]>
  manualCount: number
  outcomes: Array<{ id: string; outcome: string; detail?: string; delayMs?: number }>
  released: string[][]
  recentSinceArg: Date | null
  /** Rows erased or unsubscribed between the claim and the send (what `stillSendable` re-checks) */
  withdrawnBeforeSend: Set<string>
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
    stillSendable: async (id, _team, email) => !state.withdrawnBeforeSend.has(id) && !state.suppressed.has(email),
    hasRecentRequest: async (_p, _e, since) => {
      state.recentSinceArg = since
      return state.recent
    },
    hasRecentSentRequest: async (projectId, email) =>
      state.cooldownStoreWorks && state.committedSent.has(`${projectId}:${email}`),
    insertRequest: async (row, options) => {
      if (state.duplicate) return false
      state.inserted.push(row)
      state.insertOptions.push(options)
      return true
    },
    countManualSince: async () => state.manualCount,
    sweepStale: async (minutes, max) => {
      state.sweepArgs.push([minutes, max])
      return state.sweepResult
    },
    claimBatch: async (limit) => {
      state.claimCalls += 1
      return state.claimed.splice(0, limit)
    },
    markSent: async (id) => {
      const row = state.allClaimed.find((r) => r.id === id)
      if (row) state.committedSent.add(`${row.projectId}:${row.email}`)
      state.outcomes.push({ id, outcome: 'sent' })
    },
    markFailed: async (id, error) => void state.outcomes.push({ id, outcome: 'failed', detail: error }),
    markSkipped: async (id, reason) => void state.outcomes.push({ id, outcome: 'skipped', detail: reason }),
    markRetry: async (id, error, delayMs) => void state.outcomes.push({ id, outcome: 'retry', detail: error, delayMs }),
    release: async (ids) => void state.released.push(ids),
    loadFeedbackRecipients: async (ids) => {
      state.loadedFeedbackIds.push(ids)
      return state.feedback.filter((item) => ids.includes(item.feedbackId))
    },
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
    committedSent: new Set(),
    cooldownStoreWorks: true,
    inserted: [],
    insertOptions: [],
    duplicate: false,
    feedback: [],
    loadedFeedbackIds: [],
    csat: null,
    changelog: null,
    claimed: [],
    allClaimed: [],
    claimCalls: 0,
    sweepResult: 0,
    sweepArgs: [],
    manualCount: 0,
    outcomes: [],
    released: [],
    recentSinceArg: null,
    withdrawnBeforeSend: new Set(),
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

describe('manual requests', () => {
  it('dedupes by address inside the cooldown (source-less requests bypass the unique index)', async () => {
    await enqueue()
    expect(state.insertOptions[0]?.dedupeSince?.toISOString()).toBe(
      new Date(NOW.getTime() - 90 * 86_400_000).toISOString()
    )
    // event-based requests rely on the unique index instead
    await enqueue({ ...base, trigger: 'csat' as never, sourceId: 'resp-1' as never })
    expect(state.insertOptions[1]).toBeUndefined()
  })

  it('reports a refused insert as a duplicate', async () => {
    state.duplicate = true
    expect(await enqueue()).toEqual({ queued: false, reason: 'duplicate' })
  })

  it('queues each unique valid address and reports invalid ones per address', async () => {
    const results = await service.enqueueManualReviewRequests(
      { projectId: 'p1', emails: ['a@x.io', 'A@x.io', 'nope', 'b@x.io'] },
      { store, now: () => NOW }
    )
    expect(results).toEqual([
      { email: 'a@x.io', queued: true },
      { email: 'nope', queued: false, reason: 'invalid_email' },
      { email: 'b@x.io', queued: true },
    ])
  })

  it('stops at the daily cap per team', async () => {
    state.manualCount = service.MANUAL_DAILY_CAP - 1
    const results = await service.enqueueManualReviewRequests(
      { projectId: 'p1', emails: ['a@x.io', 'b@x.io', 'c@x.io'] },
      { store, now: () => NOW }
    )
    expect(results.map((r) => r.reason ?? 'queued')).toEqual(['queued', 'daily_limit', 'daily_limit'])
    expect(state.inserted).toHaveLength(1)
  })

  it('queues nothing once the cap is already reached', async () => {
    state.manualCount = service.MANUAL_DAILY_CAP
    const results = await service.enqueueManualReviewRequests(
      { projectId: 'p1', emails: ['a@x.io'] },
      { store, now: () => NOW }
    )
    expect(results).toEqual([{ email: 'a@x.io', queued: false, reason: 'daily_limit' }])
    expect(state.inserted).toHaveLength(0)
  })
})

describe('shipped hook', () => {
  const feedbackRow = (status: string, overrides: Partial<FeedbackRecipients> = {}): FeedbackRecipients => ({
    feedbackId: 'fb-1',
    projectId: 'p1',
    status,
    title: 'Dark mode',
    recipients: [
      { email: 'Author@x.io', name: 'Au Thor' },
      { email: 'sub1@x.io', name: null },
      { email: 'Sub2@x.io', name: null },
    ],
    ...overrides,
  })

  it('enqueues each verified recipient once when the status is a shipped value', async () => {
    state.feedback = [feedbackRow('completed')]
    const queued = await service.enqueueForFeedbackStatus('fb-1', { store, now: () => NOW })
    expect(queued).toBe(3)
    expect(state.inserted.map((r) => r.email).sort()).toEqual(['author@x.io', 'sub1@x.io', 'sub2@x.io'])
    expect(state.inserted.every((r) => r.trigger === 'shipped' && r.sourceId === 'fb-1')).toBe(true)
  })

  it('queues nothing when the store returns no verified recipients', async () => {
    state.feedback = [feedbackRow('completed', { recipients: [] })]
    expect(await service.enqueueForFeedbackStatus('fb-1', { store, now: () => NOW })).toBe(0)
  })

  it('ignores statuses that are not configured as shipped', async () => {
    state.feedback = [feedbackRow('in_progress')]
    expect(await service.enqueueForFeedbackStatus('fb-1', { store, now: () => NOW })).toBe(0)
    state.settings = settings({ shippedStatusValues: ['released'] })
    state.feedback = [feedbackRow('completed')]
    expect(await service.enqueueForFeedbackStatus('fb-1', { store, now: () => NOW })).toBe(0)
    expect(state.inserted).toHaveLength(0)
  })

  it('enqueues for feedback linked to a published changelog entry regardless of status', async () => {
    state.feedback = [
      feedbackRow('open', { feedbackId: 'fb-1', recipients: [{ email: 'a@x.io', name: null }] }),
      feedbackRow('open', { feedbackId: 'fb-2', recipients: [{ email: 'b@x.io', name: null }] }),
    ]
    state.changelog = { projectId: 'p1', feedbackIds: ['fb-1', 'fb-2'] }
    const queued = await service.enqueueForChangelogEntry('entry-1', { store, now: () => NOW })
    expect(queued).toBe(2)
    expect(state.inserted.map((r) => [r.sourceId, r.email])).toEqual([
      ['fb-1', 'a@x.io'],
      ['fb-2', 'b@x.io'],
    ])
  })

  it('loads the recipients of every linked item in one query', async () => {
    state.changelog = { projectId: 'p1', feedbackIds: ['fb-1', 'fb-2', 'fb-3'] }
    await service.enqueueForChangelogEntry('entry-1', { store, now: () => NOW })
    expect(state.loadedFeedbackIds).toEqual([['fb-1', 'fb-2', 'fb-3']])
  })

  it('asks an address at most once per entry even when it follows several linked items', async () => {
    state.feedback = [
      feedbackRow('open', { feedbackId: 'fb-1', recipients: [{ email: 'a@x.io', name: null }] }),
      feedbackRow('open', { feedbackId: 'fb-2', recipients: [{ email: 'A@x.io', name: null }] }),
    ]
    state.changelog = { projectId: 'p1', feedbackIds: ['fb-1', 'fb-2'] }
    expect(await service.enqueueForChangelogEntry('entry-1', { store, now: () => NOW })).toBe(1)
  })

  it('caps the changelog fan-out per entry', async () => {
    const many = Array.from({ length: service.MAX_CHANGELOG_RECIPIENTS + 50 }, (_, i) => ({
      email: `user${i}@x.io`,
      name: null,
    }))
    state.feedback = [feedbackRow('open', { recipients: many })]
    state.changelog = { projectId: 'p1', feedbackIds: ['fb-1'] }
    const queued = await service.enqueueForChangelogEntry('entry-1', { store, now: () => NOW })
    expect(queued).toBe(service.MAX_CHANGELOG_RECIPIENTS)
    expect(state.inserted).toHaveLength(service.MAX_CHANGELOG_RECIPIENTS)
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

describe('error logging helpers', () => {
  it('describeError keeps kind and code but never the message', () => {
    const error = Object.assign(new Error('duplicate key value (jane@example.com)'), { code: '23505' })
    const described = errors.describeError(error)
    expect(described).toEqual({ kind: 'Error', code: '23505' })
    expect(JSON.stringify(described)).not.toContain('jane@example.com')
  })

  it('scrubEmails removes addresses from stored messages', () => {
    expect(errors.scrubEmails('550 5.1.1 <jane@example.com> recipient rejected')).not.toContain('jane@example.com')
    expect(errors.scrubEmails('550 jane@example.com rejected')).toContain('[email]')
  })
})

describe('link expiry guard', () => {
  it('expires 60 days after sending, falling back to creation', () => {
    const sentAt = new Date(NOW.getTime() - 59 * 86_400_000)
    expect(guards.isRequestLinkExpired({ sentAt, createdAt: sentAt }, NOW)).toBe(false)
    const old = new Date(NOW.getTime() - 61 * 86_400_000)
    expect(guards.isRequestLinkExpired({ sentAt: old, createdAt: old }, NOW)).toBe(true)
    expect(guards.isRequestLinkExpired({ sentAt: null, createdAt: old }, NOW)).toBe(true)
  })
})

describe('classifyFailure', () => {
  it('treats SMTP 5xx as permanent and everything else as transient', () => {
    expect(service.classifyFailure({ responseCode: 550 })).toBe('permanent')
    expect(service.classifyFailure({ responseCode: 421 })).toBe('transient')
    expect(service.classifyFailure({ message: 'Recipient rejected: 550 5.1.1 no such user' })).toBe('permanent')
    expect(service.classifyFailure({ message: '451 4.7.1 try again later' })).toBe('transient')
    expect(service.classifyFailure({ message: 'connect ETIMEDOUT' })).toBe('transient')
    expect(service.classifyFailure({ message: 'Email was not accepted' })).toBe('transient')
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
    attempts: 0,
    projectName: 'Acme',
    projectSettings: { marketingEnabled: true },
    teamMarketingEnabled: true,
    settings: settings({ platforms: [{ id: 'g2', label: 'G2', url: 'https://g2.com/x' }] }),
    feedbackTitle: 'Dark mode',
    ...overrides,
  })

  const queue = (...rows: ClaimedReviewRequest[]) => {
    state.claimed = [...rows]
    state.allClaimed = [...rows]
  }

  const run = (sendEmail = vi.fn(async () => ({ accepted: true, response: 'ok' }))) =>
    service
      .processReviewRequests(
        { budgetMs: 10_000 },
        { store, sendEmail: sendEmail as never, baseUrl: 'https://app.test/' }
      )
      .then((summary) => ({ summary, sendEmail }))

  it('sends tracked links, the testimonial link and an unsubscribe link, then marks sent', async () => {
    queue(claimed())
    const { summary, sendEmail } = await run()
    expect(summary).toMatchObject({ claimed: 1, sent: 1, skipped: 0, failed: 0, retried: 0 })
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
    queue(claimed({ settings: settings({ askForTestimonial: false }) }))
    const { sendEmail } = await run()
    expect(((sendEmail.mock.calls[0] as unknown[])[0] as Record<string, unknown>).testimonialUrl).toBeNull()
  })

  it('re-checks suppression, cooldown, disabled settings and module toggles before sending', async () => {
    state.suppressed.add('jane@example.com')
    queue(claimed({ id: 'a' }))
    await run()
    state.suppressed.clear()

    state.committedSent.add('p1:jane@example.com')
    queue(claimed({ id: 'b' }))
    await run()
    state.committedSent.clear()

    queue(claimed({ id: 'c', settings: settings({ enabled: false }) }))
    await run()
    queue(claimed({ id: 'd', settings: null }))
    await run()
    queue(claimed({ id: 'e', teamMarketingEnabled: false }))
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

  it('re-checks the row and suppression right before the mailer (erased or unsubscribed after the claim)', async () => {
    // The first guard passes; the person is erased/unsubscribed by the time the mailer would be called.
    state.withdrawnBeforeSend.add('gone')
    queue(claimed({ id: 'gone' }))
    const { sendEmail } = await run()
    expect(sendEmail).not.toHaveBeenCalled()
    expect(state.outcomes).toEqual([{ id: 'gone', outcome: 'skipped', detail: 'suppressed' }])
  })

  describe('same-batch cooldown', () => {
    it('sends to one address only once when two queued rows share it (committed-state recheck)', async () => {
      queue(
        claimed({ id: 'x', sourceId: 'fb-1' }),
        claimed({ id: 'y', sourceId: 'fb-2', token: 'tok2'.padEnd(40, 'a') })
      )
      const { summary, sendEmail } = await run()
      expect(sendEmail).toHaveBeenCalledTimes(1)
      expect(summary).toMatchObject({ sent: 1, skipped: 1 })
      expect(state.outcomes).toEqual([
        { id: 'x', outcome: 'sent' },
        { id: 'y', outcome: 'skipped', detail: 'cooldown' },
      ])
    })

    it('still dedupes through the in-memory set when the committed check sees nothing', async () => {
      state.cooldownStoreWorks = false
      queue(claimed({ id: 'x' }), claimed({ id: 'y', sourceId: 'fb-2' }))
      const { sendEmail } = await run()
      expect(sendEmail).toHaveBeenCalledTimes(1)
      expect(state.outcomes[1]).toEqual({ id: 'y', outcome: 'skipped', detail: 'cooldown' })
    })

    it('scopes the duplicate check per product', async () => {
      queue(claimed({ id: 'x' }), claimed({ id: 'y', projectId: 'p2' }))
      const { sendEmail } = await run()
      expect(sendEmail).toHaveBeenCalledTimes(2)
    })
  })

  describe('sweeper and claiming', () => {
    it('sweeps stale claims (10 minutes, counted as an attempt) before claiming', async () => {
      state.sweepResult = 2
      const { summary } = await run()
      expect(state.sweepArgs).toEqual([[10, 4]])
      expect(summary.recovered).toBe(2)
      expect(state.claimCalls).toBe(1)
    })

    it('claims again while batches come back full, and stops on a short batch', async () => {
      const rows = Array.from({ length: service.REVIEW_BATCH_SIZE + 3 }, (_, i) =>
        claimed({ id: `r${i}`, email: `u${i}@x.io`, token: `t${i}`.padEnd(40, 'a') })
      )
      queue(...rows)
      const { summary } = await run()
      expect(state.claimCalls).toBe(2)
      expect(summary.sent).toBe(rows.length)
    })

    it('releases claimed rows it ran out of time for, without counting an attempt', async () => {
      queue(claimed({ id: 'x' }), claimed({ id: 'y', email: 'y@x.io' }), claimed({ id: 'z', email: 'z@x.io' }))
      let tick = 0
      const sendEmail = vi.fn(async () => ({ accepted: true, response: 'ok' }))
      await service.processReviewRequests(
        { budgetMs: 100 },
        { store, sendEmail: sendEmail as never, now: () => new Date(NOW.getTime() + tick++ * 60) }
      )
      expect(sendEmail.mock.calls.length).toBeLessThan(3)
      expect(state.released).toHaveLength(1)
      expect(state.released[0]!.length).toBeGreaterThan(0)
      expect(state.outcomes.filter((o) => o.outcome === 'retry' || o.outcome === 'failed')).toHaveLength(0)
    })
  })

  describe('retries', () => {
    it('puts a transient failure back in the queue with the first backoff (15 minutes)', async () => {
      queue(claimed({ id: 'x' }))
      const sendEmail = vi.fn().mockRejectedValueOnce(new Error('connect ETIMEDOUT'))
      const { summary } = await run(sendEmail as never)
      expect(summary).toMatchObject({ sent: 0, failed: 0, retried: 1 })
      expect(state.outcomes).toEqual([{ id: 'x', outcome: 'retry', detail: 'connect ETIMEDOUT', delayMs: 15 * 60_000 }])
    })

    it('treats an unaccepted result as transient', async () => {
      queue(claimed({ id: 'x' }))
      const sendEmail = vi.fn(async () => ({ accepted: false, response: 'mailbox full' }))
      const { summary } = await run(sendEmail as never)
      expect(summary).toMatchObject({ retried: 1, failed: 0 })
    })

    it('backs off 1 hour after the second failure', async () => {
      queue(claimed({ id: 'x', attempts: 1 }))
      await run(vi.fn().mockRejectedValue(new Error('451 try later')) as never)
      expect(state.outcomes[0]).toMatchObject({ outcome: 'retry', delayMs: 60 * 60_000 })
    })

    it('backs off 6 hours after the third failure and still retries', async () => {
      queue(claimed({ id: 'x', attempts: 2 }))
      await run(vi.fn().mockRejectedValue(new Error('451 try later')) as never)
      expect(state.outcomes[0]).toMatchObject({ outcome: 'retry', delayMs: 6 * 60 * 60_000 })
      expect(service.MAX_SEND_ATTEMPTS).toBe(4)
    })

    it('marks the request failed once the attempts are used up', async () => {
      queue(claimed({ id: 'x', attempts: service.MAX_SEND_ATTEMPTS - 1 }))
      const { summary } = await run(vi.fn().mockRejectedValue(new Error('connect ETIMEDOUT')) as never)
      expect(summary).toMatchObject({ failed: 1, retried: 0 })
      expect(state.outcomes).toEqual([{ id: 'x', outcome: 'failed', detail: 'connect ETIMEDOUT' }])
    })

    it('fails permanent (5xx) rejections immediately', async () => {
      queue(claimed({ id: 'x' }))
      const error = Object.assign(new Error('Recipient rejected'), { responseCode: 550 })
      const { summary } = await run(vi.fn().mockRejectedValue(error) as never)
      expect(summary).toMatchObject({ failed: 1, retried: 0 })
      expect(state.outcomes[0]).toMatchObject({ id: 'x', outcome: 'failed' })
    })

    it('does not store email addresses from error messages', async () => {
      queue(claimed({ id: 'x' }))
      const error = Object.assign(new Error('550 5.1.1 <jane@example.com> rejected'), { responseCode: 550 })
      await run(vi.fn().mockRejectedValue(error) as never)
      expect(JSON.stringify(state.outcomes)).not.toContain('jane@example.com')
    })

    it('keeps going after a failure', async () => {
      queue(claimed({ id: 'x' }), claimed({ id: 'y', email: 'y@x.io' }))
      const sendEmail = vi
        .fn()
        .mockRejectedValueOnce(new Error('smtp down'))
        .mockResolvedValueOnce({ accepted: true, response: 'ok' })
      const { summary } = await run(sendEmail as never)
      expect(summary).toMatchObject({ sent: 1, retried: 1 })
      expect(state.outcomes.map((o) => o.outcome)).toEqual(['retry', 'sent'])
    })
  })
})
