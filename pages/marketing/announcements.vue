<template>
  <PageContainer data-testid="marketing-announcements-page">
    <PageHeader
      title="Announcements"
      description="Draft posts for X, LinkedIn, Bluesky and your newsletter from each published changelog entry. Titles of feedback linked to an entry are included only with your workspace's data consent for feedback text, and never for hidden or support-derived items."
    />

    <MarketingProjectLoader @change="onProjectChange" @error="onPickerError" />

    <template v-if="!pickerError">
      <div v-if="!pickerSettled || isLoading" class="space-y-6">
        <Skeleton class="h-48 w-full" />
        <Skeleton class="h-48 w-full" />
        <Skeleton class="h-48 w-full" />
      </div>

      <MarketingNotice v-else-if="!project" title="No project yet">
        Marketing works on a project. Create one to draft announcements.
        <template #actions>
          <Button as-child variant="outline">
            <NuxtLink to="/workspace">Go to workspace settings</NuxtLink>
          </Button>
        </template>
      </MarketingNotice>

      <MarketingDisabled v-else-if="marketingOff" :project="project" :message="disabledMessage" />

      <MarketingLoadError v-else-if="error" title="Failed to load announcements" :message="error" @retry="load()" />

      <MarketingNotice
        v-else-if="!changelogEnabled"
        title="The changelog is off for this project"
        data-testid="announcements-changelog-off"
      >
        Announcement drafts come from published changelog entries. Turn the changelog on for this project, then publish
        an entry.
        <template #actions>
          <Button as-child variant="outline">
            <NuxtLink to="/dashboard/changelog">
              <Icon name="lucide:newspaper" class="mr-2 h-4 w-4" />
              Go to the changelog
            </NuxtLink>
          </Button>
        </template>
      </MarketingNotice>

      <MarketingNotice v-else-if="!entries.length" title="No published entries yet" data-testid="announcements-empty">
        Publish a changelog entry and it shows up here, ready for announcement drafts.
        <template #actions>
          <Button as-child variant="outline">
            <NuxtLink to="/dashboard/changelog">
              <Icon name="lucide:newspaper" class="mr-2 h-4 w-4" />
              Go to the changelog
            </NuxtLink>
          </Button>
        </template>
      </MarketingNotice>

      <template v-else>
        <p
          v-if="targetMissing"
          class="flex items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground"
          role="status"
          data-testid="announcements-entry-not-found"
        >
          <Icon name="lucide:info" class="h-4 w-4 shrink-0" />
          Entry not found or not published yet
        </p>

        <div
          v-if="!hasUsableKey"
          class="rounded-lg border border-border bg-card p-4 text-sm"
          data-testid="announcements-no-key"
        >
          <p class="font-medium">Add an AI key to generate drafts</p>
          <p class="mt-1 text-muted-foreground">
            Drafts are written with your own Anthropic, OpenAI, Gemini or Perplexity key, so the cost stays on your
            account. Add one in
            <NuxtLink to="/marketing/settings" class="underline">Marketing settings</NuxtLink>
            . You can still write and save drafts by hand.
          </p>
        </div>

        <MarketingAnnouncementCard
          v-for="entry in entries"
          :key="`${project.id}:${entry.id}`"
          :project-id="project.id"
          :entry="entry"
          :limits="limits"
          :has-usable-key="hasUsableKey"
          :highlighted="entry.id === highlightId"
        />

        <div v-if="loadMoreError" class="flex items-center gap-2 text-sm text-destructive">
          <span>{{ loadMoreError }}</span>
          <Button variant="outline" size="sm" @click="loadMore">Retry</Button>
        </div>
        <Button v-else-if="nextCursor" variant="outline" :disabled="loadingMore" @click="loadMore">
          {{ loadingMore ? 'Loading...' : 'Load more' }}
        </Button>
      </template>
    </template>
  </PageContainer>
</template>

<script>
import { apiErrorMessage, apiErrorStatus } from '~/lib/api-error'

// Pages fetched at most while looking for the ?entry= target
const MAX_TARGET_PAGES = 10

export default {
  name: 'MarketingAnnouncementsPage',

  created() {
    useHead({ title: 'Announcements · Marketing' })
  },

  data() {
    return {
      project: null,
      pickerSettled: false,
      pickerError: false,
      isLoading: false,
      error: null,
      marketingOff: false,
      disabledMessage: '',
      changelogEnabled: true,
      hasUsableKey: false,
      limits: { x: 280, bluesky: 300, linkedin: 1300, newsletter: 2000 },
      entries: [],
      nextCursor: null,
      loadingMore: false,
      loadMoreError: null,
      highlightId: null,
      targetMissing: false,
    }
  },

  methods: {
    base(projectId = this.project.id) {
      return `/api/marketing/projects/${projectId}/announcements`
    },

    onPickerError() {
      this.project = null
      this.pickerError = true
      this.pickerSettled = true
    },

    async onProjectChange(project) {
      this.project = project
      this.pickerSettled = true
      this.pickerError = false
      this.isLoading = false
      this.error = null
      this.marketingOff = false
      this.entries = []
      this.nextCursor = null
      this.loadMoreError = null
      this.loadingMore = false
      this.highlightId = null
      this.targetMissing = false
      if (project) await this.load()
    },

    async fetchPage(projectId, cursor) {
      const response = await $fetch(this.base(projectId), { query: cursor ? { cursor } : {} })
      return response.data
    },

    async load() {
      if (!this.project) return
      const projectId = this.project.id
      this.isLoading = true
      this.error = null
      this.marketingOff = false
      this.targetMissing = false
      this.loadingMore = false
      try {
        const data = await this.fetchPage(projectId)
        if (this.project?.id !== projectId) return
        this.changelogEnabled = data.changelogEnabled
        this.hasUsableKey = data.hasUsableKey
        this.limits = data.limits
        this.entries = data.entries
        this.nextCursor = data.nextCursor
      } catch (err) {
        if (this.project?.id !== projectId) return
        if (apiErrorStatus(err) === 403) {
          this.marketingOff = true
          this.disabledMessage = apiErrorMessage(err, '')
        } else {
          this.error = apiErrorMessage(err, 'Failed to load announcements')
        }
      } finally {
        if (this.project?.id === projectId) this.isLoading = false
      }
      if (this.project?.id === projectId && !this.error && !this.marketingOff) await this.focusTarget(projectId)
    },

    async loadMore() {
      if (!this.project || !this.nextCursor || this.loadingMore) return
      const projectId = this.project.id
      this.loadingMore = true
      this.loadMoreError = null
      try {
        const data = await this.fetchPage(projectId, this.nextCursor)
        if (this.project?.id !== projectId) return
        this.entries = [...this.entries, ...data.entries]
        this.nextCursor = data.nextCursor
      } catch (err) {
        if (this.project?.id !== projectId) return
        this.loadMoreError = apiErrorMessage(err, 'Failed to load more entries')
      } finally {
        if (this.project?.id === projectId) this.loadingMore = false
      }
    },

    /** Scroll to and highlight the entry named by ?entry=, paging forward to find it. */
    async focusTarget(projectId) {
      const target = this.$route.query.entry
      if (typeof target !== 'string' || !target) return
      for (let page = 0; page < MAX_TARGET_PAGES; page++) {
        if (this.project?.id !== projectId) return
        if (this.entries.some((e) => e.id === target)) {
          this.highlightId = target
          await this.$nextTick()
          if (import.meta.client) {
            document.getElementById(`announcement-${target}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
          return
        }
        if (!this.nextCursor) break
        const before = this.nextCursor
        await this.loadMore()
        // loadMore no-ops while another page is in flight; stop rather than spin
        if (this.nextCursor === before && !this.loadMoreError) break
        // A failed page shows its own retry; the entry may still be further down
        if (this.loadMoreError) return
      }
      if (this.project?.id === projectId) this.targetMissing = true
    },
  },
}
</script>
