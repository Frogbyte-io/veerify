<template>
  <div class="space-y-6">
    <Card>
      <CardHeader>
        <div class="flex items-center justify-between">
          <div>
            <CardTitle class="flex items-center gap-2">
              <Icon name="lucide:circle-dot" class="h-5 w-5" />
              Feedback Statuses
            </CardTitle>
            <CardDescription>{{ statusCardDescription }}</CardDescription>
          </div>
          <Button size="sm" @click="openCreateDialog">
            <Icon name="lucide:plus" class="w-4 h-4 mr-2" />
            Add Status
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <!-- Loading -->
        <div v-if="isLoading" class="space-y-3">
          <Skeleton v-for="n in 4" :key="n" class="h-14 w-full" />
        </div>

        <!-- Error -->
        <div v-else-if="error" class="text-center py-6">
          <p class="text-sm text-destructive mb-2">{{ error }}</p>
          <Button variant="outline" size="sm" @click="loadStatuses">
            <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
            Retry
          </Button>
        </div>

        <!-- System defaults notice (no custom statuses yet) -->
        <div v-else-if="isUsingDefaults" class="space-y-4">
          <div class="rounded-md bg-muted p-3 text-sm text-muted-foreground">
            <Icon name="lucide:info" class="w-4 h-4 inline mr-1.5 align-text-bottom" />
            Using the default starting workflow. Add a custom status to replace it with your own workflow.
          </div>
          <div class="space-y-2">
            <div
              v-for="status in statuses"
              :key="status.value"
              class="flex items-center gap-3 rounded-lg border p-3"
            >
              <span
                class="w-3 h-3 rounded-full flex-shrink-0"
                :style="{ backgroundColor: status.color || '#6b7280' }"
              />
              <div class="flex-1">
                <p class="font-medium text-sm">{{ status.name }}</p>
                <p v-if="status.description" class="text-xs text-muted-foreground">{{ status.description }}</p>
              </div>
              <Badge variant="secondary" class="text-xs">System</Badge>
            </div>
          </div>
        </div>

        <!-- Empty -->
        <div v-else-if="statuses.length === 0" class="text-center py-8">
          <Icon name="lucide:circle-dot" class="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p class="text-sm text-muted-foreground mb-3">No statuses yet</p>
          <Button size="sm" @click="openCreateDialog">Add First Status</Button>
        </div>

        <!-- Custom Status List -->
        <div v-else class="space-y-2">
          <p class="text-xs text-muted-foreground">
            {{ canReorderStatuses ? 'Drag statuses to reorder how they appear in dropdowns.' : 'Add another status to enable reordering.' }}
          </p>
          <div
            v-for="status in statuses"
            :key="status.id"
            :data-testid="`product-status-item-${status.id}`"
            class="flex items-center justify-between rounded-lg border p-3 transition-colors"
            :class="{
              'border-primary bg-primary/5': dragOverStatusId === status.id && draggedStatusId !== status.id,
            }"
            @dragover.prevent="onDragOver(status.id)"
            @dragenter.prevent="onDragOver(status.id)"
            @dragleave="onDragLeave(status.id)"
            @drop.prevent="onDrop(status.id)"
          >
            <div class="flex items-center gap-3">
              <button
                type="button"
                :data-testid="`product-status-drag-handle-${status.id}`"
                class="inline-flex h-8 w-8 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:cursor-not-allowed"
                :aria-label="`Drag to reorder ${status.name}`"
                :disabled="isReordering || !canReorderStatuses"
                :draggable="canReorderStatuses && !isReordering"
                @dragstart="onDragStart(status.id, $event)"
                @dragend="onDragEnd"
              >
                <Icon name="lucide:grip-vertical" class="w-4 h-4" />
              </button>
              <span
                class="w-3 h-3 rounded-full flex-shrink-0"
                :style="{ backgroundColor: status.color || '#6b7280' }"
              />
              <div>
                <div class="flex items-center gap-2">
                  <p class="font-medium text-sm">{{ status.name }}</p>
                  <Badge v-if="status.isDefault" variant="secondary" class="text-xs">Default</Badge>
                  <code class="text-xs text-muted-foreground bg-muted px-1 py-0.5 rounded">{{ status.value }}</code>
                </div>
                <p v-if="status.description" class="text-xs text-muted-foreground">{{ status.description }}</p>
              </div>
            </div>
            <div class="flex items-center gap-1">
              <Button variant="ghost" size="sm" :disabled="isReordering" @click="openEditDialog(status)">
                <Icon name="lucide:pencil" class="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="text-destructive hover:text-destructive"
                :disabled="isReordering || status.isDefault"
                @click="openDeleteDialog(status)"
              >
                <Icon name="lucide:trash-2" class="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Create/Edit Status Dialog -->
    <Dialog :open="showStatusDialog" @update:open="showStatusDialog = $event">
      <DialogContent class="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>{{ editingStatus ? 'Edit Status' : 'New Status' }}</DialogTitle>
          <DialogDescription>
            {{ editingStatus ? 'Update the status details.' : 'Create a new feedback workflow status.' }}
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-4 py-4">
          <div class="space-y-2">
            <Label for="status-name">Name</Label>
            <Input id="status-name" v-model="statusForm.name" placeholder="e.g. Under Review" />
          </div>
          <div class="space-y-2">
            <Label for="status-color">Color</Label>
            <div class="flex items-center gap-2">
              <input
                type="color"
                :value="statusForm.color || '#6b7280'"
                class="w-8 h-8 rounded border cursor-pointer"
                @input="statusForm.color = $event.target.value"
              />
              <Input id="status-color" v-model="statusForm.color" placeholder="#6b7280" class="flex-1" />
            </div>
          </div>
          <div class="space-y-2">
            <Label for="status-desc">Description (optional)</Label>
            <Input id="status-desc" v-model="statusForm.description" placeholder="A brief description" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showStatusDialog = false">Cancel</Button>
          <Button :disabled="isSavingStatus || !statusForm.name.trim()" @click="saveStatus">
            <Icon v-if="isSavingStatus" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
            {{ editingStatus ? 'Save' : 'Create' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Delete Status Dialog -->
    <Dialog :open="showDeleteDialog" @update:open="showDeleteDialog = $event">
      <DialogContent class="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle class="text-destructive">Delete Status</DialogTitle>
          <DialogDescription>Are you sure you want to delete "{{ deletingStatus?.name }}"?</DialogDescription>
        </DialogHeader>
        <div v-if="deletingStatus" class="py-4">
          <p class="text-sm text-muted-foreground mb-3">
            If feedback items use this status, select a replacement:
          </p>
          <div class="space-y-2">
            <Label for="replacement-status">Replacement Status</Label>
            <select
              id="replacement-status"
              v-model="replacementValue"
              class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">None (keep existing status value)</option>
              <option
                v-for="s in statuses.filter((s) => s.id !== deletingStatus?.id)"
                :key="s.id || s.value"
                :value="s.value"
              >
                {{ s.name }}
              </option>
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showDeleteDialog = false">Cancel</Button>
          <Button variant="destructive" :disabled="isDeletingStatus" @click="deleteStatus">
            <Icon v-if="isDeletingStatus" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'

export default {
  name: 'ProductSettingsStatuses',
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  data() {
    return {
      statuses: [],
      isLoading: true,
      isUsingDefaults: false,
      error: null,
      showStatusDialog: false,
      showDeleteDialog: false,
      editingStatus: null,
      deletingStatus: null,
      replacementValue: '',
      isSavingStatus: false,
      isDeletingStatus: false,
      isReordering: false,
      draggedStatusId: null,
      dragOverStatusId: null,
      statusForm: {
        name: '',
        color: '#6b7280',
        description: '',
      },
    }
  },
  computed: {
    canReorderStatuses() {
      return !this.isUsingDefaults && this.statuses.length > 1
    },
    statusCardDescription() {
      if (this.isUsingDefaults) {
        return 'Review the default starting workflow for feedback items. Add a custom status to start customizing it.'
      }

      if (this.statuses.length <= 1) {
        return 'Customize the workflow statuses available for feedback items. Add another status to enable reordering.'
      }

      return 'Customize the workflow statuses available for feedback items. Drag to reorder.'
    },
  },
  watch: {
    'project.slug': {
      handler() {
        this.loadStatuses()
      },
      immediate: false,
    },
  },
  async mounted() {
    await this.loadStatuses()
  },
  methods: {
    async loadStatuses() {
      this.isLoading = true
      this.error = null

      try {
        const response = await $fetch(`/api/projects/${this.project.slug}/statuses`)
        const data = response?.data || []
        // Detect if we're showing system defaults (id is null)
        this.isUsingDefaults = data.length > 0 && data[0].id === null
        this.statuses = data
      } catch (err) {
        console.error('Error loading statuses:', err)
        this.error = 'Failed to load statuses'
      } finally {
        this.isLoading = false
      }
    },

    openCreateDialog() {
      this.editingStatus = null
      this.statusForm = { name: '', color: '#6b7280', description: '' }
      this.showStatusDialog = true
    },

    openEditDialog(status) {
      this.editingStatus = status
      this.statusForm = {
        name: status.name,
        color: status.color || '#6b7280',
        description: status.description || '',
      }
      this.showStatusDialog = true
    },

    openDeleteDialog(status) {
      this.deletingStatus = status
      this.replacementValue = ''
      this.showDeleteDialog = true
    },

    onDragStart(statusId, event) {
      if (this.isReordering) {
        event.preventDefault()
        return
      }
      this.draggedStatusId = statusId
      if (event?.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', statusId)
      }
    },

    onDragOver(statusId) {
      if (!this.canReorderStatuses || !this.draggedStatusId || this.draggedStatusId === statusId) return
      this.dragOverStatusId = statusId
    },

    onDragLeave(statusId) {
      if (this.dragOverStatusId === statusId) {
        this.dragOverStatusId = null
      }
    },

    onDragEnd() {
      this.draggedStatusId = null
      this.dragOverStatusId = null
    },

    async onDrop(targetStatusId) {
      if (!this.canReorderStatuses || !this.draggedStatusId || this.draggedStatusId === targetStatusId || this.isReordering) {
        this.onDragEnd()
        return
      }

      const fromIndex = this.statuses.findIndex((s) => s.id === this.draggedStatusId)
      const toIndex = this.statuses.findIndex((s) => s.id === targetStatusId)

      if (fromIndex < 0 || toIndex < 0) {
        this.onDragEnd()
        return
      }

      const previousOrder = [...this.statuses]
      const reordered = [...this.statuses]
      const [moved] = reordered.splice(fromIndex, 1)
      reordered.splice(toIndex, 0, moved)
      this.statuses = reordered
      this.onDragEnd()
      await this.persistOrder(previousOrder)
    },

    async persistOrder(previousOrder) {
      this.isReordering = true
      try {
        await Promise.all(
          this.statuses.map((status, sortOrder) =>
            $fetch(`/api/projects/${this.project.slug}/statuses/${status.id}`, {
              method: 'PUT',
              body: { sortOrder },
            })
          )
        )
        toast.success('Status order saved')
      } catch (err) {
        console.error('Error saving status order:', err)
        this.statuses = previousOrder
        toast.error(err?.data?.error?.message || 'Failed to save status order')
      } finally {
        this.isReordering = false
      }
    },

    async saveStatus() {
      if (!this.statusForm.name.trim()) return
      this.isSavingStatus = true

      try {
        const body = {
          name: this.statusForm.name.trim(),
          color: this.statusForm.color || null,
          description: this.statusForm.description || null,
        }

        if (this.editingStatus) {
          await $fetch(`/api/projects/${this.project.slug}/statuses/${this.editingStatus.id}`, {
            method: 'PUT',
            body,
          })
          toast.success('Status updated')
        } else {
          await $fetch(`/api/projects/${this.project.slug}/statuses`, {
            method: 'POST',
            body,
          })
          toast.success('Status created')
        }

        this.showStatusDialog = false
        await this.loadStatuses()
      } catch (err) {
        console.error('Error saving status:', err)
        toast.error(err?.data?.error?.message || 'Failed to save status')
      } finally {
        this.isSavingStatus = false
      }
    },

    async deleteStatus() {
      if (!this.deletingStatus) return
      this.isDeletingStatus = true

      try {
        await $fetch(`/api/projects/${this.project.slug}/statuses/${this.deletingStatus.id}`, {
          method: 'DELETE',
          body: {
            replacementValue: this.replacementValue || null,
          },
        })

        toast.success('Status deleted')
        this.showDeleteDialog = false
        await this.loadStatuses()
      } catch (err) {
        console.error('Error deleting status:', err)
        toast.error(err?.data?.error?.message || 'Failed to delete status')
      } finally {
        this.isDeletingStatus = false
      }
    },
  },
}
</script>
