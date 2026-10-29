<template>
  <li
    class="flex gap-3 border-b border-border px-4 py-3 last:border-b-0"
    :class="mention.status === 'new' ? 'bg-card' : 'bg-muted/30'"
    :data-testid="`mention-item-${mention.id}`"
  >
    <input
      type="checkbox"
      class="mt-1 h-4 w-4 shrink-0 rounded border-input accent-primary"
      :checked="selected"
      :aria-label="`Select mention ${mention.title || mention.excerpt.slice(0, 40)}`"
      @change="$emit('toggle', mention.id)"
    />

    <div class="flex min-w-0 flex-1 flex-col gap-1.5">
      <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span class="inline-flex items-center gap-1">
          <Icon :name="sourceIcon" class="h-3.5 w-3.5" />
          {{ sourceLabel }}
        </span>
        <Badge :variant="kindVariant" class="shadow-none">{{ kindLabel }}</Badge>
        <span v-if="mention.author" class="truncate">by {{ mention.author }}</span>
        <span :title="publishedTitle">{{ relativeTime }}</span>
        <span v-if="mention.score !== null" class="inline-flex items-center gap-1" title="Points, upvotes or likes">
          <Icon name="lucide:arrow-up" class="h-3.5 w-3.5" />
          {{ mention.score }}
        </span>
      </div>

      <p v-if="mention.title" class="text-sm font-medium text-foreground break-words">
        <template v-for="(segment, index) in titleSegments" :key="`t${index}`">
          <mark v-if="segment.match" class="rounded bg-primary/20 px-0.5 text-foreground">{{ segment.text }}</mark>
          <template v-else>{{ segment.text }}</template>
        </template>
      </p>
      <p v-if="bodySegments.length" class="text-sm text-muted-foreground break-words">
        <template v-for="(segment, index) in bodySegments" :key="`b${index}`">
          <mark v-if="segment.match" class="rounded bg-primary/20 px-0.5 text-foreground">{{ segment.text }}</mark>
          <template v-else>{{ segment.text }}</template>
        </template>
      </p>

      <div class="flex flex-wrap items-center gap-2 pt-1">
        <Button v-if="safeUrl" as-child variant="outline" size="sm">
          <a :href="safeUrl" target="_blank" rel="noopener noreferrer">
            <Icon name="lucide:external-link" class="mr-1.5 h-3.5 w-3.5" />
            Open
          </a>
        </Button>
        <Button
          v-if="mention.status !== 'seen'"
          variant="ghost"
          size="sm"
          :disabled="busy"
          @click="$emit('status', mention.id, 'seen')"
        >
          <Icon name="lucide:check" class="mr-1.5 h-3.5 w-3.5" />
          Mark seen
        </Button>
        <Button
          v-if="mention.status !== 'dismissed'"
          variant="ghost"
          size="sm"
          :disabled="busy"
          @click="$emit('status', mention.id, 'dismissed')"
        >
          <Icon name="lucide:x" class="mr-1.5 h-3.5 w-3.5" />
          Dismiss
        </Button>
        <Button
          v-if="mention.status !== 'new'"
          variant="ghost"
          size="sm"
          :disabled="busy"
          @click="$emit('status', mention.id, 'new')"
        >
          <Icon name="lucide:rotate-ccw" class="mr-1.5 h-3.5 w-3.5" />
          Mark new
        </Button>
        <Button
          v-if="canEscalate && mention.status !== 'escalated'"
          variant="ghost"
          size="sm"
          :disabled="busy"
          data-testid="mention-escalate"
          @click="$emit('escalate', mention.id)"
        >
          <Icon name="lucide:life-buoy" class="mr-1.5 h-3.5 w-3.5" />
          Escalate to support
        </Button>
        <Button v-if="conversationLink" as-child variant="ghost" size="sm" data-testid="mention-view-conversation">
          <NuxtLink :to="conversationLink">
            <Icon name="lucide:message-square" class="mr-1.5 h-3.5 w-3.5" />
            View conversation
          </NuxtLink>
        </Button>
        <span v-if="mention.termLabel" class="ml-auto text-xs text-muted-foreground"
          >Matched: {{ mention.termLabel }}</span
        >
      </div>
    </div>
  </li>
</template>

<script>
const SOURCES = {
  hackernews: { label: 'Hacker News', icon: 'lucide:flame' },
  reddit: { label: 'Reddit', icon: 'lucide:message-circle' },
  bluesky: { label: 'Bluesky', icon: 'lucide:cloud' },
}

const KINDS = {
  mention: { label: 'Brand mention', variant: 'default' },
  competitor: { label: 'Competitor', variant: 'secondary' },
  opportunity: { label: 'Opportunity', variant: 'outline' },
}

/**
 * Splits text around case-insensitive occurrences of `needle` so the template
 * can wrap matches in <mark>. No HTML is ever built from third-party text.
 */
function splitByTerm(text, needle) {
  const value = text || ''
  const term = (needle || '').trim()
  if (!value) return []
  if (!term) return [{ text: value, match: false }]
  const lowerValue = value.toLowerCase()
  const lowerTerm = term.toLowerCase()
  const segments = []
  let cursor = 0
  let index = lowerValue.indexOf(lowerTerm, cursor)
  while (index !== -1) {
    if (index > cursor) segments.push({ text: value.slice(cursor, index), match: false })
    segments.push({ text: value.slice(index, index + term.length), match: true })
    cursor = index + term.length
    index = lowerValue.indexOf(lowerTerm, cursor)
  }
  if (cursor < value.length) segments.push({ text: value.slice(cursor), match: false })
  return segments
}

export default {
  name: 'MentionItem',

  props: {
    mention: { type: Object, required: true },
    selected: { type: Boolean, default: false },
    busy: { type: Boolean, default: false },
    canEscalate: { type: Boolean, default: false },
  },

  emits: ['toggle', 'status', 'escalate'],

  computed: {
    sourceLabel() {
      return SOURCES[this.mention.source]?.label || this.mention.source
    },
    sourceIcon() {
      return SOURCES[this.mention.source]?.icon || 'lucide:globe'
    },
    kindLabel() {
      return KINDS[this.mention.kind]?.label || this.mention.kind
    },
    kindVariant() {
      return KINDS[this.mention.kind]?.variant || 'outline'
    },
    conversationLink() {
      const { conversationId, conversationInboxId } = this.mention
      if (!conversationId || !conversationInboxId) return null
      return { path: '/inbox', query: { inboxId: conversationInboxId, conversationId } }
    },
    safeUrl() {
      try {
        const url = new URL(this.mention.url)
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
      } catch {
        return null
      }
    },
    titleSegments() {
      return splitByTerm(this.mention.title, this.mention.termLabel)
    },
    bodyText() {
      // The stored excerpt starts with the title; do not show it twice.
      const { title, excerpt } = this.mention
      if (title && excerpt.startsWith(title)) return excerpt.slice(title.length).trim()
      return excerpt
    },
    bodySegments() {
      return splitByTerm(this.bodyText, this.mention.termLabel)
    },
    publishedTitle() {
      return new Date(this.mention.publishedAt).toLocaleString()
    },
    relativeTime() {
      const date = new Date(this.mention.publishedAt)
      const minutes = Math.floor((Date.now() - date.getTime()) / 60000)
      if (minutes < 1) return 'just now'
      if (minutes < 60) return `${minutes}m ago`
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return `${hours}h ago`
      const days = Math.floor(hours / 24)
      if (days < 30) return `${days}d ago`
      return date.toLocaleDateString()
    },
  },
}
</script>
