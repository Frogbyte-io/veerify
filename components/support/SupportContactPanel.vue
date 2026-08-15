<template>
  <Sheet :open="open" @update:open="$emit('update:open', $event)">
    <SheetContent side="right" class="w-full sm:max-w-md overflow-y-auto">
      <SheetHeader>
        <SheetTitle>Contact details</SheetTitle>
        <SheetDescription class="sr-only">Contact attributes, company, and history</SheetDescription>
      </SheetHeader>

      <div class="px-4 pb-6 space-y-6">
        <!-- Loading -->
        <div v-if="isLoading" class="space-y-3">
          <Skeleton class="h-16 w-full" />
          <Skeleton class="h-24 w-full" />
          <Skeleton class="h-24 w-full" />
        </div>

        <!-- Error -->
        <div v-else-if="error" class="text-center py-6">
          <Icon name="lucide:alert-circle" class="w-6 h-6 text-destructive mx-auto mb-2" />
          <p class="text-sm text-muted-foreground mb-3">{{ error }}</p>
          <Button variant="outline" size="sm" @click="$emit('retry')">
            <Icon name="lucide:refresh-cw" class="w-3.5 h-3.5 mr-1.5" />
            Try again
          </Button>
        </div>

        <template v-else-if="contact">
          <!-- Identity -->
          <div class="flex items-center gap-3">
            <Avatar class="h-12 w-12 shrink-0">
              <AvatarFallback>{{ initials(contact.name || contact.email) }}</AvatarFallback>
            </Avatar>
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <p class="font-semibold truncate">{{ contact.name || contact.email || 'Unnamed contact' }}</p>
                <Badge v-if="contact.blockedAt" variant="outline" class="text-[10px]">Blocked</Badge>
              </div>
              <p v-if="contact.name && contact.email" class="text-sm text-muted-foreground truncate">
                {{ contact.email }}
              </p>
              <p v-if="contact.phone" class="text-xs text-muted-foreground">{{ contact.phone }}</p>
            </div>
          </div>
          <NuxtLink
            :to="`/support/contacts/${contact.id}`"
            class="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            View full contact profile
            <Icon name="lucide:arrow-up-right" class="w-3 h-3" />
          </NuxtLink>

          <!-- Company -->
          <div v-if="company">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Company</h3>
            <div class="rounded-lg border bg-card p-3 flex items-center gap-2">
              <Icon name="lucide:building-2" class="w-4 h-4 text-muted-foreground shrink-0" />
              <div class="min-w-0">
                <p class="text-sm font-medium truncate">{{ company.name }}</p>
                <p v-if="company.domain" class="text-xs text-muted-foreground truncate">{{ company.domain }}</p>
              </div>
            </div>
          </div>

          <!-- Attributes -->
          <div v-if="attributeEntries.length > 0">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Attributes</h3>
            <dl class="space-y-1.5">
              <div
                v-for="[key, value] in attributeEntries"
                :key="key"
                class="flex items-start justify-between gap-2 text-sm"
              >
                <dt class="text-muted-foreground shrink-0">{{ key }}</dt>
                <dd class="text-right break-words">{{ value }}</dd>
              </div>
            </dl>
          </div>

          <!-- Previous conversations (this inbox) -->
          <div>
            <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Previous conversations
            </h3>
            <div v-if="previousConversationsLoading" class="space-y-2">
              <Skeleton class="h-10 w-full" />
            </div>
            <p v-else-if="previousConversations.length === 0" class="text-sm text-muted-foreground">
              No other conversations in this inbox.
            </p>
            <div v-else class="space-y-1.5">
              <button
                v-for="conv in previousConversations"
                :key="conv.id"
                type="button"
                class="w-full text-left rounded-md border bg-card px-2.5 py-2 text-sm hover:bg-accent transition-colors"
                @click="$emit('select-conversation', conv.id)"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate">{{ conv.subject || 'No subject' }}</span>
                  <span class="text-xs text-muted-foreground shrink-0">#{{ conv.displayId }}</span>
                </div>
              </button>
            </div>
          </div>

          <!-- Stage 01 timeline -->
          <div>
            <div class="flex items-center gap-2 mb-2">
              <Icon name="lucide:link" class="w-3.5 h-3.5 text-foreground" />
              <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Linked feedback</h3>
            </div>
            <div v-if="timelineLoading" class="space-y-2">
              <Skeleton class="h-10 w-full" />
            </div>
            <p v-else-if="linked.length === 0" class="text-sm text-muted-foreground">No linked feedback yet.</p>
            <div v-else class="space-y-1.5">
              <div v-for="link in linked" :key="link.id" class="rounded-md border bg-card px-2.5 py-2 text-sm truncate">
                {{ link.entityType }}: {{ link.entityId }}
              </div>
            </div>

            <!-- Deliberately distinct styling from the "Linked" section above -
                 a possible match is a heuristic suggestion, never a confirmed
                 identity (see pages/support/contacts/[id].vue for the same
                 convention). -->
            <div
              v-if="!timelineLoading && probableFeedback.length > 0"
              class="mt-3 rounded-lg border border-dashed border-amber-400/60 bg-amber-500/5 p-3"
            >
              <div class="flex items-center gap-1.5 mb-1">
                <Icon name="lucide:sparkles" class="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <h4 class="text-xs font-semibold">Possible matches</h4>
              </div>
              <p class="text-[11px] text-muted-foreground mb-2">Matching email or account — not confirmed.</p>
              <div class="space-y-1.5">
                <div
                  v-for="fb in probableFeedback"
                  :key="fb.id"
                  class="flex items-center justify-between gap-2 rounded-md border bg-card px-2.5 py-2 text-sm"
                >
                  <span class="truncate">{{ fb.title }}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    class="h-6 px-2 text-xs shrink-0"
                    :disabled="linkingId === fb.id"
                    @click="$emit('link-feedback', fb.id)"
                  >
                    <Icon v-if="linkingId === fb.id" name="lucide:loader-2" class="w-3 h-3 animate-spin" />
                    <span v-else>Link</span>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </SheetContent>
  </Sheet>
</template>

<script>
export default {
  name: 'SupportContactPanel',

  props: {
    open: { type: Boolean, default: false },
    contact: { type: Object, default: null },
    company: { type: Object, default: null },
    isLoading: { type: Boolean, default: false },
    error: { type: String, default: null },
    linked: { type: Array, default: () => [] },
    probableFeedback: { type: Array, default: () => [] },
    timelineLoading: { type: Boolean, default: false },
    previousConversations: { type: Array, default: () => [] },
    previousConversationsLoading: { type: Boolean, default: false },
    linkingId: { type: String, default: null },
  },

  emits: ['update:open', 'retry', 'link-feedback', 'select-conversation'],

  computed: {
    attributeEntries() {
      if (!this.contact?.attributes || typeof this.contact.attributes !== 'object') return []
      return Object.entries(this.contact.attributes).filter(([, value]) => value !== null && value !== undefined)
    },
  },

  methods: {
    initials(value) {
      if (!value) return '?'
      const parts = value.trim().split(/\s+/)
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    },
  },
}
</script>
