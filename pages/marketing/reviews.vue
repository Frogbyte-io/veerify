<template>
  <PageContainer data-testid="marketing-reviews-page">
    <PageHeader
      title="Reviews"
      description="Ask happy customers for a review or a testimonial, and show the best ones on your public page."
    />

    <MarketingProjectLoader @change="onProjectChange" @error="onPickerError" />

    <template v-if="!pickerError">
      <div v-if="!pickerSettled" class="space-y-6">
        <Skeleton class="h-40 w-full" />
        <Skeleton class="h-64 w-full" />
        <Skeleton class="h-64 w-full" />
      </div>

      <MarketingNotice v-else-if="!project" title="No project yet">
        Marketing works on a project. Create one to ask for reviews.
        <template #actions>
          <Button as-child variant="outline">
            <NuxtLink to="/workspace">Go to workspace settings</NuxtLink>
          </Button>
        </template>
      </MarketingNotice>

      <MarketingDisabled v-else-if="marketingOff" :project="project" :message="disabledMessage" />

      <template v-else>
        <MarketingReviewsSettings
          :key="`settings-${project.id}`"
          :project-id="project.id"
          @forbidden="onForbidden"
          @permissions="onPermissions"
        />
        <MarketingReviewsRequests
          :key="`requests-${project.id}`"
          :project-id="project.id"
          :can-manage="canManage"
          @forbidden="onForbidden"
        />
        <MarketingReviewsTestimonials
          :key="`testimonials-${project.id}`"
          :project-id="project.id"
          :project="project"
          :can-manage="canManage"
          @forbidden="onForbidden"
        />
      </template>
    </template>
  </PageContainer>
</template>

<script>
export default {
  name: 'MarketingReviewsPage',

  created() {
    useHead({ title: 'Reviews · Marketing' })
  },

  data() {
    return {
      project: null,
      pickerSettled: false,
      pickerError: false,
      marketingOff: false,
      disabledMessage: '',
      // Unknown until the settings load; treated as read-only until then.
      canManage: false,
    }
  },

  methods: {
    onPermissions(permissions) {
      this.canManage = permissions.canManage === true
    },

    onPickerError() {
      this.project = null
      this.pickerError = true
      this.pickerSettled = true
    },

    onProjectChange(project) {
      this.project = project
      this.pickerSettled = true
      this.pickerError = false
      this.marketingOff = false
      this.disabledMessage = ''
      this.canManage = false
    },

    onForbidden(message) {
      this.marketingOff = true
      this.disabledMessage = message || ''
    },
  },
}
</script>
