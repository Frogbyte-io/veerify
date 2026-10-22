import { describe, expect, it } from 'vitest'

import { inboundRoutingRecipients, resolveInboundProjectId } from '../server/utils/inbound-routing'

describe('resolveInboundProjectId', () => {
  it('leaves an unmapped receiving address unattributed despite a legacy inbox project', () => {
    expect(
      resolveInboundProjectId({
        addressProjectId: null,
        inboxProjectId: 'legacy-inbox-project',
      })
    ).toBeNull()
  })

  it('attributes a new conversation to the receiving address mapping', () => {
    expect(
      resolveInboundProjectId({
        addressProjectId: 'address-project',
        inboxProjectId: 'legacy-inbox-project',
      })
    ).toBe('address-project')
  })
})

describe('resolveInboundProjectId - platform forwarding addresses', () => {
  const custom = [
    { address: 'billing@acme.com', projectId: 'project-billing' },
    { address: 'support@acme.com', projectId: 'project-app' },
    { address: 'unmapped@acme.com', projectId: null },
  ]
  const base = { addressProjectId: null, inboxProjectId: 'legacy', addressKind: 'platform' as const }

  it('recovers the product from the To header against the same inbox custom addresses', () => {
    expect(
      resolveInboundProjectId({
        ...base,
        inboxCustomAddresses: custom,
        headerRecipients: [{ address: 'Billing@Acme.com' }],
      })
    ).toBe('project-billing')
  })

  it('tries To before Cc, in header order', () => {
    expect(
      resolveInboundProjectId({
        ...base,
        inboxCustomAddresses: custom,
        headerRecipients: [
          { address: 'someone@else.com' },
          { address: 'support@acme.com' },
          { address: 'billing@acme.com' },
        ],
      })
    ).toBe('project-app')
  })

  it('leaves the conversation unattributed when no header names a mapped custom address', () => {
    expect(
      resolveInboundProjectId({
        ...base,
        inboxCustomAddresses: custom,
        headerRecipients: [{ address: 'other-tenant@else.com' }, { address: 'unmapped@acme.com' }],
      })
    ).toBeNull()
  })

  it('never reads headers for a custom address (the envelope alone decides)', () => {
    expect(
      resolveInboundProjectId({
        addressProjectId: null,
        inboxProjectId: null,
        addressKind: 'custom',
        inboxCustomAddresses: custom,
        headerRecipients: [{ address: 'billing@acme.com' }],
      })
    ).toBeNull()
  })

  it('prefers a project mapped on the platform row itself', () => {
    expect(
      resolveInboundProjectId({
        ...base,
        addressProjectId: 'platform-project',
        inboxCustomAddresses: custom,
        headerRecipients: [{ address: 'billing@acme.com' }],
      })
    ).toBe('platform-project')
  })
})

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
