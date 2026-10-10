<template>
  <div class="space-y-3" data-testid="search-status">
    <div class="flex flex-wrap items-center justify-between gap-3 text-sm">
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
        <span v-if="connection.propertyUrl" class="flex items-center gap-1.5">
          <Icon name="lucide:globe" class="h-4 w-4" />
          {{ connection.propertyUrl }}
        </span>
        <span v-if="connection.email" class="flex items-center gap-1.5">
          <Icon name="lucide:user" class="h-4 w-4" />
          {{ connection.email }}
        </span>
        <span class="flex items-center gap-1.5" data-testid="search-last-synced">
          <Icon name="lucide:refresh-cw" class="h-4 w-4" />
          {{ lastSyncedLabel }}
        </span>
      </div>
      <Button v-if="canManage" variant="outline" size="sm" data-testid="search-disconnect" @click="open = true">
        <Icon name="lucide:unlink" class="mr-2 h-4 w-4" />
        Disconnect
      </Button>
    </div>

    <p
      v-if="connection.lastError"
      class="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
      role="alert"
      data-testid="search-last-error"
    >
      {{ connection.lastError }}
    </p>

    <Dialog :open="open" @update:open="onOpenChange">
      <DialogContent data-testid="search-disconnect-dialog">
        <DialogHeader>
          <DialogTitle>Disconnect Search Console?</DialogTitle>
          <DialogDescription>
            Veerify revokes its access at Google and deletes the stored search data for this site. You can connect again
            later.
          </DialogDescription>
        </DialogHeader>
        <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
        <DialogFooter>
          <Button variant="outline" :disabled="busy" @click="open = false">Cancel</Button>
          <Button variant="destructive" :disabled="busy" data-testid="search-disconnect-confirm" @click="confirm">
            <Icon v-if="busy" name="lucide:loader-circle" class="mr-2 h-4 w-4 animate-spin" />
            Disconnect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script>
import { apiErrorMessage } from '~/lib/api-error'

export default {
  name: 'MarketingSearchStatus',

  props: {
    projectId: { type: String, required: true },
    connection: { type: Object, required: true },
    canManage: { type: Boolean, default: false },
  },

  emits: ['disconnected'],

  data() {
    return { open: false, busy: false, error: null }
  },

  computed: {
    lastSyncedLabel() {
      if (!this.connection.lastSyncAt) return 'First sync pending, data appears within the hour'
      return `Last synced ${new Date(this.connection.lastSyncAt).toLocaleString()}`
    },
  },

  methods: {
    onOpenChange(value) {
      if (this.busy) return
      this.open = value
      if (value) this.error = null
    },

    async confirm() {
      const projectId = this.projectId
      this.busy = true
      this.error = null
      try {
        await $fetch(`/api/marketing/projects/${projectId}/search/connection`, { method: 'DELETE' })
        this.open = false
        this.$emit('disconnected')
      } catch (err) {
        this.error = apiErrorMessage(err, 'Could not disconnect')
      } finally {
        this.busy = false
      }
    },
  },
}
</script>
