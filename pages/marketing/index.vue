<template>
  <NuxtLayout name="dashboard">
    <div class="p-6 max-w-5xl mx-auto space-y-6" data-testid="marketing-overview-page">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-3xl font-bold tracking-tight text-foreground">Marketing</h1>
          <p class="text-muted-foreground mt-1">Get your product found by search engines, AI assistants and people</p>
        </div>
        <MarketingProductPicker @change="onProductChange" />
      </div>

      <template v-if="pickerReady">
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
          <div class="grid gap-4 md:grid-cols-3">
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
              <CardTitle>Get set up</CardTitle>
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
                      {{ step.title }}
                    </p>
                    <p v-if="!step.done" class="text-xs text-muted-foreground">{{ step.hint }}</p>
                  </div>
                  <Button v-if="!step.done" as-child size="sm" variant="outline">
                    <NuxtLink :to="settingsLink">{{ step.action }}</NuxtLink>
                  </Button>
                </li>
              </ul>
            </CardContent>
          </Card>

          <div class="grid gap-4 md:grid-cols-3">
            <Card data-testid="marketing-card-audit">
              <CardHeader>
                <CardTitle class="flex items-center gap-2 text-base">
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
                <CardTitle class="flex items-center gap-2 text-base">
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
                  Add an Anthropic or OpenAI key to measure how AI assistants talk about you.
                </p>
                <p v-else class="text-sm text-muted-foreground">No run yet.</p>
                <Button as-child variant="outline" size="sm">
                  <NuxtLink :to="withProduct('/marketing/ai-visibility')">Open AI visibility</NuxtLink>
                </Button>
              </CardContent>
            </Card>

            <Card data-testid="marketing-card-mentions">
              <CardHeader>
                <CardTitle class="flex items-center gap-2 text-base">
                  <Icon name="lucide:at-sign" class="w-4 h-4" />
                  Mentions
                </CardTitle>
              </CardHeader>
              <CardContent class="space-y-3">
                <p class="text-3xl font-bold">{{ overview.newMentions }}</p>
                <p class="text-xs text-muted-foreground">
                  new {{ overview.newMentions === 1 ? 'mention' : 'mentions' }}
                </p>
                <Button as-child variant="outline" size="sm">
                  <NuxtLink :to="withProduct('/marketing/mentions')">Open mentions</NuxtLink>
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card data-testid="marketing-usage">
            <CardHeader>
              <CardTitle class="text-base">Usage this month</CardTitle>
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

  data() {
    return {
      pickerReady: false,
      product: null,
      overview: null,
      isLoading: false,
      error: null,
      disabledMessage: null,
    }
  },

  computed: {
    steps() {
      const setup = this.overview?.setup
      if (!setup) return []
      return [
        {
          key: 'site',
          title: 'Add your site',
          hint: 'Tell Marketing which website to look at.',
          action: 'Add site',
          done: setup.siteAdded,
        },
        {
          key: 'verify',
          title: 'Verify you own it',
          hint: 'Add a DNS record, a meta tag or a file. Nothing runs before this.',
          action: 'Verify',
          done: setup.siteVerified,
        },
        {
          key: 'terms',
          title: 'Add your brand name',
          hint: 'Add competitors and keywords too, if you like.',
          action: 'Add terms',
          done: setup.hasBrandTerm,
        },
        {
          key: 'keys',
          title: 'Add an AI key',
          hint: 'An Anthropic or OpenAI key unlocks AI visibility. A Firecrawl key is optional and unlocks the full site crawl.',
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

    async onProductChange(product) {
      this.pickerReady = true
      this.product = product
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
