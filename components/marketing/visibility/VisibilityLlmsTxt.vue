<template>
  <Card data-testid="visibility-llms-txt">
    <CardHeader>
      <CardTitle>llms.txt draft</CardTitle>
      <CardDescription>
        A starting point for <code>/llms.txt</code> on your site, built from your product details, public pages and the
        latest site audit. Review it before publishing.
      </CardDescription>
    </CardHeader>
    <CardContent class="space-y-3">
      <Skeleton v-if="isLoading" class="h-40 w-full" />

      <div v-else-if="error" class="flex items-center gap-2 text-sm text-destructive">
        <span>{{ error }}</span>
        <Button variant="outline" size="sm" @click="load">Retry</Button>
      </div>

      <template v-else>
        <pre
          class="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 text-xs"
          data-testid="visibility-llms-txt-content"
          >{{ content }}</pre
        >
        <div class="flex gap-2">
          <Button variant="outline" size="sm" class="gap-2" @click="copy">
            <Icon :name="copied ? 'lucide:check' : 'lucide:copy'" class="h-4 w-4" />
            {{ copied ? 'Copied' : 'Copy' }}
          </Button>
          <Button variant="outline" size="sm" class="gap-2" @click="download">
            <Icon name="lucide:download" class="h-4 w-4" />
            Download
          </Button>
        </div>
      </template>
    </CardContent>
  </Card>
</template>

<script>
import { toast } from 'vue-sonner'

export default {
  name: 'VisibilityLlmsTxt',

  props: {
    projectId: { type: String, required: true },
  },

  data() {
    return { content: '', isLoading: true, error: null, copied: false }
  },

  watch: {
    projectId: {
      immediate: true,
      handler() {
        this.load()
      },
    },
  },

  methods: {
    async load() {
      this.isLoading = true
      this.error = null
      try {
        const response = await $fetch(`/api/marketing/projects/${this.projectId}/visibility/llms-txt`)
        this.content = response.data.content
      } catch (err) {
        this.error = err?.data?.error?.message || 'Failed to generate the llms.txt draft'
      } finally {
        this.isLoading = false
      }
    },

    async copy() {
      try {
        await navigator.clipboard.writeText(this.content)
        this.copied = true
        setTimeout(() => {
          this.copied = false
        }, 2000)
      } catch {
        toast.error('Could not copy to the clipboard')
      }
    },

    download() {
      const url = URL.createObjectURL(new Blob([this.content], { type: 'text/plain;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'llms.txt'
      link.click()
      URL.revokeObjectURL(url)
    },
  },
}
</script>
