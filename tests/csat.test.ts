import { describe, expect, it } from 'vitest'

import { buildCsatSurveyEmail, csatRatingUrl, csatRatings } from '~/server/utils/csat'

describe('CSAT survey helpers', () => {
  it('returns the configured rating scale', () => {
    expect(csatRatings('csat_5')).toEqual([1, 2, 3, 4, 5])
    expect(csatRatings('thumbs')).toEqual([1, 2])
    expect(csatRatings('nps_10')).toHaveLength(11)
    expect(csatRatings('nps_10')[10]).toBe(10)
  })

  it('builds one distinct tokenized link per rating', () => {
    const email = buildCsatSurveyEmail({
      scale: 'csat_5',
      question: 'How was your support experience?',
      followUpQuestion: 'What could we improve?',
      token: 'opaque-token',
      contactName: '<Priya>',
    })

    expect(email.subject).toBe('How did we do?')
    expect(email.html).toContain('&lt;Priya&gt;')
    expect(email.html).toContain(csatRatingUrl('opaque-token', 1))
    expect(email.html).toContain(csatRatingUrl('opaque-token', 5))
    expect(email.text).toContain('How was your support experience?')
  })
})
