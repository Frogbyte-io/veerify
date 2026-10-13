import { describe, expect, it } from 'vitest'
import { escapeBelongsToOverlay } from '~/lib/inline-form-mixin'

type Fake = {
  contains: (other: unknown) => boolean
  getAttribute: (name: string) => string | null
}

function layer(opts: { state?: string; contains?: unknown[] } = {}): Fake {
  return {
    contains: (other) => opts.contains?.includes(other) ?? false,
    getAttribute: (name) => (name === 'data-state' ? (opts.state ?? 'open') : null),
  }
}
const root = (layers: Fake[]) => ({ querySelectorAll: () => layers as unknown as NodeListOf<Element> })
const form = {} as Element
const targetIn = (found: Fake | null) => ({ target: { closest: () => found } })

describe('escapeBelongsToOverlay', () => {
  it('does not ignore Escape with no overlay open', () => {
    expect(escapeBelongsToOverlay(targetIn(null), form, root([]))).toBe(false)
  })

  it('ignores Escape fired inside a menu/listbox/dialog', () => {
    expect(escapeBelongsToOverlay(targetIn(layer()), form, root([]))).toBe(true)
  })

  it('ignores Escape while another overlay is open in the document', () => {
    expect(escapeBelongsToOverlay(targetIn(null), form, root([layer()]))).toBe(true)
  })

  it('does not count closed layers', () => {
    expect(escapeBelongsToOverlay(targetIn(null), form, root([layer({ state: 'closed' })]))).toBe(false)
  })

  it('does not count a dialog that contains the form itself', () => {
    const dialog = layer({ contains: [form] })
    expect(escapeBelongsToOverlay(targetIn(dialog), form, root([dialog]))).toBe(false)
  })
})
