<template>
  <NuxtLayout name="dashboard">
    <div class="p-6 max-w-5xl mx-auto space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-3xl font-bold tracking-tight text-foreground">Contacts</h1>
          <p class="text-muted-foreground mt-1">Customers who have contacted support</p>
        </div>
        <div class="relative w-full sm:w-72">
          <Icon
            name="lucide:search"
            class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
          />
          <Input v-model="search" placeholder="Search by name or email" class="pl-9" @input="onSearchInput" />
        </div>
      </div>

      <!-- Loading -->
      <div v-if="isLoading" class="space-y-3">
        <Skeleton v-for="i in 6" :key="i" class="h-16 w-full" />
      </div>

      <!-- Support switched off for this project -->
      <Card v-else-if="supportDisabled" data-testid="support-disabled">
        <CardContent class="text-center py-10 space-y-3">
          <Icon name="lucide:life-buoy" class="w-8 h-8 text-muted-foreground mx-auto" />
          <p class="font-medium">Support is switched off for this project</p>
          <template v-if="projectRole === 'admin'">
            <p class="text-sm text-muted-foreground">Switch it on under Project settings, Tools.</p>
            <Button as-child variant="outline">
              <NuxtLink to="/project/settings#tools">Project settings: Tools</NuxtLink>
            </Button>
          </template>
          <p v-else class="text-sm text-muted-foreground flex items-center justify-center gap-1.5">
            <Icon name="lucide:lock" class="w-3.5 h-3.5" />
            Project admins can switch Support on.
          </p>
        </CardContent>
      </Card>

      <!-- Error -->
      <Card v-else-if="error">
        <CardContent class="text-center py-8">
          <Icon name="lucide:alert-circle" class="w-8 h-8 text-destructive mx-auto mb-3" />
          <p class="font-medium mb-2">Failed to load contacts</p>
          <p class="text-sm text-muted-foreground mb-4">{{ error }}</p>
          <Button variant="outline" @click="initProjectContext">
            <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
            Try again
          </Button>
        </CardContent>
      </Card>

      <!-- Empty state -->
      <Card v-else-if="contacts.length === 0">
        <CardContent class="text-center py-12">
          <div class="flex justify-center mb-4">
            <div class="flex items-center justify-center w-14 h-14 rounded-full bg-muted">
              <Icon name="lucide:users" class="w-7 h-7 text-muted-foreground" />
            </div>
          </div>
          <p class="font-medium text-lg mb-1">{{ search ? 'No contacts match your search' : 'No contacts yet' }}</p>
          <p class="text-sm text-muted-foreground max-w-sm mx-auto">
            Contacts appear here once someone reaches out to your project through support.
          </p>
        </CardContent>
      </Card>

      <!-- List -->
      <template v-else>
        <div class="space-y-2">
          <NuxtLink
            v-for="item in contacts"
            :key="item.id"
            :to="`/support/contacts/${item.id}`"
            prefetch-on="interaction"
            class="flex items-center justify-between rounded-lg border bg-card p-4 cursor-pointer hover:bg-accent/50 transition-colors"
          >
            <div class="flex items-center gap-3 min-w-0 flex-1">
              <Avatar class="h-9 w-9 shrink-0">
                <AvatarFallback>{{ initials(item.name || item.email) }}</AvatarFallback>
              </Avatar>
              <div class="min-w-0">
                <p class="font-medium truncate">{{ item.name || item.email || 'Unnamed contact' }}</p>
                <p v-if="item.name && item.email" class="text-sm text-muted-foreground truncate">
                  {{ item.email }}
                </p>
              </div>
            </div>
            <div class="flex items-center gap-3 shrink-0 ml-4">
              <Badge v-if="item.blockedAt" variant="outline" class="text-xs">Blocked</Badge>
              <span class="text-xs text-muted-foreground">{{ formatDate(item.createdAt) }}</span>
              <Icon name="lucide:chevron-right" class="w-4 h-4 text-muted-foreground" />
            </div>
          </NuxtLink>
        </div>

        <div v-if="hasMore" class="flex justify-center pt-2">
          <Button variant="outline" size="sm" :disabled="isLoadingMore" @click="loadContacts(false)">
            <Icon v-if="isLoadingMore" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
            {{ isLoadingMore ? 'Loading...' : 'Load more' }}
          </Button>
        </div>
      </template>
    </div>
  </NuxtLayout>
</template>

<script>
const ACTIVE_PROJECT_CHANGED_EVENT = 'veerify:active-project-changed'
const SEARCH_DEBOUNCE_MS = 300

export default {
  name: 'SupportContactsPage',

  data() {
    return {
      activeProjectId: '',
      projectRole: null,
      supportDisabled: false,
      contacts: [],
      isLoading: true,
      isLoadingMore: false,
      error: null,
      search: '',
      nextCursor: null,
      hasMore: false,
      searchDebounceTimer: null,
    }
  },

  async mounted() {
    await this.initProjectContext()
    if (import.meta.client) {
      window.addEventListener(ACTIVE_PROJECT_CHANGED_EVENT, this.handleActiveProjectChanged)
    }
  },

  beforeUnmount() {
    if (import.meta.client) {
      window.removeEventListener(ACTIVE_PROJECT_CHANGED_EVENT, this.handleActiveProjectChanged)
    }
    if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer)
  },

  methods: {
    async handleActiveProjectChanged() {
      await this.initProjectContext()
    },

    async initProjectContext() {
      this.isLoading = true
      this.error = null

      try {
        const projectResponse = await $fetch('/api/projects/active')
        const activeProjectData = projectResponse?.data?.project

        if (!activeProjectData?.id) {
          this.error = 'No active project found'
          this.isLoading = false
          return
        }

        this.activeProjectId = activeProjectData.id
        this.projectRole = activeProjectData.role || null
        this.supportDisabled = projectResponse.data.modules?.supportEnabled === false
        if (this.supportDisabled) {
          this.isLoading = false
          return
        }
        await this.loadContacts(true)
      } catch {
        this.error = 'Something went wrong. Please try again.'
        this.isLoading = false
      }
    },

    onSearchInput() {
      if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer)
      this.searchDebounceTimer = setTimeout(() => {
        this.loadContacts(true)
      }, SEARCH_DEBOUNCE_MS)
    },

    async loadContacts(reset) {
      if (!this.activeProjectId) return

      if (reset) {
        this.isLoading = true
        this.nextCursor = null
      } else {
        this.isLoadingMore = true
      }
      this.error = null

      try {
        const response = await $fetch('/api/support/contacts', {
          params: {
            projectId: this.activeProjectId,
            search: this.search || undefined,
            limit: 25,
            cursor: reset ? undefined : this.nextCursor || undefined,
          },
        })

        const page = response?.data?.contacts || []
        this.contacts = reset ? page : [...this.contacts, ...page]
        this.hasMore = Boolean(response?.data?.hasMore)
        this.nextCursor = response?.data?.nextCursor || null
      } catch {
        this.error = 'Something went wrong. Please try again.'
      } finally {
        this.isLoading = false
        this.isLoadingMore = false
      }
    },

    initials(value) {
      if (!value) return '?'
      const parts = value.trim().split(/\s+/)
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    },

    formatDate(date) {
      if (!date) return ''
      const d = new Date(date)
      const now = new Date()
      const diffMs = now.getTime() - d.getTime()
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

      if (diffDays === 0) return 'Today'
      if (diffDays === 1) return 'Yesterday'
      if (diffDays < 7) return `${diffDays} days ago`
      if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
      return d.toLocaleDateString()
    },
  },
}
</script>
