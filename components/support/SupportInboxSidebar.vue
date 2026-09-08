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

    <!-- Fixed views -->
    <div v-if="inboxes.length > 0" class="border-t px-3 py-3 space-y-2">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Views</h3>

      <button
        v-for="view in fixedViews"
        :key="view.value"
        type="button"
        :data-testid="`support-view-${view.value}`"
        class="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm transition-colors"
        :class="
          view.value === activeView ? 'bg-primary/10 text-primary font-medium' : 'text-foreground hover:bg-accent'
        "
        :aria-pressed="String(view.value === activeView)"
        @click="$emit('select-view', view.value)"
      >
        <Icon :name="view.icon" class="h-4 w-4 shrink-0" />
        <span class="min-w-0 flex-1 truncate">{{ view.label }}</span>
        <Badge
          v-if="view.badgeKey"
          variant="secondary"
          class="h-5 min-w-5 justify-center px-1.5 text-[10px] font-normal"
        >
          {{ unreadCounts[view.badgeKey] || 0 }}
        </Badge>
      </button>

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
    capabilities: { type: Object, default: () => ({}) },
    activeView: { type: String, default: 'unassigned' },
    unreadCounts: {
      type: Object,
      default: () => ({ unassigned: 0, assignedToMe: 0 }),
    },
  },

  emits: ['select-inbox', 'select-view', 'retry', 'create-tag'],

  data() {
    return { newTagName: '' }
  },

  computed: {
    canManageTagVocabulary() {
      return this.capabilities?.canManageTagVocabulary === true
    },

    fixedViews() {
      return [
        { value: 'unassigned', label: 'Unassigned', icon: 'lucide:inbox', badgeKey: 'unassigned' },
        { value: 'assigned-to-me', label: 'Assigned to me', icon: 'lucide:user-check', badgeKey: 'assignedToMe' },
        { value: 'resolved', label: 'Resolved', icon: 'lucide:check-circle-2' },
        { value: 'all', label: 'All', icon: 'lucide:layers-3' },
      ]
    },
  },

  methods: {
    createTag() {
      const name = this.newTagName.trim()
      if (!name) return
      this.$emit('create-tag', name)
      this.newTagName = ''
    },
  },
}
</script>
