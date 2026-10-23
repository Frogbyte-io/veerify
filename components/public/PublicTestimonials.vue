<template>
  <PublicProjectShell :org-slug="orgSlug" :project-slug="projectSlug" active="testimonials" @loaded="load">
    <section data-testid="public-testimonials">
      <div v-if="isLoading" class="grid gap-4 sm:grid-cols-2">
        <Skeleton v-for="n in 3" :key="n" class="h-40 w-full" />
      </div>

      <div
        v-else-if="notAvailable"
        class="py-12 text-center text-sm text-muted-foreground"
        data-testid="public-testimonials-unavailable"
      >
        <Icon name="lucide:message-square-quote" class="mx-auto mb-3 h-8 w-8" />
        Testimonials are not available for this project.
      </div>

      <div v-else-if="error" class="flex items-center justify-center gap-2 py-10 text-sm text-destructive">
        <span>{{ error }}</span>
        <Button variant="outline" size="sm" @click="load">Retry</Button>
      </div>

      <div
        v-else-if="items.length === 0"
        class="py-12 text-center text-sm text-muted-foreground"
        data-testid="public-testimonials-empty"
      >
        <Icon name="lucide:message-square-quote" class="mx-auto mb-3 h-8 w-8" />
        No testimonials yet.
      </div>

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
  </PublicProjectShell>
</template>

<script>
import { apiErrorMessage, apiErrorStatus } from '~/lib/api-error'

export default {
  name: 'PublicTestimonials',

  props: {
    orgSlug: { type: String, required: true },
    projectSlug: { type: String, required: true },
  },

  data() {
    return { isLoading: true, error: null, notAvailable: false, items: [] }
  },

  methods: {
    subtitle(item) {
      return [item.authorTitle, item.authorCompany].filter(Boolean).join(', ')
    },

    async load() {
      const key = `${this.orgSlug}/${this.projectSlug}`
      this.isLoading = true
      this.error = null
      this.notAvailable = false
      try {
        const response = await $fetch(
          `/api/public/o/${encodeURIComponent(this.orgSlug)}/${encodeURIComponent(this.projectSlug)}/testimonials`
        )
        if (key !== `${this.orgSlug}/${this.projectSlug}`) return
        this.items = response.data.items
      } catch (err) {
        if (key !== `${this.orgSlug}/${this.projectSlug}`) return
        // 404: Marketing is off for this project (or nothing to show): not an error
        if (apiErrorStatus(err) === 404) this.notAvailable = true
        else this.error = apiErrorMessage(err, 'Failed to load testimonials')
      } finally {
        if (key === `${this.orgSlug}/${this.projectSlug}`) this.isLoading = false
      }
    },
  },
}
</script>
