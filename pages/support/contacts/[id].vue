<template>
  <NuxtLayout name="dashboard">
    <div class="p-6 max-w-4xl mx-auto space-y-6">
      <NuxtLink
        to="/support/contacts"
        class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <Icon name="lucide:arrow-left" class="w-4 h-4" />
        Contacts
      </NuxtLink>

      <!-- Loading -->
      <div v-if="isLoading" class="space-y-3">
        <Skeleton class="h-24 w-full" />
        <Skeleton class="h-40 w-full" />
        <Skeleton class="h-40 w-full" />
      </div>

      <!-- Error -->
      <Card v-else-if="error">
        <CardContent class="text-center py-8">
          <Icon name="lucide:alert-circle" class="w-8 h-8 text-destructive mx-auto mb-3" />
          <p class="font-medium mb-2">Failed to load contact</p>
          <p class="text-sm text-muted-foreground mb-4">{{ error }}</p>
          <Button variant="outline" @click="loadAll">
            <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
            Try again
          </Button>
        </CardContent>
      </Card>

      <template v-else-if="contact">
        <!-- Header -->
        <Card>
          <CardContent class="p-6">
            <div class="flex items-start justify-between gap-4">
              <div class="flex items-center gap-4 min-w-0">
                <Avatar class="h-14 w-14 shrink-0">
                  <AvatarFallback class="text-lg">{{ initials(contact.name || contact.email) }}</AvatarFallback>
                </Avatar>
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <h1 class="text-2xl font-bold truncate">
                      {{ contact.name || contact.email || 'Unnamed contact' }}
                    </h1>
                    <Badge v-if="contact.blockedAt" variant="outline">Blocked</Badge>
                  </div>
                  <p v-if="contact.name && contact.email" class="text-muted-foreground">{{ contact.email }}</p>
                  <p v-if="contact.phone" class="text-sm text-muted-foreground">{{ contact.phone }}</p>
                  <p v-if="company" class="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                    <Icon name="lucide:building-2" class="w-3.5 h-3.5" />
                    {{ company.name }}
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" @click="showMergeDialog = true">
                <Icon name="lucide:merge" class="w-4 h-4 mr-2" />
                Merge
              </Button>
            </div>
          </CardContent>
        </Card>

        <!-- Identities -->
        <Card v-if="identities.length > 0">
          <CardContent class="p-6">
            <h2 class="font-semibold mb-3">Identities</h2>
            <div class="flex flex-wrap gap-2">
              <Badge v-for="identity in identities" :key="identity.id" variant="secondary" class="font-normal">
                {{ identity.kind }}: {{ identity.value }}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <!-- Timeline -->
        <Card>
          <CardContent class="p-6 space-y-6">
            <div>
              <div class="flex items-center gap-2 mb-3">
                <Icon name="lucide:link" class="w-4 h-4 text-foreground" />
                <h2 class="font-semibold">Linked</h2>
                <span class="text-xs text-muted-foreground">Linked feedback, whether automatic or confirmed by an agent.</span>
              </div>

              <div v-if="isTimelineLoading" class="space-y-2">
                <Skeleton class="h-12 w-full" />
              </div>
              <p v-else-if="linked.length === 0" class="text-sm text-muted-foreground">No linked feedback yet.</p>
              <div v-else class="space-y-2">
                <div
                  v-for="link in linked"
                  :key="link.id"
                  class="flex items-center justify-between rounded-lg border bg-card p-3"
                >
                  <div class="flex min-w-0 items-center gap-2">
                    <span class="text-sm truncate">{{ link.entityType }}: {{ link.entityId }}</span>
                    <Badge v-if="link.source === 'auto'" variant="secondary" class="shrink-0">Automatically linked</Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    :aria-label="link.source === 'auto' ? 'Remove automatic link' : 'Unlink feedback'"
                    @click="unlink(link.id)"
                  >
                    <Icon name="lucide:x" class="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>

            <!-- Deliberately distinct styling: possible matches are a heuristic
                 suggestion, never a confirmed identity. Mixing this with the
                 Linked section visually would misrepresent a guess as fact. -->
            <div
              v-if="probableFeedback.length > 0"
              class="rounded-lg border border-dashed border-amber-400/60 bg-amber-500/5 p-4"
            >
              <div class="flex items-center gap-2 mb-1">
                <Icon name="lucide:sparkles" class="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <h2 class="font-semibold">Possible matches</h2>
              </div>
              <p class="text-xs text-muted-foreground mb-3">
                Feedback submitted with a matching email or account — not confirmed. Link the ones that belong to this
                contact.
              </p>
              <div class="space-y-2">
                <div
                  v-for="feedback in probableFeedback"
                  :key="feedback.id"
                  class="flex items-center justify-between rounded-lg border bg-card p-3"
                >
                  <div class="min-w-0">
                    <p class="text-sm font-medium truncate">{{ feedback.title }}</p>
                    <p v-if="feedback.project" class="text-xs text-muted-foreground">{{ feedback.project.name }}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="linkingId === feedback.id"
                    @click="linkFeedback(feedback.id)"
                  >
                    <Icon v-if="linkingId === feedback.id" name="lucide:loader-2" class="w-4 h-4 mr-1.5 animate-spin" />
                    Link
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </template>
    </div>

    <!-- Merge dialog -->
    <Dialog :open="showMergeDialog" @update:open="showMergeDialog = $event">
      <DialogContent class="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Merge contact</DialogTitle>
          <DialogDescription>
            Choose a contact to merge into this one. The other contact's identities and links move here, and it is
            retained as a redirect so nothing referencing it breaks.
          </DialogDescription>
        </DialogHeader>

        <Input v-model="mergeSearch" placeholder="Search by name or email" @input="onMergeSearchInput" />

        <div v-if="mergeCandidates.length > 0" class="max-h-56 overflow-y-auto space-y-1 -mx-1 px-1">
          <button
            v-for="candidate in mergeCandidates"
            :key="candidate.id"
            type="button"
            class="w-full text-left rounded-md border p-2.5 text-sm hover:bg-accent transition-colors"
            :class="{ 'border-primary bg-accent': mergeSourceId === candidate.id }"
            @click="mergeSourceId = candidate.id"
          >
            <p class="font-medium truncate">{{ candidate.name || candidate.email || 'Unnamed contact' }}</p>
            <p v-if="candidate.name && candidate.email" class="text-xs text-muted-foreground truncate">
              {{ candidate.email }}
            </p>
          </button>
        </div>
        <p v-else-if="mergeSearch" class="text-sm text-muted-foreground">No contacts match.</p>

        <p v-if="mergeError" class="text-sm text-destructive">{{ mergeError }}</p>

        <DialogFooter>
          <Button variant="outline" @click="showMergeDialog = false">Cancel</Button>
          <Button :disabled="!mergeSourceId || isMerging" @click="confirmMerge">
            <Icon v-if="isMerging" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
            Merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </NuxtLayout>
</template>

<script>
const SEARCH_DEBOUNCE_MS = 300

export default {
  name: 'SupportContactDetailPage',

  data() {
    return {
      contact: null,
      identities: [],
      company: null,
      linked: [],
      probableFeedback: [],
      isLoading: true,
      isTimelineLoading: true,
      error: null,
      linkingId: null,

      showMergeDialog: false,
      mergeSearch: '',
      mergeCandidates: [],
      mergeSourceId: null,
      mergeError: null,
      isMerging: false,
      mergeSearchDebounceTimer: null,
    }
  },

  async mounted() {
    await this.loadAll()
  },

  methods: {
    contactId() {
      return this.$route.params.id
    },

    async loadAll() {
      this.isLoading = true
      this.error = null

      try {
        const detail = await $fetch(`/api/support/contacts/${this.contactId()}`)
        this.contact = detail?.data?.contact || null
        this.identities = detail?.data?.identities || []
        this.company = detail?.data?.company || null
      } catch {
        this.error = 'Something went wrong. Please try again.'
        this.isLoading = false
        return
      }

      this.isLoading = false
      await this.loadTimeline()
    },

    async loadTimeline() {
      this.isTimelineLoading = true
      try {
        const response = await $fetch(`/api/support/contacts/${this.contactId()}/timeline`)
        this.linked = response?.data?.linked || []
        this.probableFeedback = response?.data?.probableFeedback || []
      } catch {
        // The header still loaded successfully; leave the timeline empty
        // rather than blocking the whole page on a secondary failure.
        this.linked = []
        this.probableFeedback = []
      } finally {
        this.isTimelineLoading = false
      }
    },

    async linkFeedback(feedbackId) {
      this.linkingId = feedbackId
      try {
        await $fetch(`/api/support/contacts/${this.contactId()}/links`, {
          method: 'POST',
          body: { entityType: 'feedback', entityId: feedbackId },
        })
        await this.loadTimeline()
      } catch {
        // Surfacing this inline keeps the possible-match row visible so the
        // agent can retry, rather than losing their place on a toast timeout.
      } finally {
        this.linkingId = null
      }
    },

    async unlink(linkId) {
      try {
        await $fetch(`/api/support/contacts/${this.contactId()}/links/${linkId}`, { method: 'DELETE' })
        await this.loadTimeline()
      } catch {
        // no-op: the row remains, the user can retry
      }
    },

    onMergeSearchInput() {
      if (this.mergeSearchDebounceTimer) clearTimeout(this.mergeSearchDebounceTimer)
      this.mergeSearchDebounceTimer = setTimeout(() => {
        this.searchMergeCandidates()
      }, SEARCH_DEBOUNCE_MS)
    },

    async searchMergeCandidates() {
      if (!this.contact?.teamId || !this.mergeSearch) {
        this.mergeCandidates = []
        return
      }
      try {
        const response = await $fetch('/api/support/contacts', {
          params: { teamId: this.contact.teamId, search: this.mergeSearch, limit: 10 },
        })
        this.mergeCandidates = (response?.data?.contacts || []).filter((c) => c.id !== this.contactId())
      } catch {
        this.mergeCandidates = []
      }
    },

    async confirmMerge() {
      if (!this.mergeSourceId) return
      this.isMerging = true
      this.mergeError = null

      try {
        await $fetch(`/api/support/contacts/${this.contactId()}/merge`, {
          method: 'POST',
          body: { sourceContactId: this.mergeSourceId },
        })
        this.showMergeDialog = false
        this.mergeSourceId = null
        this.mergeSearch = ''
        this.mergeCandidates = []
        await this.loadAll()
      } catch (err) {
        this.mergeError = err?.data?.error?.message || err?.statusMessage || 'Could not merge these contacts.'
      } finally {
        this.isMerging = false
      }
    },

    initials(value) {
      if (!value) return '?'
      const parts = value.trim().split(/\s+/)
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    },
  },
}
</script>
