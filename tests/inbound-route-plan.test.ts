import { describe, expect, it } from 'vitest'

import { planRouteDelivery } from '../server/utils/inbound-routes'

describe('planRouteDelivery', () => {
  it('delivers to the inbox while no forward of a forward-only address is confirmed', () => {
    expect(
      planRouteDelivery({ deliverToInbox: false, forwardTo: ['a@example.org', 'b@example.org'], verifiedEmails: [] })
    ).toEqual({ toInbox: true, inboxFallback: true, forwardTo: ['a@example.org', 'b@example.org'] })
  })

  it('drops the inbox once one forward is confirmed', () => {
    expect(
      planRouteDelivery({
        deliverToInbox: false,
        forwardTo: ['a@example.org', 'b@example.org'],
        verifiedEmails: ['B@Example.org'],
      })
    ).toEqual({ toInbox: false, inboxFallback: false, forwardTo: ['a@example.org', 'b@example.org'] })
  })

  it('ignores confirmations of mailboxes the address does not forward to', () => {
    expect(
      planRouteDelivery({ deliverToInbox: false, forwardTo: ['a@example.org'], verifiedEmails: ['other@example.org'] })
        .inboxFallback
    ).toBe(true)
  })

  it('falls back to the inbox when forwarding is unavailable (no forwards on the route)', () => {
    expect(planRouteDelivery({ deliverToInbox: false, forwardTo: [], verifiedEmails: [] })).toEqual({
      toInbox: true,
      inboxFallback: true,
      forwardTo: [],
    })
  })

  it('never marks a fallback for an address that delivers to the inbox anyway', () => {
    expect(planRouteDelivery({ deliverToInbox: true, forwardTo: ['a@example.org'], verifiedEmails: [] })).toEqual({
      toInbox: true,
      inboxFallback: false,
      forwardTo: ['a@example.org'],
    })
  })
})
