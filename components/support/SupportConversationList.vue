<template>
  <div class="flex h-full flex-col">
    <div class="space-y-2 border-b px-3 pt-3 pb-2.5">
      <div class="flex items-center gap-1.5">
        <Button
          v-if="showDrawerButton"
          variant="ghost"
          size="icon"
          class="-ml-1 h-8 w-8 shrink-0"
          data-testid="support-open-inboxes"
          aria-label="Open inboxes and views"
          @click="$emit('open-inboxes')"
        >
          <Icon name="lucide:panel-left" class="h-4 w-4" />
        </Button>
        <h2 class="min-w-0 truncate text-[15px] font-semibold text-foreground" data-testid="support-list-title">
          <!-- On phones the title opens the views drawer too (Resolved, Snoozed, …) -->
          <button
            v-if="showDrawerButton"
            type="button"
            data-testid="support-list-title-views"
            class="-mx-1 inline-flex max-w-full items-center gap-1 rounded-md px-1 hover:bg-accent"
            aria-label="Switch view"
            @click="$emit('open-inboxes')"
          >
            <span class="truncate">{{ title }}</span>
            <Icon name="lucide:chevron-down" class="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
          <template v-else>{{ title }}</template>
        </h2>
        <span v-if="!isLoading && conversations.length" class="text-sm tabular-nums text-muted-foreground">
          {{ conversations.length }}{{ hasMore ? '+' : '' }}
        </span>
        <span class="flex-1" />
        <slot name="actions" />
      </div>
      <p v-if="subtitle" class="-mt-1 text-xs text-muted-foreground" data-testid="support-list-subtitle">
        {{ subtitle }}
      </p>

      <!-- Project filter chips (All projects) -->
      <slot name="scope" />

      <div class="relative">
        <Icon
          name="lucide:search"
          class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          :model-value="searchQuery"
          data-testid="support-conversation-search"
          placeholder="Search conversations"
          class="h-9 pl-8 pr-8 text-base sm:h-8 sm:text-sm"
          @input="$emit('search', $event.target.value)"
        />
        <Button
          v-if="searchQuery"
          type="button"
          variant="ghost"
          size="icon"
          data-testid="support-conversation-search-clear"
          class="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2"
          aria-label="Clear conversation search"
          @click="$emit('clear-search')"
        >
          <Icon name="lucide:x" class="h-3.5 w-3.5" />
        </Button>
      </div>

      <!-- Filter toggle and the active filters as removable chips -->
      <div class="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          data-testid="support-filter-toggle"
          :class="chipClass(showFilters)"
          :aria-expanded="String(showFilters)"
          @click="showFilters = !showFilters"
        >
          <Icon name="lucide:list-filter" class="h-3 w-3" />
          Filter
        </button>
        <button
          v-if="activeAddress"
          type="button"
          data-testid="support-filter-chip-address"
          :class="chipClass(true)"
          :title="`Show all addresses`"
          @click="$emit('clear-address')"
        >
          <Icon :name="activeAddress.behaviour === 'mail' ? 'lucide:mail' : 'lucide:life-buoy'" class="h-3 w-3" />
          <span class="max-w-40 truncate">{{ activeAddress.address }}</span>
          <Icon name="lucide:x" class="h-3 w-3" />
        </button>
        <button
          v-if="activeTag"
          type="button"
          data-testid="support-filter-chip-tag"
          :class="chipClass(true)"
          @click="$emit('clear-tag')"
        >
          <span class="h-1.5 w-1.5 rounded-full" :style="{ background: tagColor(activeTag) }" />
          {{ activeTag.name }}
          <Icon name="lucide:x" class="h-3 w-3" />
        </button>
        <button
          v-if="csatFilter !== 'all'"
          type="button"
          data-testid="support-filter-chip-csat"
          :class="chipClass(true)"
          @click="$emit('csat-filter', 'all')"
        >
          <Icon name="lucide:star" class="h-3 w-3" />
          {{ csatFilter === 'rated' ? 'Rated' : 'Awaiting rating' }}
          <Icon name="lucide:x" class="h-3 w-3" />
        </button>
      </div>

      <div v-if="showFilters" class="space-y-2 rounded-lg border bg-muted/30 p-2.5" data-testid="support-filter-panel">
        <label class="flex items-center gap-2 text-xs text-muted-foreground">
          <span class="w-12 shrink-0">CSAT</span>
          <select
            :value="csatFilter"
            data-testid="support-csat-filter"
            class="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs text-foreground"
            aria-label="Filter conversations by CSAT response"
            @change="$emit('csat-filter', $event.target.value)"
          >
            <option value="all">All responses</option>
            <option value="rated">Rated</option>
            <option value="unrated">Awaiting rating</option>
          </select>
        </label>
        <div v-if="csatSummary && csatSummary.responseCount" data-testid="support-csat-summary" class="text-[11px]">
          <div class="flex items-center justify-between gap-2">
            <span class="font-medium text-foreground">CSAT pulse</span>
            <span class="font-semibold text-cyan-700 dark:text-cyan-300">
              {{ formatScore(csatSummary.scorePercent) }}%
            </span>
          </div>
          <div class="mt-1 flex items-center justify-between gap-2 text-muted-foreground">
            <span>{{ csatSummary.responseCount }} responses</span>
            <span v-if="activeInboxScore">Inbox {{ formatScore(activeInboxScore.scorePercent) }}%</span>
          </div>
          <div v-if="topAgent" class="mt-1 truncate text-muted-foreground">
            Top agent: <span class="text-foreground">{{ topAgent.agentName }}</span>
          </div>
        </div>
      </div>

      <p
        v-if="activeView === 'trash'"
        data-testid="support-trash-note"
        class="rounded-md border bg-muted/40 px-2.5 py-2 text-[11px] text-muted-foreground"
      >
        Conversations in Trash are deleted permanently after 30 days.
      </p>
    </div>

    <div class="flex-1 overflow-y-auto overscroll-contain">
      <!-- Loading -->
      <div v-if="isLoading" class="divide-y">
        <div v-for="n in 6" :key="n" class="flex gap-3 px-3 py-3">
          <Skeleton class="h-8 w-8 shrink-0 rounded-full" />
          <div class="flex-1 space-y-2">
            <Skeleton class="h-3.5 w-1/2" />
            <Skeleton class="h-3.5 w-4/5" />
            <Skeleton class="h-3 w-full" />
          </div>
        </div>
      </div>

      <!-- Error -->
      <div v-else-if="error" class="p-4 text-center">
        <Icon name="lucide:alert-circle" class="mx-auto mb-2 h-6 w-6 text-destructive" />
        <p class="mb-3 text-sm text-muted-foreground">{{ error }}</p>
        <Button variant="outline" size="sm" @click="$emit('retry')">
          <Icon name="lucide:refresh-cw" class="mr-1.5 h-3.5 w-3.5" />
          Try again
        </Button>
      </div>

      <!-- Empty -->
      <div v-else-if="conversations.length === 0" class="px-6 py-10 text-center" data-testid="support-list-empty">
        <div
          class="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl"
          :class="
            caughtUp ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground'
          "
        >
          <Icon :name="emptyIcon" class="h-5 w-5" />
        </div>
        <p class="mb-1 text-sm font-medium">{{ searchQuery ? 'No matching conversations' : emptyTitle }}</p>
        <p class="mx-auto max-w-64 text-xs text-muted-foreground">
          {{ searchQuery ? 'Try another search.' : emptyHint }}
        </p>
        <Button
          v-if="caughtUp && activeView !== 'inbox'"
          variant="outline"
          size="sm"
          class="mt-4"
          data-testid="support-list-back-to-inbox"
          @click="$emit('go-to-inbox')"
        >
          <Icon name="lucide:inbox" class="mr-1.5 h-3.5 w-3.5" />
          Back to Inbox
        </Button>
      </div>

      <!-- List -->
      <template v-else>
        <div
          v-for="item in conversations"
          :key="item.id"
          class="group relative overflow-hidden border-b"
          @touchstart.passive="onTouchStart($event, item)"
          @touchmove.passive="onTouchMove($event)"
          @touchend="onTouchEnd"
        >
          <!-- Revealed when a row is swiped left on a touch screen -->
          <div
            v-if="canResolve(item)"
            class="absolute inset-0 flex items-center justify-end gap-1.5 bg-emerald-600 px-5 text-sm font-semibold text-white"
            aria-hidden="true"
          >
            {{ item.behaviour === 'mail' ? 'Done' : 'Resolve' }}
            <Icon name="lucide:check" class="h-4 w-4" />
          </div>
          <button
            type="button"
            :data-testid="`support-conversation-${item.id}`"
            :data-unread="String(item.isUnread === true)"
            :data-has-draft="String(item.hasDraft === true)"
            :aria-current="item.id === selectedConversationId ? 'true' : undefined"
            class="relative flex w-full items-start gap-3 bg-background py-3 pr-3 pl-2.5 text-left transition-[background-color,transform] duration-200"
            :class="[showProject ? 'border-l-[3px]' : 'border-l-2', rowClass(item)]"
            :style="[edgeStyle(item), swipeStyle(item)]"
            @click="onRowClick(item)"
          >
            <span class="relative shrink-0">
              <span
                v-if="item.isUnread"
                class="absolute top-3 -left-2 h-1.5 w-1.5 rounded-full bg-primary"
                aria-label="Unread"
              />
              <Avatar class="h-8 w-8">
                <AvatarFallback class="text-[11px] font-semibold">{{ initials(contactLabel(item)) }}</AvatarFallback>
              </Avatar>
            </span>
            <span class="block min-w-0 flex-1">
              <span class="flex items-baseline gap-2">
                <span
                  class="min-w-0 flex-1 truncate text-sm"
                  :class="item.isUnread ? 'font-semibold text-foreground' : 'text-foreground'"
                >
                  {{ contactLabel(item) }}
                </span>
                <span class="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
                  {{ formatRelativeTime(item.lastActivityAt || item.createdAt) }}
                </span>
              </span>
              <span
                class="mt-0.5 block truncate text-sm"
                :class="item.isUnread ? 'font-semibold text-foreground' : 'text-foreground/85'"
              >
                {{ item.subject || 'No subject' }}
              </span>
              <span class="mt-1.5 flex min-h-5 flex-wrap items-center gap-1.5">
                <ProjectTag
                  v-if="projectFor(item)"
                  :project="projectFor(item)"
                  class="max-w-[9rem]"
                  data-testid="support-conversation-project"
                />
                <span
                  v-if="item.behaviour === 'mail'"
                  data-testid="support-conversation-kind-mail"
                  class="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
                >
                  <Icon name="lucide:mail" class="h-3 w-3" />
                  Mail
                </span>
                <span
                  v-if="slaCountdown(item)"
                  data-testid="support-conversation-sla"
                  class="inline-flex items-center gap-1 rounded px-1.5 py-px text-[11px] font-medium"
                  :class="slaClass(item)"
                  :aria-label="`SLA ${slaCountdown(item)}`"
                >
                  <Icon name="lucide:timer" class="h-3 w-3" />
                  {{ slaCountdown(item) }}
                </span>
                <span
                  v-if="item.priority && item.priority !== 'normal'"
                  class="inline-flex items-end gap-px"
                  :title="`${capitalize(item.priority)} priority`"
                  :aria-label="`${capitalize(item.priority)} priority`"
                >
                  <span
                    v-for="bar in 3"
                    :key="bar"
                    class="w-[3px] rounded-[1px]"
                    :class="priorityBarClass(item.priority, bar)"
                    :style="{ height: `${3 + bar * 2.5}px` }"
                  />
                </span>
                <span
                  v-if="item.status !== 'open' && item.status !== 'pending'"
                  class="rounded bg-muted px-1.5 py-px text-[11px] text-muted-foreground"
                >
                  {{ formatStatus(item.status) }}
                </span>
                <span
                  v-else-if="item.status === 'pending'"
                  class="rounded bg-muted px-1.5 py-px text-[11px] text-muted-foreground"
                >
                  Pending
                </span>
                <span
                  v-if="item.hasDraft"
                  data-testid="support-conversation-draft-indicator"
                  class="inline-flex items-center gap-1 rounded bg-amber-500/12 px-1.5 py-px text-[11px] font-medium text-amber-700 dark:text-amber-300"
                  aria-label="Unsaved draft"
                >
                  <Icon name="lucide:pencil-line" class="h-3 w-3" />
                  Draft
                </span>
                <span
                  v-if="item.csatRating !== null && item.csatRating !== undefined"
                  data-testid="support-conversation-csat"
                  class="inline-flex items-center gap-1 rounded bg-cyan-500/10 px-1.5 py-px text-[11px] font-medium text-cyan-700 dark:text-cyan-300"
                  :aria-label="`CSAT rating ${item.csatRating}`"
                >
                  <Icon name="lucide:star" class="h-3 w-3" />
                  {{ item.csatRating }}
                </span>
                <span class="ml-auto flex items-center gap-1.5">
                  <span
                    v-if="addressPill(item)"
                    data-testid="support-conversation-address"
                    class="max-w-24 truncate text-[11px] text-muted-foreground"
                    :title="item.mailAddress"
                  >
                    {{ addressPill(item) }}
                  </span>
                  <span v-if="item.behaviour !== 'mail'" class="text-[11px] tabular-nums text-muted-foreground">
                    #{{ item.displayId }}
                  </span>
                  <Avatar v-if="item.assigneeUserId" class="h-5 w-5" :title="`Assigned to ${assigneeName(item)}`">
                    <AvatarFallback class="bg-primary/15 text-[9px] font-semibold text-primary">
                      {{ initials(assigneeName(item)) }}
                    </AvatarFallback>
                  </Avatar>
                </span>
              </span>
            </span>
          </button>

          <!-- Hover actions (pointer devices only) -->
          <div
            v-if="canResolve(item) || canClaim(item)"
            class="pointer-events-none absolute top-2 right-2 hidden gap-0.5 rounded-lg border bg-popover p-0.5 opacity-0 shadow-md transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(hover:hover)]:flex"
          >
            <button
              v-if="canClaim(item)"
              type="button"
              :data-testid="`support-conversation-${item.id}-claim`"
              class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Assign to me"
              aria-label="Assign to me"
              @click="$emit('quick-action', { id: item.id, action: 'claim' })"
            >
              <Icon name="lucide:user-plus" class="h-4 w-4" />
            </button>
            <button
              v-if="canResolve(item)"
              type="button"
              :data-testid="`support-conversation-${item.id}-resolve`"
              class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              :title="item.behaviour === 'mail' ? 'Done' : 'Resolve'"
              :aria-label="item.behaviour === 'mail' ? 'Done' : 'Resolve'"
              @click="$emit('quick-action', { id: item.id, action: 'resolve' })"
            >
              <Icon name="lucide:check" class="h-4 w-4" />
            </button>
          </div>
        </div>

        <div v-if="hasMore" class="flex justify-center p-3">
          <Button variant="outline" size="sm" :disabled="isLoadingMore" @click="$emit('load-more')">
            <Icon v-if="isLoadingMore" name="lucide:loader-2" class="mr-1.5 h-3.5 w-3.5 animate-spin" />
            {{ isLoadingMore ? 'Loading…' : 'Load more' }}
          </Button>
        </div>
      </template>
    </div>
  </div>
</template>

<script>
import { supportSlaClass, supportSlaCountdown } from '~/lib/support-sla'
import { supportTagColor } from '~/lib/support-tags'

const SWIPE_COMMIT_PX = 90

export default {
  name: 'SupportConversationList',

  props: {
    conversations: { type: Array, default: () => [] },
    selectedConversationId: { type: String, default: null },
    isLoading: { type: Boolean, default: false },
    isLoadingMore: { type: Boolean, default: false },
    error: { type: String, default: null },
    hasMore: { type: Boolean, default: false },
    searchQuery: { type: String, default: '' },
    csatFilter: { type: String, default: 'all' },
    csatSummary: { type: Object, default: null },
    activeView: { type: String, default: 'inbox' },
    activeInboxId: { type: String, default: null },
    title: { type: String, default: 'Inbox' },
    activeAddress: { type: Object, default: null },
    activeTag: { type: Object, default: null },
    members: { type: Array, default: () => [] },
    currentUserId: { type: String, default: '' },
    currentUserName: { type: String, default: '' },
    showDrawerButton: { type: Boolean, default: false },
    // All projects: tag every row with its project and edge it in the project's colour.
    showProject: { type: Boolean, default: false },
    // Projects of the scope (`identity` gives the colour); rows carry only `project: { id, name, slug }`.
    scopeProjects: { type: Array, default: () => [] },
    subtitle: { type: String, default: '' },
  },

  emits: [
    'select',
    'retry',
    'load-more',
    'search',
    'clear-search',
    'csat-filter',
    'clear-address',
    'clear-tag',
    'quick-action',
    'open-inboxes',
    'go-to-inbox',
  ],

  data() {
    return {
      nowMs: Date.now(),
      slaTicker: null,
      showFilters: false,
      swipe: null,
      suppressClick: false,
    }
  },

  computed: {
    caughtUp() {
      return !this.searchQuery && ['inbox', 'unassigned', 'assigned-to-me', 'breaching-soon'].includes(this.activeView)
    },

    emptyIcon() {
      if (this.searchQuery) return 'lucide:search-x'
      if (this.caughtUp) return 'lucide:party-popper'
      return 'lucide:inbox'
    },

    emptyTitle() {
      if (this.caughtUp) return 'All caught up'
      if (this.activeView === 'trash') return 'Trash is empty'
      if (this.activeView === 'spam') return 'No spam'
      if (this.activeView === 'archived') return 'Nothing archived'
      return 'No conversations'
    },

    emptyHint() {
      if (this.caughtUp) return 'New conversations show up here as they arrive.'
      if (this.activeView === 'trash') return 'Deleted conversations are kept here for 30 days.'
      if (this.activeView === 'spam') return 'Conversations marked as spam will appear here.'
      if (this.activeView === 'archived') return 'Archived conversations will appear here.'
      return 'Conversations for this view will appear here.'
    },

    activeInboxScore() {
      return this.csatSummary?.byInbox?.find((item) => item.inboxId === this.activeInboxId) || null
    },

    topAgent() {
      return this.csatSummary?.byAgent?.[0] || null
    },
  },

  mounted() {
    this.slaTicker = window.setInterval(() => {
      this.nowMs = Date.now()
    }, 30_000)
  },

  beforeUnmount() {
    if (this.slaTicker) window.clearInterval(this.slaTicker)
  },

  methods: {
    chipClass(active) {
      return [
        'inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors',
        active
          ? 'border-border bg-accent text-foreground'
          : 'border-dashed text-muted-foreground hover:border-solid hover:text-foreground',
      ]
    },

    /** `hello@acme.com` shows as `hello@`; a catch-all `*@acme.com` shows as `*@`. */
    addressPill(item) {
      if (this.activeAddress || !item.mailAddressId || !item.mailAddress) return ''
      const at = item.mailAddress.indexOf('@')
      return at > 0 ? item.mailAddress.slice(0, at + 1) : item.mailAddress
    },

    rowClass(item) {
      // In All projects the left edge keeps the project's colour, so selection is shown by the background alone.
      if (item.id === this.selectedConversationId) return this.showProject ? 'bg-accent' : 'border-l-primary bg-accent'
      return 'border-l-transparent [@media(hover:hover)]:hover:bg-accent/60'
    },

    projectFor(item) {
      if (!this.showProject || !item.project) return null
      return this.scopeProjects.find((project) => project.id === item.project.id) || item.project
    },

    edgeStyle(item) {
      const color = this.projectFor(item)?.identity?.color
      return color ? { borderLeftColor: color } : undefined
    },

    contactLabel(item) {
      if (item.contactLoading) return 'Loading…'
      return item.contact?.name || item.contact?.email || 'Unknown contact'
    },

    assigneeName(item) {
      if (item.assigneeUserId === this.currentUserId) return this.currentUserName || 'You'
      const member = this.members.find((candidate) => candidate.userId === item.assigneeUserId)
      return member?.userName || member?.userEmail || 'a teammate'
    },

    canResolve(item) {
      return !item.deletedAt && !item.spamAt && ['open', 'pending', 'snoozed'].includes(item.status)
    },

    canClaim(item) {
      return Boolean(this.currentUserId) && !item.assigneeUserId && this.canResolve(item)
    },

    initials(value) {
      if (!value) return '?'
      const parts = value.trim().split(/\s+/)
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    },

    capitalize(value) {
      return value ? value.charAt(0).toUpperCase() + value.slice(1) : ''
    },

    priorityBarClass(priority, bar) {
      if (priority === 'urgent') return 'bg-red-500'
      const filled = { low: 1, high: 3 }[priority] || 2
      return bar <= filled ? 'bg-muted-foreground' : 'bg-muted'
    },

    tagColor(tag) {
      return supportTagColor(tag)
    },

    formatRelativeTime(dateStr) {
      if (!dateStr) return ''
      const date = new Date(dateStr)
      const diffMin = Math.floor((Date.now() - date.getTime()) / 60000)
      if (diffMin < 1) return 'now'
      if (diffMin < 60) return `${diffMin}m`
      const diffHr = Math.floor(diffMin / 60)
      if (diffHr < 24) return `${diffHr}h`
      const diffDays = Math.floor(diffHr / 24)
      if (diffDays < 7) return `${diffDays}d`
      return date.toLocaleDateString()
    },

    formatStatus(status) {
      const labels = { open: 'Open', pending: 'Pending', resolved: 'Resolved', snoozed: 'Snoozed', closed: 'Archived' }
      return labels[status] || status
    },

    slaCountdown(item) {
      return supportSlaCountdown(item, this.nowMs)
    },

    slaClass(item) {
      return supportSlaClass(item, this.nowMs)
    },

    formatScore(value) {
      return value === null || value === undefined ? '—' : Math.round(value)
    },

    onRowClick(item) {
      if (this.suppressClick) {
        this.suppressClick = false
        return
      }
      this.$emit('select', item.id)
    },

    // Swipe left to resolve. Vertical movement keeps scrolling the list.
    onTouchStart(event, item) {
      if (!this.canResolve(item)) return
      const touch = event.touches[0]
      this.swipe = { id: item.id, x: touch.clientX, y: touch.clientY, dx: 0, horizontal: null }
    },

    onTouchMove(event) {
      if (!this.swipe) return
      const touch = event.touches[0]
      const dx = touch.clientX - this.swipe.x
      const dy = touch.clientY - this.swipe.y
      if (this.swipe.horizontal === null && Math.abs(dx) + Math.abs(dy) > 8) {
        this.swipe.horizontal = Math.abs(dx) > Math.abs(dy)
      }
      if (this.swipe.horizontal) this.swipe.dx = Math.min(0, dx)
    },

    onTouchEnd() {
      if (!this.swipe) return
      const { id, dx } = this.swipe
      this.suppressClick = Math.abs(dx) > 8
      if (dx <= -SWIPE_COMMIT_PX) {
        this.swipe = { id, dx: -window.innerWidth, done: true }
        window.setTimeout(() => {
          this.swipe = null
          this.$emit('quick-action', { id, action: 'resolve' })
        }, 180)
        return
      }
      this.swipe = null
    },

    swipeStyle(item) {
      if (!this.swipe || this.swipe.id !== item.id || !this.swipe.dx) return undefined
      return {
        transform: `translateX(${this.swipe.dx}px)`,
        transitionDuration: this.swipe.done ? '180ms' : '0ms',
      }
    },
  },
}
</script>
