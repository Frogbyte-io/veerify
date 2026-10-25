<template>
  <Card data-testid="reviews-testimonials">
    <CardHeader>
      <CardTitle role="heading" aria-level="2">Testimonials</CardTitle>
      <CardDescription>
        Only testimonials the author agreed to publish and you approved appear on your public wall. Others stay private.
        <template v-if="wallUrl">
          <a
            :href="wallUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="font-medium text-primary underline underline-offset-2"
            data-testid="testimonials-wall-link"
          >
            Open the public wall
          </a>
        </template>
        <template v-else-if="project && project.isPublic === false"
          >This project is private, so there is no public wall.</template
        >
      </CardDescription>
    </CardHeader>

    <CardContent class="space-y-4">
      <div class="flex flex-wrap gap-2" role="tablist" aria-label="Testimonial status">
        <Button
          v-for="tab in tabs"
          :key="tab.value"
          size="sm"
          role="tab"
          :aria-selected="status === tab.value"
          :variant="status === tab.value ? 'default' : 'outline'"
          :data-testid="`testimonials-tab-${tab.value}`"
          @click="setStatus(tab.value)"
        >
          {{ tab.label }}
          <span class="ml-1 text-xs opacity-80">{{ counts[tab.value] }}</span>
        </Button>
      </div>

      <div v-if="isLoading" class="space-y-3" data-testid="testimonials-loading">
        <Skeleton v-for="n in 3" :key="n" class="h-28 w-full" />
      </div>

      <div v-else-if="error" class="flex items-center gap-2 text-sm text-destructive" data-testid="testimonials-error">
        <span>{{ error }}</span>
        <Button variant="outline" size="sm" @click="load">Retry</Button>
      </div>

      <p v-else-if="items.length === 0" class="text-sm text-muted-foreground" data-testid="testimonials-empty">
        No {{ status }} testimonials.
      </p>

      <ul v-else class="space-y-3">
        <li v-for="item in items" :key="item.id" class="rounded-md border p-4" data-testid="testimonial-row">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-medium">{{ item.authorName }}</span>
            <span v-if="subtitle(item)" class="text-xs text-muted-foreground">{{ subtitle(item) }}</span>
            <span v-if="item.rating" class="inline-flex items-center gap-0.5" :aria-label="`${item.rating} out of 5`">
              <Icon
                v-for="n in item.rating"
                :key="n"
                name="lucide:star"
                mode="svg"
                class="h-3.5 w-3.5 text-amber-500 [&_path]:fill-amber-400"
              />
            </span>
            <Badge :variant="item.consentPublic ? 'default' : 'outline'" data-testid="testimonial-consent">
              {{ item.consentPublic ? 'Public OK' : 'Private only' }}
            </Badge>
            <Badge v-if="item.featured" variant="secondary">Featured</Badge>
            <span v-if="item.authorEmail" class="text-xs text-muted-foreground">{{ item.authorEmail }}</span>
          </div>

          <!-- Plain text only: testimonial text is untrusted -->
          <p class="mt-2 whitespace-pre-wrap break-words text-sm">{{ item.quote }}</p>

          <p v-if="!item.consentPublic" class="mt-2 text-xs text-muted-foreground">
            The author did not agree to public display. Approving keeps it for private use only.
          </p>
          <p v-if="rowErrors[item.id]" class="mt-2 text-sm text-destructive" role="alert">{{ rowErrors[item.id] }}</p>

          <p v-if="!canManage" class="mt-3 text-xs text-muted-foreground" data-testid="testimonials-readonly">
            Only project admins can approve, feature or delete testimonials.
          </p>
          <div v-else class="mt-3 flex flex-wrap gap-2">
            <Button
              v-if="item.status !== 'approved'"
              size="sm"
              :disabled="busy[item.id]"
              data-testid="testimonial-approve"
              @click="update(item, { status: 'approved' })"
            >
              {{ item.consentPublic ? 'Approve' : 'Approve (private only)' }}
            </Button>
            <Button
              v-if="item.status !== 'rejected'"
              size="sm"
              variant="outline"
              :disabled="busy[item.id]"
              data-testid="testimonial-reject"
              @click="update(item, { status: 'rejected' })"
            >
              Reject
            </Button>
            <Button
              v-if="item.status === 'approved' && item.consentPublic"
              size="sm"
              variant="outline"
              :disabled="busy[item.id]"
              data-testid="testimonial-feature"
              @click="update(item, { featured: !item.featured })"
            >
              <Icon name="lucide:sparkles" class="mr-2 h-4 w-4" />
              {{ item.featured ? 'Unfeature' : 'Feature' }}
            </Button>
            <template v-if="confirmDeleteId === item.id">
              <Button
                size="sm"
                variant="destructive"
                :disabled="busy[item.id]"
                data-testid="testimonial-delete-confirm"
                @click="remove(item)"
              >
                Confirm delete
              </Button>
              <Button size="sm" variant="ghost" :disabled="busy[item.id]" @click="confirmDeleteId = null"
                >Cancel</Button
              >
            </template>
            <Button
              v-else
              size="sm"
              variant="ghost"
              :disabled="busy[item.id]"
              :aria-label="`Delete testimonial from ${item.authorName}`"
              data-testid="testimonial-delete"
              @click="confirmDeleteId = item.id"
            >
              <Icon name="lucide:trash-2" class="h-4 w-4" />
            </Button>
          </div>
        </li>
      </ul>
    </CardContent>
  </Card>
</template>

<script>
import { apiErrorMessage, apiErrorStatus } from '~/lib/api-error'
import { buildPublicBoardUrl } from '~/lib/public-board-url'

export default {
  name: 'MarketingReviewsTestimonials',

  props: {
    projectId: { type: String, required: true },
    // The active project (slug, isPublic, customDomain, settings), for the public wall link
    project: { type: Object, default: null },
    canManage: { type: Boolean, default: false },
  },

  emits: ['forbidden'],

  data() {
    return {
      tabs: [
        { value: 'pending', label: 'Pending' },
        { value: 'approved', label: 'Approved' },
        { value: 'rejected', label: 'Rejected' },
      ],
      status: 'pending',
      isLoading: true,
      error: null,
      items: [],
      counts: { pending: 0, approved: 0, rejected: 0 },
      busy: {},
      rowErrors: {},
      confirmDeleteId: null,
    }
  },

  computed: {
    // Only for public projects: a private project has no public wall.
    wallUrl() {
      if (!import.meta.client || !this.project || this.project.isPublic !== true) return ''
      const orgSlug = this.project.organization?.slug
      if (!this.project.customDomain && !orgSlug) return ''
      const boardUrl = buildPublicBoardUrl({
        orgSlug,
        customDomain: this.project.customDomain || null,
        projectSlug: this.project.slug,
        appDomain: useRuntimeConfig().public.appDomain || 'localhost',
        protocol: window.location.protocol,
        port: window.location.port,
      })
      return `${boardUrl.replace(/\/+$/, '')}/testimonials`
    },
  },

  async mounted() {
    await this.load()
  },

  methods: {
    subtitle(item) {
      return [item.authorTitle, item.authorCompany].filter(Boolean).join(', ')
    },

    setStatus(value) {
      if (value === this.status) return
      this.status = value
      this.load()
    },

    async load() {
      const projectId = this.projectId
      const status = this.status
      this.isLoading = true
      this.error = null
      this.confirmDeleteId = null
      try {
        const response = await $fetch(`/api/marketing/projects/${projectId}/testimonials`, { query: { status } })
        if (projectId !== this.projectId || status !== this.status) return
        this.items = response.data.items
        this.counts = response.data.counts
      } catch (err) {
        if (projectId !== this.projectId || status !== this.status) return
        if (apiErrorStatus(err) === 403) this.$emit('forbidden', apiErrorMessage(err, ''))
        else this.error = apiErrorMessage(err, 'Failed to load testimonials')
      } finally {
        if (projectId === this.projectId && status === this.status) this.isLoading = false
      }
    },

    async update(item, patch) {
      const projectId = this.projectId
      this.busy = { ...this.busy, [item.id]: true }
      this.rowErrors = { ...this.rowErrors, [item.id]: '' }
      try {
        await $fetch(`/api/marketing/projects/${projectId}/testimonials/${item.id}`, { method: 'PATCH', body: patch })
        if (projectId !== this.projectId) return
        await this.load()
      } catch (err) {
        if (projectId !== this.projectId) return
        this.rowErrors = { ...this.rowErrors, [item.id]: apiErrorMessage(err, 'Could not update the testimonial') }
      } finally {
        this.busy = { ...this.busy, [item.id]: false }
      }
    },

    async remove(item) {
      const projectId = this.projectId
      this.busy = { ...this.busy, [item.id]: true }
      this.rowErrors = { ...this.rowErrors, [item.id]: '' }
      try {
        await $fetch(`/api/marketing/projects/${projectId}/testimonials/${item.id}`, { method: 'DELETE' })
        if (projectId !== this.projectId) return
        this.confirmDeleteId = null
        await this.load()
      } catch (err) {
        if (projectId !== this.projectId) return
        this.rowErrors = { ...this.rowErrors, [item.id]: apiErrorMessage(err, 'Could not delete the testimonial') }
      } finally {
        this.busy = { ...this.busy, [item.id]: false }
      }
    },
  },
}
</script>
