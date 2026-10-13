<template>
  <Card data-testid="reviews-settings">
    <CardHeader>
      <CardTitle role="heading" aria-level="2">Review and testimonial requests</CardTitle>
      <CardDescription>
        Ask happy customers for a public review or a short testimonial. Off by default. Every email has an unsubscribe
        link, and an address is contacted at most once per cooldown.
      </CardDescription>
    </CardHeader>

    <CardContent>
      <div v-if="isLoading" class="space-y-3" data-testid="reviews-settings-loading">
        <Skeleton class="h-10 w-full" />
        <Skeleton class="h-24 w-full" />
        <Skeleton class="h-24 w-full" />
      </div>

      <div
        v-else-if="error"
        class="flex items-center gap-2 text-sm text-destructive"
        data-testid="reviews-settings-error"
      >
        <span>{{ error }}</span>
        <Button variant="outline" size="sm" @click="load">Retry</Button>
      </div>

      <form v-else-if="draft" class="space-y-6" @submit.prevent="save">
        <p
          v-if="!canManage"
          class="rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground"
          role="note"
          data-testid="reviews-settings-readonly"
        >
          You can view these settings. Only team admins can change them.
        </p>

        <div class="flex items-center justify-between gap-4 rounded-md border p-3">
          <div>
            <Label for="reviews-enabled">Send review requests</Label>
            <p class="text-xs text-muted-foreground">Nothing is sent until this is on.</p>
          </div>
          <Switch
            id="reviews-enabled"
            :model-value="draft.enabled"
            :disabled="locked"
            data-testid="reviews-enabled"
            @update:model-value="(value) => (draft.enabled = value)"
          />
        </div>

        <div class="space-y-3">
          <div>
            <p class="text-sm font-medium">Review platforms</p>
            <p class="text-xs text-muted-foreground">
              One button per platform in the email. https links only, up to {{ maxPlatforms }}.
            </p>
          </div>
          <p v-if="draft.platforms.length === 0" class="text-xs text-muted-foreground">No platforms yet.</p>
          <div
            v-for="(platform, index) in draft.platforms"
            :key="platform.uid"
            class="grid gap-2 sm:grid-cols-[10rem_1fr_auto]"
            data-testid="reviews-platform-row"
          >
            <Input
              v-model="platform.label"
              maxlength="40"
              placeholder="G2"
              :aria-label="`Platform ${index + 1} name`"
              :disabled="locked"
            />
            <Input
              v-model="platform.url"
              type="url"
              maxlength="500"
              placeholder="https://www.g2.com/products/your-product/reviews"
              :aria-label="`Platform ${index + 1} link`"
              :disabled="locked"
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              :aria-label="`Remove platform ${index + 1}`"
              :disabled="locked"
              @click="removePlatform(index)"
            >
              <Icon name="lucide:trash-2" class="h-4 w-4" />
            </Button>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            :disabled="locked || draft.platforms.length >= maxPlatforms"
            data-testid="reviews-add-platform"
            @click="addPlatform"
          >
            <Icon name="lucide:plus" class="mr-2 h-4 w-4" />
            Add platform
          </Button>
        </div>

        <div class="flex items-center justify-between gap-4 rounded-md border p-3">
          <div>
            <Label for="reviews-testimonial">Ask for a testimonial</Label>
            <p class="text-xs text-muted-foreground">
              Adds a link to a short form. Nothing is shown publicly without the author's consent and your approval.
            </p>
          </div>
          <Switch
            id="reviews-testimonial"
            :model-value="draft.askForTestimonial"
            :disabled="locked"
            @update:model-value="(value) => (draft.askForTestimonial = value)"
          />
        </div>

        <div class="space-y-4">
          <p class="text-sm font-medium">Triggers</p>

          <div class="space-y-3 rounded-md border p-3">
            <div class="flex items-center justify-between gap-4">
              <div>
                <Label for="reviews-csat">After a good support rating</Label>
                <p class="text-xs text-muted-foreground">When a customer rates a support conversation highly.</p>
              </div>
              <Switch
                id="reviews-csat"
                :model-value="draft.csatTrigger"
                :disabled="locked"
                @update:model-value="(value) => (draft.csatTrigger = value)"
              />
            </div>
            <div v-if="draft.csatTrigger" class="max-w-xs">
              <Label for="reviews-min-rating">Minimum rating</Label>
              <Input
                id="reviews-min-rating"
                v-model="minRatingText"
                type="number"
                min="0"
                max="10"
                placeholder="Top score of the scale"
                class="mt-1"
                :disabled="locked"
              />
              <p class="mt-1 text-xs text-muted-foreground">
                Leave empty to use only the top score of the survey scale.
              </p>
            </div>
          </div>

          <div class="space-y-3 rounded-md border p-3">
            <div class="flex items-center justify-between gap-4">
              <div>
                <Label for="reviews-shipped">After feedback ships</Label>
                <p class="text-xs text-muted-foreground">
                  When feedback reaches a shipped status, or is linked from a published changelog entry. Goes to the
                  author and subscribers.
                </p>
              </div>
              <Switch
                id="reviews-shipped"
                :model-value="draft.shippedTrigger"
                :disabled="locked"
                @update:model-value="(value) => (draft.shippedTrigger = value)"
              />
            </div>
            <fieldset v-if="draft.shippedTrigger" class="space-y-2">
              <legend class="text-xs font-medium">Shipped statuses</legend>
              <label v-for="status in statuses" :key="status.value" class="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  class="h-4 w-4 rounded border-input"
                  :checked="draft.shippedStatusValues.includes(status.value)"
                  :disabled="locked"
                  @change="toggleStatus(status.value, $event.target.checked)"
                />
                {{ status.name }}
                <span class="text-xs text-muted-foreground">{{ status.value }}</span>
              </label>
            </fieldset>
          </div>
        </div>

        <div class="max-w-xs">
          <Label for="reviews-cooldown">Cooldown (days)</Label>
          <Input
            id="reviews-cooldown"
            v-model="cooldownText"
            type="number"
            min="1"
            max="730"
            class="mt-1"
            :disabled="locked"
          />
          <p class="mt-1 text-xs text-muted-foreground">An address is asked at most once in this many days.</p>
        </div>

        <p v-if="saveError" class="text-sm text-destructive" role="alert" data-testid="reviews-settings-save-error">
          {{ saveError }}
        </p>
        <p v-else-if="savedAt" class="text-sm text-muted-foreground" role="status">Saved.</p>

        <Button v-if="canManage" type="submit" :disabled="locked" data-testid="reviews-settings-save">
          <Icon v-if="saving" name="lucide:loader-circle" class="mr-2 h-4 w-4 animate-spin" />
          Save settings
        </Button>
      </form>
    </CardContent>
  </Card>
</template>

<script>
import { apiErrorDetails, apiErrorMessage, apiErrorStatus } from '~/lib/api-error'

const MAX_PLATFORMS = 6

export default {
  name: 'MarketingReviewsSettings',

  props: {
    projectId: { type: String, required: true },
  },

  emits: ['forbidden', 'saved', 'permissions'],

  data() {
    return {
      canManage: false,
      uidCounter: 0,
      isLoading: true,
      error: null,
      draft: null,
      statuses: [],
      saving: false,
      saveError: null,
      savedAt: null,
      minRatingText: '',
      cooldownText: '90',
      maxPlatforms: MAX_PLATFORMS,
    }
  },

  computed: {
    locked() {
      return this.saving || !this.canManage
    },
  },

  async mounted() {
    await this.load()
  },

  methods: {
    // Rows are keyed by a client-side uid: platform ids are server-assigned and new rows have none.
    nextUid() {
      this.uidCounter += 1
      return `platform-row-${this.uidCounter}`
    },

    apply(data) {
      this.statuses = data.statuses
      if (typeof data.canManage === 'boolean') {
        this.canManage = data.canManage
        this.$emit('permissions', { canManage: data.canManage })
      }
      this.draft = {
        ...data.settings,
        platforms: data.settings.platforms.map((platform) => ({ ...platform, uid: this.nextUid() })),
        shippedStatusValues: [...data.settings.shippedStatusValues],
      }
      this.minRatingText = data.settings.csatMinRating === null ? '' : String(data.settings.csatMinRating)
      this.cooldownText = String(data.settings.cooldownDays)
    },

    async load() {
      const projectId = this.projectId
      this.isLoading = true
      this.error = null
      try {
        const response = await $fetch(`/api/marketing/projects/${projectId}/reviews/settings`)
        if (projectId !== this.projectId) return
        this.apply(response.data)
      } catch (err) {
        if (projectId !== this.projectId) return
        if (apiErrorStatus(err) === 403) {
          this.$emit('forbidden', apiErrorMessage(err, ''))
        } else {
          this.error = apiErrorMessage(err, 'Failed to load review request settings')
        }
      } finally {
        if (projectId === this.projectId) this.isLoading = false
      }
    },

    addPlatform() {
      if (this.draft.platforms.length < MAX_PLATFORMS) {
        this.draft.platforms.push({ uid: this.nextUid(), label: '', url: '' })
      }
    },

    removePlatform(index) {
      this.draft.platforms.splice(index, 1)
    },

    toggleStatus(value, checked) {
      const set = new Set(this.draft.shippedStatusValues)
      if (checked) set.add(value)
      else set.delete(value)
      this.draft.shippedStatusValues = [...set]
    },

    async save() {
      if (!this.canManage) return
      const projectId = this.projectId
      const cooldown = Number.parseInt(this.cooldownText, 10)
      const minText = String(this.minRatingText ?? '').trim()
      const minRating = minText === '' ? null : Number.parseInt(minText, 10)
      if (!Number.isInteger(cooldown) || cooldown < 1 || cooldown > 730) {
        this.saveError = 'Cooldown must be between 1 and 730 days'
        return
      }
      if (minRating !== null && (!Number.isInteger(minRating) || minRating < 0 || minRating > 10)) {
        this.saveError = 'Minimum rating must be between 0 and 10'
        return
      }

      this.saving = true
      this.saveError = null
      this.savedAt = null
      try {
        const response = await $fetch(`/api/marketing/projects/${projectId}/reviews/settings`, {
          method: 'PUT',
          body: {
            enabled: this.draft.enabled,
            platforms: this.draft.platforms.map((platform) => ({
              ...(platform.id ? { id: platform.id } : {}),
              label: platform.label,
              url: platform.url,
            })),
            askForTestimonial: this.draft.askForTestimonial,
            csatTrigger: this.draft.csatTrigger,
            csatMinRating: minRating,
            shippedTrigger: this.draft.shippedTrigger,
            shippedStatusValues: this.draft.shippedStatusValues,
            cooldownDays: cooldown,
          },
        })
        if (projectId !== this.projectId) return
        this.apply(response.data)
        this.savedAt = Date.now()
        this.$emit('saved', response.data.settings)
      } catch (err) {
        if (projectId !== this.projectId) return
        const details = apiErrorDetails(err)
        const detail = Array.isArray(details) ? details.find((issue) => issue?.message)?.message : null
        this.saveError = detail || apiErrorMessage(err, 'Could not save the settings')
      } finally {
        if (projectId === this.projectId) this.saving = false
      }
    },
  },
}
</script>
