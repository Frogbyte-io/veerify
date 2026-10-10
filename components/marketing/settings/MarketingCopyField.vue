<template>
  <div class="mt-1 flex items-center gap-2">
    <code class="flex-1 min-w-0 break-all rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs">{{ value }}</code>
    <Button type="button" variant="outline" size="icon" aria-label="Copy" @click="copy">
      <Icon name="lucide:copy" class="w-4 h-4" />
    </Button>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'

/** A read-only value with a copy button. */
export default {
  name: 'MarketingCopyField',

  props: {
    value: { type: String, required: true },
  },

  methods: {
    async copy() {
      try {
        await navigator.clipboard.writeText(this.value)
        toast.success('Copied')
      } catch {
        toast.error('Could not copy. Select the text and copy it manually.')
      }
    },
  },
}
</script>
