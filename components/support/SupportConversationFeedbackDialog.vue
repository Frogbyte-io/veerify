<template>
  <Dialog :open="open" @update:open="$emit('update:open', $event)">
    <DialogContent class="sm:max-w-[560px]">
      <DialogHeader>
        <DialogTitle>Convert to feedback</DialogTitle>
        <DialogDescription>
          Create a feedback item from this conversation. The contact remains private to the project.
        </DialogDescription>
      </DialogHeader>

      <div class="inline-flex rounded-md border bg-muted/30 p-1" role="tablist" aria-label="Feedback link action">
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'create'"
          data-testid="support-feedback-mode-create"
          class="rounded px-3 py-1.5 text-xs font-medium transition-colors"
          :class="mode === 'create' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'"
          @click="setMode('create')"
        >
          Create new
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'existing'"
          data-testid="support-feedback-mode-existing"
          class="rounded px-3 py-1.5 text-xs font-medium transition-colors"
          :class="mode === 'existing' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'"
          @click="setMode('existing')"
        >
          Link existing
        </button>
      </div>

      <div v-if="mode === 'create'" class="space-y-4 py-3">
        <div class="space-y-2">
          <Label for="support-feedback-title">Title</Label>
          <Input
            id="support-feedback-title"
            v-model="form.title"
            data-testid="support-feedback-title"
            placeholder="Brief summary of the feedback"
          />
        </div>

        <div class="space-y-2">
          <Label for="support-feedback-body">Description</Label>
          <textarea
            id="support-feedback-body"
            v-model="form.body"
            data-testid="support-feedback-body"
            placeholder="Describe the customer's feedback"
            rows="6"
            class="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>

        <div v-if="products.length > 1" class="space-y-2">
          <Label for="support-feedback-product">Product</Label>
          <select
            id="support-feedback-product"
            v-model="form.productId"
            data-testid="support-feedback-product"
            class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option v-for="item in products" :key="item.id" :value="item.id">{{ item.name }}</option>
          </select>
        </div>

        <div class="space-y-2">
          <Label for="support-feedback-category">Category</Label>
          <div v-if="isLoadingCategories" class="flex h-10 items-center gap-2 text-sm text-muted-foreground">
            <Icon name="lucide:loader-2" class="h-4 w-4 animate-spin" />
            Loading categories…
          </div>
          <select
            v-else-if="categories.length > 0"
            id="support-feedback-category"
            v-model="form.categoryId"
            data-testid="support-feedback-category"
            class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option :value="null">No category</option>
            <option v-for="category in categories" :key="category.id" :value="category.id">
              {{ category.name }}
            </option>
          </select>
          <p v-else-if="categoriesError" class="text-xs text-destructive">
            {{ categoriesError }}
            <button type="button" class="underline" @click="loadCategories">Retry</button>
          </p>
          <p v-else class="text-xs text-muted-foreground">No categories configured for this project.</p>
        </div>
      </div>

      <div v-else class="space-y-3 py-3">
        <div class="flex gap-2">
          <Input
            v-model="searchQuery"
            data-testid="support-feedback-search"
            placeholder="Search feedback by title or description"
            @keyup.enter="searchFeedback"
          />
          <Button
            variant="outline"
            :disabled="isSearching"
            data-testid="support-feedback-search-submit"
            @click="searchFeedback"
          >
            <Icon v-if="isSearching" name="lucide:loader-2" class="h-4 w-4 animate-spin" />
            <Icon v-else name="lucide:search" class="h-4 w-4" />
            <span class="sr-only">Search</span>
          </Button>
        </div>
        <p v-if="searchError" class="text-xs text-destructive">{{ searchError }}</p>
        <div
          v-else-if="!isSearching && searchResults.length === 0"
          class="rounded-md border border-dashed p-5 text-center text-xs text-muted-foreground"
        >
          Search for an existing feedback item to link.
        </div>
        <div v-else class="max-h-64 space-y-2 overflow-y-auto">
          <button
            v-for="item in searchResults"
            :key="item.id"
            type="button"
            data-testid="support-feedback-result"
            class="w-full rounded-md border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5"
            :class="selectedFeedbackId === item.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : ''"
            @click="selectedFeedbackId = item.id"
          >
            <div class="flex items-start gap-3">
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{{ item.title }}</p>
                <p class="mt-1 line-clamp-2 text-xs text-muted-foreground">{{ item.body || 'No description' }}</p>
                <p class="mt-2 text-[11px] text-muted-foreground">
                  {{ item.project?.name || 'Product' }} · {{ item.status }} · {{ item.voteCount }} votes
                </p>
              </div>
              <Icon v-if="selectedFeedbackId === item.id" name="lucide:check" class="h-4 w-4 text-primary" />
            </div>
          </button>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" data-testid="support-feedback-cancel" @click="$emit('update:open', false)">
          Cancel
        </Button>
        <Button
          data-testid="support-feedback-submit"
          :disabled="isSubmitting || (mode === 'create' ? !form.title.trim() || !form.productId : !selectedFeedbackId)"
          @click="mode === 'create' ? submit() : linkSelected()"
        >
          <Icon v-if="isSubmitting" name="lucide:loader-2" class="mr-2 h-4 w-4 animate-spin" />
          {{ mode === 'create' ? 'Create feedback' : 'Link feedback' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script>
export default {
  name: 'SupportConversationFeedbackDialog',

  props: {
    open: { type: Boolean, default: false },
    conversation: { type: Object, default: null },
    messages: { type: Array, default: () => [] },
    projectId: { type: String, default: '' },
    projectSlug: { type: String, default: '' },
    products: { type: Array, default: () => [] },
    isSubmitting: { type: Boolean, default: false },
  },

  emits: ['update:open', 'submit', 'link'],

  data() {
    return {
      categories: [],
      mode: 'create',
      searchQuery: '',
      searchResults: [],
      selectedFeedbackId: null,
      isSearching: false,
      searchError: null,
      isLoadingCategories: false,
      categoriesError: null,
      form: {
        title: '',
        body: '',
        productId: '',
        categoryId: null,
      },
    }
  },

  watch: {
    open(value) {
      if (value) this.initialize()
    },
  },

  methods: {
    initialize() {
      const firstIncoming = this.messages.find((message) => message.kind === 'incoming' && !message.isPrivate)
      this.form = {
        title: this.conversation?.subject?.trim() || 'Support request',
        body: firstIncoming?.body?.trim() || '',
        productId: this.products[0]?.id || '',
        categoryId: null,
      }
      this.mode = 'create'
      this.searchQuery = ''
      this.searchResults = []
      this.selectedFeedbackId = null
      this.searchError = null
      this.categories = []
      this.categoriesError = null
      void this.loadCategories()
    },

    setMode(mode) {
      this.mode = mode
      if (mode === 'existing' && this.searchResults.length === 0) void this.searchFeedback()
    },

    async loadCategories() {
      this.form.categoryId = null
      this.categories = []
      this.categoriesError = null
      if (!this.projectSlug) return

      this.isLoadingCategories = true
      try {
        const response = await $fetch(`/api/projects/${encodeURIComponent(this.projectSlug)}/categories`)
        this.categories = response?.data || []
      } catch {
        this.categories = []
        this.categoriesError = 'Could not load categories.'
      } finally {
        this.isLoadingCategories = false
      }
    },

    async searchFeedback() {
      this.isSearching = true
      this.searchError = null
      try {
        const response = await $fetch(`/api/support/conversations/${this.conversation?.id}/feedback`, {
          params: { search: this.searchQuery.trim() || undefined, limit: 20 },
        })
        this.searchResults = response?.data?.items || []
      } catch {
        this.searchResults = []
        this.searchError = 'Could not search feedback. Please try again.'
      } finally {
        this.isSearching = false
      }
    },

    submit() {
      if (this.isSubmitting || !this.form.title.trim() || !this.form.productId) return
      this.$emit('submit', {
        title: this.form.title.trim(),
        body: this.form.body.trim() || null,
        productId: this.form.productId,
        categoryId: this.form.categoryId || null,
      })
    },

    linkSelected() {
      if (this.isSubmitting || !this.selectedFeedbackId) return
      this.$emit('link', this.selectedFeedbackId)
    },
  },
}
</script>
