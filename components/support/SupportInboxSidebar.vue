<template>
  <div class="flex h-full flex-col">
    <div class="px-3 py-3 border-b">
      <h2 class="text-sm font-semibold text-foreground">Inboxes</h2>
    </div>

    <!-- Inbox switcher -->
    <div class="flex-1 overflow-y-auto px-2 py-2 space-y-1">
      <div v-if="isLoading" class="space-y-2 px-1">
        <Skeleton v-for="n in 3" :key="n" class="h-9 w-full" />
      </div>

      <div v-else-if="error" class="px-1 py-2">
        <p class="text-xs text-muted-foreground mb-2">{{ error }}</p>
        <Button variant="outline" size="sm" class="w-full" @click="$emit('retry')">
          <Icon name="lucide:refresh-cw" class="w-3.5 h-3.5 mr-1.5" />
          Retry
        </Button>
      </div>

      <p
        v-else-if="inboxes.length === 0"
        data-testid="support-no-assignment"
        class="px-1 py-3 text-xs leading-relaxed text-muted-foreground"
      >
        No support inboxes are assigned to you.
      </p>

      <button
        v-for="inbox in inboxes"
        :key="inbox.id"
        type="button"
        :data-testid="`support-inbox-switch-${inbox.id}`"
        class="w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-left transition-colors"
        :class="
          inbox.id === activeInboxId ? 'bg-primary/10 text-primary font-medium' : 'text-foreground hover:bg-accent'
        "
        @click="$emit('select-inbox', inbox.id)"
      >
        <Icon name="lucide:inbox" class="w-4 h-4 shrink-0" />
        <span class="truncate">{{ inbox.name }}</span>
        <Icon
          v-if="!inbox.isEnabled"
          name="lucide:pause-circle"
          class="w-3.5 h-3.5 ml-auto text-muted-foreground shrink-0"
        />
      </button>
    </div>

    <!-- Filters -->
    <div class="border-t px-3 py-3 space-y-3">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Filters</h3>

      <div class="space-y-1.5">
        <Label for="support-filter-status" class="text-xs text-muted-foreground">Status</Label>
        <select
          id="support-filter-status"
          data-testid="support-filter-status"
          class="w-full h-9 px-2.5 text-sm bg-background border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
          :value="filters.status"
          @change="onFilterChange('status', $event.target.value)"
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="pending">Pending</option>
          <option value="resolved">Resolved</option>
          <option value="snoozed">Snoozed</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      <div class="space-y-1.5">
        <Label for="support-filter-assignee" class="text-xs text-muted-foreground">Assignee</Label>
        <select
          id="support-filter-assignee"
          data-testid="support-filter-assignee"
          class="w-full h-9 px-2.5 text-sm bg-background border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
          :value="filters.assigneeUserId"
          @change="onFilterChange('assigneeUserId', $event.target.value)"
        >
          <option value="">Anyone</option>
          <option v-for="member in members" :key="member.userId" :value="member.userId">
            {{ member.userName || member.userEmail }}
          </option>
        </select>
      </div>

      <div v-if="tagsAvailable" class="space-y-1.5">
        <Label for="support-filter-tag" class="text-xs text-muted-foreground">Tag</Label>
        <select
          id="support-filter-tag"
          data-testid="support-filter-tag"
          class="w-full h-9 px-2.5 text-sm bg-background border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
          :value="filters.tagId"
          @change="onFilterChange('tagId', $event.target.value)"
        >
          <option value="">All tags</option>
          <option v-for="tag in tags" :key="tag.id" :value="tag.id">{{ tag.name }}</option>
        </select>
      </div>

      <div v-if="canManageTagVocabulary" class="space-y-2 border-t pt-3" data-testid="support-tag-management">
        <Label for="support-new-tag" class="text-xs text-muted-foreground">Shared tag list</Label>
        <div class="flex gap-1.5">
          <Input
            id="support-new-tag"
            v-model="newTagName"
            class="h-8 min-w-0 text-xs"
            placeholder="New tag"
            @keydown.enter.prevent="createTag"
          />
          <Button
            size="sm"
            class="shrink-0"
            data-testid="support-create-tag"
            :disabled="!newTagName.trim()"
            @click="createTag"
          >
            Create tag
          </Button>
        </div>
      </div>

      <Button
        v-if="hasActiveFilters"
        variant="ghost"
        size="sm"
        class="w-full text-muted-foreground"
        @click="clearFilters"
      >
        <Icon name="lucide:x" class="w-3.5 h-3.5 mr-1.5" />
        Clear filters
      </Button>
    </div>
  </div>
</template>

<script>
export default {
  name: 'SupportInboxSidebar',

  props: {
    inboxes: { type: Array, default: () => [] },
    activeInboxId: { type: String, default: null },
    isLoading: { type: Boolean, default: false },
    error: { type: String, default: null },
    members: { type: Array, default: () => [] },
    tags: { type: Array, default: () => [] },
    tagsAvailable: { type: Boolean, default: false },
    capabilities: { type: Object, default: () => ({}) },
    filters: {
      type: Object,
      default: () => ({ status: '', assigneeUserId: '', tagId: '' }),
    },
  },

  emits: ['select-inbox', 'update:filters', 'retry', 'create-tag'],

  data() {
    return { newTagName: '' }
  },

  computed: {
    hasActiveFilters() {
      return Boolean(this.filters.status || this.filters.assigneeUserId || this.filters.tagId)
    },

    canManageTagVocabulary() {
      return this.capabilities?.canManageTagVocabulary === true
    },
  },

  methods: {
    onFilterChange(field, value) {
      this.$emit('update:filters', { ...this.filters, [field]: value })
    },

    clearFilters() {
      this.$emit('update:filters', { status: '', assigneeUserId: '', tagId: '' })
    },

    createTag() {
      const name = this.newTagName.trim()
      if (!name) return
      this.$emit('create-tag', name)
      this.newTagName = ''
    },
  },
}
</script>
