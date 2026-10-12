<template>
  <NuxtLayout name="dashboard">
    <div class="p-6 space-y-6" data-testid="roadmap-page">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-3xl font-bold tracking-tight text-foreground">Roadmap</h1>
          <p class="text-muted-foreground mt-1">Drag feedback between columns to change its status</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <RoadmapProductPicker @change="onProductChange" />
          <Button v-if="publicUrl" as-child variant="outline" data-testid="roadmap-public-link">
            <a :href="publicUrl" target="_blank" rel="noopener noreferrer">
              <Icon name="lucide:external-link" class="w-4 h-4 mr-2" />
              View public roadmap
            </a>
          </Button>
        </div>
      </div>

      <template v-if="pickerReady">
        <Card v-if="!product">
          <CardContent class="py-10 text-center">
            <p class="font-medium mb-1">No products yet</p>
            <p class="text-sm text-muted-foreground mb-4">The roadmap works on a product. Create one first.</p>
            <Button as-child variant="outline">
              <NuxtLink to="/products">Go to products</NuxtLink>
            </Button>
          </CardContent>
        </Card>

        <Card v-else-if="disabledMessage !== null" data-testid="roadmap-disabled">
          <CardContent class="py-10 text-center space-y-4">
            <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Icon name="lucide:map" class="w-6 h-6 text-muted-foreground" />
            </div>
            <div class="space-y-1">
              <p class="font-medium">Roadmap is switched off</p>
              <p class="text-sm text-muted-foreground max-w-md mx-auto">
                {{ disabledMessage || 'The roadmap needs to be enabled for your team and for this product.' }}
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

        <div v-else-if="isLoading" class="flex gap-4 overflow-x-auto" data-testid="roadmap-loading">
          <div v-for="n in 4" :key="n" class="w-[300px] shrink-0 space-y-3">
            <Skeleton class="h-9 w-full" />
            <Skeleton v-for="m in 3" :key="m" class="h-24 w-full" />
          </div>
        </div>

        <Card v-else-if="error" data-testid="roadmap-error">
          <CardContent class="text-center py-8">
            <Icon name="lucide:alert-circle" class="w-8 h-8 text-destructive mx-auto mb-3" />
            <p class="font-medium mb-2">Failed to load the roadmap</p>
            <p class="text-sm text-muted-foreground mb-4">{{ error }}</p>
            <Button variant="outline" @click="load">
              <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
              Try again
            </Button>
          </CardContent>
        </Card>

        <template v-else>
          <div class="flex flex-wrap items-center gap-4" data-testid="roadmap-filters">
            <div class="flex items-center gap-2">
              <Icon name="lucide:tag" class="w-4 h-4 text-muted-foreground" />
              <select
                v-model="categoryFilter"
                class="h-9 rounded-md border border-input bg-background px-3 text-sm"
                data-testid="roadmap-category-filter"
                aria-label="Filter by category"
                @change="rebuildLists"
              >
                <option value="">All categories</option>
                <option v-for="category in categories" :key="category.id" :value="category.id">
                  {{ category.name }}
                </option>
              </select>
            </div>
            <label class="flex items-center gap-2 text-sm cursor-pointer">
              <Switch :model-value="showHidden" data-testid="roadmap-show-hidden" @update:model-value="setShowHidden" />
              Show hidden
            </label>
          </div>

          <div class="overflow-x-auto pb-4" data-testid="roadmap-board">
            <div class="flex gap-4 min-w-max">
              <div
                v-for="column in columns"
                :key="column.value"
                :data-testid="`roadmap-column-${column.value}`"
                class="w-[300px] shrink-0 flex flex-col bg-muted/30 rounded-xl border"
              >
                <div class="p-3 flex items-center justify-between border-b bg-card/50 rounded-t-xl">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="h-2.5 w-2.5 rounded-full shrink-0" :style="{ backgroundColor: column.color }" />
                    <h3 class="text-sm font-semibold truncate">{{ column.name }}</h3>
                  </div>
                  <Badge variant="secondary" class="font-mono" :data-testid="`roadmap-count-${column.value}`">
                    {{ lists[column.value]?.length ?? 0 }}
                  </Badge>
                </div>
                <VueDraggable
                  v-model="lists[column.value]"
                  :group="{ name: 'roadmap', pull: true, put: true }"
                  :animation="150"
                  ghost-class="opacity-40"
                  class="p-3 space-y-3 min-h-[200px] flex-1"
                  :data-status="column.value"
                  @end="onDragEnd"
                >
                  <NuxtLink
                    v-for="item in lists[column.value]"
                    :key="item.id"
                    :to="`/feedback/${item.id}`"
                    :data-id="item.id"
                    :data-testid="`roadmap-card-${item.id}`"
                    class="block"
                    draggable="false"
                  >
                    <Card :class="['hover:bg-accent/40 transition-colors', item.isHidden ? 'border-dashed' : '']">
                      <CardContent class="p-3 space-y-2">
                        <p class="text-sm font-medium line-clamp-3">{{ item.title }}</p>
                        <div class="flex flex-wrap items-center gap-1.5">
                          <Badge v-if="item.category" variant="secondary">{{ item.category.name }}</Badge>
                          <Badge v-if="item.isPinned" variant="outline" class="gap-1">
                            <Icon name="lucide:pin" class="w-3 h-3" />
                            Pinned
                          </Badge>
                          <Badge v-if="item.isHidden" variant="outline" class="gap-1">
                            <Icon name="lucide:eye-off" class="w-3 h-3" />
                            Hidden
                          </Badge>
                        </div>
                        <div class="flex items-center gap-3 text-xs text-muted-foreground">
                          <span class="inline-flex items-center gap-1">
                            <Icon name="lucide:chevron-up" class="w-3.5 h-3.5" />
                            {{ item.voteCount }}
                          </span>
                          <span class="inline-flex items-center gap-1">
                            <Icon name="lucide:message-square" class="w-3.5 h-3.5" />
                            {{ item.commentCount }}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  </NuxtLink>
                </VueDraggable>
              </div>
            </div>
          </div>
        </template>
      </template>
    </div>
  </NuxtLayout>
</template>

<script>
import { toast } from 'vue-sonner'
import { VueDraggable } from 'vue-draggable-plus'
import { apiErrorMessage, apiErrorStatus } from '~/lib/api-error'

const HIDDEN_KEY = 'veerify_roadmap_show_hidden'

function sortItems(items) {
  return [...items].sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.voteCount - a.voteCount)
}

export default {
  name: 'DashboardRoadmapPage',

  components: { VueDraggable },

  data() {
    return {
      pickerReady: false,
      product: null,
      // Source of truth: columns as returned by the API (all items, incl. hidden)
      columns: [],
      // Filtered per-column views bound to the draggable lists
      lists: {},
      publicUrl: null,
      isLoading: false,
      error: null,
      disabledMessage: null,
      categoryFilter: '',
      showHidden: false,
      requestId: 0,
    }
  },

  computed: {
    categories() {
      const seen = new Map()
      for (const column of this.columns) {
        for (const item of column.items) {
          if (item.category && !seen.has(item.category.id)) seen.set(item.category.id, item.category)
        }
      }
      return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
    },
  },

  mounted() {
    if (import.meta.client) {
      try {
        this.showHidden = localStorage.getItem(HIDDEN_KEY) === '1'
      } catch {
        // Ignore storage failures.
      }
    }
  },

  methods: {
    setShowHidden(value) {
      this.showHidden = value === true
      if (import.meta.client) {
        try {
          localStorage.setItem(HIDDEN_KEY, this.showHidden ? '1' : '0')
        } catch {
          // Ignore storage failures.
        }
      }
      this.rebuildLists()
    },

    rebuildLists() {
      const lists = {}
      for (const column of this.columns) {
        lists[column.value] = column.items.filter(
          (item) =>
            (this.showHidden || !item.isHidden) && (!this.categoryFilter || item.category?.id === this.categoryFilter)
        )
      }
      this.lists = lists
    },

    async onProductChange(product) {
      this.pickerReady = true
      this.product = product
      this.columns = []
      this.lists = {}
      this.publicUrl = null
      this.disabledMessage = null
      this.error = null
      this.categoryFilter = ''
      if (product) await this.load()
    },

    async load() {
      if (!this.product) return
      const productId = this.product.id
      const requestId = ++this.requestId
      const isCurrent = () => this.requestId === requestId && this.product?.id === productId
      this.isLoading = true
      this.error = null
      this.disabledMessage = null
      try {
        const response = await $fetch(`/api/roadmap/projects/${productId}`)
        if (!isCurrent()) return
        this.columns = response?.data?.columns || []
        this.publicUrl = response?.data?.publicUrl || null
        this.rebuildLists()
      } catch (err) {
        if (!isCurrent()) return
        const message = apiErrorMessage(err, '')
        if (apiErrorStatus(err) === 403 && /^Roadmap is not enabled for this (team|product)$/.test(message)) {
          this.disabledMessage = message
        } else if (apiErrorStatus(err) === 403) {
          this.error = message || 'You do not have access to this product'
        } else {
          this.error = apiErrorMessage(err, 'Failed to load the roadmap')
        }
      } finally {
        if (isCurrent()) this.isLoading = false
      }
    },

    /**
     * Moves the card in the source columns, then rebuilds the filtered lists
     * so they stay consistent with the data (filters make the list a subset).
     */
    moveItem(itemId, fromStatus, toStatus) {
      const from = this.columns.find((c) => c.value === fromStatus)
      const to = this.columns.find((c) => c.value === toStatus)
      if (!from || !to) return null
      const item = from.items.find((i) => i.id === itemId)
      if (!item) return null
      from.items = from.items.filter((i) => i.id !== itemId)
      item.status = toStatus
      to.items = sortItems([...to.items, item])
      this.rebuildLists()
      return item
    },

    async onDragEnd(evt) {
      const fromStatus = evt.from?.dataset?.status
      const toStatus = evt.to?.dataset?.status
      const itemId = evt.item?.dataset?.id
      if (!fromStatus || !toStatus || !itemId || fromStatus === toStatus) return

      const productId = this.product?.id
      // Optimistic move
      if (!this.moveItem(itemId, fromStatus, toStatus)) {
        this.rebuildLists()
        return
      }

      try {
        // Existing status endpoint: it fires subscriber notifications, GitHub sync and marketing hooks.
        await $fetch(`/api/feedback/${itemId}/status`, { method: 'PATCH', body: { status: toStatus } })
      } catch (err) {
        if (this.product?.id === productId) {
          this.moveItem(itemId, toStatus, fromStatus)
        }
        toast.error(apiErrorMessage(err, 'Failed to update the status'))
      }
    },
  },
}
</script>
