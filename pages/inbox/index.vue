<template>
  <div class="contents">
    <div
      ref="pageRoot"
      class="h-full min-h-[420px]"
      data-testid="support-inbox-page"
      :data-active-project-listener-ready="activeProjectListenerReady ? 'true' : 'false'"
    >
      <!-- Loading project context -->
      <div
        v-if="isLoadingProject"
        class="@container/panes flex h-full overflow-hidden"
        data-testid="support-inbox-skeleton"
      >
        <div class="hidden w-[232px] shrink-0 space-y-2 border-r bg-sidebar p-3 @4xl/panes:block">
          <Skeleton class="h-10 w-full" />
          <Skeleton v-for="n in 6" :key="n" class="h-7 w-full" />
        </div>
        <div
          class="w-full min-w-0 shrink-0 space-y-3 p-3 @2xl/panes:w-[320px] @2xl/panes:border-r @6xl/panes:w-[360px]"
        >
          <Skeleton class="h-6 w-1/3" />
          <Skeleton class="h-9 w-full" />
          <div v-for="n in 6" :key="n" class="flex gap-3 py-1.5">
            <Skeleton class="h-8 w-8 shrink-0 rounded-full" />
            <div class="flex-1 space-y-2">
              <Skeleton class="h-3.5 w-1/2" />
              <Skeleton class="h-3.5 w-full" />
            </div>
          </div>
        </div>
        <div class="hidden min-w-0 flex-1 flex-col @2xl/panes:flex">
          <div class="border-b p-4">
            <Skeleton class="h-5 w-1/2" />
          </div>
          <div class="mx-auto w-full max-w-3xl flex-1 space-y-4 p-4">
            <Skeleton class="h-20 w-2/3" />
            <Skeleton class="h-20 w-3/5" />
          </div>
          <div class="mx-auto w-full max-w-3xl p-4">
            <Skeleton class="h-28 w-full rounded-xl" />
          </div>
        </div>
      </div>

      <!-- Notices (load error, Inbox off, no inbox) use the standard page frame and gutters -->
      <div
        v-else-if="showNotice"
        class="h-full overflow-y-auto px-4 pt-4 pb-10 sm:px-6 lg:px-8"
        data-testid="support-inbox-notice"
      >
        <PageContainer>
          <PageHeader title="Inbox" description="Conversations with your customers" />

          <!-- Project error -->
          <Card v-if="projectError">
            <CardContent class="py-8 text-center">
              <Icon name="lucide:alert-circle" class="mx-auto mb-3 h-8 w-8 text-destructive" />
              <p class="mb-2 font-medium">Failed to load the project</p>
              <p class="mb-4 text-sm text-muted-foreground">{{ projectError }}</p>
              <Button variant="outline" @click="initProjectContext">
                <Icon name="lucide:refresh-cw" class="mr-2 h-4 w-4" />
                Try again
              </Button>
            </CardContent>
          </Card>

          <!-- Inbox switched off for this project -->
          <Card v-else-if="supportDisabled" data-testid="support-disabled">
            <CardContent class="space-y-3 py-10 text-center">
              <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Icon name="lucide:life-buoy" class="h-6 w-6 text-muted-foreground" />
              </div>
              <p class="font-medium">Inbox is switched off for this project</p>
              <template v-if="activeProject?.role === 'admin'">
                <p class="text-sm text-muted-foreground">Switch it on under Project settings, Tools.</p>
                <Button as-child variant="outline">
                  <NuxtLink to="/project/settings?tab=tools">
                    <Icon name="lucide:layout-grid" class="mr-2 h-4 w-4" />
                    Project settings: Tools
                  </NuxtLink>
                </Button>
              </template>
              <p v-else class="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
                <Icon name="lucide:lock" class="h-3.5 w-3.5" />
                Project admins can switch Inbox on.
              </p>
            </CardContent>
          </Card>

          <!-- No inbox yet: point to settings, where managers create one -->
          <Card v-else data-testid="support-inbox-empty">
            <CardContent class="py-8 text-center">
              <div
                v-if="inboxAccessError"
                data-testid="support-inbox-access-error"
                class="mb-4 text-sm text-destructive"
                role="alert"
              >
                {{ inboxAccessError }}
              </div>
              <Icon name="lucide:inbox" class="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <p class="mb-2 font-medium" data-testid="support-no-assignment">No inboxes are assigned to you.</p>
              <p class="mx-auto mb-4 max-w-md text-sm text-muted-foreground">
                Admins can create an inbox and set up domains, addresses and agents in inbox settings. Otherwise, ask an
                inbox administrator to add you to an inbox.
              </p>
              <Button as-child>
                <NuxtLink to="/inbox/settings" data-testid="support-inbox-empty-settings">
                  <Icon name="lucide:settings" class="mr-2 h-4 w-4" />
                  Open inbox settings
                </NuxtLink>
              </Button>
            </CardContent>
          </Card>
        </PageContainer>
      </div>

      <!-- Panes, sized by the container (not the viewport) so they adapt when the
           app sidebar opens or collapses: narrow = one pane (list or thread),
           @2xl = list + thread, 898px = inbox column too, 1340px = details inline. -->
      <div v-else class="@container/panes relative flex h-full overflow-hidden">
        <div
          v-if="inboxAccessError"
          data-testid="support-inbox-access-error"
          class="absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive shadow-sm"
          role="alert"
        >
          {{ inboxAccessError }}
        </div>

        <!-- Inbox switcher, views, addresses, tags -->
        <aside v-if="!isCompactPanes" class="w-[232px] shrink-0 border-r bg-sidebar">
          <SupportInboxSidebar v-bind="sidebarProps" v-on="sidebarListeners" />
        </aside>

        <!-- Conversation list -->
        <section
          class="w-full min-w-0 shrink-0 @2xl/panes:block @2xl/panes:w-[320px] @2xl/panes:border-r @6xl/panes:w-[360px]"
          :class="selectedConversationId ? 'hidden' : 'block'"
          aria-label="Conversations"
        >
          <SupportConversationList
            :conversations="conversationsEnriched"
            :selected-conversation-id="selectedConversationId"
            :is-loading="isLoadingConversations"
            :is-loading-more="isLoadingMoreConversations"
            :error="conversationsError"
            :has-more="hasMoreConversations"
            :search-query="conversationSearch"
            :csat-filter="csatFilter"
            :csat-summary="csatSummary"
            :active-inbox-id="activeInboxId"
            :active-view="activeView"
            :title="activeViewLabel"
            :active-address="activeAddress"
            :active-tag="activeTag"
            :members="inboxMembers"
            :current-user-id="currentUserId"
            :current-user-name="currentUserName"
            :show-drawer-button="isCompactPanes"
            @select="selectConversation"
            @search="handleConversationSearch"
            @clear-search="clearConversationSearch"
            @csat-filter="handleCsatFilter"
            @clear-address="selectAddress(null)"
            @clear-tag="selectTag(null)"
            @quick-action="handleQuickAction"
            @open-inboxes="showInboxSheet = true"
            @go-to-inbox="selectView('inbox')"
            @retry="() => loadConversations(true)"
            @load-more="() => loadConversations(false)"
          />
        </section>

        <!-- Thread -->
        <section
          class="min-w-0 flex-1 @2xl/panes:block"
          :class="selectedConversationId ? 'block' : 'hidden'"
          aria-label="Conversation"
        >
          <SupportConversationThread
            :conversation-id="selectedConversationId"
            :conversation="conversationDetail"
            :contact="conversationContact"
            :current-user-id="currentUserId"
            :members="inboxMembers"
            :messages="messages"
            :is-loading-detail="isLoadingDetail"
            :detail-error="detailError"
            :is-loading-messages="isLoadingMessages"
            :messages-error="messagesError"
            :is-updating="isUpdatingConversation"
            :details-open="showDetails"
            :receiving-address="receivingAddress"
            @retry-detail="loadConversationDetail"
            @retry-messages="loadMessages"
            @update-conversation="patchConversation"
            @claim-conversation="claimConversation"
            @mark-unread="markConversationUnread"
            @toggle-details="toggleDetails"
            @back="closeConversation"
          >
            <template #composer>
              <SupportComposer
                v-if="selectedConversationId"
                ref="composer"
                :conversation-id="selectedConversationId"
                :project-id="activeProjectId"
                :contact="conversationContact"
                :current-user-name="currentUserName"
                :conversation="conversationDetail"
                :addresses="addresses"
                :inbox-sending-address="inboxSendingAddress"
                @posted="handleMessagePosted"
                @draft-state-changed="handleDraftStateChanged"
              />
            </template>
          </SupportConversationThread>
        </section>

        <!-- Details inline on wide panes -->
        <aside
          v-if="detailsInline && showDetails && selectedConversationId"
          class="w-[300px] shrink-0 border-l bg-sidebar"
          aria-label="Conversation details"
        >
          <SupportConversationDetails v-bind="detailsProps" v-on="detailsListeners">
            <SupportContactPanel v-bind="contactPanelProps" v-on="contactPanelListeners" />
          </SupportConversationDetails>
        </aside>
      </div>
    </div>

    <!-- Inbox column as a drawer when the panes are too narrow -->
    <Sheet v-if="isCompactPanes" :open="showInboxSheet" @update:open="showInboxSheet = $event">
      <SheetContent side="left" class="w-[86vw] max-w-[300px] gap-0 p-0" data-testid="support-inbox-sheet">
        <SheetHeader class="sr-only">
          <SheetTitle>Inboxes</SheetTitle>
          <SheetDescription>Switch inbox, view, address or tag</SheetDescription>
        </SheetHeader>
        <SupportInboxSidebar
          v-bind="sidebarProps"
          @select-inbox="(id) => closeInboxSheetAfter(selectInbox(id))"
          @select-view="(view) => closeInboxSheetAfter(selectView(view))"
          @select-address="(id) => closeInboxSheetAfter(selectAddress(id))"
          @select-tag="(id) => closeInboxSheetAfter(selectTag(id))"
          @retry="loadInboxes"
          @create-tag="createTag"
        />
      </SheetContent>
    </Sheet>

    <!-- Details as a slide-over when the panes are too narrow to show it inline -->
    <Sheet
      v-if="!detailsInline"
      :open="showDetails && Boolean(selectedConversationId)"
      @update:open="showDetails = $event"
    >
      <SheetContent
        side="right"
        class="w-full gap-0 p-0 sm:max-w-sm [&>button]:hidden"
        data-testid="support-details-sheet"
      >
        <SheetHeader class="sr-only">
          <SheetTitle>Conversation details</SheetTitle>
          <SheetDescription>Properties, contact and history</SheetDescription>
        </SheetHeader>
        <SupportConversationDetails v-bind="detailsProps" v-on="detailsListeners">
          <SupportContactPanel v-bind="contactPanelProps" v-on="contactPanelListeners" />
        </SupportConversationDetails>
      </SheetContent>
    </Sheet>

    <SupportConversationFeedbackDialog
      :open="showFeedbackBridgeDialog"
      :conversation="conversationDetail"
      :messages="messages"
      :project-id="activeProjectId"
      :project-slug="activeProject?.slug || ''"
      :products="activeProjectProducts"
      :is-submitting="isCreatingFeedback"
      @update:open="showFeedbackBridgeDialog = $event"
      @submit="convertConversationToFeedback"
      @link="linkExistingFeedback"
    />

    <div
      v-if="showShortcutHelp"
      data-testid="support-shortcut-help"
      role="dialog"
      aria-modal="true"
      aria-labelledby="support-shortcut-help-title"
      class="fixed inset-0 z-50 flex items-start justify-center bg-black/20 p-6 pt-24 backdrop-blur-[1px]"
      @click.self="showShortcutHelp = false"
    >
      <div class="w-full max-w-sm rounded-lg border bg-card p-4 text-card-foreground shadow-xl">
        <div class="flex items-start justify-between gap-4">
          <div>
            <p id="support-shortcut-help-title" class="text-sm font-semibold">Keyboard shortcuts</p>
            <p class="mt-1 text-xs text-muted-foreground">Shortcuts work when you are not editing a field.</p>
          </div>
          <button
            type="button"
            data-testid="support-shortcut-help-close"
            aria-label="Close keyboard shortcuts"
            class="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            @click="showShortcutHelp = false"
          >
            <Icon name="lucide:x" class="h-4 w-4" />
          </button>
        </div>
        <div class="mt-4 grid grid-cols-[4rem_1fr] items-center gap-x-3 gap-y-2 text-xs">
          <kbd class="rounded border bg-muted px-1.5 py-1 text-center font-mono">j / k</kbd>
          <span>Next / previous conversation</span>
          <kbd class="rounded border bg-muted px-1.5 py-1 text-center font-mono">r / n</kbd>
          <span>Reply / internal note</span>
          <kbd class="rounded border bg-muted px-1.5 py-1 text-center font-mono">c</kbd>
          <span>Assign to me</span>
          <kbd class="rounded border bg-muted px-1.5 py-1 text-center font-mono">i</kbd>
          <span>Show or hide details</span>
          <kbd class="rounded border bg-muted px-1.5 py-1 text-center font-mono">e</kbd>
          <span>Resolve conversation</span>
          <kbd class="rounded border bg-muted px-1.5 py-1 text-center font-mono">#</kbd>
          <span>Delete conversation (move to Trash)</span>
          <kbd class="rounded border bg-muted px-1.5 py-1 text-center font-mono">!</kbd>
          <span>Mark conversation as spam</span>
          <kbd class="rounded border bg-muted px-1.5 py-1 text-center font-mono">/</kbd>
          <span>Focus conversation search</span>
          <kbd class="rounded border bg-muted px-1.5 py-1 text-center font-mono">?</kbd>
          <span>Toggle this help</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'
import { loadActiveProject } from '~/lib/active-project'
import {
  getNextSupportConversationId,
  getSupportShortcutAction,
  isSupportShortcutEditableTarget,
} from '~/lib/support-keyboard-shortcuts'

const ACTIVE_PROJECT_CHANGED_EVENT = 'veerify:active-project-changed'
const SUPPORT_DRAFT_STATE_CHANGED_EVENT = 'veerify:support-draft-state-changed'
const SUPPORT_VIEWS = [
  'inbox',
  'assigned-to-me',
  'unassigned',
  'breaching-soon',
  'snoozed',
  'resolved',
  'archived',
  'spam',
  'trash',
  'all',
]
const DEFAULT_VIEW = 'inbox'
const VIEW_LABELS = {
  inbox: 'Inbox',
  'assigned-to-me': 'Assigned to me',
  unassigned: 'Unassigned',
  'breaching-soon': 'Breaching soon',
  snoozed: 'Snoozed',
  resolved: 'Resolved',
  archived: 'Archived',
  spam: 'Spam',
  trash: 'Trash',
  all: 'All conversations',
}
// Views that only show conversations still being worked: resolving one takes it out.
const WORKING_VIEWS = ['inbox', 'assigned-to-me', 'unassigned', 'breaching-soon']
const EMPTY_UNREAD_COUNTS = { inbox: 0, unassigned: 0, assignedToMe: 0, breachingSoon: 0, byAddress: {} }
// Container width from which the details panel sits beside the thread instead of sliding over it.
const DETAILS_INLINE_MIN_WIDTH = 1340
const DETAILS_OPEN_STORAGE_KEY = 'veerify:support:details-open'
const CSAT_FILTERS = ['all', 'rated', 'unrated']
const DRAFT_STORAGE_PREFIX = 'veerify:support:draft'
const DRAFT_MODES = ['reply', 'note']

export default {
  name: 'SupportInboxPage',

  created() {
    useHead({ title: 'Inbox' })
  },

  data() {
    return {
      activeProjectId: '',
      activeProject: null,
      activeProjectProducts: [],
      supportDisabled: false,
      currentUserId: '',
      currentUserName: '',
      contextGeneration: 0,
      activeProjectListenerReady: false,
      isLoadingProject: true,
      projectError: null,

      inboxes: [],
      activeInboxId: null,
      isLoadingInboxes: true,
      inboxesError: null,
      inboxAccessError: null,

      inboxMembers: [],

      activeView: DEFAULT_VIEW,
      addresses: [],
      inboxSendingAddress: null,
      activeAddressId: null,
      tags: [],
      activeTagId: null,
      conversationTags: [],
      conversationTagsBusy: false,
      showDetails: false,

      conversations: [],
      isLoadingConversations: true,
      isLoadingMoreConversations: false,
      conversationsError: null,
      hasMoreConversations: false,
      conversationsNextCursor: null,
      conversationSearch: '',
      csatFilter: 'all',
      csatSummary: null,
      conversationSearchDebounceTimer: null,
      unreadCounts: { ...EMPTY_UNREAD_COUNTS },
      conversationDraftIds: [],
      contactCache: {},

      selectedConversationId: null,
      conversationDetail: null,
      conversationContact: null,
      isLoadingDetail: false,
      detailError: null,
      isUpdatingConversation: false,
      showFeedbackBridgeDialog: false,
      isCreatingFeedback: false,

      messages: [],
      isLoadingMessages: false,
      messagesError: null,

      contactPanelContact: null,
      contactPanelCompany: null,
      contactPanelLoading: false,
      contactPanelError: null,
      timelineLinked: [],
      timelineProbableFeedback: [],
      timelineLinkedLoading: false,
      timelineProbableLoading: false,
      timelineLinkedMoreLoading: false,
      timelineProbableMoreLoading: false,
      timelineLinkedHasMore: false,
      timelineProbableHasMore: false,
      timelineLinkedCursor: null,
      timelineProbableCursor: null,
      timelineLinkedError: null,
      timelineProbableError: null,
      timelineLinkedMoreError: null,
      timelineProbableMoreError: null,
      timelineGeneration: 0,
      timelineLinkedGeneration: 0,
      timelineProbableGeneration: 0,
      previousConversations: [],
      previousConversationsLoading: false,
      linkingFeedbackId: null,

      unsubscribeInboxChannel: null,
      unsubscribeConversationChannel: null,
      unregisterReconnectHook: null,
      showShortcutHelp: false,
      showInboxSheet: false,
      pageWidth: null,
      pageResizeObserver: null,
    }
  },

  computed: {
    noInbox() {
      return !this.isLoadingInboxes && !this.inboxesError && this.inboxes.length === 0
    },
    showNotice() {
      return Boolean(this.projectError) || this.supportDisabled || this.noInbox
    },
    // Mirrors the @4xl/panes container query (56rem): below it the inbox
    // sidebar moves into a drawer opened from a compact toolbar. Rendered
    // with v-if so the desktop DOM carries no hidden duplicates. The extra
    // 2px is the pane card's border, which the container query excludes.
    isCompactPanes() {
      return this.pageWidth !== null && this.pageWidth < 898
    },

    activeInbox() {
      return this.inboxes.find((inbox) => inbox.id === this.activeInboxId) || null
    },

    detailsInline() {
      return this.pageWidth !== null && this.pageWidth >= DETAILS_INLINE_MIN_WIDTH
    },

    activeViewLabel() {
      return VIEW_LABELS[this.activeView] || 'Inbox'
    },

    activeAddress() {
      return this.addresses.find((address) => address.id === this.activeAddressId) || null
    },

    activeTag() {
      return this.tags.find((tag) => tag.id === this.activeTagId) || null
    },

    receivingAddress() {
      const id = this.conversationDetail?.mailAddressId
      return (id && this.addresses.find((address) => address.id === id)?.address) || ''
    },

    sidebarProps() {
      return {
        inboxes: this.inboxes,
        activeInboxId: this.activeInboxId,
        isLoading: this.isLoadingInboxes,
        error: this.inboxesError,
        capabilities: this.activeInbox?.capabilities,
        activeView: this.activeView,
        unreadCounts: this.unreadCounts,
        addresses: this.addresses,
        activeAddressId: this.activeAddressId,
        tags: this.tags,
        activeTagId: this.activeTagId,
      }
    },

    sidebarListeners() {
      return {
        'select-inbox': this.selectInbox,
        'select-view': this.selectView,
        'select-address': this.selectAddress,
        'select-tag': this.selectTag,
        retry: this.loadInboxes,
        'create-tag': this.createTag,
      }
    },

    detailsProps() {
      return {
        conversation: this.conversationDetail,
        currentUserId: this.currentUserId,
        members: this.inboxMembers,
        isUpdating: this.isUpdatingConversation,
        tags: this.tags,
        conversationTags: this.conversationTags,
        tagsBusy: this.conversationTagsBusy,
      }
    },

    detailsListeners() {
      return {
        close: () => this.setDetailsOpen(false),
        'update-conversation': this.patchConversation,
        'convert-to-feedback': () => {
          // Two modals do not stack well: the slide-over closes before the dialog opens.
          if (!this.detailsInline) this.showDetails = false
          this.openFeedbackBridgeDialog()
        },
        'add-tag': this.addConversationTag,
        'remove-tag': this.removeConversationTag,
      }
    },

    contactPanelProps() {
      return {
        contact: this.contactPanelContact,
        company: this.contactPanelCompany,
        isLoading: this.contactPanelLoading,
        error: this.contactPanelError,
        linked: this.timelineLinked,
        probableFeedback: this.timelineProbableFeedback,
        linkedLoading: this.timelineLinkedLoading,
        probableLoading: this.timelineProbableLoading,
        linkedMoreLoading: this.timelineLinkedMoreLoading,
        probableMoreLoading: this.timelineProbableMoreLoading,
        linkedHasMore: this.timelineLinkedHasMore,
        probableHasMore: this.timelineProbableHasMore,
        linkedError: this.timelineLinkedError,
        probableError: this.timelineProbableError,
        linkedMoreError: this.timelineLinkedMoreError,
        probableMoreError: this.timelineProbableMoreError,
        previousConversations: this.previousConversations,
        previousConversationsLoading: this.previousConversationsLoading,
        linkingId: this.linkingFeedbackId,
      }
    },

    contactPanelListeners() {
      return {
        retry: this.loadContactPanel,
        'link-feedback': this.linkFeedback,
        'unlink-feedback': this.unlinkFeedback,
        'load-linked': (reset) => this.loadTimelineSection('linked', reset),
        'load-probable': (reset) => this.loadTimelineSection('probable', reset),
        'select-conversation': this.selectConversation,
      }
    },

    conversationsEnriched() {
      return this.conversations.map((item) => {
        const cached = this.contactCache[item.contactId]
        const isSentinel = cached === 'loading' || cached === 'error'
        return {
          ...item,
          contact: cached && !isSentinel ? cached : null,
          contactLoading: cached === 'loading',
          hasDraft: this.conversationDraftIds.includes(item.id),
        }
      })
    },
  },

  watch: {
    // Inline (wide panes) the panel stays open unless the agent closed it; as a slide-over it starts closed.
    detailsInline: {
      handler(inline) {
        this.showDetails = inline ? this.storageGet(DETAILS_OPEN_STORAGE_KEY) !== '0' : false
      },
    },
  },

  async mounted() {
    if (import.meta.client) {
      this.pageWidth = this.$refs.pageRoot?.clientWidth ?? null
      this.showDetails = this.detailsInline && this.storageGet(DETAILS_OPEN_STORAGE_KEY) !== '0'
      if (typeof ResizeObserver !== 'undefined' && this.$refs.pageRoot) {
        this.pageResizeObserver = new ResizeObserver(([entry]) => {
          this.pageWidth = entry.contentRect.width
        })
        this.pageResizeObserver.observe(this.$refs.pageRoot)
      }
      window.addEventListener('keydown', this.handleKeyboardShortcut)
      window.addEventListener(SUPPORT_DRAFT_STATE_CHANGED_EVENT, this.handleDraftStateWindowEvent)
    }
    await this.initProjectContext()

    if (import.meta.client) {
      window.addEventListener(ACTIVE_PROJECT_CHANGED_EVENT, this.handleActiveProjectChanged)
      this.activeProjectListenerReady = true
      this.unregisterReconnectHook = this.$realtime.onReconnect(this.handleRealtimeReconnect)
    }
  },

  beforeUnmount() {
    this.pageResizeObserver?.disconnect()
    if (import.meta.client) {
      window.removeEventListener('keydown', this.handleKeyboardShortcut)
      window.removeEventListener(ACTIVE_PROJECT_CHANGED_EVENT, this.handleActiveProjectChanged)
      window.removeEventListener(SUPPORT_DRAFT_STATE_CHANGED_EVENT, this.handleDraftStateWindowEvent)
    }
    if (this.unregisterReconnectHook) this.unregisterReconnectHook()
    if (this.unsubscribeInboxChannel) this.unsubscribeInboxChannel()
    if (this.unsubscribeConversationChannel) this.unsubscribeConversationChannel()
    if (this.conversationSearchDebounceTimer) clearTimeout(this.conversationSearchDebounceTimer)
  },

  methods: {
    handleKeyboardShortcut(event) {
      if (event.key === 'Escape' && this.showShortcutHelp) {
        event.preventDefault()
        this.showShortcutHelp = false
        return
      }
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      if (isSupportShortcutEditableTarget(event.target)) return

      const action = getSupportShortcutAction(event.key)
      if (!action) return
      event.preventDefault()

      if (action === 'next' || action === 'previous') {
        this.navigateConversations(action === 'next' ? 1 : -1)
      } else if (action === 'reply' || action === 'note') {
        this.setComposerMode(action)
      } else if (action === 'claim') {
        void this.claimConversation()
      } else if (action === 'resolve') {
        void this.patchConversation({ status: 'resolved' })
      } else if (action === 'delete') {
        if (!this.conversationDetail?.deletedAt) void this.patchConversation({ deleted: true })
      } else if (action === 'spam') {
        if (!this.conversationDetail?.spamAt && !this.conversationDetail?.deletedAt)
          void this.patchConversation({ spam: true })
      } else if (action === 'search') {
        this.focusConversationSearch()
      } else if (action === 'details') {
        if (this.selectedConversationId) this.toggleDetails()
      } else if (action === 'help') {
        this.showShortcutHelp = !this.showShortcutHelp
      }
    },

    navigateConversations(direction) {
      const nextConversationId = getNextSupportConversationId(
        this.conversations.map((conversation) => conversation.id),
        this.selectedConversationId,
        direction
      )
      if (!nextConversationId || nextConversationId === this.selectedConversationId) return
      void this.selectConversation(nextConversationId)
    },

    setComposerMode(mode) {
      const composer = this.$refs.composer
      if (!composer || typeof composer.setMode !== 'function') return
      composer.setMode(mode)
      this.$nextTick(() => composer.$refs?.input?.focus?.())
    },

    focusConversationSearch() {
      if (!import.meta.client) return
      const input = document.querySelector('[data-testid="support-conversation-search"]')
      input?.focus?.()
    },

    async handleActiveProjectChanged() {
      this.resetInboxState()
      await this.initProjectContext()
    },

    resetInboxState() {
      this.contextGeneration += 1
      if (this.unsubscribeInboxChannel) {
        this.unsubscribeInboxChannel()
        this.unsubscribeInboxChannel = null
      }
      if (this.unsubscribeConversationChannel) {
        this.unsubscribeConversationChannel()
        this.unsubscribeConversationChannel = null
      }
      this.inboxes = []
      this.currentUserId = ''
      this.currentUserName = ''
      this.activeInboxId = null
      this.inboxMembers = []
      this.addresses = []
      this.activeAddressId = null
      this.activeView = DEFAULT_VIEW
      this.tags = []
      this.activeTagId = null
      this.conversationTags = []
      this.inboxSendingAddress = null
      this.conversationSearch = ''
      this.csatFilter = 'all'
      this.csatSummary = null
      if (this.conversationSearchDebounceTimer) {
        clearTimeout(this.conversationSearchDebounceTimer)
        this.conversationSearchDebounceTimer = null
      }
      this.conversations = []
      this.unreadCounts = { ...EMPTY_UNREAD_COUNTS }
      this.conversationDraftIds = []
      this.contactCache = {}
      this.selectedConversationId = null
      this.conversationDetail = null
      this.conversationContact = null
      this.messages = []
      this.resetContactPanel()
    },

    async initProjectContext() {
      const generation = this.contextGeneration
      this.isLoadingProject = true
      this.projectError = null

      try {
        // Shared cache: a warm navigation resolves at once; session loads alongside.
        const sessionPromise = $fetch('/api/auth/session')
        sessionPromise.catch(() => {})
        const activeContext = await loadActiveProject()
        const activeProjectData = activeContext?.project

        if (!activeProjectData?.id) {
          if (generation === this.contextGeneration) {
            this.projectError = 'No active project found'
            this.isLoadingProject = false
          }
          return
        }

        if (generation !== this.contextGeneration) return
        this.activeProjectId = activeProjectData.id
        this.activeProject = activeProjectData
        this.activeProjectProducts = activeContext.products || []
        this.supportDisabled = activeContext.modules?.supportEnabled === false
        if (this.supportDisabled) {
          this.isLoadingProject = false
          return
        }
        const sessionResponse = await sessionPromise
        if (generation !== this.contextGeneration) return
        this.currentUserId = sessionResponse?.data?.user?.id || ''
        this.currentUserName = sessionResponse?.data?.user?.name || sessionResponse?.data?.user?.email || ''
        this.isLoadingProject = false
        await this.loadInboxes({ generation, projectId: activeProjectData.id })
      } catch {
        if (generation === this.contextGeneration) {
          this.projectError = 'Something went wrong. Please try again.'
          this.isLoadingProject = false
        }
      }
    },

    isCurrentContext(generation, projectId, inboxId = null) {
      return (
        generation === this.contextGeneration &&
        this.activeProjectId === projectId &&
        (!inboxId || this.activeInboxId === inboxId)
      )
    },

    isCurrentConversation(generation, projectId, inboxId, conversationId) {
      return this.isCurrentContext(generation, projectId, inboxId) && this.selectedConversationId === conversationId
    },

    async loadInboxes({
      recovering = false,
      generation = this.contextGeneration,
      projectId = this.activeProjectId,
    } = {}) {
      if (!projectId || !this.isCurrentContext(generation, projectId)) return

      this.isLoadingInboxes = true
      this.inboxesError = null
      if (!recovering) this.inboxAccessError = null

      try {
        const response = await $fetch('/api/support/inboxes', { params: { projectId } })
        if (!this.isCurrentContext(generation, projectId)) return
        this.inboxes = response?.data?.inboxes || []

        const requestedInboxId = this.$route.query.inboxId
        const initialInboxId =
          (typeof requestedInboxId === 'string' && this.inboxes.some((i) => i.id === requestedInboxId)
            ? requestedInboxId
            : null) ||
          this.inboxes[0]?.id ||
          null

        if (initialInboxId) {
          await this.selectInbox(initialInboxId, { generation, projectId, useRouteView: true })
          // Deep link from a conversation_assigned notification
          // (`/inbox?conversationId=…`). Opened after the inbox loads,
          // because selectInbox clears any current selection.
          if (this.isCurrentContext(generation, projectId)) await this.openRequestedConversation()
        }
      } catch (error) {
        if (!this.isCurrentContext(generation, projectId)) return
        if (this.isForbiddenError(error)) {
          this.inboxes = []
          this.activeInboxId = null
          this.inboxMembers = []
          if (!recovering) this.inboxAccessError = 'You do not have access to this inbox'
          return
        }
        this.inboxesError = 'Failed to load inboxes. Please try again.'
      } finally {
        if (this.isCurrentContext(generation, projectId)) this.isLoadingInboxes = false
      }
    },

    async selectInbox(
      inboxId,
      { generation = this.contextGeneration, projectId = this.activeProjectId, useRouteView = false } = {}
    ) {
      if (!inboxId || inboxId === this.activeInboxId) return
      if (!this.isCurrentContext(generation, projectId)) return

      if (this.unsubscribeInboxChannel) {
        this.unsubscribeInboxChannel()
        this.unsubscribeInboxChannel = null
      }
      this.unselectConversation()

      this.activeInboxId = inboxId
      this.inboxAccessError = null
      this.activeView = useRouteView ? this.normalizeSupportView(this.$route.query.view) : DEFAULT_VIEW
      this.addresses = []
      this.inboxSendingAddress = null
      this.activeTagId = useRouteView && typeof this.$route.query.tag === 'string' ? this.$route.query.tag : null
      this.activeAddressId =
        useRouteView && typeof this.$route.query.address === 'string' ? this.$route.query.address : null
      this.conversationSearch = useRouteView ? this.normalizeConversationSearch(this.$route.query.search) : ''
      this.csatFilter = useRouteView ? this.normalizeCsatFilter(this.$route.query.csat) : 'all'

      if (import.meta.client) {
        this.$router
          .replace({
            query: {
              ...this.$route.query,
              inboxId,
              view: this.activeView === DEFAULT_VIEW ? undefined : this.activeView,
              address: this.activeAddressId || undefined,
              tag: this.activeTagId || undefined,
              search: this.conversationSearch || undefined,
              csat: this.csatFilter === 'all' ? undefined : this.csatFilter,
            },
          })
          .catch(() => {})
      }

      await Promise.all([
        this.loadInboxMembers({ generation, projectId, inboxId }),
        this.loadAddresses({ generation, projectId, inboxId }),
        this.loadTags({ generation, projectId, inboxId }),
        this.loadConversations(true, { generation, projectId, inboxId }),
        this.loadCsatSummary({ generation, projectId }),
      ])
      if (this.isCurrentContext(generation, projectId, inboxId)) this.subscribeInbox()
    },

    isForbiddenError(error) {
      return error?.statusCode === 403 || error?.status === 403 || error?.response?.status === 403
    },

    async recoverFromForbiddenInbox({
      generation = this.contextGeneration,
      projectId = this.activeProjectId,
      inboxId = null,
    } = {}) {
      if (!this.isCurrentContext(generation, projectId, inboxId)) return
      this.unselectConversation()
      this.activeInboxId = null
      this.inboxMembers = []
      this.conversations = []
      this.contactCache = {}
      if (import.meta.client) {
        await this.$router
          .replace({ query: { ...this.$route.query, inboxId: undefined, conversationId: undefined } })
          .catch(() => {})
      }
      await this.loadInboxes({ recovering: true, generation, projectId })
      if (this.isCurrentContext(generation, projectId)) this.inboxAccessError = 'You do not have access to this inbox'
    },

    async openRequestedConversation() {
      const requested = this.$route.query.conversationId
      if (typeof requested !== 'string' || !requested) return
      if (this.selectedConversationId === requested) return

      // The target may sit beyond the first page of the list, or in a
      // different inbox than the one that opened, so select it directly rather
      // than looking it up in `this.conversations`. selectConversation surfaces
      // its own error state if the id is unreadable.
      await this.selectConversation(requested)
    },

    async loadInboxMembers({
      generation = this.contextGeneration,
      projectId = this.activeProjectId,
      inboxId = this.activeInboxId,
    } = {}) {
      if (!inboxId || !this.isCurrentContext(generation, projectId, inboxId)) return
      try {
        const response = await $fetch(`/api/support/inboxes/${inboxId}/members`)
        if (!this.isCurrentContext(generation, projectId, inboxId)) return
        this.inboxMembers = response?.data?.members || []
      } catch (error) {
        if (!this.isCurrentContext(generation, projectId, inboxId)) return
        this.inboxMembers = []
        if (this.isForbiddenError(error)) await this.recoverFromForbiddenInbox({ generation, projectId, inboxId })
      }
    },

    async loadAddresses({
      generation = this.contextGeneration,
      projectId = this.activeProjectId,
      inboxId = this.activeInboxId,
    } = {}) {
      if (!inboxId || !this.isCurrentContext(generation, projectId, inboxId)) return
      try {
        const response = await $fetch(`/api/support/inboxes/${inboxId}/addresses`)
        if (!this.isCurrentContext(generation, projectId, inboxId)) return
        this.addresses = response?.data?.addresses || []
        this.inboxSendingAddress = response?.data?.inboxSendingAddress || this.activeInbox?.emailAddress || null
        // A stale ?address= from the URL must not filter the list by an address this inbox no longer has.
        if (this.activeAddressId && !this.addresses.some((address) => address.id === this.activeAddressId)) {
          this.activeAddressId = null
          await this.loadConversations(true, { generation, projectId, inboxId })
        }
      } catch {
        // The Addresses group is a convenience filter: without it the inbox still works.
        if (this.isCurrentContext(generation, projectId, inboxId)) this.addresses = []
      }
    },

    async selectAddress(addressId) {
      const nextId = addressId || null
      if (nextId === this.activeAddressId) return
      this.unselectConversation()
      this.activeAddressId = nextId
      if (import.meta.client) {
        await this.$router
          .replace({ query: { ...this.$route.query, address: nextId || undefined, conversationId: undefined } })
          .catch(() => {})
      }
      await this.loadConversations(true)
    },

    async selectTag(tagId) {
      const nextId = tagId || null
      if (nextId === this.activeTagId) return
      this.unselectConversation()
      this.activeTagId = nextId
      if (import.meta.client) {
        await this.$router
          .replace({ query: { ...this.$route.query, tag: nextId || undefined, conversationId: undefined } })
          .catch(() => {})
      }
      await this.loadConversations(true)
    },

    async loadTags({
      generation = this.contextGeneration,
      projectId = this.activeProjectId,
      inboxId = this.activeInboxId,
    } = {}) {
      if (!projectId || !this.isCurrentContext(generation, projectId, inboxId)) return
      try {
        const response = await $fetch('/api/support/tags', { params: { projectId } })
        if (!this.isCurrentContext(generation, projectId, inboxId)) return
        this.tags = response?.data?.tags || []
        if (this.activeTagId && !this.tags.some((tag) => tag.id === this.activeTagId)) {
          this.activeTagId = null
          await this.loadConversations(true, { generation, projectId, inboxId })
        }
      } catch {
        // Tags are a filter and a label: the inbox works without them.
        if (this.isCurrentContext(generation, projectId, inboxId)) this.tags = []
      }
    },

    async loadConversationTags({
      generation = this.contextGeneration,
      projectId = this.activeProjectId,
      inboxId = this.activeInboxId,
      conversationId = this.selectedConversationId,
    } = {}) {
      if (!conversationId || !this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return
      try {
        const response = await $fetch(`/api/support/conversations/${conversationId}/tags`)
        if (this.isCurrentConversation(generation, projectId, inboxId, conversationId)) {
          this.conversationTags = response?.data?.tags || []
        }
      } catch {
        if (this.isCurrentConversation(generation, projectId, inboxId, conversationId)) this.conversationTags = []
      }
    },

    async addConversationTag(tagId) {
      await this.changeConversationTag(tagId, 'add')
    },

    async removeConversationTag(tagId) {
      await this.changeConversationTag(tagId, 'remove')
    },

    async changeConversationTag(tagId, change) {
      const conversationId = this.selectedConversationId
      if (!conversationId || !tagId || this.conversationTagsBusy) return
      const context = {
        generation: this.contextGeneration,
        projectId: this.activeProjectId,
        inboxId: this.activeInboxId,
        conversationId,
      }
      this.conversationTagsBusy = true
      try {
        if (change === 'add') {
          await $fetch(`/api/support/conversations/${conversationId}/tags`, { method: 'POST', body: { tagId } })
        } else {
          await $fetch(`/api/support/conversations/${conversationId}/tags/${tagId}`, { method: 'DELETE' })
        }
        await Promise.all([this.loadConversationTags(context), this.loadMessages(context)])
      } catch (error) {
        if (this.isCurrentConversation(context.generation, context.projectId, context.inboxId, conversationId)) {
          toast.error(error?.data?.error?.message || 'Failed to update tags')
        }
      } finally {
        this.conversationTagsBusy = false
      }
    },

    async createTag(name) {
      if (!this.activeProjectId) return
      const generation = this.contextGeneration
      const projectId = this.activeProjectId
      const inboxId = this.activeInboxId
      if (!this.isCurrentContext(generation, projectId, inboxId)) return
      try {
        await $fetch('/api/support/tags', {
          method: 'POST',
          body: { projectId, name },
        })
        await this.loadTags({ generation, projectId, inboxId })
      } catch (error) {
        if (!this.isCurrentContext(generation, projectId, inboxId)) return
        if (this.isForbiddenError(error)) {
          await this.recoverFromForbiddenInbox({ generation, projectId, inboxId })
          return
        }
        toast.error(error?.data?.error?.message || 'Failed to create tag')
      }
    },

    normalizeSupportView(value) {
      return typeof value === 'string' && SUPPORT_VIEWS.includes(value) ? value : DEFAULT_VIEW
    },

    normalizeConversationSearch(value) {
      if (typeof value !== 'string') return ''
      return value.trim().slice(0, 200)
    },

    normalizeCsatFilter(value) {
      return typeof value === 'string' && CSAT_FILTERS.includes(value) ? value : 'all'
    },

    async selectView(view) {
      const nextView = this.normalizeSupportView(view)
      if (nextView === this.activeView) return

      this.unselectConversation()
      this.activeView = nextView

      if (import.meta.client) {
        await this.$router
          .replace({
            query: {
              ...this.$route.query,
              view: nextView === DEFAULT_VIEW ? undefined : nextView,
              conversationId: undefined,
              search: this.conversationSearch || undefined,
              csat: this.csatFilter === 'all' ? undefined : this.csatFilter,
            },
          })
          .catch(() => {})
      }

      await this.loadConversations(true)
    },

    async loadConversations(
      reset,
      { generation = this.contextGeneration, projectId = this.activeProjectId, inboxId = this.activeInboxId } = {}
    ) {
      if (!inboxId || !this.isCurrentContext(generation, projectId, inboxId)) return

      if (reset) {
        this.isLoadingConversations = true
        this.conversationsNextCursor = null
      } else {
        this.isLoadingMoreConversations = true
      }
      this.conversationsError = null

      try {
        const response = await $fetch('/api/support/conversations', {
          params: {
            inboxId,
            view: this.activeView,
            mailAddressId: this.activeAddressId || undefined,
            tagId: this.activeTagId || undefined,
            search: this.conversationSearch || undefined,
            csat: this.csatFilter === 'all' ? undefined : this.csatFilter,
            limit: 25,
            cursor: reset ? undefined : this.conversationsNextCursor || undefined,
          },
        })

        if (!this.isCurrentContext(generation, projectId, inboxId)) return
        const page = response?.data?.conversations || []
        this.conversations = reset ? page : [...this.conversations, ...page]
        this.unreadCounts = { ...EMPTY_UNREAD_COUNTS, ...(response?.data?.unreadCounts || {}) }
        this.hasMoreConversations = Boolean(response?.data?.hasMore)
        this.conversationsNextCursor = response?.data?.nextCursor || null
        this.syncConversationDraftIndicators()

        await this.ensureContactsLoaded(
          page.map((c) => c.contactId),
          { generation, projectId, inboxId }
        )
      } catch (error) {
        if (!this.isCurrentContext(generation, projectId, inboxId)) return
        if (this.isForbiddenError(error)) {
          await this.recoverFromForbiddenInbox({ generation, projectId, inboxId })
          return
        }
        this.conversationsError = 'Failed to load conversations. Please try again.'
      } finally {
        if (this.isCurrentContext(generation, projectId, inboxId)) {
          this.isLoadingConversations = false
          this.isLoadingMoreConversations = false
        }
      }
    },

    async loadCsatSummary({ generation = this.contextGeneration, projectId = this.activeProjectId } = {}) {
      if (!projectId || !this.isCurrentContext(generation, projectId)) return
      try {
        const response = await $fetch(`/api/support/projects/${projectId}/csat-summary`)
        if (!this.isCurrentContext(generation, projectId)) return
        this.csatSummary = response?.data || null
      } catch {
        if (this.isCurrentContext(generation, projectId)) this.csatSummary = null
      }
    },

    async applyConversationSearch() {
      if (!this.activeInboxId) return

      if (import.meta.client) {
        await this.$router
          .replace({
            query: {
              ...this.$route.query,
              search: this.conversationSearch || undefined,
            },
          })
          .catch(() => {})
      }

      await this.loadConversations(true)
    },

    handleConversationSearch(value) {
      this.conversationSearch = this.normalizeConversationSearch(value)
      if (this.conversationSearchDebounceTimer) clearTimeout(this.conversationSearchDebounceTimer)
      this.conversationSearchDebounceTimer = setTimeout(() => {
        this.conversationSearchDebounceTimer = null
        this.applyConversationSearch()
      }, 250)
    },

    async handleCsatFilter(value) {
      const nextFilter = this.normalizeCsatFilter(value)
      if (nextFilter === this.csatFilter) return
      this.csatFilter = nextFilter
      this.unselectConversation()
      if (import.meta.client) {
        await this.$router
          .replace({
            query: {
              ...this.$route.query,
              csat: nextFilter === 'all' ? undefined : nextFilter,
              conversationId: undefined,
            },
          })
          .catch(() => {})
      }
      await this.loadConversations(true)
    },

    async clearConversationSearch() {
      if (this.conversationSearchDebounceTimer) {
        clearTimeout(this.conversationSearchDebounceTimer)
        this.conversationSearchDebounceTimer = null
      }
      if (!this.conversationSearch) return
      this.conversationSearch = ''
      await this.applyConversationSearch()
    },

    draftKey(conversationId, mode) {
      return `${DRAFT_STORAGE_PREFIX}:${conversationId}:${mode}`
    },

    storageGet(key) {
      if (!import.meta.client) return null
      try {
        return window.localStorage.getItem(key)
      } catch {
        return null
      }
    },

    storageSet(key, value) {
      if (!import.meta.client) return
      try {
        window.localStorage.setItem(key, value)
      } catch {
        // Private windows and blocked storage: the preference just isn't remembered.
      }
    },

    conversationHasDraft(conversationId) {
      if (!conversationId) return false
      return DRAFT_MODES.some((mode) => (this.storageGet(this.draftKey(conversationId, mode)) || '').trim().length > 0)
    },

    syncConversationDraftIndicators() {
      if (!import.meta.client) return
      this.conversationDraftIds = this.conversations
        .map((item) => item.id)
        .filter((conversationId) => this.conversationHasDraft(conversationId))
    },

    setConversationDraftIndicator(conversationId, hasDraft) {
      if (!conversationId) return
      const ids = new Set(this.conversationDraftIds)
      if (hasDraft) ids.add(conversationId)
      else ids.delete(conversationId)
      this.conversationDraftIds = [...ids]
    },

    handleDraftStateChanged({ conversationId, hasDraft }) {
      this.setConversationDraftIndicator(conversationId, Boolean(hasDraft))
    },

    handleDraftStateWindowEvent(event) {
      const detail = event?.detail
      if (!detail || typeof detail.conversationId !== 'string') return
      this.setConversationDraftIndicator(detail.conversationId, Boolean(detail.hasDraft))
    },

    async ensureContactsLoaded(
      contactIds,
      { generation = this.contextGeneration, projectId = this.activeProjectId, inboxId = this.activeInboxId } = {}
    ) {
      if (!this.isCurrentContext(generation, projectId, inboxId)) return
      // Retry ids never fetched, or whose last fetch failed. A resolved-but-null
      // contact stays cached as null so it is not re-requested on every render.
      const uniqueIds = [...new Set(contactIds)].filter((id) => {
        if (!id) return false
        const cached = this.contactCache[id]
        return cached === undefined || cached === 'error'
      })
      if (uniqueIds.length === 0) return

      for (const id of uniqueIds) {
        if (!this.isCurrentContext(generation, projectId, inboxId)) return
        this.contactCache[id] = 'loading'
      }

      await Promise.all(
        uniqueIds.map(async (id) => {
          try {
            const response = await $fetch(`/api/support/contacts/${id}`)
            if (!this.isCurrentContext(generation, projectId, inboxId)) return
            this.contactCache[id] = response?.data?.contact || null
          } catch (error) {
            if (!this.isCurrentContext(generation, projectId, inboxId)) return
            if (this.isForbiddenError(error)) {
              await this.recoverFromForbiddenInbox({ generation, projectId, inboxId })
              return
            }
            // Sentinel rather than `delete` - a dynamic delete is a lint error,
            // and this keeps the id retryable on the next enrich pass.
            this.contactCache[id] = 'error'
          }
        })
      )
    },

    async closeInboxSheetAfter(pending) {
      this.showInboxSheet = false
      await pending
    },

    unselectConversation() {
      if (this.unsubscribeConversationChannel) {
        this.unsubscribeConversationChannel()
        this.unsubscribeConversationChannel = null
      }
      this.selectedConversationId = null
      this.conversationDetail = null
      this.conversationContact = null
      this.messages = []
      this.messagesError = null
      this.detailError = null
      this.conversationTags = []
      this.resetContactPanel()
    },

    async selectConversation(conversationId) {
      if (!conversationId || conversationId === this.selectedConversationId) return
      const generation = this.contextGeneration
      const projectId = this.activeProjectId
      const inboxId = this.activeInboxId
      if (!this.isCurrentContext(generation, projectId, inboxId)) return

      if (this.unsubscribeConversationChannel) {
        this.unsubscribeConversationChannel()
        this.unsubscribeConversationChannel = null
      }

      this.selectedConversationId = conversationId
      this.resetContactPanel()

      if (import.meta.client) {
        this.$router.replace({ query: { ...this.$route.query, conversationId } }).catch(() => {})
      }

      this.subscribeConversation(conversationId)

      await this.updateConversationReadState(false, { generation, projectId, inboxId, conversationId })
      await Promise.all([
        this.loadConversationDetail({ generation, projectId, inboxId, conversationId }),
        this.loadMessages({ generation, projectId, inboxId, conversationId }),
        this.loadConversationTags({ generation, projectId, inboxId, conversationId }),
        this.loadConversations(true, { generation, projectId, inboxId }),
      ])
    },

    async updateConversationReadState(isUnread, context) {
      const { generation, projectId, inboxId, conversationId } = context
      if (!this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return

      try {
        await $fetch(`/api/support/conversations/${conversationId}/read-state`, {
          method: 'PUT',
          body: { isUnread },
        })
      } catch (error) {
        if (!this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return
        if (this.isForbiddenError(error)) {
          await this.recoverFromForbiddenInbox({ generation, projectId, inboxId })
          return
        }
        alert(error?.data?.error?.message || 'Failed to update read state')
      }
    },

    async markConversationUnread() {
      const context = {
        generation: this.contextGeneration,
        projectId: this.activeProjectId,
        inboxId: this.activeInboxId,
        conversationId: this.selectedConversationId,
      }
      if (!this.isCurrentConversation(context.generation, context.projectId, context.inboxId, context.conversationId))
        return

      this.isUpdatingConversation = true
      try {
        await this.updateConversationReadState(true, context)
        if (!this.isCurrentConversation(context.generation, context.projectId, context.inboxId, context.conversationId))
          return
        await Promise.all([this.loadConversationDetail(context), this.loadConversations(true, context)])
      } finally {
        if (this.isCurrentConversation(context.generation, context.projectId, context.inboxId, context.conversationId))
          this.isUpdatingConversation = false
      }
    },

    async loadConversationDetail({
      generation = this.contextGeneration,
      projectId = this.activeProjectId,
      inboxId = this.activeInboxId,
      conversationId = this.selectedConversationId,
    } = {}) {
      if (
        !conversationId ||
        !this.isCurrentContext(generation, projectId, inboxId) ||
        conversationId !== this.selectedConversationId
      )
        return

      this.isLoadingDetail = true
      this.detailError = null

      try {
        const response = await $fetch(`/api/support/conversations/${conversationId}`)
        if (!this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return
        this.conversationDetail = response?.data?.conversation || null
        this.conversationContact = response?.data?.contact || null

        if (this.conversationContact?.id) {
          // The contact sidebar is secondary; a slow history request must not
          // keep the conversation and composer behind the detail skeleton.
          void this.loadContactPanel({ generation, projectId, inboxId, conversationId }).catch(() => {
            if (!this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return
            this.contactPanelError = 'Failed to load contact details. Please try again.'
            this.contactPanelLoading = false
          })
        }
      } catch (error) {
        if (this.isForbiddenError(error)) {
          if (this.isCurrentConversation(generation, projectId, inboxId, conversationId))
            await this.recoverFromForbiddenInbox({ generation, projectId, inboxId })
          return
        }
        if (!this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return
        this.detailError = 'Failed to load this conversation. Please try again.'
      } finally {
        if (this.isCurrentConversation(generation, projectId, inboxId, conversationId)) this.isLoadingDetail = false
      }
    },

    async loadMessages({
      generation = this.contextGeneration,
      projectId = this.activeProjectId,
      inboxId = this.activeInboxId,
      conversationId = this.selectedConversationId,
    } = {}) {
      if (
        !conversationId ||
        !this.isCurrentContext(generation, projectId, inboxId) ||
        conversationId !== this.selectedConversationId
      )
        return

      this.isLoadingMessages = true
      this.messagesError = null

      try {
        const response = await $fetch(`/api/support/conversations/${conversationId}/messages`)
        if (!this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return
        const items = response?.data?.messages || []
        this.messages = [...items].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        this.scrollMessagesToBottom()
      } catch (error) {
        if (this.isForbiddenError(error)) {
          if (this.isCurrentConversation(generation, projectId, inboxId, conversationId))
            await this.recoverFromForbiddenInbox({ generation, projectId, inboxId })
          return
        }
        if (!this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return
        this.messagesError = 'Could not load messages. Please try again.'
        this.messages = []
      } finally {
        if (this.isCurrentConversation(generation, projectId, inboxId, conversationId)) this.isLoadingMessages = false
      }
    },

    scrollMessagesToBottom() {
      if (!import.meta.client) return
      this.$nextTick(() => {
        const el = this.$el?.querySelector?.('[data-testid="support-conversation-thread-scroll"]')
        if (el) el.scrollTop = el.scrollHeight
      })
    },

    async patchConversation(patch) {
      if (!this.selectedConversationId || this.isUpdatingConversation) return
      const generation = this.contextGeneration
      const projectId = this.activeProjectId
      const inboxId = this.activeInboxId
      const conversationId = this.selectedConversationId
      if (!this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return

      const before = this.conversationDetail
      const nextId = this.neighbourConversationId(conversationId)
      this.isUpdatingConversation = true
      try {
        const response = await $fetch(`/api/support/conversations/${conversationId}`, {
          method: 'PATCH',
          body: patch,
        })
        const updated = response?.data?.conversation || null
        if (this.isCurrentConversation(generation, projectId, inboxId, conversationId) && updated) {
          this.conversationDetail = updated
        }
        // Resolving, archiving or moving a conversation to a folder takes it out
        // of the current view: move on to the next one (or back to the list on a
        // single pane) rather than leave open a thread the list no longer shows.
        if (this.leavesView(updated || { ...before, ...patch })) {
          if (!this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return
          // The `finally` below only resets this while the conversation is still selected.
          this.isUpdatingConversation = false
          this.offerUndo(before, patch)
          await this.advanceFrom(conversationId, nextId, { generation, projectId, inboxId })
          return
        }
        // The PATCH writes an `activity` message server-side describing the
        // change - reload the thread and list so it appears without waiting
        // on the realtime round-trip for the agent's own action.
        if (!this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return
        await Promise.all([
          this.loadMessages({ generation, projectId, inboxId, conversationId }),
          this.loadConversations(true, { generation, projectId, inboxId }),
        ])
      } catch (err) {
        if (!this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return
        if (this.isForbiddenError(err)) {
          await this.recoverFromForbiddenInbox({ generation, projectId, inboxId })
          return
        }
        toast.error(err?.data?.error?.message || 'Failed to update this conversation')
      } finally {
        if (this.isCurrentConversation(generation, projectId, inboxId, conversationId))
          this.isUpdatingConversation = false
      }
    },

    /** True when the current view no longer lists a conversation in this state. */
    leavesView(state) {
      if (!state) return false
      const view = this.activeView
      if (view === 'trash') return !state.deletedAt
      if (state.deletedAt) return true
      if (view === 'spam') return !state.spamAt
      if (state.spamAt) return true
      if (view === 'all') return false
      if (WORKING_VIEWS.includes(view)) return !['open', 'pending'].includes(state.status)
      const viewStatus = { snoozed: 'snoozed', resolved: 'resolved', archived: 'closed' }[view]
      return Boolean(viewStatus) && state.status !== viewStatus
    },

    /** The conversation the list would show next after this one leaves it. */
    neighbourConversationId(conversationId) {
      const ids = this.conversations.map((conversation) => conversation.id)
      const index = ids.indexOf(conversationId)
      if (index === -1) return null
      return ids[index + 1] || ids[index - 1] || null
    },

    /** Below @2xl the list and thread share one pane: after an action, go back to the list. */
    isSinglePane() {
      return this.pageWidth !== null && this.pageWidth < 672
    },

    async advanceFrom(conversationId, nextId, { generation, projectId, inboxId }) {
      if (!this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return
      this.unselectConversation()
      if (nextId && !this.isSinglePane()) {
        await this.selectConversation(nextId)
        return
      }
      if (import.meta.client) {
        this.$router.replace({ query: { ...this.$route.query, conversationId: undefined } }).catch(() => {})
      }
      await this.loadConversations(true, { generation, projectId, inboxId })
    },

    /** Toast for an action that moved a conversation out of the view, with a one-click undo. */
    offerUndo(before, patch) {
      if (!before?.id) return
      const label = before.behaviour === 'mail' ? 'Mail' : `#${before.displayId}`
      let message = ''
      const undo = {}
      if ('deleted' in patch) {
        message = patch.deleted ? `Moved ${label} to Trash` : `Restored ${label}`
        undo.deleted = !patch.deleted
      } else if ('spam' in patch) {
        message = patch.spam ? `Marked ${label} as spam` : `Moved ${label} out of Spam`
        undo.spam = !patch.spam
      } else if (patch.status) {
        const verbs = {
          resolved: 'Resolved',
          closed: 'Archived',
          snoozed: 'Snoozed',
          open: 'Reopened',
          pending: 'Updated',
        }
        message =
          before.behaviour === 'mail' && patch.status === 'resolved'
            ? 'Marked done'
            : `${verbs[patch.status] || 'Updated'} ${label}`
        undo.status = before.status
      } else {
        return
      }
      toast(message, {
        action: { label: 'Undo', onClick: () => void this.patchConversationById(before.id, undo) },
      })
    },

    /** PATCH a conversation that may not be the selected one (quick actions, undo). */
    async patchConversationById(conversationId, patch) {
      const generation = this.contextGeneration
      const projectId = this.activeProjectId
      const inboxId = this.activeInboxId
      try {
        await $fetch(`/api/support/conversations/${conversationId}`, { method: 'PATCH', body: patch })
      } catch (err) {
        if (!this.isCurrentContext(generation, projectId, inboxId)) return
        if (this.isForbiddenError(err)) {
          await this.recoverFromForbiddenInbox({ generation, projectId, inboxId })
          return
        }
        toast.error(err?.data?.error?.message || 'Failed to update this conversation')
        return
      }
      if (!this.isCurrentContext(generation, projectId, inboxId)) return
      const reloads = [this.loadConversations(true, { generation, projectId, inboxId })]
      if (this.selectedConversationId === conversationId) {
        reloads.push(
          this.loadConversationDetail({ generation, projectId, inboxId, conversationId }),
          this.loadMessages({ generation, projectId, inboxId, conversationId })
        )
      }
      await Promise.all(reloads)
    },

    /** Hover and swipe actions on list rows. */
    async handleQuickAction({ id, action }) {
      if (!id) return
      if (id === this.selectedConversationId) {
        if (action === 'claim') await this.claimConversation()
        else if (action === 'resolve') await this.patchConversation({ status: 'resolved' })
        return
      }
      const before = this.conversations.find((conversation) => conversation.id === id)
      if (action === 'resolve') {
        await this.patchConversationById(id, { status: 'resolved' })
        this.offerUndo(before, { status: 'resolved' })
        return
      }
      if (action === 'claim') {
        const generation = this.contextGeneration
        const projectId = this.activeProjectId
        const inboxId = this.activeInboxId
        try {
          const response = await $fetch(`/api/support/conversations/${id}/claim`, { method: 'POST' })
          if (response?.data?.claimed === false) toast('Another agent claimed this conversation first.')
        } catch (err) {
          if (this.isCurrentContext(generation, projectId, inboxId)) {
            toast.error(err?.data?.error?.message || 'Failed to claim this conversation')
          }
          return
        }
        if (this.isCurrentContext(generation, projectId, inboxId)) {
          await this.loadConversations(true, { generation, projectId, inboxId })
        }
      }
    },

    closeConversation() {
      this.unselectConversation()
      if (import.meta.client) {
        this.$router.replace({ query: { ...this.$route.query, conversationId: undefined } }).catch(() => {})
      }
    },

    toggleDetails() {
      this.setDetailsOpen(!this.showDetails)
    },

    setDetailsOpen(open) {
      this.showDetails = open
      // Remember the choice where the panel sits inline; as a slide-over it always starts closed.
      if (this.detailsInline) this.storageSet(DETAILS_OPEN_STORAGE_KEY, open ? '1' : '0')
    },

    openFeedbackBridgeDialog() {
      if (!this.selectedConversationId || this.conversationDetail?.linkedFeedbackId) return
      this.showFeedbackBridgeDialog = true
    },

    async convertConversationToFeedback(payload) {
      if (!this.selectedConversationId || this.isCreatingFeedback) return

      const generation = this.contextGeneration
      const projectId = this.activeProjectId
      const inboxId = this.activeInboxId
      const conversationId = this.selectedConversationId
      if (!this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return

      this.isCreatingFeedback = true
      try {
        const response = await $fetch(`/api/support/conversations/${conversationId}/feedback`, {
          method: 'POST',
          body: payload,
        })
        if (!this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return

        if (response?.data?.conversation) this.conversationDetail = response.data.conversation
        this.showFeedbackBridgeDialog = false
        await Promise.all([
          this.loadConversationDetail({ generation, projectId, inboxId, conversationId }),
          this.loadMessages({ generation, projectId, inboxId, conversationId }),
          this.loadConversations(true, { generation, projectId, inboxId }),
        ])
      } catch (error) {
        if (!this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return
        if (this.isForbiddenError(error)) {
          await this.recoverFromForbiddenInbox({ generation, projectId, inboxId })
          return
        }
        alert(error?.data?.error?.message || 'Failed to create feedback from this conversation')
      } finally {
        if (this.isCurrentConversation(generation, projectId, inboxId, conversationId)) this.isCreatingFeedback = false
      }
    },

    async linkExistingFeedback(feedbackId) {
      if (!this.selectedConversationId || this.isCreatingFeedback || !feedbackId) return

      const generation = this.contextGeneration
      const projectId = this.activeProjectId
      const inboxId = this.activeInboxId
      const conversationId = this.selectedConversationId
      if (!this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return

      this.isCreatingFeedback = true
      try {
        const response = await $fetch(`/api/support/conversations/${conversationId}/feedback`, {
          method: 'PUT',
          body: { feedbackId },
        })
        if (!this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return

        if (response?.data?.conversation) this.conversationDetail = response.data.conversation
        this.showFeedbackBridgeDialog = false
        await Promise.all([
          this.loadConversationDetail({ generation, projectId, inboxId, conversationId }),
          this.loadMessages({ generation, projectId, inboxId, conversationId }),
          this.loadConversations(true, { generation, projectId, inboxId }),
        ])
      } catch (error) {
        if (!this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return
        if (this.isForbiddenError(error)) {
          await this.recoverFromForbiddenInbox({ generation, projectId, inboxId })
          return
        }
        alert(error?.data?.error?.message || 'Failed to link this feedback')
      } finally {
        if (this.isCurrentConversation(generation, projectId, inboxId, conversationId)) this.isCreatingFeedback = false
      }
    },

    async claimConversation() {
      if (!this.selectedConversationId || this.isUpdatingConversation) return
      const generation = this.contextGeneration
      const projectId = this.activeProjectId
      const inboxId = this.activeInboxId
      const conversationId = this.selectedConversationId
      if (!this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return

      this.isUpdatingConversation = true
      try {
        const response = await $fetch(`/api/support/conversations/${conversationId}/claim`, { method: 'POST' })
        if (!this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return
        if (response?.data?.conversation) this.conversationDetail = response.data.conversation
        if (response?.data?.claimed === false) alert('This conversation was claimed by another agent.')

        await Promise.all([
          this.loadMessages({ generation, projectId, inboxId, conversationId }),
          this.loadConversations(true, { generation, projectId, inboxId }),
        ])
      } catch (err) {
        if (!this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return
        if (this.isForbiddenError(err)) {
          await this.recoverFromForbiddenInbox({ generation, projectId, inboxId })
          return
        }
        alert(err?.data?.error?.message || 'Failed to claim this conversation')
      } finally {
        if (this.isCurrentConversation(generation, projectId, inboxId, conversationId))
          this.isUpdatingConversation = false
      }
    },

    async handleMessagePosted({ resolved = false, behaviour = null } = {}) {
      const generation = this.contextGeneration
      const projectId = this.activeProjectId
      const inboxId = this.activeInboxId
      const conversationId = this.selectedConversationId
      if (!this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return

      const before = this.conversationDetail
      if (behaviour) {
        toast(behaviour === 'helpdesk' ? `Sent · now support case #${before?.displayId}` : 'Sent · now plain mail')
      }
      if (resolved && this.leavesView({ ...before, status: 'resolved' })) {
        const nextId = this.neighbourConversationId(conversationId)
        this.offerUndo({ ...before, behaviour: behaviour || before?.behaviour }, { status: 'resolved' })
        await this.advanceFrom(conversationId, nextId, { generation, projectId, inboxId })
        return
      }

      // An outgoing reply may have auto-claimed the conversation in the same
      // transaction as the message. Refresh all three views immediately so
      // the owner shown in the header/list does not lag behind the thread.
      await Promise.all([
        this.loadConversationDetail({ generation, projectId, inboxId, conversationId }),
        this.loadMessages({ generation, projectId, inboxId, conversationId }),
        this.loadConversations(true, { generation, projectId, inboxId }),
      ])
    },

    resetContactPanel() {
      this.invalidateTimelineRequests()
      this.contactPanelContact = null
      this.contactPanelCompany = null
      this.contactPanelError = null
      this.timelineLinked = []
      this.timelineProbableFeedback = []
      this.timelineLinkedLoading = false
      this.timelineProbableLoading = false
      this.timelineLinkedMoreLoading = false
      this.timelineProbableMoreLoading = false
      this.timelineLinkedHasMore = false
      this.timelineProbableHasMore = false
      this.timelineLinkedCursor = null
      this.timelineProbableCursor = null
      this.timelineLinkedError = null
      this.timelineProbableError = null
      this.timelineLinkedMoreError = null
      this.timelineProbableMoreError = null
      this.previousConversations = []
    },

    invalidateTimelineRequests() {
      this.timelineGeneration += 1
      this.timelineLinkedGeneration += 1
      this.timelineProbableGeneration += 1
    },

    isCurrentTimeline(generation, sectionGeneration, linked, context) {
      return (
        this.isCurrentConversation(context.generation, context.projectId, context.inboxId, context.conversationId) &&
        generation === this.timelineGeneration &&
        sectionGeneration === (linked ? this.timelineLinkedGeneration : this.timelineProbableGeneration)
      )
    },

    async loadContactPanel({
      generation = this.contextGeneration,
      projectId = this.activeProjectId,
      inboxId = this.activeInboxId,
      conversationId = this.selectedConversationId,
    } = {}) {
      const contactId = this.conversationContact?.id
      if (
        !contactId ||
        !this.isCurrentContext(generation, projectId, inboxId) ||
        conversationId !== this.selectedConversationId
      )
        return

      this.contactPanelLoading = true
      this.contactPanelError = null

      try {
        const response = await $fetch(`/api/support/contacts/${contactId}`)
        if (!this.isCurrentContext(generation, projectId, inboxId) || conversationId !== this.selectedConversationId)
          return
        this.contactPanelContact = response?.data?.contact || null
        this.contactPanelCompany = response?.data?.company || null
      } catch (error) {
        if (this.isForbiddenError(error)) {
          if (this.isCurrentConversation(generation, projectId, inboxId, conversationId))
            await this.recoverFromForbiddenInbox({ generation, projectId, inboxId })
          return
        }
        if (this.isCurrentConversation(generation, projectId, inboxId, conversationId)) {
          this.contactPanelError = 'Failed to load contact details. Please try again.'
          this.contactPanelLoading = false
        }
        return
      }
      if (this.isCurrentConversation(generation, projectId, inboxId, conversationId)) this.contactPanelLoading = false

      await Promise.all([
        this.loadTimeline(contactId, { generation, projectId, inboxId, conversationId }),
        this.loadPreviousConversations(contactId, { generation, projectId, inboxId, conversationId }),
      ])
    },

    async loadTimeline(
      contactId,
      {
        generation = this.contextGeneration,
        projectId = this.activeProjectId,
        inboxId = this.activeInboxId,
        conversationId = this.selectedConversationId,
      } = {}
    ) {
      if (!this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return
      const timelineGeneration = ++this.timelineGeneration
      this.timelineLinkedCursor = null
      this.timelineProbableCursor = null
      await Promise.all([
        this.loadTimelineSection('linked', true, {
          contactId,
          generation,
          projectId,
          inboxId,
          conversationId,
          timelineGeneration,
        }),
        this.loadTimelineSection('probable', true, {
          contactId,
          generation,
          projectId,
          inboxId,
          conversationId,
          timelineGeneration,
        }),
      ])
    },

    async loadTimelineSection(
      section,
      reset,
      {
        contactId = this.contactPanelContact?.id,
        generation = this.contextGeneration,
        projectId = this.activeProjectId,
        inboxId = this.activeInboxId,
        conversationId = this.selectedConversationId,
        timelineGeneration,
      } = {}
    ) {
      if (!contactId || !this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return
      const linked = section === 'linked'
      const requestGeneration = timelineGeneration ?? this.timelineGeneration
      const requestSectionGeneration = linked ? ++this.timelineLinkedGeneration : ++this.timelineProbableGeneration
      const context = { generation, projectId, inboxId, conversationId }
      const loadingKey = linked ? 'timelineLinkedLoading' : 'timelineProbableLoading'
      const moreLoadingKey = linked ? 'timelineLinkedMoreLoading' : 'timelineProbableMoreLoading'
      const errorKey = linked ? 'timelineLinkedError' : 'timelineProbableError'
      const moreErrorKey = linked ? 'timelineLinkedMoreError' : 'timelineProbableMoreError'
      const cursorKey = linked ? 'timelineLinkedCursor' : 'timelineProbableCursor'
      const hasMoreKey = linked ? 'timelineLinkedHasMore' : 'timelineProbableHasMore'
      if (reset) {
        this[loadingKey] = true
        this[errorKey] = null
        this[moreErrorKey] = null
        this[cursorKey] = null
        this[hasMoreKey] = false
      } else {
        this[moreLoadingKey] = true
        this[moreErrorKey] = null
      }
      try {
        const response = await $fetch(`/api/support/contacts/${contactId}/timeline`, {
          params: {
            limit: 25,
            section: linked ? 'linked' : 'probable',
            [linked ? 'linkedCursor' : 'probableCursor']: reset ? undefined : this[cursorKey] || undefined,
          },
        })
        if (!this.isCurrentTimeline(requestGeneration, requestSectionGeneration, linked, context)) return
        const page = response?.data || {}
        if (linked) {
          this.timelineLinked = reset ? page.linked || [] : [...this.timelineLinked, ...(page.linked || [])]
          this.timelineLinkedHasMore = Boolean(page.linkedHasMore)
          this.timelineLinkedCursor = page.linkedNextCursor || null
        } else {
          this.timelineProbableFeedback = reset
            ? page.probableFeedback || []
            : [...this.timelineProbableFeedback, ...(page.probableFeedback || [])]
          this.timelineProbableHasMore = Boolean(page.probableHasMore)
          this.timelineProbableCursor = page.probableNextCursor || null
        }
      } catch (error) {
        if (
          this.isForbiddenError(error) &&
          this.isCurrentTimeline(requestGeneration, requestSectionGeneration, linked, context)
        ) {
          await this.recoverFromForbiddenInbox({ generation, projectId, inboxId })
        }
        if (this.isCurrentTimeline(requestGeneration, requestSectionGeneration, linked, context)) {
          this[reset ? errorKey : moreErrorKey] = linked
            ? reset
              ? 'Could not load linked feedback. Please try again.'
              : 'Could not load more linked feedback.'
            : reset
              ? 'Could not load possible matches. Please try again.'
              : 'Could not load more possible matches.'
        }
      } finally {
        if (this.isCurrentTimeline(requestGeneration, requestSectionGeneration, linked, context)) {
          this[reset ? loadingKey : moreLoadingKey] = false
        }
      }
    },

    async loadPreviousConversations(
      contactId,
      {
        generation = this.contextGeneration,
        projectId = this.activeProjectId,
        inboxId = this.activeInboxId,
        conversationId = this.selectedConversationId,
      } = {}
    ) {
      if (!inboxId || !this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return
      this.previousConversationsLoading = true
      try {
        const response = await $fetch('/api/support/conversations', {
          params: { inboxId, contactId, limit: 5 },
        })
        if (!this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return
        this.previousConversations = (response?.data?.conversations || []).filter((c) => c.id !== conversationId)
      } catch (error) {
        if (this.isForbiddenError(error) && this.isCurrentConversation(generation, projectId, inboxId, conversationId))
          await this.recoverFromForbiddenInbox({ generation, projectId, inboxId })
        if (this.isCurrentConversation(generation, projectId, inboxId, conversationId)) this.previousConversations = []
      } finally {
        if (this.isCurrentConversation(generation, projectId, inboxId, conversationId))
          this.previousConversationsLoading = false
      }
    },

    async linkFeedback(feedbackId) {
      const contactId = this.contactPanelContact?.id
      if (!contactId) return
      const generation = this.contextGeneration
      const projectId = this.activeProjectId
      const inboxId = this.activeInboxId
      const conversationId = this.selectedConversationId
      if (!this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return

      this.linkingFeedbackId = feedbackId
      try {
        await $fetch(`/api/support/contacts/${contactId}/links`, {
          method: 'POST',
          body: { entityType: 'feedback', entityId: feedbackId },
        })
        if (!this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return
        await this.loadTimeline(contactId, { generation, projectId, inboxId, conversationId })
      } catch (error) {
        if (!this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return
        if (this.isForbiddenError(error)) {
          await this.recoverFromForbiddenInbox({ generation, projectId, inboxId })
          return
        }
        // Leave the possible-match row visible so the agent can retry.
      } finally {
        if (this.isCurrentConversation(generation, projectId, inboxId, conversationId)) this.linkingFeedbackId = null
      }
    },

    async unlinkFeedback(linkId) {
      const contactId = this.contactPanelContact?.id
      if (!contactId) return
      const generation = this.contextGeneration
      const projectId = this.activeProjectId
      const inboxId = this.activeInboxId
      const conversationId = this.selectedConversationId
      if (!this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return

      try {
        await $fetch(`/api/support/contacts/${contactId}/links/${linkId}`, { method: 'DELETE' })
        if (this.isCurrentConversation(generation, projectId, inboxId, conversationId)) {
          await this.loadTimeline(contactId, { generation, projectId, inboxId, conversationId })
        }
      } catch (error) {
        if (
          this.isForbiddenError(error) &&
          this.isCurrentConversation(generation, projectId, inboxId, conversationId)
        ) {
          await this.recoverFromForbiddenInbox({ generation, projectId, inboxId })
        }
      }
    },

    subscribeInbox() {
      if (!import.meta.client || !this.activeInboxId) return
      this.unsubscribeInboxChannel = this.$realtime.subscribe(`inbox:${this.activeInboxId}`, {
        onEvent: () => {
          this.loadConversations(true)
        },
        // Not retried automatically (see lib/realtime-client.ts) - the list
        // pane still works via the direct fetch above, it just won't live-update.
        onSubscribeError: (reason) => {
          console.warn(`Could not subscribe to inbox updates: ${reason}`)
        },
      })
    },

    subscribeConversation(conversationId) {
      if (!import.meta.client || !conversationId) return
      this.unsubscribeConversationChannel = this.$realtime.subscribe(`conversation:${conversationId}`, {
        onEvent: () => {
          this.loadConversationDetail()
          this.loadMessages()
        },
        onSubscribeError: (reason) => {
          console.warn(`Could not subscribe to conversation updates: ${reason}`)
        },
      })
    },

    handleRealtimeReconnect() {
      // Envelopes carry only ids, and events published during a reconnect gap
      // are lost - refetch through the normal authorized endpoints rather
      // than trusting anything about what might have been missed.
      if (this.activeInboxId) this.loadConversations(true)
      if (this.selectedConversationId) {
        this.loadConversationDetail()
        this.loadMessages()
      }
    },
  },
}
</script>
