<template>
  <div class="flex h-full flex-col" data-testid="support-conversation-details">
    <div class="flex h-12 shrink-0 items-center justify-between border-b px-4">
      <h2 class="text-sm font-semibold">Details</h2>
      <Button
        variant="ghost"
        size="icon"
        class="h-8 w-8"
        data-testid="support-details-close"
        aria-label="Close details"
        @click="$emit('close')"
      >
        <Icon name="lucide:x" class="h-4 w-4" />
      </Button>
    </div>

    <div class="flex-1 overflow-y-auto overscroll-contain">
      <div v-if="!conversation" class="space-y-3 p-4">
        <Skeleton class="h-5 w-1/3" />
        <Skeleton v-for="n in 5" :key="n" class="h-8 w-full" />
      </div>

      <template v-else>
        <!-- Properties -->
        <section class="border-b px-4 py-4">
          <h3 :class="headingClass">Properties</h3>
          <dl class="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5 text-sm">
            <dt :class="termClass">Type</dt>
            <dd>
              <select
                :value="conversation.behaviour === 'mail' ? 'mail' : 'helpdesk'"
                data-testid="support-thread-type"
                :disabled="isUpdating || !isWorkable"
                :class="selectClass"
                aria-label="Conversation type"
                @change="onUpdate('behaviour', $event.target.value)"
              >
                <option value="helpdesk">Support case #{{ conversation.displayId }}</option>
                <option value="mail">Mail</option>
              </select>
            </dd>

            <dt :class="termClass">Status</dt>
            <dd>
              <select
                :value="conversation.status"
                data-testid="support-thread-status"
                :disabled="isUpdating"
                :class="selectClass"
                aria-label="Status"
                @change="onUpdate('status', $event.target.value)"
              >
                <option value="open">Open</option>
                <option value="pending">Pending</option>
                <option value="snoozed">Snoozed</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Archived</option>
              </select>
            </dd>

            <dt :class="termClass">Priority</dt>
            <dd>
              <select
                :value="conversation.priority || ''"
                data-testid="support-thread-priority"
                :disabled="isUpdating"
                :class="selectClass"
                aria-label="Priority"
                @change="onUpdate('priority', $event.target.value || null)"
              >
                <option value="">No priority</option>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </dd>

            <dt :class="termClass">Assignee</dt>
            <dd>
              <select
                :value="conversation.assigneeUserId || ''"
                data-testid="support-thread-assignee"
                :disabled="isUpdating"
                :class="selectClass"
                aria-label="Assignee"
                @change="onUpdate('assigneeUserId', $event.target.value || null)"
              >
                <option value="">Unassigned</option>
                <option v-if="showCurrentUserOption" :value="currentUserId">You</option>
                <option v-for="member in members" :key="member.userId" :value="member.userId">
                  {{ member.userId === currentUserId ? 'You' : member.userName || member.userEmail }}
                </option>
              </select>
            </dd>

            <dt :class="termClass" class="self-start pt-1.5">Tags</dt>
            <dd class="flex flex-wrap items-center gap-1 py-1" data-testid="support-thread-tags">
              <span
                v-for="tag in conversationTags"
                :key="tag.id"
                class="inline-flex items-center gap-1 rounded bg-muted py-0.5 pr-1 pl-1.5 text-xs"
              >
                <span class="h-1.5 w-1.5 rounded-full" :style="{ background: tagColor(tag) }" />
                {{ tag.name }}
                <button
                  type="button"
                  class="rounded text-muted-foreground hover:text-foreground"
                  :data-testid="`support-thread-tag-remove-${tag.id}`"
                  :aria-label="`Remove tag ${tag.name}`"
                  :disabled="tagsBusy"
                  @click="$emit('remove-tag', tag.id)"
                >
                  <Icon name="lucide:x" class="h-3 w-3" />
                </button>
              </span>
              <select
                v-if="availableTags.length > 0"
                value=""
                data-testid="support-thread-tag-add"
                :disabled="tagsBusy"
                class="h-6 max-w-28 rounded border border-dashed bg-transparent px-1 text-xs text-muted-foreground"
                aria-label="Add tag"
                @change="onAddTag($event)"
              >
                <option value="" disabled>+ Add tag</option>
                <option v-for="tag in availableTags" :key="tag.id" :value="tag.id">{{ tag.name }}</option>
              </select>
              <span v-else-if="conversationTags.length === 0" class="text-xs text-muted-foreground">No tags</span>
            </dd>
          </dl>
        </section>

        <!-- SLA: only support cases have one -->
        <section v-if="slaRows.length > 0" class="border-b px-4 py-4" data-testid="support-details-sla">
          <h3 :class="headingClass">SLA</h3>
          <dl class="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-sm">
            <template v-for="row in slaRows" :key="row.label">
              <dt :class="termClass">{{ row.label }}</dt>
              <dd :class="row.className">{{ row.value }}</dd>
            </template>
          </dl>
        </section>

        <!-- Feedback bridge -->
        <section class="border-b px-4 py-4">
          <h3 :class="headingClass">Feedback</h3>
          <a
            v-if="conversation.linkedFeedbackId"
            :href="`/feedback/${conversation.linkedFeedbackId}`"
            data-testid="support-thread-linked-feedback"
            class="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-accent"
          >
            <Icon name="lucide:external-link" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span class="min-w-0">
              <span class="block truncate font-medium">
                {{ conversation.linkedFeedback?.title || 'View linked feedback' }}
              </span>
              <span v-if="conversation.linkedFeedback" class="block text-xs text-muted-foreground">
                {{ conversation.linkedFeedback.status }} · {{ conversation.linkedFeedback.voteCount }} votes
              </span>
            </span>
          </a>
          <button
            v-else
            type="button"
            data-testid="support-thread-convert-feedback"
            class="flex w-full items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-left text-sm text-muted-foreground hover:border-solid hover:text-foreground"
            @click="$emit('convert-to-feedback')"
          >
            <Icon name="lucide:message-square-plus" class="mt-0.5 h-4 w-4 shrink-0" />
            Convert to feedback, or link to an existing item
          </button>
        </section>

        <!-- Contact, company, timeline -->
        <section class="px-4 py-4">
          <h3 :class="headingClass">Contact</h3>
          <slot />
        </section>
      </template>
    </div>
  </div>
</template>

<script>
import { supportTagColor } from '~/lib/support-tags'

export default {
  name: 'SupportConversationDetails',

  props: {
    conversation: { type: Object, default: null },
    currentUserId: { type: String, default: '' },
    members: { type: Array, default: () => [] },
    isUpdating: { type: Boolean, default: false },
    tags: { type: Array, default: () => [] },
    conversationTags: { type: Array, default: () => [] },
    tagsBusy: { type: Boolean, default: false },
  },

  emits: ['close', 'update-conversation', 'convert-to-feedback', 'add-tag', 'remove-tag'],

  data() {
    return { nowMs: Date.now(), ticker: null }
  },

  computed: {
    headingClass() {
      return 'mb-2.5 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground'
    },

    termClass() {
      return 'text-xs text-muted-foreground'
    },

    selectClass() {
      return 'h-8 w-full min-w-0 rounded-md border border-transparent bg-transparent px-1.5 text-sm hover:border-border focus:border-border disabled:opacity-60'
    },

    isWorkable() {
      return !this.conversation?.deletedAt && !this.conversation?.spamAt
    },

    showCurrentUserOption() {
      return Boolean(this.currentUserId && !this.members.some((member) => member.userId === this.currentUserId))
    },

    availableTags() {
      const used = new Set(this.conversationTags.map((tag) => tag.id))
      return this.tags.filter((tag) => !used.has(tag.id))
    },

    slaRows() {
      const item = this.conversation
      if (!item || item.behaviour === 'mail') return []
      const rows = []
      if (item.firstResponseDueAt && !item.firstResponseAt) {
        rows.push(this.slaRow('First reply', item.firstResponseDueAt, item.slaPausedAt))
      } else if (item.nextResponseDueAt) {
        rows.push(this.slaRow('Next reply', item.nextResponseDueAt, item.slaPausedAt))
      }
      if (item.resolutionDueAt) rows.push(this.slaRow('Resolution', item.resolutionDueAt, item.slaPausedAt))
      return rows
    },
  },

  mounted() {
    this.ticker = window.setInterval(() => {
      this.nowMs = Date.now()
    }, 30_000)
  },

  beforeUnmount() {
    if (this.ticker) window.clearInterval(this.ticker)
  },

  methods: {
    onUpdate(field, value) {
      this.$emit('update-conversation', { [field]: value })
    },

    onAddTag(event) {
      const tagId = event.target.value
      event.target.value = ''
      if (tagId) this.$emit('add-tag', tagId)
    },

    tagColor(tag) {
      return supportTagColor(tag)
    },

    slaRow(label, dueAt, pausedAt) {
      const due = new Date(dueAt)
      const when = due.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
      if (pausedAt) return { label, value: `Paused · due ${when}`, className: 'text-muted-foreground' }
      const diffMin = Math.ceil((due.getTime() - this.nowMs) / 60000)
      if (diffMin <= 0) return { label, value: `Breached · ${when}`, className: 'font-medium text-destructive' }
      const left = diffMin < 60 ? `${diffMin}m left` : `${Math.floor(diffMin / 60)}h ${diffMin % 60}m left`
      return {
        label,
        value: `${left} · ${when}`,
        className: diffMin <= 60 ? 'font-medium text-amber-700 dark:text-amber-300' : '',
      }
    },
  },
}
</script>
