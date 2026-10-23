import { describe, expect, it } from 'vitest'

import { inboundRoutingRecipients } from '../server/utils/inbound-routing'

describe('inboundRoutingRecipients', () => {
  const headers = {
    to: [{ address: 'someone@else.com' }, { address: 'support@acme.com', name: 'Acme Support' }],
    cc: [{ address: 'billing@acme.com' }],
  }

  it('routes on the envelope recipient alone when the provider reported one', () => {
    // A Bcc'd copy: the support address is in no header at all.
    expect(
      inboundRoutingRecipients({ ...headers, envelopeRecipients: [{ address: 'hidden-alias@acme.com' }] })
    ).toEqual([{ address: 'hidden-alias@acme.com' }])
  })

  it('never lets a To/Cc header outrank the envelope', () => {
    // The headers name other inboxes; the mail was delivered to billing only.
    const recipients = inboundRoutingRecipients({
      ...headers,
      envelopeRecipients: [{ address: 'billing@acme.com' }],
    })

    expect(recipients.map((entry) => entry.address)).toEqual(['billing@acme.com'])
  })

  it('keeps several envelope recipients in provider order, lowercased and de-duplicated', () => {
    const recipients = inboundRoutingRecipients({
      ...headers,
      envelopeRecipients: [{ address: 'B@acme.com' }, { address: 'a@acme.com' }, { address: 'b@acme.com' }],
    })

    expect(recipients.map((entry) => entry.address)).toEqual(['b@acme.com', 'a@acme.com'])
  })

  it('falls back to To then Cc only when there is no envelope recipient', () => {
    expect(inboundRoutingRecipients({ ...headers, envelopeRecipients: [] })).toEqual([
      { address: 'someone@else.com' },
      { address: 'support@acme.com', name: 'Acme Support' },
      { address: 'billing@acme.com' },
    ])
  })

  it('drops a header address repeated across To and Cc', () => {
    const recipients = inboundRoutingRecipients({
      to: [{ address: 'support@acme.com' }],
      cc: [{ address: 'Support@Acme.com' }, { address: 'billing@acme.com' }],
      envelopeRecipients: [],
    })

    expect(recipients.map((entry) => entry.address)).toEqual(['support@acme.com', 'billing@acme.com'])
  })

  it('returns nothing when the message names no recipient at all', () => {
    expect(inboundRoutingRecipients({ to: [], cc: [], envelopeRecipients: [] })).toEqual([])
  })
})
