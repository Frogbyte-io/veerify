<template>
  <div class="space-y-6">
    <Card>
      <CardHeader>
        <div class="flex items-start justify-between gap-4">
          <div>
            <CardTitle class="flex items-center gap-2">
              <Icon name="lucide:boxes" class="h-5 w-5" />
              Products
            </CardTitle>
            <CardDescription>
              Each product has its own feedback board and its own public or private setting.
            </CardDescription>
          </div>
          <Button size="sm" data-testid="project-products-add" @click="openAdd">
            <Icon name="lucide:plus" class="h-4 w-4 mr-1.5" />
            Add product
          </Button>
        </div>
      </CardHeader>
      <CardContent class="space-y-3">
        <div
          v-if="products.length === 1"
          class="rounded-md bg-muted p-3 text-sm text-muted-foreground"
          data-testid="project-products-single-note"
        >
          With one product, the product layer is hidden everywhere: "{{ project.name }}" simply is the product. Add a
          second product and product pickers, tabs and filters appear automatically.
        </div>

        <div
          v-for="(product, index) in products"
          :key="product.id"
          class="flex flex-wrap items-center gap-3 rounded-lg border p-3"
          :data-testid="`project-product-row-${product.slug}`"
        >
          <div class="flex flex-col">
            <Button
              variant="ghost"
              size="icon"
              class="h-5 w-6"
              :disabled="index === 0 || busyId === product.id"
              aria-label="Move up"
              @click="move(index, -1)"
            >
              <Icon name="lucide:chevron-up" class="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="h-5 w-6"
              :disabled="index === products.length - 1 || busyId === product.id"
              aria-label="Move down"
              @click="move(index, 1)"
            >
              <Icon name="lucide:chevron-down" class="h-4 w-4" />
            </Button>
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium truncate">{{ product.name }}</p>
            <p class="text-xs text-muted-foreground truncate">/{{ product.slug }}</p>
          </div>
          <label class="flex items-center gap-2 text-sm">
            <Switch
              :model-value="product.isPublic"
              :disabled="busyId === product.id"
              :aria-label="`${product.name} is public`"
              @update:model-value="setPublic(product, $event)"
            />
            <span class="w-14 text-muted-foreground">{{ product.isPublic ? 'Public' : 'Private' }}</span>
          </label>
          <Button variant="outline" size="sm" @click="openRename(product)">Rename</Button>
          <Button
            variant="outline"
            size="sm"
            class="text-destructive"
            :disabled="products.length <= 1"
            :title="products.length <= 1 ? 'A project needs at least one product' : ''"
            @click="openDelete(product)"
          >
            <Icon name="lucide:trash-2" class="h-4 w-4" />
            <span class="sr-only">Delete {{ product.name }}</span>
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Add / rename -->
    <Dialog :open="formDialog.open" @update:open="formDialog.open = $event">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{{ formDialog.product ? 'Rename product' : 'Add product' }}</DialogTitle>
          <DialogDescription>
            {{
              formDialog.product
                ? 'Changing the slug changes the public URL of this product.'
                : 'A new product gets its own empty feedback board.'
            }}
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-3">
          <div class="space-y-2">
            <Label for="product-name">Name</Label>
            <Input id="product-name" v-model="formDialog.name" placeholder="dot x" />
          </div>
          <div class="space-y-2">
            <Label for="product-slug">URL slug</Label>
            <Input id="product-slug" v-model="formDialog.slug" placeholder="Generated from the name if empty" />
          </div>
          <label v-if="!formDialog.product" class="flex items-center gap-2 text-sm">
            <Switch v-model="formDialog.isPublic" aria-label="Public" />
            Public board
          </label>
          <p v-if="formDialog.error" class="text-sm text-destructive">{{ formDialog.error }}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="formDialog.open = false">Cancel</Button>
          <Button :disabled="!formDialog.name.trim() || formDialog.saving" @click="submitForm">
            <Icon v-if="formDialog.saving" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
            {{ formDialog.product ? 'Save' : 'Add product' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Delete -->
    <Dialog :open="deleteDialog.open" @update:open="deleteDialog.open = $event">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle class="text-destructive">Delete {{ deleteDialog.product?.name }}?</DialogTitle>
          <DialogDescription>
            Feedback on this product is not deleted. Choose which product should receive it.
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-2">
          <Label for="product-move-to">Move feedback to</Label>
          <select
            id="product-move-to"
            v-model="deleteDialog.moveTo"
            class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option v-for="p in otherProducts" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <p v-if="deleteDialog.error" class="text-sm text-destructive">{{ deleteDialog.error }}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="deleteDialog.open = false">Cancel</Button>
          <Button variant="destructive" :disabled="!deleteDialog.moveTo || deleteDialog.saving" @click="confirmDelete">
            <Icon v-if="deleteDialog.saving" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
            Delete product
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'

export default {
  name: 'ProjectSettingsProducts',
  props: {
    project: { type: Object, required: true },
    products: { type: Array, required: true },
  },
  emits: ['products-changed'],
  data() {
    return {
      busyId: null,
      formDialog: { open: false, product: null, name: '', slug: '', isPublic: true, saving: false, error: '' },
      deleteDialog: { open: false, product: null, moveTo: '', saving: false, error: '' },
    }
  },
  computed: {
    base() {
      return `/api/projects/${this.project.slug}/products`
    },
    otherProducts() {
      return this.products.filter((p) => p.id !== this.deleteDialog.product?.id)
    },
  },
  methods: {
    errorMessage(err, fallback) {
      return err?.data?.error?.message || err?.statusMessage || fallback
    },
    openAdd() {
      this.formDialog = { open: true, product: null, name: '', slug: '', isPublic: true, saving: false, error: '' }
    },
    openRename(product) {
      this.formDialog = {
        open: true,
        product,
        name: product.name,
        slug: product.slug,
        isPublic: product.isPublic,
        saving: false,
        error: '',
      }
    },
    async submitForm() {
      const dialog = this.formDialog
      const isRename = Boolean(dialog.product)
      dialog.saving = true
      dialog.error = ''
      try {
        if (isRename) {
          await $fetch(`${this.base}/${dialog.product.id}`, {
            method: 'PUT',
            body: { name: dialog.name.trim(), slug: dialog.slug.trim() || undefined },
          })
        } else {
          await $fetch(this.base, {
            method: 'POST',
            body: { name: dialog.name.trim(), slug: dialog.slug.trim() || undefined, isPublic: dialog.isPublic },
          })
        }
        dialog.open = false
        toast.success(isRename ? 'Product updated' : 'Product added')
        this.$emit('products-changed')
      } catch (err) {
        dialog.error = this.errorMessage(err, 'Failed to save product')
      } finally {
        dialog.saving = false
      }
    },
    async setPublic(product, value) {
      this.busyId = product.id
      try {
        await $fetch(`${this.base}/${product.id}`, { method: 'PUT', body: { isPublic: value } })
        this.$emit('products-changed')
      } catch (err) {
        toast.error(this.errorMessage(err, 'Failed to update product'))
      } finally {
        this.busyId = null
      }
    },
    async move(index, delta) {
      const a = this.products[index]
      const b = this.products[index + delta]
      if (!a || !b) return
      this.busyId = a.id
      try {
        // Renumber the whole list so equal sortOrder values never make the swap a no-op.
        const next = this.products.map((p) => p.id)
        next[index] = b.id
        next[index + delta] = a.id
        await Promise.all(
          next.map((id, order) => {
            const current = this.products.find((p) => p.id === id)
            if (current.sortOrder === order) return null
            return $fetch(`${this.base}/${id}`, { method: 'PUT', body: { sortOrder: order } })
          })
        )
        this.$emit('products-changed')
      } catch (err) {
        toast.error(this.errorMessage(err, 'Failed to reorder products'))
      } finally {
        this.busyId = null
      }
    },
    openDelete(product) {
      const other = this.products.find((p) => p.id !== product.id)
      this.deleteDialog = { open: true, product, moveTo: other?.id || '', saving: false, error: '' }
    },
    async confirmDelete() {
      const dialog = this.deleteDialog
      dialog.saving = true
      dialog.error = ''
      try {
        await $fetch(`${this.base}/${dialog.product.id}`, { method: 'DELETE', query: { moveTo: dialog.moveTo } })
        dialog.open = false
        toast.success('Product deleted')
        this.$emit('products-changed')
      } catch (err) {
        dialog.error = this.errorMessage(err, 'Failed to delete product')
      } finally {
        dialog.saving = false
      }
    },
  },
}
</script>
