<template>
  <div class="space-y-6">
    <Card>
      <CardHeader>
        <div class="flex items-center justify-between">
          <div>
            <CardTitle class="flex items-center gap-2">
              <Icon name="lucide:tags" class="h-5 w-5" />
              Feedback Categories
            </CardTitle>
            <CardDescription>Organize feedback into categories for your product.</CardDescription>
          </div>
          <Button size="sm" @click="openCreateDialog">
            <Icon name="lucide:plus" class="w-4 h-4 mr-2" />
            Add Category
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <!-- Loading -->
        <div v-if="isLoading" class="space-y-3">
          <Skeleton v-for="n in 3" :key="n" class="h-14 w-full" />
        </div>

        <!-- Error -->
        <div v-else-if="error" class="text-center py-6">
          <p class="text-sm text-destructive mb-2">{{ error }}</p>
          <Button variant="outline" size="sm" @click="loadCategories">
            <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
            Retry
          </Button>
        </div>

        <!-- Empty -->
        <div v-else-if="categories.length === 0" class="text-center py-8">
          <Icon name="lucide:tags" class="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p class="text-sm text-muted-foreground mb-3">No categories yet</p>
          <Button size="sm" @click="openCreateDialog">Add First Category</Button>
        </div>

        <!-- Category List -->
        <div v-else class="space-y-2">
          <p class="text-xs text-muted-foreground">Drag categories to reorder how they appear on your public board.</p>
          <div
            v-for="category in categories"
            :key="category.id"
            :data-testid="`product-category-item-${category.id}`"
            class="flex items-center justify-between rounded-lg border p-3 transition-colors"
            :class="{
              'border-primary bg-primary/5': dragOverCategoryId === category.id && draggedCategoryId !== category.id,
            }"
            @dragover.prevent="onCategoryDragOver(category.id)"
            @dragenter.prevent="onCategoryDragOver(category.id)"
            @dragleave="onCategoryDragLeave(category.id)"
            @drop.prevent="onCategoryDrop(category.id)"
          >
            <div class="flex items-center gap-3">
              <button
                type="button"
                :data-testid="`product-category-drag-handle-${category.id}`"
                class="inline-flex h-8 w-8 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:cursor-not-allowed"
                :aria-label="`Drag to reorder ${category.name}`"
                :disabled="isReordering"
                draggable="true"
                @dragstart="onCategoryDragStart(category.id, $event)"
                @dragend="onCategoryDragEnd"
              >
                <Icon name="lucide:grip-vertical" class="w-4 h-4" />
              </button>
              <span
                class="w-3 h-3 rounded-full flex-shrink-0"
                :style="{ backgroundColor: category.color || '#6b7280' }"
              />
              <div>
                <div class="flex items-center gap-2">
                  <span v-if="category.icon" class="text-sm">{{ category.icon }}</span>
                  <p class="font-medium text-sm">{{ category.name }}</p>
                  <Badge v-if="category.isDefault" variant="secondary" class="text-xs">Default</Badge>
                </div>
                <p v-if="category.description" class="text-xs text-muted-foreground">
                  {{ category.description }}
                </p>
              </div>
            </div>
            <div class="flex items-center gap-1">
              <Button variant="ghost" size="sm" :disabled="isReordering" @click="openEditDialog(category)">
                <Icon name="lucide:pencil" class="w-4 h-4" />
              </Button>
              <Button
                v-if="!category.isDefault"
                variant="ghost"
                size="sm"
                class="text-destructive hover:text-destructive"
                :disabled="isReordering"
                @click="openDeleteDialog(category)"
              >
                <Icon name="lucide:trash-2" class="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Create/Edit Category Dialog -->
    <Dialog :open="showCategoryDialog" @update:open="showCategoryDialog = $event">
      <DialogContent class="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>{{ editingCategory ? 'Edit Category' : 'New Category' }}</DialogTitle>
          <DialogDescription>
            {{ editingCategory ? 'Update the category details.' : 'Create a new feedback category.' }}
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-4 py-4">
          <div class="space-y-2">
            <Label for="cat-name">Name</Label>
            <Input id="cat-name" v-model="categoryForm.name" placeholder="e.g. Enhancement" />
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-2">
              <Label for="cat-icon">Icon (emoji)</Label>
              <Input id="cat-icon" v-model="categoryForm.icon" placeholder="e.g. 🚀" maxlength="4" />
            </div>
            <div class="space-y-2">
              <Label for="cat-color">Color</Label>
              <div class="flex items-center gap-2">
                <input
                  type="color"
                  :value="categoryForm.color || '#6b7280'"
                  class="w-8 h-8 rounded border cursor-pointer"
                  @input="categoryForm.color = $event.target.value"
                />
                <Input id="cat-color" v-model="categoryForm.color" placeholder="#6b7280" class="flex-1" />
              </div>
            </div>
          </div>
          <div class="space-y-2">
            <Label for="cat-desc">Description (optional)</Label>
            <Input id="cat-desc" v-model="categoryForm.description" placeholder="A brief description" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showCategoryDialog = false">Cancel</Button>
          <Button :disabled="isSavingCategory || !categoryForm.name.trim()" @click="saveCategory">
            <Icon v-if="isSavingCategory" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
            {{ editingCategory ? 'Save' : 'Create' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Delete Category Dialog -->
    <Dialog :open="showDeleteDialog" @update:open="showDeleteDialog = $event">
      <DialogContent class="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle class="text-destructive">Delete Category</DialogTitle>
          <DialogDescription> Are you sure you want to delete "{{ deletingCategory?.name }}"? </DialogDescription>
        </DialogHeader>
        <div v-if="deletingCategory" class="py-4">
          <p class="text-sm text-muted-foreground mb-3">If feedback items use this category, select a replacement:</p>
          <div class="space-y-2">
            <Label for="replacement-cat">Replacement Category</Label>
            <select
              id="replacement-cat"
              v-model="replacementCategoryId"
              class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">None (remove category from feedback)</option>
              <option
                v-for="cat in categories.filter((c) => c.id !== deletingCategory?.id)"
                :key="cat.id"
                :value="cat.id"
              >
                {{ cat.icon }} {{ cat.name }}
              </option>
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showDeleteDialog = false">Cancel</Button>
          <Button variant="destructive" :disabled="isDeletingCategory" @click="deleteCategory">
            <Icon v-if="isDeletingCategory" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
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
  name: 'ProductSettingsCategories',
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  data() {
    return {
      categories: [],
      isLoading: true,
      error: null,
      showCategoryDialog: false,
      showDeleteDialog: false,
      editingCategory: null,
      deletingCategory: null,
      replacementCategoryId: '',
      isSavingCategory: false,
      isDeletingCategory: false,
      isReordering: false,
      draggedCategoryId: null,
      dragOverCategoryId: null,
      categoryForm: {
        name: '',
        icon: '',
        color: '#6b7280',
        description: '',
      },
    }
  },
  watch: {
    'project.slug': {
      handler() {
        this.loadCategories()
      },
      immediate: false,
    },
  },
  async mounted() {
    await this.loadCategories()
  },
  methods: {
    async loadCategories() {
      this.isLoading = true
      this.error = null

      try {
        const response = await $fetch(`/api/projects/${this.project.slug}/categories`)
        this.categories = response?.data || []
      } catch (err) {
        console.error('Error loading categories:', err)
        this.error = 'Failed to load categories'
      } finally {
        this.isLoading = false
      }
    },

    openCreateDialog() {
      this.editingCategory = null
      this.categoryForm = { name: '', icon: '', color: '#6b7280', description: '' }
      this.showCategoryDialog = true
    },

    openEditDialog(category) {
      this.editingCategory = category
      this.categoryForm = {
        name: category.name,
        icon: category.icon || '',
        color: category.color || '#6b7280',
        description: category.description || '',
      }
      this.showCategoryDialog = true
    },

    openDeleteDialog(category) {
      this.deletingCategory = category
      this.replacementCategoryId = ''
      this.showDeleteDialog = true
    },

    onCategoryDragStart(categoryId, event) {
      if (this.isReordering) {
        event.preventDefault()
        return
      }

      this.draggedCategoryId = categoryId
      if (event?.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', categoryId)
      }
    },

    onCategoryDragOver(categoryId) {
      if (!this.draggedCategoryId || this.draggedCategoryId === categoryId) return
      this.dragOverCategoryId = categoryId
    },

    onCategoryDragLeave(categoryId) {
      if (this.dragOverCategoryId === categoryId) {
        this.dragOverCategoryId = null
      }
    },

    onCategoryDragEnd() {
      this.draggedCategoryId = null
      this.dragOverCategoryId = null
    },

    async onCategoryDrop(targetCategoryId) {
      if (!this.draggedCategoryId || this.draggedCategoryId === targetCategoryId || this.isReordering) {
        this.onCategoryDragEnd()
        return
      }

      const fromIndex = this.categories.findIndex((category) => category.id === this.draggedCategoryId)
      const toIndex = this.categories.findIndex((category) => category.id === targetCategoryId)

      if (fromIndex < 0 || toIndex < 0) {
        this.onCategoryDragEnd()
        return
      }

      const previousOrder = [...this.categories]
      const reordered = [...this.categories]
      const [movedCategory] = reordered.splice(fromIndex, 1)
      reordered.splice(toIndex, 0, movedCategory)
      this.categories = reordered
      this.onCategoryDragEnd()
      await this.persistCategoryOrder(previousOrder)
    },

    async persistCategoryOrder(previousOrder) {
      this.isReordering = true

      try {
        await Promise.all(
          this.categories.map((category, sortOrder) =>
            $fetch(`/api/projects/${this.project.slug}/categories/${category.id}`, {
              method: 'PUT',
              body: { sortOrder },
            })
          )
        )
        toast.success('Category order saved')
      } catch (err) {
        console.error('Error saving category order:', err)
        this.categories = previousOrder
        toast.error(err?.data?.error?.message || 'Failed to save category order')
      } finally {
        this.isReordering = false
      }
    },

    async saveCategory() {
      if (!this.categoryForm.name.trim()) return
      this.isSavingCategory = true

      try {
        const body = {
          name: this.categoryForm.name.trim(),
          icon: this.categoryForm.icon || null,
          color: this.categoryForm.color || null,
          description: this.categoryForm.description || null,
        }

        if (this.editingCategory) {
          await $fetch(`/api/projects/${this.project.slug}/categories/${this.editingCategory.id}`, {
            method: 'PUT',
            body,
          })
          toast.success('Category updated')
        } else {
          await $fetch(`/api/projects/${this.project.slug}/categories`, {
            method: 'POST',
            body,
          })
          toast.success('Category created')
        }

        this.showCategoryDialog = false
        await this.loadCategories()
      } catch (err) {
        console.error('Error saving category:', err)
        toast.error(err?.data?.error?.message || 'Failed to save category')
      } finally {
        this.isSavingCategory = false
      }
    },

    async deleteCategory() {
      if (!this.deletingCategory) return
      this.isDeletingCategory = true

      try {
        await $fetch(`/api/projects/${this.project.slug}/categories/${this.deletingCategory.id}`, {
          method: 'DELETE',
          body: {
            replacementCategoryId: this.replacementCategoryId || null,
          },
        })

        toast.success('Category deleted')
        this.showDeleteDialog = false
        await this.loadCategories()
      } catch (err) {
        console.error('Error deleting category:', err)
        toast.error(err?.data?.error?.message || 'Failed to delete category')
      } finally {
        this.isDeletingCategory = false
      }
    },
  },
}
</script>
