<template>
  <div class="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Icon name="lucide:code-2" class="h-5 w-5" />
          Embed Your Public Board
        </CardTitle>
        <CardDescription> Add your public board to any website using an iframe snippet. </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div v-if="!publicBoardUrl" class="rounded-md bg-muted p-4 text-sm text-muted-foreground">
          The public board URL could not be determined. Make sure the project is public and its workspace has a slug.
        </div>

        <template v-else>
          <div v-if="products.length > 1" class="space-y-2">
            <Label for="embed-product">Product</Label>
            <select
              id="embed-product"
              v-model="selectedProductSlug"
              class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option v-for="p in publicProducts" :key="p.id" :value="p.slug">{{ p.name }}</option>
            </select>
          </div>
          <!-- Snippet -->
          <div class="space-y-2">
            <Label>Embed Snippet</Label>
            <div class="relative">
              <pre
                class="rounded-md bg-muted px-4 py-3 text-sm font-mono overflow-x-auto whitespace-pre-wrap break-all"
                >{{ iframeSnippet }}</pre
              >
              <Button
                variant="ghost"
                size="icon"
                class="absolute top-2 right-2 h-7 w-7"
                :title="copied ? 'Copied!' : 'Copy snippet'"
                @click="copySnippet"
              >
                <Icon :name="copied ? 'lucide:check' : 'lucide:copy'" class="h-4 w-4" />
              </Button>
            </div>
          </div>

          <!-- Options -->
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-2">
              <Label for="embed-width">Width</Label>
              <Input id="embed-width" v-model="options.width" placeholder="100%" />
            </div>
            <div class="space-y-2">
              <Label for="embed-height">Height</Label>
              <Input id="embed-height" v-model="options.height" placeholder="600" />
            </div>
          </div>

          <p class="text-xs text-muted-foreground">
            Paste this snippet into any HTML page where you want the feedback board to appear. The board will use the
            same settings and styles configured in the Appearance tab.
          </p>
        </template>
      </CardContent>
    </Card>

    <!-- Live Preview -->
    <Card v-if="publicBoardUrl">
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Icon name="lucide:monitor" class="h-5 w-5" />
          Preview
        </CardTitle>
        <CardDescription>Live preview of the embedded board.</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="rounded-md border overflow-hidden" :style="{ height: previewHeight }">
          <iframe
            :src="publicBoardUrl"
            :width="options.width || '100%'"
            :height="options.height || '600'"
            frameborder="0"
            class="w-full h-full"
            title="Feedback Board Preview"
          />
        </div>
      </CardContent>
    </Card>
  </div>
</template>

<script>
import { buildPublicBoardUrl } from '~/lib/public-board-url'

export default {
  name: 'ProjectSettingsEmbed',
  props: {
    project: {
      type: Object,
      required: true,
    },
    organization: {
      type: Object,
      default: null,
    },
    products: {
      type: Array,
      default: () => [],
    },
  },
  data() {
    return {
      selectedProductSlug: '',
      copied: false,
      options: {
        width: '100%',
        height: '600',
      },
    }
  },
  computed: {
    publicProducts() {
      return this.products.filter((p) => p.isPublic)
    },
    productSlug() {
      if (this.products.length <= 1) return undefined
      return this.selectedProductSlug || this.publicProducts[0]?.slug
    },
    publicBoardUrl() {
      if (!import.meta.client || !this.project || !this.organization?.slug) return ''
      const hasActiveDomain = this.project.customDomain && this.project.settings?.domainStatus === 'active'
      return buildPublicBoardUrl({
        orgSlug: this.organization.slug,
        projectSlug: this.project.slug,
        productSlug: this.productSlug,
        customDomain: hasActiveDomain ? this.project.customDomain : undefined,
        appDomain: useRuntimeConfig().public.appDomain || 'localhost',
        protocol: window.location.protocol,
        port: window.location.port,
      })
    },
    iframeSnippet() {
      const width = this.options.width || '100%'
      const height = this.options.height || '600'
      return `<iframe\n  src="${this.publicBoardUrl}"\n  width="${width}"\n  height="${height}"\n  frameborder="0"\n  title="${this.project.name}"\n></iframe>`
    },
    previewHeight() {
      const h = parseInt(this.options.height, 10)
      return isNaN(h) ? '600px' : `${Math.min(h, 800)}px`
    },
  },
  methods: {
    async copySnippet() {
      try {
        await navigator.clipboard.writeText(this.iframeSnippet)
        this.copied = true
        setTimeout(() => {
          this.copied = false
        }, 2000)
      } catch {
        // fallback for browsers without clipboard API
        const el = document.createElement('textarea')
        el.value = this.iframeSnippet
        document.body.appendChild(el)
        el.select()
        document.execCommand('copy')
        document.body.removeChild(el)
        this.copied = true
        setTimeout(() => {
          this.copied = false
        }, 2000)
      }
    },
  },
}
</script>
