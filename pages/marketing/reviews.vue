<template>
  <NuxtLayout name="dashboard">
    <div class="mx-auto max-w-4xl space-y-6 p-6" data-testid="marketing-reviews-page">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-3xl font-bold text-foreground">Reviews</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            Ask happy customers for a review or a testimonial, and show the best ones on your public page.
          </p>
        </div>
        <MarketingProductPicker @change="onProductChange" @error="onPickerError" />
      </div>

      <div v-if="!pickerSettled" class="space-y-4">
        <Skeleton class="h-40 w-full" />
        <Skeleton class="h-64 w-full" />
      </div>

      <div v-else-if="pickerError" class="text-sm text-muted-foreground">
        Products could not be loaded. Use Retry above to try again.
      </div>

      <div v-else-if="!product" class="text-sm text-muted-foreground">Create a product first to ask for reviews.</div>

      <MarketingDisabled v-else-if="marketingOff" :product="product" :message="disabledMessage" />

      <template v-else>
        <MarketingReviewsSettings
          :key="`settings-${product.id}`"
          :project-id="product.id"
          @forbidden="onForbidden"
          @permissions="onPermissions"
        />
        <MarketingReviewsRequests
          :key="`requests-${product.id}`"
          :project-id="product.id"
          :can-manage="canManage"
          @forbidden="onForbidden"
        />
        <MarketingReviewsTestimonials
          :key="`testimonials-${product.id}`"
          :project-id="product.id"
          :product="product"
          :can-manage="canManage"
          @forbidden="onForbidden"
        />
      </template>
    </div>
  </NuxtLayout>
</template>

<script>
export default {
  name: 'MarketingReviewsPage',

  created() {
    useHead({ title: 'Reviews · Marketing' })
  },

  data() {
    return {
      product: null,
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
      this.product = null
      this.pickerError = true
      this.pickerSettled = true
    },

    onProductChange(product) {
      this.product = product
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
