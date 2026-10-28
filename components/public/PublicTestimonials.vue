<template>
  <section data-testid="public-testimonials">
    <div v-if="isLoading" class="grid gap-4 sm:grid-cols-2">
      <Skeleton v-for="n in 4" :key="n" class="h-40 w-full" />
    </div>

    <PublicStateMessage
      v-else-if="notAvailable"
      icon="lucide:message-square-quote"
      title="Testimonials are not available for this project."
      data-testid="public-testimonials-unavailable"
    />

    <PublicStateMessage
      v-else-if="error"
      icon="lucide:alert-circle"
      kind="error"
      :title="error"
      retryable
      @retry="load"
    />

    <PublicStateMessage
      v-else-if="items.length === 0"
      icon="lucide:message-square-quote"
      title="No testimonials yet."
      data-testid="public-testimonials-empty"
    />

    <div v-else class="grid gap-4 sm:grid-cols-2">
      <figure
        v-for="item in items"
        :key="item.id"
        class="flex flex-col rounded-lg border bg-card p-5"
        data-testid="public-testimonial-card"
      >
        <div v-if="item.rating" class="mb-2 flex gap-0.5" :aria-label="`${item.rating} out of 5`">
          <Icon
            v-for="n in item.rating"
            :key="n"
            name="lucide:star"
            mode="svg"
            class="h-4 w-4 text-amber-500 [&_path]:fill-amber-400"
          />
        </div>
        <!-- Plain text only: testimonial text is user submitted -->
        <blockquote class="flex-1 whitespace-pre-wrap break-words text-sm text-foreground">
          {{ item.quote }}
        </blockquote>
        <figcaption class="mt-4 text-sm">
          <span class="font-medium">{{ item.authorName }}</span>
          <span v-if="subtitle(item)" class="block text-xs text-muted-foreground">{{ subtitle(item) }}</span>
        </figcaption>
      </figure>
    </div>
  </section>
</template>

<script>
import { apiErrorMessage, apiErrorStatus } from '~/lib/api-error'
import { publicCache, publicTabRequest } from '~/lib/public-cache'

/** Testimonials tab body. The shell (PublicProjectShell) owns header, tabs and theme. */
export default {
  name: 'PublicTestimonials',

  props: {
    orgSlug: { type: String, required: true },
    projectSlug: { type: String, required: true },
  },

  data() {
    return { isLoading: true, error: null, notAvailable: false, items: [], loadSeq: 0 }
  },

  async mounted() {
    await this.load()
  },

  methods: {
    subtitle(item) {
      return [item.authorTitle, item.authorCompany].filter(Boolean).join(', ')
    },

    async load() {
      const seq = ++this.loadSeq
      const request = publicTabRequest('testimonials', this.orgSlug, this.projectSlug)
      const hit = publicCache.peek(request.key)
      this.error = null
      this.notAvailable = false
      if (hit) {
        this.items = hit.data?.data?.items || []
        this.isLoading = false
        if (!hit.stale) return
      } else {
        this.isLoading = true
      }
      try {
        const response = await publicCache.load(request.key, request.fetcher, { force: Boolean(hit) })
        if (seq !== this.loadSeq) return
        this.items = response?.data?.items || []
      } catch (err) {
        if (seq !== this.loadSeq || hit) return
        // 404: Marketing is off for this project (or nothing to show): not an error
        if (apiErrorStatus(err) === 404) this.notAvailable = true
        else this.error = apiErrorMessage(err, 'Failed to load testimonials')
      } finally {
        if (seq === this.loadSeq) this.isLoading = false
      }
    },
  },
}
</script>
