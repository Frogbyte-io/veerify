<template>
  <!--
    Second of the two layers `design.md` requires for inbound HTML: sanitized on
    ingest (server/utils/inbound-sanitize.ts), then rendered here inside a
    sandboxed iframe. Both, not either — the sanitizer is the primary defence,
    and this contains anything that gets past it.

    `sandbox` with no `allow-scripts` and no `allow-same-origin` means the
    document cannot run script, cannot reach our cookies or localStorage, and
    cannot navigate the agent's tab. `srcdoc` keeps it a same-document string
    rather than a network fetch.

    Deliberately NOT `v-html` — that would render hostile markup directly into
    the agent's authenticated session, which is exactly the risk the design
    calls out.
  -->
  <iframe
    ref="frame"
    data-testid="support-message-html"
    class="w-full border-0 bg-transparent"
    :style="{ height: height + 'px' }"
    sandbox=""
    referrerpolicy="no-referrer"
    loading="lazy"
    :srcdoc="document"
    @load="fitToContent"
  />
</template>

<script>
const MIN_HEIGHT = 24
const MAX_HEIGHT = 900

export default {
  name: 'SupportMessageHtml',

  props: {
    html: {
      type: String,
      required: true,
    },
  },

  data() {
    return {
      height: MIN_HEIGHT,
    }
  },

  computed: {
    document() {
      // A minimal wrapper so the message inherits readable typography instead
      // of the browser's default serif. Styles live here, in the sandboxed
      // document, rather than being injected into the message markup.
      return [
        '<!doctype html><html><head><meta charset="utf-8">',
        '<style>',
        'html,body{margin:0;padding:0;background:transparent;}',
        'body{font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;word-break:break-word;}',
        '@media (prefers-color-scheme: dark){body{color:#e5e5e5;}}',
        'a{color:#2563eb;}',
        'img,table{max-width:100%;}',
        'blockquote{margin:0 0 0 .75rem;padding-left:.75rem;border-left:2px solid #d4d4d4;color:#666;}',
        '</style></head><body>',
        this.html,
        '</body></html>',
      ].join('')
    },
  },

  watch: {
    html() {
      // Shrink first so a shorter message does not keep a taller frame's height
      // until the new content loads.
      this.height = MIN_HEIGHT
    },
  },

  methods: {
    fitToContent() {
      // An iframe has no intrinsic height, so without this every message would
      // render in a fixed-height box with its own scrollbar.
      //
      // `sandbox=""` makes the frame opaque-origin, so reading its document
      // throws. That is the security property working as intended, and the
      // fallback is a sensible fixed height rather than a broken layout.
      try {
        const frame = this.$refs.frame
        const body = frame?.contentDocument?.body
        if (!body) return

        const measured = Math.ceil(body.scrollHeight)
        this.height = Math.min(Math.max(measured, MIN_HEIGHT), MAX_HEIGHT)
      } catch {
        this.height = 240
      }
    },
  },
}
</script>
