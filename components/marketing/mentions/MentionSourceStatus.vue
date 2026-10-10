<template>
  <div class="rounded-lg border border-border bg-card p-4" data-testid="mention-source-status">
    <h2 class="mb-3 text-sm font-semibold text-foreground">Sources</h2>

    <div v-if="isLoading" class="grid gap-3 sm:grid-cols-3">
      <Skeleton v-for="n in 3" :key="n" class="h-16 w-full" />
    </div>

    <div v-else-if="error" class="flex items-center gap-2 text-sm text-destructive">
      <span>{{ error }}</span>
      <Button variant="outline" size="sm" @click="$emit('retry')">Retry</Button>
    </div>

    <div v-else class="grid gap-3 sm:grid-cols-3">
      <div
        v-for="source in sources"
        :key="source.id"
        class="rounded-md border border-border p-3 text-sm"
        :data-testid="`mention-source-${source.id}`"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="font-medium text-foreground">{{ source.label }}</span>
          <Badge v-if="!source.configured" variant="outline" class="shadow-none">Unavailable</Badge>
          <Badge v-else-if="source.lastError" variant="destructive" class="shadow-none">Error</Badge>
          <Badge v-else variant="secondary" class="shadow-none">Ready</Badge>
        </div>

        <p v-if="!source.configured" class="mt-1 text-xs text-muted-foreground">
          {{ unavailableHint(source) }}
        </p>
        <template v-else>
          <p class="mt-1 text-xs text-muted-foreground">
            {{ source.lastPolledAt ? `Last polled ${formatTime(source.lastPolledAt)}` : 'Not polled yet' }}
          </p>
          <p v-if="source.lastError" class="mt-1 break-words text-xs text-destructive">{{ source.lastError }}</p>
        </template>
      </div>
    </div>
  </div>
</template>

<script>
const ENV_HINTS = {
  reddit: 'Self-hosted installs need REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET set to enable Reddit.',
  bluesky: 'Self-hosted installs need BLUESKY_IDENTIFIER and BLUESKY_APP_PASSWORD set to enable Bluesky.',
}

export default {
  name: 'MentionSourceStatus',

  props: {
    sources: { type: Array, default: () => [] },
    isLoading: { type: Boolean, default: false },
    error: { type: String, default: null },
  },

  emits: ['retry'],

  methods: {
    unavailableHint(source) {
      return ENV_HINTS[source.id] || 'This source is not configured on this install.'
    },

    formatTime(value) {
      const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60000)
      if (minutes < 1) return 'just now'
      if (minutes < 60) return `${minutes}m ago`
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return `${hours}h ago`
      return new Date(value).toLocaleString()
    },
  },
}
</script>
