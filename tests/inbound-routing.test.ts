import { describe, expect, it } from 'vitest'

import { resolveInboundProjectId } from '../server/utils/inbound-routing'

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
