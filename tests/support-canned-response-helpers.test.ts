import { describe, expect, it } from 'vitest'

const helpers = await import('~/lib/support-canned-responses').catch(() => null)

describe('support canned response helpers', () => {
  it('substitutes only contact and agent name variables', () => {
    expect(helpers).not.toBeNull()

    const result = helpers!.substituteCannedResponse(
      'Hi {{contact.name}}, {{agent.name}} here about #{{conversation.displayId}}.',
      {
        contact: { name: 'Priya Customer' },
        agent: { name: 'Ada Agent' },
      }
    )

    expect(result).toBe('Hi Priya Customer, Ada Agent here about #{{conversation.displayId}}.')
  })

  it('inserts generated response text at the cursor without replacing surrounding text', () => {
    expect(helpers).not.toBeNull()

    expect(helpers!.insertTextAtCursor('Before  after', 'canned body', 7)).toEqual({
      value: 'Before canned body after',
      cursor: 18,
    })
  })

  it('can replace a slash shortcode token while preserving the rest of the draft', () => {
    expect(helpers).not.toBeNull()

    expect(helpers!.insertTextAtCursor('Before /greet after', 'Hello there', 13, 7)).toEqual({
      value: 'Before Hello there after',
      cursor: 18,
    })
  })
})
