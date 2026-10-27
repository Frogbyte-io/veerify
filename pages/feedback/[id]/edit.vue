<template>
  <NuxtLayout name="clean">
    <!-- Loading State -->
    <AuthCard v-if="isLoading" wide title="Edit Your Feedback">
      <div class="space-y-4">
        <Skeleton class="h-4 w-64" />
        <Skeleton class="h-10 w-full" />
        <Skeleton class="h-36 w-full" />
        <Skeleton class="h-10 w-28 ml-auto" />
      </div>
    </AuthCard>

    <!-- Token Error State -->
    <AuthCard v-else-if="tokenError" wide title="Invalid Edit Link" :description="tokenError">
      <Icon name="lucide:link-2-off" class="mx-auto h-12 w-12 text-destructive" />
    </AuthCard>

    <!-- Success State -->
    <AuthCard v-else-if="saved" wide title="Feedback Updated" description="Your changes have been saved successfully.">
      <Icon name="lucide:check-circle-2" class="mx-auto h-12 w-12 text-green-500" />
    </AuthCard>

    <!-- Edit Form -->
    <AuthCard v-else-if="item" wide title="Edit Your Feedback" :description="'for ' + item.projectName">
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
    </AuthCard>
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
