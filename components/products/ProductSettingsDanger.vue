<template>
  <div class="space-y-6">
    <Card class="border-destructive/50">
      <CardHeader>
        <CardTitle class="flex items-center gap-2 text-destructive">
          <Icon name="lucide:alert-triangle" class="h-5 w-5" />
          Danger Zone
        </CardTitle>
        <CardDescription> Irreversible and destructive actions for this product. </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="flex items-center justify-between rounded-lg border border-destructive/30 p-4">
          <div>
            <p class="font-medium text-sm">Delete this product</p>
            <p class="text-xs text-muted-foreground">
              Permanently delete "{{ project.name }}" and all its feedback, categories, and roadmap items. This cannot
              be undone.
            </p>
          </div>
          <Button variant="destructive" @click="showDeleteDialog = true"> Delete Product </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Delete Confirmation Dialog -->
    <Dialog :open="showDeleteDialog" @update:open="showDeleteDialog = $event">
      <DialogContent class="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle class="text-destructive">Delete Product</DialogTitle>
          <DialogDescription>
            This will permanently delete <span class="font-semibold">{{ project.name }}</span> and all associated data
            including feedback, votes, categories, and roadmap items.
          </DialogDescription>
        </DialogHeader>
        <div class="py-4 space-y-3">
          <p class="text-sm text-muted-foreground">
            Type <span class="font-mono font-semibold text-foreground">{{ project.name }}</span> to confirm:
          </p>
          <Input v-model="deleteConfirmation" :placeholder="project.name" />
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showDeleteDialog = false">Cancel</Button>
          <Button
            variant="destructive"
            :disabled="deleteConfirmation !== project.name || isDeleting"
            @click="deleteProject"
          >
            <Icon v-if="isDeleting" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
            Delete Permanently
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'

export default {
  name: 'ProductSettingsDanger',
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  emits: ['deleted'],
  data() {
    return {
      showDeleteDialog: false,
      deleteConfirmation: '',
      isDeleting: false,
    }
  },
  methods: {
    async deleteProject() {
      if (this.deleteConfirmation !== this.project.name) return
      this.isDeleting = true

      try {
        await $fetch(`/api/teams/${this.project.teamId}/projects/${this.project.id}`, {
          method: 'DELETE',
        })

        toast.success('Product deleted')
        this.$emit('deleted')
      } catch (err) {
        console.error('Error deleting project:', err)
        toast.error(err?.data?.error?.message || 'Failed to delete product')
      } finally {
        this.isDeleting = false
      }
    },
  },
}
</script>
