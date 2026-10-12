<template>
  <NuxtLayout name="dashboard">
    <div class="p-6 max-w-5xl mx-auto space-y-6" data-testid="marketing-overview-page">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-3xl font-bold tracking-tight text-foreground">Marketing</h1>
          <p class="text-muted-foreground mt-1">Get your product found by search engines, AI assistants and people</p>
        </div>
        <MarketingProductPicker @change="onProductChange" @error="onPickerError" />
      </div>

      <p v-if="pickerError" class="text-sm text-muted-foreground" data-testid="marketing-picker-error">
        Products could not be loaded. Use Retry above to try again.
      </p>

      <template v-else-if="pickerReady">
        <Card v-if="!product">
          <CardContent class="py-10 text-center">
            <p class="font-medium mb-1">No products yet</p>
            <p class="text-sm text-muted-foreground mb-4">Marketing works on a product. Create one to get started.</p>
            <Button as-child variant="outline">
              <NuxtLink to="/products">Go to products</NuxtLink>
            </Button>
          </CardContent>
        </Card>

        <MarketingDisabled v-else-if="disabledMessage !== null" :product="product" :message="disabledMessage" />

        <div v-else-if="isLoading" class="space-y-6">
          <Skeleton class="h-40 w-full" />
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton class="h-40" />
            <Skeleton class="h-40" />
            <Skeleton class="h-40" />
          </div>
          <Skeleton class="h-24 w-full" />
        </div>

        <Card v-else-if="error">
          <CardContent class="text-center py-8">
            <Icon name="lucide:alert-circle" class="w-8 h-8 text-destructive mx-auto mb-3" />
            <p class="font-medium mb-2">Failed to load the marketing overview</p>
            <p class="text-sm text-muted-foreground mb-4">{{ error }}</p>
            <Button variant="outline" @click="load">
              <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
              Try again
            </Button>
          </CardContent>
        </Card>

        <template v-else-if="overview">
          <Card v-if="!setupComplete" data-testid="marketing-setup">
            <CardHeader>
              <CardTitle role="heading" aria-level="2">Get set up</CardTitle>
              <CardDescription>{{ completedSteps }} of {{ steps.length }} steps done</CardDescription>
            </CardHeader>
            <CardContent>
              <ul class="space-y-2">
                <li
                  v-for="step in steps"
                  :key="step.key"
                  class="flex items-start gap-3"
                  :data-testid="`setup-${step.key}`"
                >
                  <Icon
                    :name="step.done ? 'lucide:circle-check' : 'lucide:circle'"
                    class="w-5 h-5 mt-0.5 shrink-0"
                    :class="step.done ? 'text-green-600 dark:text-green-500' : 'text-muted-foreground'"
                  />
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-medium" :class="step.done ? 'text-muted-foreground' : ''">
                      <span class="sr-only">{{ step.done ? 'Done: ' : 'To do: ' }}</span>
                      {{ step.title }}
                    </p>
                    <p v-if="!step.done" class="text-xs text-muted-foreground">{{ step.hint }}</p>
                  </div>
                  <template v-if="!step.done">
                    <span
                      v-if="step.adminOnly && canManageSite === false"
                      class="text-xs text-muted-foreground"
                      :data-testid="`setup-${step.key}-admin-note`"
                    >
                      Ask a team admin
                    </span>
                    <Button v-else as-child size="sm" variant="outline">
                      <NuxtLink :to="`${settingsLink}#${step.section}`">{{ step.action }}</NuxtLink>
                    </Button>
                  </template>
                </li>
              </ul>
            </CardContent>
          </Card>

          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card data-testid="marketing-card-audit">
              <CardHeader>
                <CardTitle role="heading" aria-level="2" class="flex items-center gap-2 text-base">
                  <Icon name="lucide:search-check" class="w-4 h-4" />
                  Site audit
                </CardTitle>
              </CardHeader>
              <CardContent class="space-y-3">
                <template v-if="overview.latestAudit">
                  <p class="text-3xl font-bold">
                    {{ overview.latestAudit.score === null ? 'n/a' : overview.latestAudit.score }}
                    <span
                      v-if="overview.latestAudit.score !== null"
                      class="text-base font-normal text-muted-foreground"
                    >
                      / 100
                    </span>
                  </p>
                  <p class="text-xs text-muted-foreground">
                    {{ auditSummary }}
                  </p>
                </template>
                <p v-else class="text-sm text-muted-foreground">No audit yet.</p>
                <Button as-child variant="outline" size="sm">
                  <NuxtLink :to="withProduct('/marketing/audit')">Open audit</NuxtLink>
                </Button>
              </CardContent>
            </Card>

            <Card data-testid="marketing-card-visibility">
              <CardHeader>
                <CardTitle role="heading" aria-level="2" class="flex items-center gap-2 text-base">
                  <Icon name="lucide:sparkles" class="w-4 h-4" />
                  AI visibility
                </CardTitle>
              </CardHeader>
              <CardContent class="space-y-3">
                <template v-if="overview.latestVisibilityRun">
                  <p class="text-3xl font-bold">
                    {{ mentionRateLabel }}
                  </p>
                  <p class="text-xs text-muted-foreground">
                    of sampled AI answers mention your brand.
                    {{ runSummary }}
                  </p>
                </template>
                <p v-else-if="!overview.setup.hasLlmKey" class="text-sm text-muted-foreground">
                  Add an Anthropic, OpenAI, Gemini or Perplexity key to measure how AI assistants talk about you.
                </p>
                <p v-else class="text-sm text-muted-foreground">No run yet.</p>
                <Button as-child variant="outline" size="sm">
                  <NuxtLink :to="withProduct('/marketing/ai-visibility')">Open AI visibility</NuxtLink>
                </Button>
              </CardContent>
            </Card>

            <Card data-testid="marketing-card-mentions">
              <CardHeader>
                <CardTitle role="heading" aria-level="2" class="flex items-center gap-2 text-base">
                  <Icon name="lucide:at-sign" class="w-4 h-4" />
                  Mentions
                </CardTitle>
              </CardHeader>
              <CardContent class="space-y-3">
                <p class="text-3xl font-bold">{{ overview.newMentions ?? 0 }}</p>
                <p class="text-xs text-muted-foreground">
                  new {{ overview?.newMentions === 1 ? 'mention' : 'mentions' }}
                </p>
                <Button as-child variant="outline" size="sm">
                  <NuxtLink :to="withProduct('/marketing/mentions')">Open mentions</NuxtLink>
                </Button>
              </CardContent>
            </Card>

            <Card data-testid="marketing-card-search">
              <CardHeader>
                <CardTitle role="heading" aria-level="2" class="flex items-center gap-2 text-base">
                  <Icon name="lucide:trending-up" class="w-4 h-4" />
                  Search
                </CardTitle>
              </CardHeader>
              <CardContent class="space-y-3">
                <template v-if="overview.search?.connected && overview.search.totals">
                  <p class="text-3xl font-bold">{{ formatNumber(overview.search.totals.current.clicks) }}</p>
                  <p class="text-xs text-muted-foreground">
                    clicks and {{ formatNumber(overview.search.totals.current.impressions) }} impressions, last
                    {{ overview.search.totals.days }} days
                  </p>
                  <p v-if="searchDelta" class="text-xs" :class="searchDelta.className" data-testid="search-delta">
                    {{ searchDelta.label }}
                  </p>
                </template>
                <p v-else-if="overview.search?.connected" class="text-sm text-muted-foreground">
                  Connected. Waiting for the first sync.
                </p>
                <p v-else class="text-sm text-muted-foreground">
                  Connect Search Console to see clicks and impressions.
                </p>
                <Button as-child variant="outline" size="sm">
                  <NuxtLink :to="withProduct('/marketing/search')">
                    {{ overview.search?.connected ? 'Open search' : 'Connect Search Console' }}
                  </NuxtLink>
                </Button>
              </CardContent>
            </Card>

            <Card data-testid="marketing-card-reviews">
              <CardHeader>
                <CardTitle role="heading" aria-level="2" class="flex items-center gap-2 text-base">
                  <Icon name="lucide:star" class="w-4 h-4" />
                  Reviews
                </CardTitle>
              </CardHeader>
              <CardContent class="space-y-3">
                <template v-if="overview.reviews?.enabled">
                  <p class="text-3xl font-bold">{{ formatNumber(overview.reviews.requestsSent) }}</p>
                  <p class="text-xs text-muted-foreground">
                    {{ overview.reviews.requestsSent === 1 ? 'request' : 'requests' }} sent in the last
                    {{ overview.reviews.sinceDays }} days.
                    {{ formatNumber(overview.reviews.pendingTestimonials) }} pending
                    {{ overview.reviews.pendingTestimonials === 1 ? 'testimonial' : 'testimonials' }}.
                  </p>
                </template>
                <p v-else class="text-sm text-muted-foreground">
                  Review requests are off. Ask happy customers for reviews and testimonials.
                </p>
                <Button as-child variant="outline" size="sm">
                  <NuxtLink :to="withProduct('/marketing/reviews')">
                    {{ overview.reviews?.enabled ? 'Open reviews' : 'Turn on review requests' }}
                  </NuxtLink>
                </Button>
              </CardContent>
            </Card>

            <Card data-testid="marketing-card-announcements">
              <CardHeader>
                <CardTitle role="heading" aria-level="2" class="flex items-center gap-2 text-base">
                  <Icon name="lucide:megaphone" class="w-4 h-4" />
                  Announcements
                </CardTitle>
              </CardHeader>
              <CardContent class="space-y-3">
                <template v-if="overview.announcements?.changelogEnabled">
                  <p class="text-3xl font-bold">{{ formatNumber(overview.announcements.withoutDrafts) }}</p>
                  <p class="text-xs text-muted-foreground">
                    published {{ overview.announcements.withoutDrafts === 1 ? 'entry' : 'entries' }} without drafts
                  </p>
                </template>
                <p v-else class="text-sm text-muted-foreground">
                  Changelog is off. Turn it on to draft announcements for what you ship.
                </p>
                <Button as-child variant="outline" size="sm">
                  <NuxtLink :to="withProduct('/marketing/announcements')">Open announcements</NuxtLink>
                </Button>
              </CardContent>
            </Card>

            <Card data-testid="marketing-card-language">
              <CardHeader>
                <CardTitle role="heading" aria-level="2" class="flex items-center gap-2 text-base">
                  <Icon name="lucide:message-circle-heart" class="w-4 h-4" />
                  Customer language
                </CardTitle>
              </CardHeader>
              <CardContent class="space-y-3">
                <template v-if="overview.language?.lastRunAt">
                  <p class="text-3xl font-bold">{{ formatDate(overview.language.lastRunAt) }}</p>
                  <p class="text-xs text-muted-foreground">last analysis</p>
                </template>
                <p v-else-if="overview.language?.consented" class="text-sm text-muted-foreground">
                  No analysis yet. Run one to see how customers describe you.
                </p>
                <p v-else class="text-sm text-muted-foreground">
                  Give consent to analyse customer feedback and learn the words they use.
                </p>
                <Button as-child variant="outline" size="sm">
                  <NuxtLink :to="withProduct('/marketing/language')">
                    {{ overview.language?.consented ? 'Open customer language' : 'Give consent to analyse' }}
                  </NuxtLink>
                </Button>
              </CardContent>
            </Card>

            <Card data-testid="marketing-card-changelog">
              <CardHeader>
                <CardTitle role="heading" aria-level="2" class="flex items-center gap-2 text-base">
                  <Icon name="lucide:newspaper" class="w-4 h-4" />
                  Changelog
                </CardTitle>
              </CardHeader>
              <CardContent class="space-y-3">
                <template v-if="overview.changelog?.latest">
                  <p class="text-base font-semibold line-clamp-2">{{ overview.changelog.latest.title }}</p>
                  <p class="text-xs text-muted-foreground">
                    Published {{ formatDate(overview.changelog.latest.publishedAt) }}
                  </p>
                </template>
                <p v-else-if="overview.changelog?.enabled" class="text-sm text-muted-foreground">
                  Nothing published yet.
                </p>
                <p v-else class="text-sm text-muted-foreground">Changelog is off for this product.</p>
                <Button as-child variant="outline" size="sm">
                  <NuxtLink :to="withProduct('/dashboard/changelog')">Open changelog</NuxtLink>
                </Button>
              </CardContent>
            </Card>

            <Card data-testid="marketing-card-competitors">
              <CardHeader>
                <CardTitle role="heading" aria-level="2" class="flex items-center gap-2 text-base">
                  <Icon name="lucide:binoculars" class="w-4 h-4" />
                  Competitors
                </CardTitle>
              </CardHeader>
              <CardContent class="space-y-3">
                <template v-if="overview.competitors?.watching || overview.competitors?.unseenChanges">
                  <p class="text-2xl font-semibold">{{ overview.competitors.unseenChanges ?? 0 }}</p>
                  <p class="text-xs text-muted-foreground">
                    unseen {{ overview.competitors.unseenChanges === 1 ? 'change' : 'changes' }} across
                    {{ overview.competitors.watching ?? 0 }} watched
                    {{ overview.competitors.watching === 1 ? 'page' : 'pages' }}
                  </p>
                </template>
                <p v-else class="text-sm text-muted-foreground">
                  Watch competitors' pricing and changelog pages for changes.
                </p>
                <Button as-child variant="outline" size="sm">
                  <NuxtLink :to="withProduct('/marketing/competitors')">
                    {{
                      overview.competitors?.watching || overview.competitors?.unseenChanges
                        ? 'Review changes'
                        : 'Watch a competitor'
                    }}
                  </NuxtLink>
                </Button>
              </CardContent>
            </Card>

            <Card data-testid="marketing-card-launch-kit">
              <CardHeader>
                <CardTitle role="heading" aria-level="2" class="flex items-center gap-2 text-base">
                  <Icon name="lucide:rocket" class="w-4 h-4" />
                  Launch kit
                </CardTitle>
              </CardHeader>
              <CardContent class="space-y-3">
                <p class="text-2xl font-semibold">
                  {{ overview.launchKit?.live ?? 0 }}
                  <span class="text-sm font-normal text-muted-foreground">
                    / {{ overview.launchKit?.catalogSize ?? 0 }} live
                  </span>
                </p>
                <p class="text-xs text-muted-foreground">
                  {{ overview.launchKit?.submitted ?? 0 }} submitted · {{ overview.launchKit?.inProgress ?? 0 }} in
                  progress
                </p>
                <Button as-child variant="outline" size="sm">
                  <NuxtLink :to="withProduct('/marketing/launch')">Open launch kit</NuxtLink>
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card data-testid="marketing-usage">
            <CardHeader>
              <CardTitle role="heading" aria-level="2" class="text-base">Usage this month</CardTitle>
              <CardDescription>Counted for your whole team. Provider invoices are the source of truth.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl class="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt class="text-xs text-muted-foreground">AI tokens (input and output)</dt>
                  <dd class="text-xl font-semibold">{{ formatNumber(llmTokens) }}</dd>
                </div>
                <div>
                  <dt class="text-xs text-muted-foreground">Pages crawled</dt>
                  <dd class="text-xl font-semibold">{{ formatNumber(crawledPages) }}</dd>
                </div>
                <div v-for="item in llmCosts" :key="item.provider" :data-testid="`usage-cost-${item.provider}`">
                  <dt class="text-xs text-muted-foreground">Estimated cost, {{ item.provider }}</dt>
                  <dd class="text-xl font-semibold">{{ item.label }}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </template>
      </template>
    </div>
  </NuxtLayout>
</template>

<script>
import { apiErrorMessage, apiErrorStatus } from '~/lib/api-error'

export default {
  name: 'MarketingOverviewPage',

  created() {
    useHead({ title: 'Marketing overview' })
  },

  data() {
    return {
      pickerReady: false,
      product: null,
      overview: null,
      isLoading: false,
      error: null,
      disabledMessage: null,
      pickerError: false,
      canManageSite: null,
    }
  },

  computed: {
    steps() {
      const setup = this.overview?.setup
      if (!setup) return []
      return [
        {
          key: 'site',
          section: 'site',
          title: 'Add your site',
          hint: 'Tell Marketing which website to look at.',
          action: 'Add site',
          adminOnly: true,
          done: setup.siteAdded,
        },
        {
          key: 'verify',
          section: 'site',
          title: 'Verify you own it',
          hint: 'Add a DNS record, a meta tag or a file. Nothing runs before this.',
          action: 'Verify',
          adminOnly: true,
          done: setup.siteVerified,
        },
        {
          key: 'terms',
          section: 'terms',
          title: 'Add your brand name',
          hint: 'Add competitors and keywords too, if you like.',
          action: 'Add terms',
          done: setup.hasBrandTerm,
        },
        {
          key: 'keys',
          section: 'keys',
          title: 'Add an AI key',
          hint: 'An Anthropic, OpenAI, Gemini or Perplexity key unlocks AI visibility. A Firecrawl key is optional and unlocks the full site crawl.',
          action: 'Add keys',
          done: setup.hasLlmKey,
        },
      ]
    },

    completedSteps() {
      return this.steps.filter((step) => step.done).length
    },

    setupComplete() {
      return this.steps.length > 0 && this.completedSteps === this.steps.length
    },

    settingsLink() {
      return this.withProduct('/marketing/settings')
    },

    auditSummary() {
      const audit = this.overview?.latestAudit
      if (!audit) return ''
      const mode = audit.mode === 'full' ? 'Full crawl' : 'Basic mode'
      if (audit.status !== 'done') return `${mode}, ${audit.status}`
      return `${mode}, finished ${this.formatDate(audit.finishedAt)}`
    },

    mentionRateLabel() {
      const rate = this.overview?.latestVisibilityRun?.mentionRate
      return rate === null || rate === undefined ? 'n/a' : `${Math.round(rate * 100)}%`
    },

    runSummary() {
      const run = this.overview?.latestVisibilityRun
      if (!run) return ''
      return run.finishedAt ? `Last run ${this.formatDate(run.finishedAt)}.` : `Run ${run.status}.`
    },

    llmTokens() {
      const usage = this.overview?.usage || {}
      return Object.entries(usage)
        .filter(([metric]) => metric.startsWith('llm:') && /:(input|output)_tokens$/.test(metric))
        .reduce((sum, [, units]) => sum + units, 0)
    },

    llmCosts() {
      const usage = this.overview?.usage || {}
      return Object.entries(usage)
        .map(([metric, micros]) => ({ match: /^llm:(.+):cost_usd_micros$/.exec(metric), micros }))
        .filter((item) => item.match)
        .map((item) => ({
          provider: item.match[1],
          label: `$${(item.micros / 1_000_000).toFixed(2)}`,
        }))
        .sort((a, b) => a.provider.localeCompare(b.provider))
    },

    searchDelta() {
      const totals = this.overview?.search?.totals
      if (!totals?.previous || totals.previous.clicks === 0) return null
      const change = (totals.current.clicks - totals.previous.clicks) / totals.previous.clicks
      const pct = Math.round(Math.abs(change) * 100)
      if (pct === 0) return { label: 'Clicks unchanged vs the previous period', className: 'text-muted-foreground' }
      const up = change > 0
      return {
        label: `Clicks ${up ? 'up' : 'down'} ${pct}% vs the previous period`,
        className: up ? 'text-green-600 dark:text-green-500' : 'text-destructive',
      }
    },

    crawledPages() {
      return this.overview?.usage?.['crawl:pages'] || 0
    },
  },

  methods: {
    withProduct(path) {
      return this.product ? `${path}?product=${encodeURIComponent(this.product.slug)}` : path
    },

    formatNumber(value) {
      return new Intl.NumberFormat().format(value || 0)
    },

    formatDate(value) {
      if (!value) return 'never'
      return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    },

    onPickerError() {
      this.product = null
      this.overview = null
      this.pickerError = true
      this.pickerReady = true
    },

    async loadCanManage(productId) {
      try {
        const response = await $fetch(`/api/marketing/projects/${productId}/site`)
        if (this.product?.id === productId) this.canManageSite = response?.data?.canManage ?? null
      } catch {
        // Unknown: keep the action buttons rather than hide them wrongly
      }
    },

    async onProductChange(product) {
      this.pickerReady = true
      this.pickerError = false
      this.product = product
      this.canManageSite = null
      this.overview = null
      this.disabledMessage = null
      this.error = null
      if (product) await this.load()
    },

    async load() {
      if (!this.product) return
      const productId = this.product.id
      this.isLoading = true
      this.error = null
      this.disabledMessage = null
      this.loadCanManage(productId)
      try {
        const response = await $fetch(`/api/marketing/projects/${productId}/overview`)
        if (this.product?.id !== productId) return
        this.overview = response?.data || null
      } catch (err) {
        if (this.product?.id !== productId) return
        if (apiErrorStatus(err) === 403) {
          this.disabledMessage = apiErrorMessage(err, '')
        } else {
          this.error = apiErrorMessage(err, 'Failed to load the overview')
        }
      } finally {
        if (this.product?.id === productId) this.isLoading = false
      }
    },
  },
}
</script>
