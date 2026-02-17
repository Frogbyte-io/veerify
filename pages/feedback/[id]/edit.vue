<template>
  <NuxtLayout name="clean">
    <div class="min-h-screen flex items-center justify-center bg-background p-4">
      <!-- Loading State -->
      <div v-if="isLoading" class="w-full max-w-lg space-y-4">
        <Skeleton class="h-8 w-48" />
        <Skeleton class="h-4 w-64" />
        <Skeleton class="h-10 w-full" />
        <Skeleton class="h-36 w-full" />
        <Skeleton class="h-10 w-28 ml-auto" />
      </div>

      <!-- Token Error State -->
      <div v-else-if="tokenError" class="w-full max-w-lg">
        <div class="bg-card rounded-lg border border-border p-8 text-center">
          <Icon name="lucide:link-2-off" class="w-12 h-12 mx-auto text-destructive mb-4" />
          <h1 class="text-xl font-semibold mb-2">Invalid Edit Link</h1>
          <p class="text-muted-foreground">{{ tokenError }}</p>
        </div>
      </div>

      <!-- Success State -->
      <div v-else-if="saved" class="w-full max-w-lg">
        <div class="bg-card rounded-lg border border-border p-8 text-center">
          <Icon name="lucide:check-circle-2" class="w-12 h-12 mx-auto text-green-500 mb-4" />
          <h1 class="text-xl font-semibold mb-2">Feedback Updated</h1>
          <p class="text-muted-foreground">Your changes have been saved successfully.</p>
        </div>
      </div>

      <!-- Edit Form -->
      <div v-else-if="item" class="w-full max-w-lg">
        <div class="bg-card rounded-lg border border-border p-8">
          <div class="mb-6">
            <h1 class="text-2xl font-bold text-foreground">Edit Your Feedback</h1>
            <p class="text-muted-foreground mt-1">
              for <strong>{{ item.projectName }}</strong>
            </p>
          </div>

          <form class="space-y-5" @submit.prevent="saveEdit">
            <div class="space-y-2">
              <label class="text-sm font-medium text-foreground">Title</label>
              <Input
                v-model="form.title"
                placeholder="Short summary of your feedback"
                :disabled="isSaving"
                maxlength="200"
              />
              <p v-if="formErrors.title" class="text-sm text-destructive">{{ formErrors.title }}</p>
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium text-foreground">Description</label>
              <Textarea
                v-model="form.body"
                placeholder="Provide more details about your feedback..."
                rows="6"
                :disabled="isSaving"
                maxlength="5000"
              />
              <p v-if="formErrors.body" class="text-sm text-destructive">{{ formErrors.body }}</p>
            </div>

            <p v-if="saveError" class="text-sm text-destructive">{{ saveError }}</p>

            <div class="flex justify-end pt-2">
              <Button type="submit" :disabled="isSaving">
                <Icon v-if="isSaving" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
                Save Changes
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </NuxtLayout>
</template>

<script>
export default {
  name: 'FeedbackEditPage',

  data() {
    return {
      item: null,
      form: {
        title: '',
        body: '',
      },
      formErrors: {},
      isLoading: true,
      tokenError: null,
      isSaving: false,
      saveError: null,
      saved: false,
    }
  },

  computed: {
    feedbackId() {
      return this.$route.params.id
    },
    token() {
      return this.$route.query.token
    },
  },

  async mounted() {
    await this.loadFeedback()
  },

  methods: {
    async loadFeedback() {
      this.isLoading = true
      this.tokenError = null

      if (!this.token) {
        this.tokenError = 'No edit token provided. Please use the link from your confirmation email.'
        this.isLoading = false
        return
      }

      try {
        const response = await $fetch(`/api/feedback/${this.feedbackId}/edit`, {
          query: { token: this.token },
        })
        this.item = response?.data || null
        if (this.item) {
          this.form.title = this.item.title
          this.form.body = this.item.body || ''
        }
      } catch (err) {
        if (err?.statusCode === 403) {
          this.tokenError = err?.data?.error?.message || 'This edit link is invalid or has expired.'
        } else if (err?.statusCode === 404) {
          this.tokenError = 'Feedback not found.'
        } else {
          this.tokenError = 'Failed to load feedback. Please try again.'
        }
      } finally {
        this.isLoading = false
      }
    },

    validate() {
      this.formErrors = {}
      if (!this.form.title.trim()) {
        this.formErrors.title = 'Title is required'
      } else if (this.form.title.length > 200) {
        this.formErrors.title = 'Title is too long'
      }
      if (!this.form.body.trim()) {
        this.formErrors.body = 'Description is required'
      } else if (this.form.body.length > 5000) {
        this.formErrors.body = 'Description is too long'
      }
      return Object.keys(this.formErrors).length === 0
    },

    async saveEdit() {
      if (!this.validate()) return

      this.isSaving = true
      this.saveError = null

      try {
        await $fetch(`/api/feedback/${this.feedbackId}/edit`, {
          method: 'PUT',
          body: {
            token: this.token,
            title: this.form.title.trim(),
            body: this.form.body.trim(),
          },
        })
        this.saved = true
      } catch (err) {
        if (err?.statusCode === 403) {
          this.saveError = err?.data?.error?.message || 'This edit link is invalid or has expired.'
        } else {
          this.saveError = err?.data?.error?.message || 'Failed to save changes. Please try again.'
        }
      } finally {
        this.isSaving = false
      }
    },
  },
}
</script>
