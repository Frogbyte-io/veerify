<template>
  <nav class="flex h-full flex-col items-center gap-1 overflow-y-auto py-2.5" aria-label="Views">
    <!-- Inbox switcher, addresses and tags live in the drawer -->
    <button
      type="button"
      data-testid="support-open-inboxes"
      class="mb-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground"
      :aria-label="combined ? 'All inboxes: views' : `${activeInboxName}: switch inbox, address or tag`"
      :title="activeInboxName"
      @click="$emit('open-inboxes')"
    >
      <Icon v-if="combined" name="lucide:inbox" class="h-4 w-4" />
      <template v-else>{{ initial(activeInboxName) }}</template>
    </button>

    <button
      v-for="view in workingViews"
      :key="view.value"
      type="button"
      :data-testid="`support-rail-view-${view.value}`"
      :class="itemClass(view.value === activeView)"
      :aria-pressed="String(view.value === activeView)"
      :aria-label="view.label"
      :title="view.label"
      @click="$emit('select-view', view.value)"
    >
      <Icon :name="view.icon" class="h-5 w-5" />
      <span
        v-if="view.badgeKey && unreadCounts[view.badgeKey]"
        class="absolute top-0.5 right-0.5 min-w-4 rounded-full px-1 text-[10px] leading-4 font-semibold tabular-nums"
        :class="view.urgent ? 'bg-destructive text-white' : 'bg-primary text-primary-foreground'"
      >
        {{ badge(unreadCounts[view.badgeKey]) }}
      </span>
    </button>

    <div class="min-h-3 flex-1" />

    <div class="flex flex-col items-center gap-1 border-t pt-2">
      <button
        v-for="view in folderViews"
        :key="view.value"
        type="button"
        :data-testid="`support-rail-view-${view.value}`"
        :class="itemClass(view.value === activeView)"
        :aria-pressed="String(view.value === activeView)"
        :aria-label="view.label"
        :title="view.label"
        @click="$emit('select-view', view.value)"
      >
        <Icon :name="view.icon" class="h-5 w-5" />
      </button>
      <NuxtLink
        v-if="!combined"
        to="/inbox/settings"
        :class="itemClass(false)"
        aria-label="Inbox settings"
        title="Inbox settings"
      >
        <Icon name="lucide:settings" class="h-5 w-5" />
      </NuxtLink>
    </div>
  </nav>
</template>

<script>
import { SUPPORT_FOLDER_VIEW_ITEMS, SUPPORT_WORKING_VIEW_ITEMS } from '~/lib/support-views'

export default {
  name: 'SupportInboxRail',

  props: {
    activeInboxName: { type: String, default: 'Inbox' },
    activeView: { type: String, default: 'inbox' },
    unreadCounts: { type: Object, default: () => ({}) },
    // All projects: one combined list, no inbox to pick.
    combined: { type: Boolean, default: false },
  },

  emits: ['select-view', 'open-inboxes'],

  computed: {
    workingViews() {
      return SUPPORT_WORKING_VIEW_ITEMS
    },

    folderViews() {
      return SUPPORT_FOLDER_VIEW_ITEMS
    },
  },

  methods: {
    itemClass(active) {
      return [
        'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors',
        active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      ]
    },

    initial(name) {
      return (name || 'I').trim().charAt(0).toUpperCase()
    },

    badge(count) {
      return count > 99 ? '99+' : count
    },
  },
}
</script>
