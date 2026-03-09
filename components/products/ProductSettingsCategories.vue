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
          <Button variant="outline" size="sm" @click="refreshResource">
            <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
            Retry
          </Button>
        </div>

        <!-- Empty -->
        <div v-else-if="localCategories.length === 0" class="text-center py-8">
          <Icon name="lucide:tags" class="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p class="text-sm text-muted-foreground mb-3">No categories yet</p>
          <Button size="sm" @click="openCreateDialog">Add First Category</Button>
        </div>

        <!-- Category List -->
        <div v-else class="space-y-2">
          <p class="text-xs text-muted-foreground">Drag categories to reorder how they appear on your public board.</p>
          <VueDraggable
            v-model="localCategories"
            tag="div"
            class="space-y-2"
            :animation="180"
            :disabled="isReordering || localCategories.length <= 1"
            ghost-class="category-sort-ghost"
            chosen-class="category-sort-chosen"
            drag-class="category-sort-drag"
            handle="[data-sort-handle='category']"
            @start="onCategorySortStart"
            @end="onCategorySortEnd"
          >
            <div
              v-for="category in localCategories"
              :key="category.id"
              :data-testid="`product-category-item-${category.id}`"
              class="flex items-center justify-between rounded-lg border p-3 transition-colors duration-150"
            >
              <div class="flex items-center gap-3">
                <button
                  type="button"
                  :data-testid="`product-category-drag-handle-${category.id}`"
                  data-sort-handle="category"
                  class="inline-flex h-8 w-8 cursor-grab items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 active:cursor-grabbing"
                  :aria-label="`Drag to reorder ${category.name}`"
                  :disabled="isReordering || localCategories.length <= 1"
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
          </VueDraggable>
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
                >
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
                v-for="cat in localCategories.filter((c) => c.id !== deletingCategory?.id)"
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
import { VueDraggable } from 'vue-draggable-plus'
import { toast } from 'vue-sonner'

function sortCategories(categories) {
  return [...categories].sort((a, b) => {
    if ((a.sortOrder ?? 0) !== (b.sortOrder ?? 0)) {
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    }
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
  })
}

export default {
  name: 'ProductSettingsCategories',
  components: {
    VueDraggable,
  },
  props: {
    project: {
      type: Object,
      required: true,
    },
    resourceState: {
      type: Object,
      required: true,
    },
    ensureLoaded: {
      type: Function,
      default: null,
    },
    refresh: {
      type: Function,
      default: null,
    },
  },
  emits: ['categories-updated', 'feedback-default-invalidated'],
  data() {
    return {
      localCategories: [],
      showCategoryDialog: false,
      showDeleteDialog: false,
      editingCategory: null,
      deletingCategory: null,
      replacementCategoryId: '',
      isSavingCategory: false,
      isDeletingCategory: false,
      isReordering: false,
      dragStartOrder: [],
      categoryForm: {
        name: '',
        icon: '',
        color: '#6b7280',
        description: '',
      },
    }
  },
  computed: {
    isLoading() {
      return ['idle', 'loading'].includes(this.resourceState?.status) && this.localCategories.length === 0
    },
    error() {
      if (this.localCategories.length > 0) return null
      if (this.resourceState?.status !== 'error') return null
      return this.resourceState?.error || 'Failed to load categories'
    },
  },
  watch: {
    'resourceState.data': {
      handler(categories) {
        this.localCategories = sortCategories(Array.isArray(categories) ? categories.map((category) => ({ ...category })) : [])
      },
      immediate: true,
      deep: true,
    },
  },
  methods: {
    refreshResource() {
      if (!this.refresh) return
      this.refresh().catch(() => {})
    },
    emitCategories(categories) {
      const nextCategories = sortCategories(categories.map((category) => ({ ...category })))
      this.localCategories = nextCategories
      this.$emit('categories-updated', nextCategories)
      this.$emit('feedback-default-invalidated')
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

    onCategorySortStart() {
      this.dragStartOrder = this.localCategories.map((category) => ({ ...category }))
    },

    async onCategorySortEnd(event) {
      if (this.isReordering || event?.oldIndex === event?.newIndex) {
        this.dragStartOrder = []
        return
      }

      if (!this.dragStartOrder.length) {
        return
      }

      const previousOrder = this.dragStartOrder.map((category) => ({ ...category }))
      this.dragStartOrder = []
      await this.persistCategoryOrder(previousOrder)
    },

    async persistCategoryOrder(previousOrder) {
      this.isReordering = true
      const reorderedCategories = this.localCategories.map((category, sortOrder) => ({
        ...category,
        sortOrder,
      }))
      this.localCategories = reorderedCategories

      try {
        await Promise.all(
          reorderedCategories.map((category) =>
            $fetch(`/api/projects/${this.project.slug}/categories/${category.id}`, {
              method: 'PUT',
              body: { sortOrder: category.sortOrder },
            })
          )
        )
        this.emitCategories(reorderedCategories)
        toast.success('Category order saved')
      } catch (err) {
        console.error('Error saving category order:', err)
        this.localCategories = previousOrder
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

        let savedCategory = null
        if (this.editingCategory) {
          const response = await $fetch(`/api/projects/${this.project.slug}/categories/${this.editingCategory.id}`, {
            method: 'PUT',
            body,
          })
          savedCategory = response?.data || null
          toast.success('Category updated')
        } else {
          const response = await $fetch(`/api/projects/${this.project.slug}/categories`, {
            method: 'POST',
            body,
          })
          savedCategory = response?.data || null
          toast.success('Category created')
        }

        const currentCategories = this.localCategories.map((category) => ({ ...category }))
        const nextCategories = this.editingCategory
          ? currentCategories.map((category) => (category.id === savedCategory?.id ? savedCategory : category))
          : [...currentCategories, savedCategory]

        this.emitCategories(nextCategories.filter(Boolean))
        this.showCategoryDialog = false
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

        const nextCategories = this.localCategories.filter((category) => category.id !== this.deletingCategory.id)
        this.emitCategories(nextCategories)
        toast.success('Category deleted')
        this.showDeleteDialog = false
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

<style scoped>
.category-sort-ghost {
  opacity: 0.45;
}

.category-sort-chosen {
  border-color: hsl(var(--primary));
  background: color-mix(in oklab, hsl(var(--primary)) 10%, transparent);
}

.category-sort-drag {
  cursor: grabbing;
}
</style>
