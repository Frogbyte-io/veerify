<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-[440px]" data-testid="launch-add-dialog">
      <DialogHeader>
        <DialogTitle>Add custom directory</DialogTitle>
        <DialogDescription>
          Track a niche directory, newsletter or community that is not in the list. Up to {{ maxCustom }} per product.
        </DialogDescription>
      </DialogHeader>

      <form class="space-y-3" @submit.prevent="submit">
        <div class="space-y-1">
          <Label for="launch-add-name">Name</Label>
          <Input
            id="launch-add-name"
            v-model="name"
            maxlength="80"
            placeholder="Directory name"
            :disabled="saving"
            data-testid="launch-add-name"
          />
        </div>
        <div class="space-y-1">
          <Label for="launch-add-url">Link (optional, https)</Label>
          <Input
            id="launch-add-url"
            v-model="url"
            type="url"
            maxlength="500"
            placeholder="https://"
            :disabled="saving"
            data-testid="launch-add-url"
          />
        </div>

        <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>

        <DialogFooter>
          <Button type="button" variant="ghost" :disabled="saving" @click="onOpenChange(false)">Cancel</Button>
          <Button type="submit" :disabled="saving || !name.trim()" data-testid="launch-add-submit">
            <Icon v-if="saving" name="lucide:loader-circle" class="mr-2 h-4 w-4 animate-spin" />
            Add
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

<script>
import { apiErrorDetails, apiErrorMessage, apiErrorStatus } from '~/lib/api-error'

export default {
  name: 'MarketingLaunchAddDialog',

  props: {
    open: { type: Boolean, default: false },
    projectId: { type: String, required: true },
  },

  emits: ['update:open', 'added', 'forbidden'],

  data() {
    return { name: '', url: '', saving: false, error: null, maxCustom: 30 }
  },

  methods: {
    onOpenChange(value) {
      if (!value) {
        this.name = ''
        this.url = ''
        this.error = null
      }
      this.$emit('update:open', value)
    },

    async submit() {
      if (!this.name.trim()) return
      const projectId = this.projectId
      this.saving = true
      this.error = null
      try {
        await $fetch(`/api/marketing/projects/${projectId}/launch-kit/custom`, {
          method: 'POST',
          body: { name: this.name.trim(), url: this.url.trim() || null },
        })
        if (projectId !== this.projectId) return
        this.$emit('added')
        this.onOpenChange(false)
      } catch (err) {
        if (projectId !== this.projectId) return
        if (apiErrorStatus(err) === 403) this.$emit('forbidden', apiErrorMessage(err, ''))
        const details = apiErrorDetails(err)
        const detail = Array.isArray(details) ? details.find((issue) => issue?.message)?.message : null
        this.error = detail || apiErrorMessage(err, 'Could not add the directory')
      } finally {
        if (projectId === this.projectId) this.saving = false
      }
    },
  },
}
</script>
