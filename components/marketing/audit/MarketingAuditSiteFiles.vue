<template>
  <Card data-testid="audit-site-files">
    <CardHeader>
      <CardTitle role="heading" aria-level="2" class="text-base">Site files</CardTitle>
    </CardHeader>
    <CardContent class="space-y-5">
      <div data-testid="audit-llms">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-medium">llms.txt</span>
          <Badge :variant="llms.variant">{{ llms.label }}</Badge>
        </div>
        <ul v-if="problems.length" class="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li v-for="(problem, index) in problems" :key="index">{{ problem }}</li>
        </ul>
        <p v-if="llms.state === 'missing'" class="mt-2 text-sm text-muted-foreground">
          An llms.txt file gives AI assistants a short, curated guide to your product.
        </p>
        <NuxtLink
          v-if="llms.state !== 'valid'"
          to="/marketing/ai-visibility"
          class="mt-2 inline-flex items-center gap-1 text-sm underline"
        >
          Generate an llms.txt
          <Icon name="lucide:arrow-right" class="h-3 w-3" />
        </NuxtLink>
      </div>

      <div data-testid="audit-sitemap">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-medium">sitemap.xml</span>
          <Badge :variant="sitemap.variant">{{ sitemap.label }}</Badge>
        </div>
        <p v-if="sitemapDetail" class="mt-1 text-sm text-muted-foreground">{{ sitemapDetail }}</p>
      </div>

      <div data-testid="audit-robots">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-medium">robots.txt</span>
          <Badge :variant="robots.variant">{{ robots.label }}</Badge>
        </div>
      </div>
    </CardContent>
  </Card>
</template>

<script>
function describe(file, okLabel) {
  const status = file?.status
  if (status === 'found') return { state: 'found', label: okLabel, variant: 'secondary' }
  if (status === 'missing') return { state: 'missing', label: 'Missing', variant: 'destructive' }
  return { state: 'error', label: 'Could not be fetched', variant: 'outline' }
}

export default {
  name: 'MarketingAuditSiteFiles',

  props: {
    siteFacts: { type: Object, default: null },
  },

  computed: {
    llms() {
      const file = this.siteFacts?.llmsTxt
      if (file?.status === 'found') {
        return file.validation?.valid
          ? { state: 'valid', label: 'Valid', variant: 'secondary' }
          : { state: 'invalid', label: 'Invalid', variant: 'destructive' }
      }
      return describe(file, 'Found')
    },
    problems() {
      return this.siteFacts?.llmsTxt?.validation?.problems || []
    },
    sitemap() {
      return describe(this.siteFacts?.sitemap, 'Found')
    },
    sitemapDetail() {
      const sitemap = this.siteFacts?.sitemap
      if (sitemap?.status !== 'found') return ''
      if (sitemap.kind === 'invalid') return 'The file is not a valid sitemap.'
      const noun = sitemap.kind === 'index' ? 'child sitemaps' : 'URLs'
      return `${sitemap.urlCount} ${noun} listed.`
    },
    robots() {
      return describe(this.siteFacts?.robotsTxt, 'Found')
    },
  },
}
</script>
