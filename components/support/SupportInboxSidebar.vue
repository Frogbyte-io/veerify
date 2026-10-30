<template>
  <div class="flex h-full flex-col gap-0.5 overflow-y-auto px-2 py-2.5 text-sm">
    <!-- Inbox switcher -->
    <div v-if="isLoading" class="space-y-2 px-1 pb-2">
      <Skeleton class="h-10 w-full" />
    </div>

    <div v-else-if="error" class="px-1 py-2">
      <p class="mb-2 text-xs text-muted-foreground">{{ error }}</p>
      <Button variant="outline" size="sm" class="w-full" @click="$emit('retry')">
        <Icon name="lucide:refresh-cw" class="mr-1.5 h-3.5 w-3.5" />
        Retry
      </Button>
    </div>

    <p
      v-else-if="inboxes.length === 0"
      data-testid="support-no-assignment"
      class="px-1 py-3 text-xs leading-relaxed text-muted-foreground"
    >
      No inboxes are assigned to you.
    </p>

    <div v-else class="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            data-testid="support-inbox-switcher"
            class="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-accent"
          >
            <span
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground"
              aria-hidden="true"
            >
              {{ initial(activeInbox?.name) }}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate font-semibold leading-tight" data-testid="support-active-inbox-name">
                {{ activeInbox?.name || 'Inbox' }}
              </span>
              <span class="block truncate text-[11px] leading-tight text-muted-foreground">{{ inboxSummary }}</span>
            </span>
            <Icon name="lucide:chevrons-up-down" class="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="w-60">
          <DropdownMenuLabel class="text-xs text-muted-foreground">Inboxes</DropdownMenuLabel>
          <DropdownMenuItem
            v-for="inbox in inboxes"
            :key="inbox.id"
            :data-testid="`support-inbox-switch-${inbox.id}`"
            @select="$emit('select-inbox', inbox.id)"
          >
            <Icon name="lucide:inbox" class="h-4 w-4" />
            <span class="min-w-0 flex-1 truncate">{{ inbox.name }}</span>
            <Icon v-if="!inbox.isEnabled" name="lucide:pause-circle" class="h-3.5 w-3.5 text-muted-foreground" />
            <Icon v-if="inbox.id === activeInboxId" name="lucide:check" class="h-4 w-4" />
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem as-child>
            <NuxtLink to="/inbox/settings">
              <Icon name="lucide:settings" class="h-4 w-4" />
              Inbox settings
            </NuxtLink>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NuxtLink
        to="/inbox/settings"
        data-testid="support-sidebar-settings-link"
        class="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="Inbox settings"
        title="Inbox settings"
      >
        <Icon name="lucide:settings" class="h-4 w-4" />
      </NuxtLink>
    </div>

    <template v-if="inboxes.length > 0">
      <!-- Views -->
      <nav class="mt-3 space-y-0.5" aria-label="Views">
        <button
          v-for="view in fixedViews"
          :key="view.value"
          type="button"
          :data-testid="`support-view-${view.value}`"
          :class="navClass(view.value === activeView)"
          :aria-pressed="String(view.value === activeView)"
          @click="$emit('select-view', view.value)"
        >
          <Icon :name="view.icon" class="h-4 w-4 shrink-0" />
          <span class="min-w-0 flex-1 truncate">{{ view.label }}</span>
          <span
            v-if="view.badgeKey && unreadCounts[view.badgeKey]"
            :data-testid="`support-view-count-${view.value}`"
            class="text-[11px] tabular-nums"
            :class="view.urgent ? 'font-semibold text-destructive' : 'text-muted-foreground'"
          >
            {{ unreadCounts[view.badgeKey] }}
          </span>
        </button>
      </nav>

      <!-- Addresses: a filter on top of the view -->
      <template v-if="addresses.length > 0">
        <h3 :class="groupClass">Addresses</h3>
        <div class="space-y-0.5" data-testid="support-address-filter">
          <button
            type="button"
            data-testid="support-address-all"
            :class="navClass(!activeAddressId)"
            :aria-pressed="String(!activeAddressId)"
            @click="$emit('select-address', null)"
          >
            <Icon name="lucide:mails" class="h-4 w-4 shrink-0" />
            <span class="min-w-0 flex-1 truncate">All addresses</span>
          </button>
          <button
            v-for="address in addresses"
            :key="address.id"
            type="button"
            :data-testid="`support-address-${address.id}`"
            :class="navClass(address.id === activeAddressId)"
            :aria-pressed="String(address.id === activeAddressId)"
            :title="`${address.address} (${address.behaviour === 'mail' ? 'Mail' : 'Helpdesk'})`"
            @click="$emit('select-address', address.id)"
          >
            <Icon :name="addressIcon(address)" class="h-4 w-4 shrink-0" />
            <span class="min-w-0 flex-1 truncate">{{ address.address }}</span>
            <span v-if="addressCount(address.id)" class="text-[11px] tabular-nums text-muted-foreground">
              {{ addressCount(address.id) }}
            </span>
          </button>
        </div>
      </template>

      <!-- Tags: filters, plus the shared vocabulary for supervisors -->
      <template v-if="tags.length > 0 || canManageTagVocabulary">
        <h3 :class="groupClass">Tags</h3>
        <div class="space-y-0.5">
          <button
            v-for="tag in tags"
            :key="tag.id"
            type="button"
            :data-testid="`support-tag-filter-${tag.id}`"
            :class="navClass(tag.id === activeTagId)"
            :aria-pressed="String(tag.id === activeTagId)"
            @click="$emit('select-tag', tag.id === activeTagId ? null : tag.id)"
          >
            <span class="mx-1 h-2 w-2 shrink-0 rounded-full" :style="{ background: tagColor(tag) }" />
            <span class="min-w-0 flex-1 truncate">{{ tag.name }}</span>
          </button>
          <p v-if="tags.length === 0" class="px-2.5 py-1 text-xs text-muted-foreground">No tags yet.</p>
        </div>
        <!-- Supervisors keep the shared vocabulary here -->
        <div v-if="canManageTagVocabulary" class="mt-1 flex gap-1 px-1" data-testid="support-tag-management">
          <Input
            v-model="newTagName"
            aria-label="New tag name"
            class="h-7 min-w-0 border-dashed bg-transparent text-xs"
            placeholder="New tag"
            @keydown.enter.prevent="createTag"
          />
          <Button
            size="icon"
            variant="ghost"
            class="h-7 w-7 shrink-0"
            data-testid="support-create-tag"
            aria-label="Create tag"
            title="Create tag"
            :disabled="!newTagName.trim()"
            @click="createTag"
          >
            <Icon name="lucide:plus" class="h-4 w-4" />
          </Button>
        </div>
      </template>

      <!-- Folders you rarely need sit at the bottom -->
      <div class="min-h-4 flex-1" />
      <div class="space-y-0.5 border-t pt-2">
        <button
          v-for="view in folderViews"
          :key="view.value"
          type="button"
          :data-testid="`support-view-${view.value}`"
          :class="navClass(view.value === activeView)"
          :aria-pressed="String(view.value === activeView)"
          @click="$emit('select-view', view.value)"
        >
          <Icon :name="view.icon" class="h-4 w-4 shrink-0" />
          <span class="min-w-0 flex-1 truncate">{{ view.label }}</span>
        </button>
      </div>
    </template>
  </div>
</template>

<script>
import { supportTagColor } from '~/lib/support-tags'

export default {
  name: 'SupportInboxSidebar',

  props: {
    inboxes: { type: Array, default: () => [] },
    activeInboxId: { type: String, default: null },
    isLoading: { type: Boolean, default: false },
    error: { type: String, default: null },
    capabilities: { type: Object, default: null },
    activeView: { type: String, default: 'inbox' },
    unreadCounts: {
      type: Object,
      default: () => ({ inbox: 0, unassigned: 0, assignedToMe: 0, breachingSoon: 0, byAddress: {} }),
    },
    addresses: { type: Array, default: () => [] },
    activeAddressId: { type: String, default: null },
    tags: { type: Array, default: () => [] },
    activeTagId: { type: String, default: null },
  },

  emits: ['select-inbox', 'select-view', 'select-address', 'select-tag', 'retry', 'create-tag'],

  data() {
    return { newTagName: '' }
  },

  computed: {
    activeInbox() {
      return this.inboxes.find((inbox) => inbox.id === this.activeInboxId) || null
    },

    inboxSummary() {
      const count = this.addresses.length
      if (count === 0) return this.inboxes.length > 1 ? `${this.inboxes.length} inboxes` : 'Inbox'
      return count === 1 ? '1 address' : `${count} addresses`
    },

    canManageTagVocabulary() {
      return this.capabilities?.canManageTagVocabulary === true
    },

    groupClass() {
      return 'px-2.5 pt-4 pb-1 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground'
    },

    fixedViews() {
      return [
        { value: 'inbox', label: 'Inbox', icon: 'lucide:inbox', badgeKey: 'inbox' },
        { value: 'assigned-to-me', label: 'Assigned to me', icon: 'lucide:user-round', badgeKey: 'assignedToMe' },
        { value: 'unassigned', label: 'Unassigned', icon: 'lucide:user-round-x', badgeKey: 'unassigned' },
        {
          value: 'breaching-soon',
          label: 'Breaching soon',
          icon: 'lucide:alarm-clock',
          badgeKey: 'breachingSoon',
          urgent: true,
        },
        { value: 'snoozed', label: 'Snoozed', icon: 'lucide:clock' },
        { value: 'resolved', label: 'Resolved', icon: 'lucide:check-circle-2' },
      ]
    },

    folderViews() {
      return [
        { value: 'all', label: 'All conversations', icon: 'lucide:layers-3' },
        { value: 'archived', label: 'Archived', icon: 'lucide:archive' },
        { value: 'spam', label: 'Spam', icon: 'lucide:shield-alert' },
        { value: 'trash', label: 'Trash', icon: 'lucide:trash-2' },
      ]
    },
  },

  methods: {
    navClass(active) {
      return [
        'flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left transition-colors',
        active
          ? 'bg-accent font-medium text-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      ]
    },

    initial(name) {
      return (name || 'I').trim().charAt(0).toUpperCase()
    },

    addressIcon(address) {
      return address.behaviour === 'mail' ? 'lucide:mail' : 'lucide:life-buoy'
    },

    addressCount(addressId) {
      return this.unreadCounts?.byAddress?.[addressId] || 0
    },

    tagColor(tag) {
      return supportTagColor(tag)
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
