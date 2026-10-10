<template>
  <Card data-testid="search-property">
    <CardHeader>
      <CardTitle class="text-base">Choose a Search Console property</CardTitle>
      <CardDescription>
        We could not match {{ origin }} to a property on {{ email || 'the connected Google account' }}. Pick the one to
        read.
      </CardDescription>
    </CardHeader>
    <CardContent class="space-y-3">
      <p v-if="!canManage" class="text-sm text-muted-foreground">Only team admins can choose the property.</p>

      <div v-else-if="isLoading" class="space-y-2">
        <Skeleton class="h-10 w-full" />
        <Skeleton class="h-10 w-full" />
      </div>

      <div v-else-if="error" class="flex items-center gap-2 text-sm text-destructive">
        <span>{{ error }}</span>
        <Button variant="outline" size="sm" @click="load">Retry</Button>
      </div>

      <p v-else-if="properties.length === 0" class="text-sm text-muted-foreground" data-testid="search-property-empty">
        This Google account has no Search Console properties. Add and verify your site in Search Console, or reconnect
        with another account.
      </p>

      <ul v-else class="space-y-2">
        <li v-for="property in properties" :key="property.siteUrl">
          <Button
            variant="outline"
            class="w-full justify-between"
            :disabled="Boolean(saving)"
            :data-testid="`search-property-option`"
            @click="select(property.siteUrl)"
          >
            <span class="truncate">{{ property.siteUrl }}</span>
            <Icon v-if="saving === property.siteUrl" name="lucide:loader-circle" class="h-4 w-4 animate-spin" />
          </Button>
        </li>
      </ul>

      <p v-if="saveError" class="text-sm text-destructive" role="alert">{{ saveError }}</p>
    </CardContent>
  </Card>
</template>

<script>
import { apiErrorMessage, apiErrorStatus } from '~/lib/api-error'

export default {
  name: 'MarketingSearchProperty',

  props: {
    projectId: { type: String, required: true },
    origin: { type: String, default: '' },
    email: { type: String, default: null },
    canManage: { type: Boolean, default: false },
  },

  emits: ['saved', 'revoked'],

  data() {
    return {
      properties: [],
      isLoading: false,
      error: null,
      saving: null,
      saveError: null,
    }
  },

  watch: {
    projectId() {
      this.load()
    },
  },

  mounted() {
    this.load()
  },

  methods: {
    async load() {
      if (!this.canManage) return
      const projectId = this.projectId
      this.isLoading = true
      this.error = null
      try {
        const response = await $fetch(`/api/marketing/projects/${projectId}/search/properties`)
        if (projectId !== this.projectId) return
        this.properties = response.data.properties
      } catch (err) {
        if (projectId !== this.projectId) return
        if (apiErrorStatus(err) === 409) this.$emit('revoked')
        this.error = apiErrorMessage(err, 'Failed to load properties')
      } finally {
        if (projectId === this.projectId) this.isLoading = false
      }
    },

    async select(propertyUrl) {
      const projectId = this.projectId
      this.saving = propertyUrl
      this.saveError = null
      try {
        await $fetch(`/api/marketing/projects/${projectId}/search/property`, {
          method: 'PUT',
          body: { propertyUrl },
        })
        if (projectId === this.projectId) this.$emit('saved')
      } catch (err) {
        if (projectId === this.projectId) this.saveError = apiErrorMessage(err, 'Could not save the property')
      } finally {
        this.saving = null
      }
    },
  },
}
</script>
