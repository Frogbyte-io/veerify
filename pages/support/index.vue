<template>
  <NuxtLayout name="dashboard">
    <div class="h-[calc(100vh-6rem)] min-h-[560px]">
      <!-- Loading team context -->
      <div v-if="isLoadingTeam" class="h-full flex items-center justify-center">
        <div class="space-y-3 w-full max-w-md">
          <Skeleton class="h-8 w-40 mx-auto" />
          <Skeleton class="h-40 w-full" />
        </div>
      </div>

      <!-- Team error -->
      <Card v-else-if="teamError" class="max-w-md mx-auto mt-12">
        <CardContent class="text-center py-8">
          <Icon name="lucide:alert-circle" class="w-8 h-8 text-destructive mx-auto mb-3" />
          <p class="font-medium mb-2">Failed to load workspace</p>
          <p class="text-sm text-muted-foreground mb-4">{{ teamError }}</p>
          <Button variant="outline" @click="initTeamContext">
            <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
            Try again
          </Button>
        </CardContent>
      </Card>

      <!-- Three-pane layout -->
      <div v-else class="h-full flex rounded-lg border overflow-hidden bg-card">
        <div
          v-if="inboxAccessError"
          data-testid="support-inbox-access-error"
          class="absolute z-10 left-4 top-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive shadow-sm"
          role="alert"
        >
          {{ inboxAccessError }}
        </div>
        <!-- Left: inbox switcher + filters -->
        <div class="w-[220px] shrink-0 border-r bg-muted/20">
          <SupportInboxSidebar
            :inboxes="inboxes"
            :active-inbox-id="activeInboxId"
            :is-loading="isLoadingInboxes"
            :error="inboxesError"
            :members="inboxMembers"
            :tags="tags"
            :tags-available="tagsAvailable"
            :capabilities="activeInbox?.capabilities"
            :filters="filters"
            @select-inbox="selectInbox"
            @update:filters="onFiltersChange"
            @retry="loadInboxes"
            @create-tag="createTag"
          />
        </div>

        <!-- Middle: conversation list -->
        <div class="w-[340px] shrink-0 border-r">
          <SupportConversationList
            :conversations="conversationsEnriched"
            :selected-conversation-id="selectedConversationId"
            :is-loading="isLoadingConversations"
            :is-loading-more="isLoadingMoreConversations"
            :error="conversationsError"
            :has-more="hasMoreConversations"
            @select="selectConversation"
            @retry="() => loadConversations(true)"
            @load-more="() => loadConversations(false)"
          />
        </div>

        <!-- Right: thread -->
        <div class="flex-1 min-w-0">
          <SupportConversationThread
            :conversation-id="selectedConversationId"
            :conversation="conversationDetail"
            :contact="conversationContact"
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
            @toggle-contact-panel="showContactPanel = !showContactPanel"
          >
            <template #composer>
              <SupportComposer
                v-if="selectedConversationId"
                :conversation-id="selectedConversationId"
                @posted="loadMessages"
              />
            </template>
          </SupportConversationThread>
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
      :timeline-loading="timelineLoading"
      :previous-conversations="previousConversations"
      :previous-conversations-loading="previousConversationsLoading"
      :linking-id="linkingFeedbackId"
      @update:open="showContactPanel = $event"
      @retry="loadContactPanel"
      @link-feedback="linkFeedback"
      @select-conversation="selectConversation"
    />
  </NuxtLayout>
</template>

<script>
const ACTIVE_TEAM_CHANGED_EVENT = 'veerify:active-team-changed'

export default {
  name: 'SupportInboxPage',

  data() {
    return {
      activeTeamId: '',
      isLoadingTeam: true,
      teamError: null,

      inboxes: [],
      activeInboxId: null,
      isLoadingInboxes: true,
      inboxesError: null,
      inboxAccessError: null,

      inboxMembers: [],

      tags: [],
      tagsAvailable: false,

      filters: { status: '', assigneeUserId: '', tagId: '' },

      conversations: [],
      isLoadingConversations: true,
      isLoadingMoreConversations: false,
      conversationsError: null,
      hasMoreConversations: false,
      conversationsNextCursor: null,
      contactCache: {},

      selectedConversationId: null,
      conversationDetail: null,
      conversationContact: null,
      isLoadingDetail: false,
      detailError: null,
      isUpdatingConversation: false,

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
      timelineLoading: false,
      previousConversations: [],
      previousConversationsLoading: false,
      linkingFeedbackId: null,

      unsubscribeInboxChannel: null,
      unsubscribeConversationChannel: null,
      unregisterReconnectHook: null,
    }
  },

  computed: {
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
        }
      })
    },
  },

  async mounted() {
    await this.initTeamContext()

    if (import.meta.client) {
      window.addEventListener(ACTIVE_TEAM_CHANGED_EVENT, this.handleActiveTeamChanged)
      this.unregisterReconnectHook = this.$realtime.onReconnect(this.handleRealtimeReconnect)
    }
  },

  beforeUnmount() {
    if (import.meta.client) {
      window.removeEventListener(ACTIVE_TEAM_CHANGED_EVENT, this.handleActiveTeamChanged)
    }
    if (this.unregisterReconnectHook) this.unregisterReconnectHook()
    if (this.unsubscribeInboxChannel) this.unsubscribeInboxChannel()
    if (this.unsubscribeConversationChannel) this.unsubscribeConversationChannel()
  },

  methods: {
    async handleActiveTeamChanged() {
      this.resetInboxState()
      await this.initTeamContext()
    },

    resetInboxState() {
      if (this.unsubscribeInboxChannel) {
        this.unsubscribeInboxChannel()
        this.unsubscribeInboxChannel = null
      }
      if (this.unsubscribeConversationChannel) {
        this.unsubscribeConversationChannel()
        this.unsubscribeConversationChannel = null
      }
      this.inboxes = []
      this.activeInboxId = null
      this.inboxMembers = []
      this.tags = []
      this.tagsAvailable = false
      this.filters = { status: '', assigneeUserId: '', tagId: '' }
      this.conversations = []
      this.contactCache = {}
      this.selectedConversationId = null
      this.conversationDetail = null
      this.conversationContact = null
      this.messages = []
      this.showContactPanel = false
      this.resetContactPanel()
    },

    async initTeamContext() {
      this.isLoadingTeam = true
      this.teamError = null

      try {
        const teamResponse = await $fetch('/api/teams/active')
        const activeTeamData = teamResponse?.data

        if (!activeTeamData?.id) {
          this.teamError = 'No active team found'
          this.isLoadingTeam = false
          return
        }

        this.activeTeamId = activeTeamData.id
        this.isLoadingTeam = false
        await this.loadInboxes()
        if (this.activeInboxId) await this.loadTags()
      } catch {
        this.teamError = 'Something went wrong. Please try again.'
        this.isLoadingTeam = false
      }
    },

    async loadInboxes({ recovering = false } = {}) {
      if (!this.activeTeamId) return

      this.isLoadingInboxes = true
      this.inboxesError = null
      if (!recovering) this.inboxAccessError = null

      try {
        const response = await $fetch('/api/support/inboxes', { params: { teamId: this.activeTeamId } })
        this.inboxes = response?.data?.inboxes || []

        const requestedInboxId = this.$route.query.inboxId
        const initialInboxId =
          (typeof requestedInboxId === 'string' && this.inboxes.some((i) => i.id === requestedInboxId)
            ? requestedInboxId
            : null) ||
          this.inboxes[0]?.id ||
          null

        if (initialInboxId) {
          await this.selectInbox(initialInboxId)
          // Deep link from a conversation_assigned notification
          // (`/support?conversationId=…`). Opened after the inbox loads,
          // because selectInbox clears any current selection.
          await this.openRequestedConversation()
        }
      } catch (error) {
        if (this.isForbiddenError(error)) {
          this.inboxes = []
          this.activeInboxId = null
          this.inboxMembers = []
          this.tags = []
          this.tagsAvailable = false
          if (!recovering) this.inboxAccessError = 'You do not have access to this support inbox'
          return
        }
        this.inboxesError = 'Failed to load inboxes. Please try again.'
      } finally {
        this.isLoadingInboxes = false
      }
    },

    async loadTags() {
      // Best effort: a team with no tags yet, or a failed lookup, hides the tag
      // filter rather than showing an empty control - no fallback/fake data.
      if (!this.activeTeamId || !this.activeInboxId) return
      try {
        const response = await $fetch('/api/support/tags', { params: { teamId: this.activeTeamId } })
        this.tags = response?.data?.tags || []
        this.tagsAvailable = true
      } catch (error) {
        if (this.isForbiddenError(error)) {
          await this.recoverFromForbiddenInbox()
          return
        }
        this.tags = []
        this.tagsAvailable = false
      }
    },

    async createTag(name) {
      if (!this.activeTeamId) return
      try {
        await $fetch('/api/support/tags', {
          method: 'POST',
          body: { teamId: this.activeTeamId, name },
        })
        await this.loadTags()
      } catch (error) {
        if (this.isForbiddenError(error)) {
          await this.recoverFromForbiddenInbox()
          return
        }
        alert(error?.data?.error?.message || 'Failed to create tag')
      }
    },

    async selectInbox(inboxId) {
      if (!inboxId || inboxId === this.activeInboxId) return

      if (this.unsubscribeInboxChannel) {
        this.unsubscribeInboxChannel()
        this.unsubscribeInboxChannel = null
      }
      this.unselectConversation()

      this.activeInboxId = inboxId
      this.inboxAccessError = null
      this.filters = { status: '', assigneeUserId: '', tagId: '' }

      if (import.meta.client) {
        this.$router.replace({ query: { ...this.$route.query, inboxId } }).catch(() => {})
      }

      await Promise.all([this.loadInboxMembers(), this.loadConversations(true)])
      this.subscribeInbox()
    },

    isForbiddenError(error) {
      return error?.statusCode === 403 || error?.status === 403 || error?.response?.status === 403
    },

    async recoverFromForbiddenInbox() {
      this.unselectConversation()
      this.activeInboxId = null
      this.inboxMembers = []
      this.tags = []
      this.tagsAvailable = false
      this.conversations = []
      this.contactCache = {}
      if (import.meta.client) {
        await this.$router
          .replace({ query: { ...this.$route.query, inboxId: undefined, conversationId: undefined } })
          .catch(() => {})
      }
      await this.loadInboxes({ recovering: true })
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

    async loadInboxMembers() {
      if (!this.activeInboxId) return
      try {
        const response = await $fetch(`/api/support/inboxes/${this.activeInboxId}/members`)
        this.inboxMembers = response?.data?.members || []
      } catch (error) {
        this.inboxMembers = []
        if (this.isForbiddenError(error)) await this.recoverFromForbiddenInbox()
      }
    },

    async onFiltersChange(newFilters) {
      this.filters = newFilters
      await this.loadConversations(true)
    },

    async loadConversations(reset) {
      if (!this.activeInboxId) return

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
            inboxId: this.activeInboxId,
            status: this.filters.status || undefined,
            assigneeUserId: this.filters.assigneeUserId || undefined,
            tagId: this.filters.tagId || undefined,
            limit: 25,
            cursor: reset ? undefined : this.conversationsNextCursor || undefined,
          },
        })

        const page = response?.data?.conversations || []
        this.conversations = reset ? page : [...this.conversations, ...page]
        this.hasMoreConversations = Boolean(response?.data?.hasMore)
        this.conversationsNextCursor = response?.data?.nextCursor || null

        await this.ensureContactsLoaded(page.map((c) => c.contactId))
      } catch (error) {
        if (this.isForbiddenError(error)) {
          await this.recoverFromForbiddenInbox()
          return
        }
        this.conversationsError = 'Failed to load conversations. Please try again.'
      } finally {
        this.isLoadingConversations = false
        this.isLoadingMoreConversations = false
      }
    },

    async ensureContactsLoaded(contactIds) {
      // Retry ids never fetched, or whose last fetch failed. A resolved-but-null
      // contact stays cached as null so it is not re-requested on every render.
      const uniqueIds = [...new Set(contactIds)].filter((id) => {
        if (!id) return false
        const cached = this.contactCache[id]
        return cached === undefined || cached === 'error'
      })
      if (uniqueIds.length === 0) return

      for (const id of uniqueIds) {
        this.contactCache[id] = 'loading'
      }

      await Promise.all(
        uniqueIds.map(async (id) => {
          try {
            const response = await $fetch(`/api/support/contacts/${id}`)
            this.contactCache[id] = response?.data?.contact || null
          } catch (error) {
            if (this.isForbiddenError(error)) {
              await this.recoverFromForbiddenInbox()
              return
            }
            // Sentinel rather than `delete` - a dynamic delete is a lint error,
            // and this keeps the id retryable on the next enrich pass.
            this.contactCache[id] = 'error'
          }
        })
      )
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

      await this.loadConversationDetail()
      await this.loadMessages()
    },

    async loadConversationDetail() {
      if (!this.selectedConversationId) return

      this.isLoadingDetail = true
      this.detailError = null

      try {
        const response = await $fetch(`/api/support/conversations/${this.selectedConversationId}`)
        this.conversationDetail = response?.data?.conversation || null
        this.conversationContact = response?.data?.contact || null

        if (this.conversationContact?.id) {
          await this.loadContactPanel()
        }
      } catch (error) {
        if (this.isForbiddenError(error)) {
          await this.recoverFromForbiddenInbox()
          return
        }
        this.detailError = 'Failed to load this conversation. Please try again.'
      } finally {
        this.isLoadingDetail = false
      }
    },

    async loadMessages() {
      if (!this.selectedConversationId) return

      this.isLoadingMessages = true
      this.messagesError = null

      try {
        const response = await $fetch(`/api/support/conversations/${this.selectedConversationId}/messages`)
        const items = response?.data?.messages || []
        this.messages = [...items].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        this.scrollMessagesToBottom()
      } catch (error) {
        if (this.isForbiddenError(error)) {
          await this.recoverFromForbiddenInbox()
          return
        }
        this.messagesError = 'Could not load messages. Please try again.'
        this.messages = []
      } finally {
        this.isLoadingMessages = false
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
      if (!this.selectedConversationId) return

      this.isUpdatingConversation = true
      try {
        const response = await $fetch(`/api/support/conversations/${this.selectedConversationId}`, {
          method: 'PATCH',
          body: patch,
        })
        if (response?.data?.conversation) {
          this.conversationDetail = response.data.conversation
        }
        // The PATCH writes an `activity` message server-side describing the
        // change - reload the thread and list so it appears without waiting
        // on the realtime round-trip for the agent's own action.
        await Promise.all([this.loadMessages(), this.loadConversations(true)])
      } catch (err) {
        if (this.isForbiddenError(err)) {
          await this.recoverFromForbiddenInbox()
          return
        }
        alert(err?.data?.error?.message || 'Failed to update this conversation')
      } finally {
        this.isUpdatingConversation = false
      }
    },

    resetContactPanel() {
      this.contactPanelContact = null
      this.contactPanelCompany = null
      this.contactPanelError = null
      this.timelineLinked = []
      this.timelineProbableFeedback = []
      this.previousConversations = []
    },

    async loadContactPanel() {
      const contactId = this.conversationContact?.id
      if (!contactId) return

      this.contactPanelLoading = true
      this.contactPanelError = null

      try {
        const response = await $fetch(`/api/support/contacts/${contactId}`)
        this.contactPanelContact = response?.data?.contact || null
        this.contactPanelCompany = response?.data?.company || null
      } catch (error) {
        if (this.isForbiddenError(error)) {
          await this.recoverFromForbiddenInbox()
          return
        }
        this.contactPanelError = 'Failed to load contact details. Please try again.'
        this.contactPanelLoading = false
        return
      }
      this.contactPanelLoading = false

      await Promise.all([this.loadTimeline(contactId), this.loadPreviousConversations(contactId)])
    },

    async loadTimeline(contactId) {
      this.timelineLoading = true
      try {
        const response = await $fetch(`/api/support/contacts/${contactId}/timeline`)
        this.timelineLinked = response?.data?.linked || []
        this.timelineProbableFeedback = response?.data?.probableFeedback || []
      } catch (error) {
        if (this.isForbiddenError(error)) await this.recoverFromForbiddenInbox()
        this.timelineLinked = []
        this.timelineProbableFeedback = []
      } finally {
        this.timelineLoading = false
      }
    },

    async loadPreviousConversations(contactId) {
      if (!this.activeInboxId) return
      this.previousConversationsLoading = true
      try {
        const response = await $fetch('/api/support/conversations', {
          params: { inboxId: this.activeInboxId, contactId, limit: 5 },
        })
        this.previousConversations = (response?.data?.conversations || []).filter(
          (c) => c.id !== this.selectedConversationId
        )
      } catch (error) {
        if (this.isForbiddenError(error)) await this.recoverFromForbiddenInbox()
        this.previousConversations = []
      } finally {
        this.previousConversationsLoading = false
      }
    },

    async linkFeedback(feedbackId) {
      const contactId = this.contactPanelContact?.id
      if (!contactId) return

      this.linkingFeedbackId = feedbackId
      try {
        await $fetch(`/api/support/contacts/${contactId}/links`, {
          method: 'POST',
          body: { entityType: 'feedback', entityId: feedbackId },
        })
        await this.loadTimeline(contactId)
      } catch (error) {
        if (this.isForbiddenError(error)) {
          await this.recoverFromForbiddenInbox()
          return
        }
        // Leave the possible-match row visible so the agent can retry.
      } finally {
        this.linkingFeedbackId = null
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
