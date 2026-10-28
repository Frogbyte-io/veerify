<template>
  <div class="contents">
    <div
      ref="pageRoot"
      class="h-[calc(100dvh-7rem)] min-h-[480px]"
      data-testid="support-inbox-page"
      :data-active-project-listener-ready="activeProjectListenerReady ? 'true' : 'false'"
    >
      <!-- Loading project context -->
      <div
        v-if="isLoadingProject"
        class="@container/panes flex h-full overflow-hidden rounded-lg border bg-card"
        data-testid="support-inbox-skeleton"
      >
        <div class="hidden w-[220px] shrink-0 space-y-3 border-r bg-muted/20 p-3 @4xl/panes:block">
          <Skeleton class="h-9 w-full" />
          <Skeleton v-for="n in 4" :key="n" class="h-7 w-full" />
        </div>
        <div
          class="w-full min-w-0 shrink-0 space-y-3 p-3 @2xl/panes:w-[300px] @2xl/panes:border-r @6xl/panes:w-[340px]"
        >
          <Skeleton class="h-9 w-full" />
          <div v-for="n in 6" :key="n" class="space-y-2">
            <Skeleton class="h-4 w-2/3" />
            <Skeleton class="h-3 w-full" />
          </div>
        </div>
        <div class="hidden min-w-0 flex-1 flex-col @2xl/panes:flex">
          <div class="border-b p-4">
            <Skeleton class="h-5 w-1/2" />
          </div>
          <div class="flex-1 space-y-4 p-4">
            <Skeleton class="h-16 w-2/3" />
            <Skeleton class="ml-auto h-16 w-1/2" />
            <Skeleton class="h-16 w-3/5" />
          </div>
          <div class="border-t p-3">
            <Skeleton class="h-20 w-full" />
          </div>
        </div>
      </div>

      <!-- Notices (load error, Support off, no inbox) use the standard page frame -->
      <PageContainer v-else-if="showNotice" data-testid="support-inbox-notice">
        <PageHeader title="Inbox" description="Conversations with your customers" />

        <!-- Project error -->
        <Card v-if="projectError">
          <CardContent class="text-center py-8">
            <Icon name="lucide:alert-circle" class="w-8 h-8 text-destructive mx-auto mb-3" />
            <p class="font-medium mb-2">Failed to load the project</p>
            <p class="text-sm text-muted-foreground mb-4">{{ projectError }}</p>
            <Button variant="outline" @click="initProjectContext">
              <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
              Try again
            </Button>
          </CardContent>
        </Card>

        <!-- Support switched off for this project -->
        <Card v-else-if="supportDisabled" data-testid="support-disabled">
          <CardContent class="text-center py-10 space-y-3">
            <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Icon name="lucide:life-buoy" class="w-6 h-6 text-muted-foreground" />
            </div>
            <p class="font-medium">Support is switched off for this project</p>
            <template v-if="activeProject?.role === 'admin'">
              <p class="text-sm text-muted-foreground">Switch it on under Project settings, Tools.</p>
              <Button as-child variant="outline">
                <NuxtLink to="/project/settings?tab=tools">
                  <Icon name="lucide:layout-grid" class="w-4 h-4 mr-2" />
                  Project settings: Tools
                </NuxtLink>
              </Button>
            </template>
            <p v-else class="text-sm text-muted-foreground flex items-center justify-center gap-1.5">
              <Icon name="lucide:lock" class="w-3.5 h-3.5" />
              Project admins can switch Support on.
            </p>
          </CardContent>
        </Card>

        <!-- No inbox yet: point to settings, where managers create one -->
        <Card v-else data-testid="support-inbox-empty">
          <CardContent class="text-center py-8">
            <div
              v-if="inboxAccessError"
              data-testid="support-inbox-access-error"
              class="text-sm text-destructive mb-4"
              role="alert"
            >
              {{ inboxAccessError }}
            </div>
            <Icon name="lucide:inbox" class="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <p class="font-medium mb-2" data-testid="support-no-assignment">No support inboxes are assigned to you.</p>
            <p class="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
              Admins can create an inbox and set up domains, addresses and agents in support settings. Otherwise, ask a
              support administrator to add you to an inbox.
            </p>
            <Button as-child>
              <NuxtLink to="/support/settings" data-testid="support-inbox-empty-settings">
                <Icon name="lucide:settings" class="w-4 h-4 mr-2" />
                Open support settings
              </NuxtLink>
            </Button>
          </CardContent>
        </Card>
      </PageContainer>

      <!-- Responsive pane layout. Sized by the container (not the viewport)
         so it adapts when the app sidebar opens or collapses:
         narrow = one pane (list or thread), @2xl = list + thread,
         @4xl = inbox sidebar + list + thread. -->
      <div v-else class="@container/panes relative h-full flex flex-col rounded-lg border overflow-hidden bg-card">
        <div v-if="isCompactPanes" class="flex h-11 shrink-0 items-center gap-2 border-b px-2">
          <Button
            variant="ghost"
            size="sm"
            data-testid="support-open-inboxes"
            aria-label="Open inboxes and views"
            @click="showInboxSheet = true"
          >
            <Icon name="lucide:panel-left" class="w-4 h-4" />
          </Button>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{{ activeInbox?.name || 'Support' }}</p>
          </div>
          <Button variant="ghost" size="sm" as-child>
            <NuxtLink to="/support/settings" aria-label="Support settings" data-testid="support-settings-link">
              <Icon name="lucide:settings" class="w-4 h-4" />
            </NuxtLink>
          </Button>
        </div>

        <div class="flex min-h-0 flex-1">
          <div
            v-if="inboxAccessError"
            data-testid="support-inbox-access-error"
            class="absolute z-10 left-4 top-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive shadow-sm"
            role="alert"
          >
            {{ inboxAccessError }}
          </div>
          <!-- Left: inbox switcher + fixed views -->
          <div class="hidden w-[220px] shrink-0 border-r bg-muted/20 @4xl/panes:block">
            <SupportInboxSidebar
              :inboxes="inboxes"
              :active-inbox-id="activeInboxId"
              :is-loading="isLoadingInboxes"
              :error="inboxesError"
              :capabilities="activeInbox?.capabilities"
              :active-view="activeView"
              :unread-counts="unreadCounts"
              @select-inbox="selectInbox"
              @select-view="selectView"
              @retry="loadInboxes"
              @create-tag="createTag"
            />
          </div>

          <!-- Middle: conversation list -->
          <div
            class="w-full min-w-0 shrink-0 @2xl/panes:block @2xl/panes:w-[300px] @2xl/panes:border-r @6xl/panes:w-[340px]"
            :class="selectedConversationId ? 'hidden' : 'block'"
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
              :unread-counts="unreadCounts"
              @select="selectConversation"
              @search="handleConversationSearch"
              @clear-search="clearConversationSearch"
              @csat-filter="handleCsatFilter"
              @retry="() => loadConversations(true)"
              @load-more="() => loadConversations(false)"
            />
          </div>

          <!-- Right: thread -->
          <div class="flex-1 min-w-0 @2xl/panes:block" :class="selectedConversationId ? 'block' : 'hidden'">
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
              @retry-detail="loadConversationDetail"
              @retry-messages="loadMessages"
              @update-conversation="patchConversation"
              @claim-conversation="claimConversation"
              @mark-unread="markConversationUnread"
              @convert-to-feedback="openFeedbackBridgeDialog"
              @toggle-contact-panel="showContactPanel = !showContactPanel"
              @back="unselectConversation"
            >
              <template #composer>
                <SupportComposer
                  v-if="selectedConversationId"
                  ref="composer"
                  :conversation-id="selectedConversationId"
                  :project-id="activeProjectId"
                  :contact="conversationContact"
                  :current-user-name="currentUserName"
                  @posted="handleMessagePosted"
                  @draft-state-changed="handleDraftStateChanged"
                />
              </template>
            </SupportConversationThread>
          </div>
        </div>
      </div>
    </div>

    <!-- Inbox switcher + views as a drawer when the panes are too narrow -->
    <Sheet v-if="isCompactPanes" :open="showInboxSheet" @update:open="showInboxSheet = $event">
      <SheetContent side="left" class="w-[85vw] max-w-xs p-0" data-testid="support-inbox-sheet">
        <SheetHeader class="sr-only">
          <SheetTitle>Inboxes</SheetTitle>
          <SheetDescription>Switch inbox or conversation view</SheetDescription>
        </SheetHeader>
        <SupportInboxSidebar
          :inboxes="inboxes"
          :active-inbox-id="activeInboxId"
          :is-loading="isLoadingInboxes"
          :error="inboxesError"
          :capabilities="activeInbox?.capabilities"
          :active-view="activeView"
          :unread-counts="unreadCounts"
          @select-inbox="(id) => closeInboxSheetAfter(selectInbox(id))"
          @select-view="(view) => closeInboxSheetAfter(selectView(view))"
          @retry="loadInboxes"
          @create-tag="createTag"
        />
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
          <span>Claim conversation</span>
          <kbd class="rounded border bg-muted px-1.5 py-1 text-center font-mono">e</kbd>
          <span>Resolve conversation</span>
          <kbd class="rounded border bg-muted px-1.5 py-1 text-center font-mono">/</kbd>
          <span>Focus conversation search</span>
          <kbd class="rounded border bg-muted px-1.5 py-1 text-center font-mono">?</kbd>
          <span>Toggle this help</span>
        </div>
      </div>
    </div>

    <!-- Far right: contact drawer -->
    <SupportContactPanel
      :open="showContactPanel"
      :contact="contactPanelContact"
      :company="contactPanelCompany"
      :is-loading="contactPanelLoading"
      :error="contactPanelError"
      :linked="timelineLinked"
      :probable-feedback="timelineProbableFeedback"
      :linked-loading="timelineLinkedLoading"
      :probable-loading="timelineProbableLoading"
      :linked-more-loading="timelineLinkedMoreLoading"
      :probable-more-loading="timelineProbableMoreLoading"
      :linked-has-more="timelineLinkedHasMore"
      :probable-has-more="timelineProbableHasMore"
      :linked-error="timelineLinkedError"
      :probable-error="timelineProbableError"
      :linked-more-error="timelineLinkedMoreError"
      :probable-more-error="timelineProbableMoreError"
      :previous-conversations="previousConversations"
      :previous-conversations-loading="previousConversationsLoading"
      :linking-id="linkingFeedbackId"
      @update:open="showContactPanel = $event"
      @retry="loadContactPanel"
      @link-feedback="linkFeedback"
      @unlink-feedback="unlinkFeedback"
      @load-linked="(reset) => loadTimelineSection('linked', reset)"
      @load-probable="(reset) => loadTimelineSection('probable', reset)"
      @select-conversation="selectConversation"
    />
  </div>
</template>

<script>
import { loadActiveProject } from '~/lib/active-project'
import {
  getNextSupportConversationId,
  getSupportShortcutAction,
  isSupportShortcutEditableTarget,
} from '~/lib/support-keyboard-shortcuts'

const ACTIVE_PROJECT_CHANGED_EVENT = 'veerify:active-project-changed'
const SUPPORT_DRAFT_STATE_CHANGED_EVENT = 'veerify:support-draft-state-changed'
const SUPPORT_VIEWS = ['unassigned', 'assigned-to-me', 'resolved', 'breaching-soon', 'all']
const CSAT_FILTERS = ['all', 'rated', 'unrated']
const DRAFT_STORAGE_PREFIX = 'veerify:support:draft'
const DRAFT_MODES = ['reply', 'note']

export default {
  name: 'SupportInboxPage',

  created() {
    useHead({ title: 'Support inbox' })
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

      activeView: 'unassigned',

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
      unreadCounts: { unassigned: 0, assignedToMe: 0 },
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

      showContactPanel: false,
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

  async mounted() {
    if (import.meta.client) {
      this.pageWidth = this.$refs.pageRoot?.clientWidth ?? null
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
      } else if (action === 'search') {
        this.focusConversationSearch()
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
      this.activeView = 'unassigned'
      this.conversationSearch = ''
      this.csatFilter = 'all'
      this.csatSummary = null
      if (this.conversationSearchDebounceTimer) {
        clearTimeout(this.conversationSearchDebounceTimer)
        this.conversationSearchDebounceTimer = null
      }
      this.conversations = []
      this.unreadCounts = { unassigned: 0, assignedToMe: 0 }
      this.conversationDraftIds = []
      this.contactCache = {}
      this.selectedConversationId = null
      this.conversationDetail = null
      this.conversationContact = null
      this.messages = []
      this.showContactPanel = false
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
          // (`/support?conversationId=…`). Opened after the inbox loads,
          // because selectInbox clears any current selection.
          if (this.isCurrentContext(generation, projectId)) await this.openRequestedConversation()
        }
      } catch (error) {
        if (!this.isCurrentContext(generation, projectId)) return
        if (this.isForbiddenError(error)) {
          this.inboxes = []
          this.activeInboxId = null
          this.inboxMembers = []
          if (!recovering) this.inboxAccessError = 'You do not have access to this support inbox'
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
      this.activeView = useRouteView ? this.normalizeSupportView(this.$route.query.view) : 'unassigned'
      this.conversationSearch = useRouteView ? this.normalizeConversationSearch(this.$route.query.search) : ''
      this.csatFilter = useRouteView ? this.normalizeCsatFilter(this.$route.query.csat) : 'all'

      if (import.meta.client) {
        this.$router
          .replace({
            query: {
              ...this.$route.query,
              inboxId,
              view: this.activeView === 'unassigned' ? undefined : this.activeView,
              search: this.conversationSearch || undefined,
              csat: this.csatFilter === 'all' ? undefined : this.csatFilter,
            },
          })
          .catch(() => {})
      }

      await Promise.all([
        this.loadInboxMembers({ generation, projectId, inboxId }),
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
      if (this.isCurrentContext(generation, projectId))
        this.inboxAccessError = 'You do not have access to this support inbox'
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
      } catch (error) {
        if (!this.isCurrentContext(generation, projectId, inboxId)) return
        if (this.isForbiddenError(error)) {
          await this.recoverFromForbiddenInbox({ generation, projectId, inboxId })
          return
        }
        alert(error?.data?.error?.message || 'Failed to create tag')
      }
    },

    normalizeSupportView(value) {
      return typeof value === 'string' && SUPPORT_VIEWS.includes(value) ? value : 'unassigned'
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
              view: nextView === 'unassigned' ? undefined : nextView,
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
            search: this.conversationSearch || undefined,
            csat: this.csatFilter === 'all' ? undefined : this.csatFilter,
            limit: 25,
            cursor: reset ? undefined : this.conversationsNextCursor || undefined,
          },
        })

        if (!this.isCurrentContext(generation, projectId, inboxId)) return
        const page = response?.data?.conversations || []
        this.conversations = reset ? page : [...this.conversations, ...page]
        this.unreadCounts = response?.data?.unreadCounts || { unassigned: 0, assignedToMe: 0 }
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
      this.showContactPanel = false
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

      this.isUpdatingConversation = true
      try {
        const response = await $fetch(`/api/support/conversations/${conversationId}`, {
          method: 'PATCH',
          body: patch,
        })
        if (
          this.isCurrentConversation(generation, projectId, inboxId, conversationId) &&
          response?.data?.conversation
        ) {
          this.conversationDetail = response.data.conversation
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
        alert(err?.data?.error?.message || 'Failed to update this conversation')
      } finally {
        if (this.isCurrentConversation(generation, projectId, inboxId, conversationId))
          this.isUpdatingConversation = false
      }
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

    async handleMessagePosted() {
      const generation = this.contextGeneration
      const projectId = this.activeProjectId
      const inboxId = this.activeInboxId
      const conversationId = this.selectedConversationId
      if (!this.isCurrentConversation(generation, projectId, inboxId, conversationId)) return

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
