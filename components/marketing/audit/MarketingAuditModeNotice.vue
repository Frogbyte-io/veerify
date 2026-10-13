<template>
  <div data-testid="audit-mode">
    <div class="flex items-center gap-2">
      <Badge :variant="mode === 'full' ? 'default' : 'secondary'">
        {{ mode === 'full' ? 'Full crawl' : 'Basic audit' }}
      </Badge>
      <span v-if="mode === 'full'" class="text-sm text-muted-foreground">
        Up to {{ pageLimit }} pages crawled through Firecrawl.
      </span>
    </div>
    <div
      v-if="mode === 'basic'"
      class="mt-3 rounded-lg border border-border bg-muted/40 p-4 text-sm"
      data-testid="audit-basic-notice"
    >
      <p class="font-medium text-foreground">Only part of your site was checked</p>
      <p class="mt-1 text-muted-foreground">
        A basic audit checks robots.txt, llms.txt, the sitemap and the home page. To audit every page, add a Firecrawl
        API key in
        <NuxtLink to="/marketing/settings" class="underline">Marketing settings</NuxtLink>
        . On a self-hosted install you can instead set <code class="rounded bg-muted px-1">FIRECRAWL_API_KEY</code> on
        the server.
      </p>
    </div>
  </div>
</template>

<script>
export default {
  name: 'MarketingAuditModeNotice',

  props: {
    mode: { type: String, required: true },
    pageLimit: { type: Number, default: 0 },
  },
}
</script>
