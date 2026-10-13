/**
 * Options API mixin for inline add/edit forms that replace the button that opens them.
 *
 * Mark the form container with `data-inline-form="<key>"` and the opening button with
 * `data-inline-opener="<key>"`, then call `inlineOpen(key, onEscape)` when the form opens and
 * `inlineClose()` when it closes. Opening focuses the first field; Escape (anywhere on the page,
 * not only inside the field) calls `onEscape`; closing returns focus to the opener, which is
 * looked up again by attribute because the original node is gone once the form replaced it.
 *
 * Escape is ignored when it was meant for an overlay (reka-ui menu, listbox, dialog, popover) that is
 * open next to the form: it should close that overlay, not cancel the form.
 */
const OVERLAY_LAYER = '[role="menu"],[role="listbox"],[role="dialog"],[role="alertdialog"],[data-dismissable-layer]'

/**
 * True when an Escape keydown belongs to an open overlay layer rather than the inline form. A layer
 * that contains the form itself (a form inside a dialog) does not count.
 */
export function escapeBelongsToOverlay(
  event: { target: unknown },
  form: Element | null,
  root: Pick<ParentNode, 'querySelectorAll'> = document
): boolean {
  const target = event.target as Element | null
  const own = (layer: Element) => Boolean(form && layer.contains(form))
  const targetLayer = typeof target?.closest === 'function' ? target.closest(OVERLAY_LAYER) : null
  if (targetLayer && !own(targetLayer)) return true
  for (const layer of Array.from(root.querySelectorAll(OVERLAY_LAYER))) {
    if (own(layer) || layer.getAttribute('data-state') === 'closed') continue
    return true
  }
  return false
}
type InlineHost = {
  $nextTick: (fn: () => void) => void
  _inlineKey?: string | null
  _inlineHandler?: ((event: KeyboardEvent) => void) | null
  inlineTeardown: () => void
}

const FIELD = 'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled])'

export default {
  beforeUnmount(this: InlineHost) {
    this.inlineTeardown()
  },
  methods: {
    inlineOpen(this: InlineHost, key: string, onEscape: () => void) {
      this.inlineTeardown()
      this._inlineKey = key
      const handler = (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return
        const form = document.querySelector(`[data-inline-form="${key}"]`)
        if (escapeBelongsToOverlay(event, form)) return
        onEscape()
      }
      this._inlineHandler = handler
      document.addEventListener('keydown', handler)
      this.$nextTick(() => {
        const form = document.querySelector(`[data-inline-form="${key}"]`)
        form?.querySelector<HTMLElement>(FIELD)?.focus()
      })
    },
    inlineClose(this: InlineHost) {
      const key = this._inlineKey
      this.inlineTeardown()
      if (!key) return
      // The opener can still be disabled while a save settles, so retry for a few frames
      let tries = 0
      const focusOpener = () => {
        const opener = document.querySelector<HTMLElement>(`[data-inline-opener="${key}"]`)
        opener?.focus()
        if (document.activeElement !== opener && tries++ < 30) requestAnimationFrame(focusOpener)
      }
      this.$nextTick(focusOpener)
    },
    inlineTeardown(this: InlineHost) {
      if (this._inlineHandler) document.removeEventListener('keydown', this._inlineHandler)
      this._inlineHandler = null
      this._inlineKey = null
    },
  },
}
