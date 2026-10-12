<template>
  <NuxtLayout name="dashboard">
    <div class="p-6 max-w-4xl mx-auto space-y-6" data-testid="changelog-page">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-3xl font-bold tracking-tight text-foreground">Changelog</h1>
          <p class="text-muted-foreground mt-1">Tell your users what shipped</p>
        </div>
        <div class="flex items-center gap-2">
          <ChangelogProductPicker @change="onProductChange" />
          <Button v-if="product && !disabledMessage" as-child data-testid="changelog-new-entry">
            <NuxtLink :to="newEntryLink">
              <Icon name="lucide:plus" class="w-4 h-4 mr-2" />
              New entry
            </NuxtLink>
          </Button>
        </div>
      </div>

      <template v-if="pickerReady">
        <Card v-if="!product">
          <CardContent class="py-10 text-center">
            <p class="font-medium mb-1">No products yet</p>
            <p class="text-sm text-muted-foreground mb-4">The changelog works on a product. Create one first.</p>
            <Button as-child variant="outline">
              <NuxtLink to="/products">Go to products</NuxtLink>
            </Button>
          </CardContent>
        </Card>

        <Card v-else-if="disabledMessage !== null" data-testid="changelog-disabled">
          <CardContent class="py-10 text-center space-y-4">
            <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Icon name="lucide:newspaper" class="w-6 h-6 text-muted-foreground" />
            </div>
            <div class="space-y-1">
              <p class="font-medium">Changelog is switched off</p>
              <p class="text-sm text-muted-foreground max-w-md mx-auto">
                {{ disabledMessage || 'The changelog needs to be enabled for your team and for this product.' }}
              </p>
              <p class="text-sm text-muted-foreground max-w-md mx-auto">
                Both switches have to be on: the team switch under Settings, Tools, and the product switch under the
                product's Features tab.
              </p>
            </div>
            <div class="flex flex-wrap items-center justify-center gap-2">
              <Button as-child variant="outline">
                <NuxtLink to="/settings#tools">Settings: Tools</NuxtLink>
              </Button>
              <Button as-child variant="outline">
                <NuxtLink :to="`/products/${product.slug}#features`">{{ product.name }}: Features</NuxtLink>
              </Button>
            </div>
          </CardContent>
        </Card>

        <div v-else-if="isLoading" class="space-y-3">
          <Skeleton v-for="n in 4" :key="n" class="h-20 w-full" />
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
      </template>
    </div>
  </NuxtLayout>
</template>

<script>
import { apiErrorMessage, apiErrorStatus } from '~/lib/api-error'
import { isModuleOffMessage } from '~/lib/changelog-editor'

export default {
  name: 'ChangelogPage',

  data() {
    return {
      pickerReady: false,
      product: null,
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
      return `/dashboard/changelog/new?product=${encodeURIComponent(this.product.slug)}`
    },
  },

  methods: {
    entryLink(entry) {
      return `/dashboard/changelog/${entry.id}?product=${encodeURIComponent(this.product.slug)}`
    },

    formatDate(value) {
      if (!value) return ''
      return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    },

    async onProductChange(product) {
      this.pickerReady = true
      this.product = product
      this.entries = []
      this.nextCursor = null
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
        const response = await $fetch(`/api/changelog/projects/${productId}/entries`)
        if (this.product?.id !== productId) return
        this.entries = response?.data?.entries || []
        this.nextCursor = response?.data?.nextCursor || null
      } catch (err) {
        if (this.product?.id !== productId) return
        const message = apiErrorMessage(err, '')
        // 403 means either "module switched off" (explained below) or "not a
        // member of this team": only the first one gets the enable-it card.
        if (apiErrorStatus(err) === 403 && isModuleOffMessage(message)) {
          this.disabledMessage = message
        } else if (apiErrorStatus(err) === 403) {
          this.error = message || 'You do not have access to this product'
        } else {
          this.error = apiErrorMessage(err, 'Failed to load the changelog')
        }
      } finally {
        if (this.product?.id === productId) this.isLoading = false
      }
    },

    async loadMore() {
      if (!this.product || !this.nextCursor) return
      const productId = this.product.id
      this.isLoadingMore = true
      this.loadMoreError = null
      try {
        const response = await $fetch(`/api/changelog/projects/${productId}/entries`, {
          query: { cursor: this.nextCursor },
        })
        if (this.product?.id !== productId) return
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
