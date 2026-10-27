<template>
  <PageContainer data-testid="changelog-page">
    <PageHeader title="Changelog" description="Tell your users what shipped">
      <template #actions>
        <ChangelogProductPicker @change="onProductChange" />
        <Button v-if="canCreate" as-child data-testid="changelog-new-entry">
          <NuxtLink :to="newEntryLink">
            <Icon name="lucide:plus" class="w-4 h-4 mr-2" />
            New entry
          </NuxtLink>
        </Button>
        <Button v-else disabled data-testid="changelog-new-entry">
          <Icon name="lucide:plus" class="w-4 h-4 mr-2" />
          New entry
        </Button>
      </template>
    </PageHeader>

    <Card v-if="disabledMessage !== null" data-testid="changelog-disabled">
      <CardContent class="py-10 text-center space-y-4">
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Icon name="lucide:newspaper" class="w-6 h-6 text-muted-foreground" />
        </div>
        <div class="space-y-1">
          <p class="font-medium">Changelog is switched off</p>
          <p class="text-sm text-muted-foreground max-w-md mx-auto">
            {{
              isAdmin ? 'Switch it on under Project settings, Tools.' : 'Project admins can switch the changelog on.'
            }}
          </p>
        </div>
        <div v-if="isAdmin" class="flex flex-wrap items-center justify-center gap-2">
          <Button as-child variant="outline">
            <NuxtLink to="/project/settings#tools">Project settings: Tools</NuxtLink>
          </Button>
        </div>
      </CardContent>
    </Card>

    <Card v-else-if="contextError">
      <CardContent class="text-center py-8">
        <Icon name="lucide:alert-circle" class="w-8 h-8 text-destructive mx-auto mb-3" />
        <p class="font-medium mb-2">Failed to load the active project</p>
        <p class="text-sm text-muted-foreground mb-4">{{ contextError }}</p>
        <Button variant="outline" @click="bootstrap">
          <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
          Try again
        </Button>
      </CardContent>
    </Card>

    <div v-else-if="!contextReady || isLoading" class="space-y-3" data-testid="changelog-loading">
      <Skeleton v-for="n in 4" :key="n" class="h-[92px] w-full rounded-xl" />
    </div>

    <Card v-else-if="error">
      <CardContent class="text-center py-8">
        <Icon name="lucide:alert-circle" class="w-8 h-8 text-destructive mx-auto mb-3" />
        <p class="font-medium mb-2">Failed to load the changelog</p>
        <p class="text-sm text-muted-foreground mb-4">{{ error }}</p>
        <Button variant="outline" @click="load">
          <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
          Try again
        </Button>
      </CardContent>
    </Card>

    <Card v-else-if="entries.length === 0">
      <CardContent class="py-10 text-center">
        <Icon name="lucide:newspaper" class="w-8 h-8 text-muted-foreground mx-auto mb-3" />
        <p class="font-medium mb-1">No entries yet</p>
        <p class="text-sm text-muted-foreground">Write your first release note with "New entry".</p>
      </CardContent>
    </Card>

    <div v-else class="space-y-3">
      <NuxtLink
        v-for="entry in entries"
        :key="entry.id"
        :to="entryLink(entry)"
        class="block"
        :data-testid="`changelog-entry-${entry.slug}`"
      >
        <Card class="hover:bg-accent/40 transition-colors">
          <CardContent class="py-4 flex items-start justify-between gap-4">
            <div class="min-w-0 space-y-1">
              <p class="font-medium truncate">{{ entry.title }}</p>
              <p v-if="entry.summary" class="text-sm text-muted-foreground line-clamp-2">{{ entry.summary }}</p>
              <div class="flex flex-wrap items-center gap-1.5 pt-1">
                <Badge v-if="showProductBadges" variant="outline" data-testid="changelog-entry-products">
                  {{ entryProductLabel(entry) }}
                </Badge>
                <Badge v-for="label in entry.labels" :key="label" variant="secondary" class="capitalize">
                  {{ label }}
                </Badge>
              </div>
            </div>
            <div class="shrink-0 text-right space-y-1">
              <Badge :variant="entry.status === 'published' ? 'default' : 'outline'" class="capitalize">
                {{ entry.status }}
              </Badge>
              <p class="text-xs text-muted-foreground">
                {{
                  entry.status === 'published'
                    ? formatDate(entry.publishedAt)
                    : 'Updated ' + formatDate(entry.updatedAt)
                }}
              </p>
            </div>
          </CardContent>
        </Card>
      </NuxtLink>

      <div v-if="nextCursor" class="text-center pt-2">
        <Button variant="outline" :disabled="isLoadingMore" @click="loadMore">
          {{ isLoadingMore ? 'Loading...' : 'Load more' }}
        </Button>
        <p v-if="loadMoreError" class="text-sm text-destructive mt-2">{{ loadMoreError }}</p>
      </div>
    </div>
  </PageContainer>
</template>

<script>
import { apiErrorMessage, apiErrorStatus } from '~/lib/api-error'
import { cachedActiveProject, loadActiveProject } from '~/lib/active-project'
import { isModuleOffMessage } from '~/lib/changelog-editor'

export default {
  name: 'ChangelogPage',

  data() {
    return {
      contextReady: false,
      contextError: null,
      project: null,
      products: [],
      productId: '',
      entries: [],
      nextCursor: null,
      isLoading: false,
      isLoadingMore: false,
      error: null,
      loadMoreError: null,
      disabledMessage: null,
    }
  },

  computed: {
    newEntryLink() {
      return this.productId
        ? `/dashboard/changelog/new?productId=${encodeURIComponent(this.productId)}`
        : '/dashboard/changelog/new'
    },
    canCreate() {
      return this.contextReady && !!this.project && this.disabledMessage === null
    },
    isAdmin() {
      return this.project?.role === 'admin'
    },
    // Product tags only matter when there is more than one product
    showProductBadges() {
      return this.products.length > 1
    },
  },

  created() {
    useHead({ title: 'Changelog' })
    // Warm navigation: render and start the data fetch at once from the cache
    if (import.meta.client) {
      const cached = cachedActiveProject()
      if (cached !== undefined) this.onProductChange(cached, this.productFromRoute(cached))
    }
  },

  async mounted() {
    await this.bootstrap()
  },

  methods: {
    productFromRoute(context) {
      const products = context?.products || []
      const wanted = this.$route.query.productId
      return products.length > 1 && products.some((p) => p.id === wanted) ? wanted : ''
    },

    // Resolve the active project (cache first, in parallel with the picker) and load the list
    async bootstrap() {
      this.contextError = null
      try {
        const context = (await loadActiveProject()) || null
        const unchanged =
          this.contextReady &&
          (context?.project?.id || null) === (this.project?.id || null) &&
          (context?.modules?.changelogEnabled === true) === (this.disabledMessage === null)
        if (!unchanged) await this.onProductChange(context, this.productFromRoute(context))
      } catch (err) {
        this.contextError = apiErrorMessage(err, 'Failed to load the active project')
      }
    },

    entryLink(entry) {
      return `/dashboard/changelog/${entry.id}`
    },

    entryProductLabel(entry) {
      const ids = entry.productIds || []
      if (ids.length === 0) return 'All products'
      return ids
        .map((id) => this.products.find((p) => p.id === id)?.name)
        .filter(Boolean)
        .join(', ')
    },

    formatDate(value) {
      if (!value) return ''
      return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    },

    async onProductChange(context, productId) {
      this.contextReady = true
      this.contextError = null
      this.project = context?.project || null
      this.products = context?.products || []
      this.productId = productId || ''
      this.entries = []
      this.nextCursor = null
      this.disabledMessage = null
      this.error = null
      if (!this.project) return
      if (context.modules?.changelogEnabled !== true) {
        this.disabledMessage = ''
        return
      }
      await this.load()
    },

    async load() {
      if (!this.project) return
      const projectId = this.project.id
      const productId = this.productId
      const isCurrent = () => this.project?.id === projectId && this.productId === productId
      this.isLoading = true
      this.error = null
      this.disabledMessage = null
      try {
        const response = await $fetch(`/api/changelog/projects/${projectId}/entries`, {
          query: productId ? { productId } : {},
        })
        if (!isCurrent()) return
        this.entries = response?.data?.entries || []
        this.nextCursor = response?.data?.nextCursor || null
      } catch (err) {
        if (!isCurrent()) return
        const message = apiErrorMessage(err, '')
        // 403 means either "module switched off" (explained below) or "no access
        // to this project": only the first one gets the enable-it card.
        if (apiErrorStatus(err) === 403 && isModuleOffMessage(message)) {
          this.disabledMessage = message
        } else if (apiErrorStatus(err) === 403) {
          this.error = message || 'You do not have access to this project'
        } else {
          this.error = apiErrorMessage(err, 'Failed to load the changelog')
        }
      } finally {
        if (isCurrent()) this.isLoading = false
      }
    },

    async loadMore() {
      if (!this.project || !this.nextCursor) return
      const projectId = this.project.id
      const productId = this.productId
      this.isLoadingMore = true
      this.loadMoreError = null
      try {
        const response = await $fetch(`/api/changelog/projects/${projectId}/entries`, {
          query: { cursor: this.nextCursor, ...(productId ? { productId } : {}) },
        })
        if (this.project?.id !== projectId || this.productId !== productId) return
        this.entries = [...this.entries, ...(response?.data?.entries || [])]
        this.nextCursor = response?.data?.nextCursor || null
      } catch (err) {
        this.loadMoreError = apiErrorMessage(err, 'Failed to load more entries')
      } finally {
        this.isLoadingMore = false
      }
    },
  },
}
</script>
