import { describe, expect, it } from 'vitest'
import SupportMessageHtml from '~/components/support/SupportMessageHtml.vue'

const fitToContent = SupportMessageHtml.methods?.fitToContent as () => void

describe('SupportMessageHtml iframe sizing', () => {
  it('uses the fallback height when the sandboxed document body is unavailable', () => {
    const instance = {
      $refs: { frame: { contentDocument: null } },
      height: 24,
    }

    fitToContent.call(instance)

    expect(instance.height).toBe(240)
  })

  it('uses the fallback height when accessing the sandboxed document throws', () => {
    const instance = {
      $refs: {
        get frame() {
          throw new Error('opaque origin')
        },
      },
      height: 24,
    }

    fitToContent.call(instance)

    expect(instance.height).toBe(240)
  })
})
