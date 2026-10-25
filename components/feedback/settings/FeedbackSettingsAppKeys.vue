<template>
  <div class="space-y-6">
    <Card>
      <CardHeader>
        <div class="flex items-center justify-between">
          <div>
            <CardTitle class="flex items-center gap-2">
              <Icon name="lucide:key-round" class="h-5 w-5" />
              App keys
            </CardTitle>
            <CardDescription>
              Let your desktop app post feedback into one of this project's products.
            </CardDescription>
          </div>
          <Button size="sm" @click="openCreateDialog">
            <Icon name="lucide:plus" class="w-4 h-4 mr-2" />
            Create key
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
          <Button variant="outline" size="sm" @click="loadKeys">
            <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
            Retry
          </Button>
        </div>

        <!-- Empty -->
        <div v-else-if="keys.length === 0" class="text-center py-8">
          <Icon name="lucide:key-round" class="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p class="text-sm text-muted-foreground mb-3">No app keys yet</p>
          <Button size="sm" @click="openCreateDialog">Create First Key</Button>
        </div>

        <!-- List -->
        <div v-else class="space-y-2">
          <div
            v-for="apiKey in keys"
            :key="apiKey.id"
            :data-testid="`api-key-item-${apiKey.id}`"
            class="flex items-center justify-between rounded-lg border p-3"
          >
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <p class="font-medium text-sm truncate">{{ apiKey.name }}</p>
                <Badge v-if="apiKey.revokedAt" variant="destructive" class="text-xs">Revoked</Badge>
              </div>
              <p class="text-xs font-mono text-muted-foreground">{{ apiKey.keyPrefix }}…</p>
              <p v-if="showProductNames && apiKey.productName" class="text-xs text-muted-foreground">
                Posts to {{ apiKey.productName }}
              </p>
              <p class="text-xs text-muted-foreground">
                Created {{ formatDate(apiKey.createdAt) }} · Last used
                {{ apiKey.lastUsedAt ? formatDate(apiKey.lastUsedAt) : 'Never' }}
              </p>
            </div>
            <Button
              v-if="!apiKey.revokedAt"
              variant="ghost"
              size="sm"
              class="text-destructive hover:text-destructive"
              @click="openRevokeDialog(apiKey)"
            >
              <Icon name="lucide:trash-2" class="w-4 h-4 mr-2" />
              Revoke
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Usage example -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Icon name="lucide:terminal" class="h-5 w-5" />
          Usage
        </CardTitle>
        <CardDescription>
          Send feedback with a <code>POST</code> request. <code>type</code> is <code>bug</code> or <code>feature</code>;
          <code>appVersion</code>, <code>os</code> and <code>osVersion</code> are optional.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="relative">
          <pre class="rounded-md bg-muted px-4 py-3 text-sm font-mono overflow-x-auto whitespace-pre-wrap break-all">{{
            curlExample
          }}</pre>
          <Button
            variant="ghost"
            size="icon"
            class="absolute top-2 right-2 h-7 w-7"
            :title="copiedCurl ? 'Copied!' : 'Copy example'"
            @click="copyText(curlExample, 'curl')"
          >
            <Icon :name="copiedCurl ? 'lucide:check' : 'lucide:copy'" class="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Create dialog -->
    <Dialog :open="showCreateDialog" @update:open="showCreateDialog = $event">
      <DialogContent class="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Create app key</DialogTitle>
          <DialogDescription>Give the key a name so you can recognise it later.</DialogDescription>
        </DialogHeader>
        <div class="space-y-2 py-4">
          <Label for="api-key-name">Name</Label>
          <Input
            id="api-key-name"
            v-model="newKeyName"
            maxlength="60"
            placeholder="e.g. Dot X desktop app"
            @keydown.enter.prevent="createKey"
          />
          <div v-if="products.length > 1" class="space-y-2 pt-2">
            <Label for="api-key-product">Product</Label>
            <select
              id="api-key-product"
              v-model="newKeyProductId"
              data-testid="api-key-product-select"
              class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            >
              <option v-for="item in products" :key="item.id" :value="item.id">{{ item.name }}</option>
            </select>
            <p class="text-xs text-muted-foreground">Feedback sent with this key lands on this product's board.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showCreateDialog = false">Cancel</Button>
          <Button :disabled="isCreating || !newKeyName.trim()" @click="createKey">
            <Icon v-if="isCreating" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Created key dialog -->
    <Dialog :open="showKeyDialog" @update:open="onKeyDialogToggle">
      <DialogContent class="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>Your new app key</DialogTitle>
          <DialogDescription>Copy this key now. You won't be able to see it again.</DialogDescription>
        </DialogHeader>
        <div class="relative py-4">
          <pre
            data-testid="api-key-full-value"
            class="rounded-md bg-muted px-4 py-3 pr-12 text-sm font-mono whitespace-pre-wrap break-all"
            >{{ createdKey }}</pre
          >
          <Button
            variant="ghost"
            size="icon"
            class="absolute top-6 right-2 h-7 w-7"
            :title="copiedKey ? 'Copied!' : 'Copy key'"
            @click="copyText(createdKey, 'key')"
          >
            <Icon :name="copiedKey ? 'lucide:check' : 'lucide:copy'" class="h-4 w-4" />
          </Button>
        </div>
        <DialogFooter>
          <Button @click="closeKeyDialog">Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Revoke dialog -->
    <Dialog :open="showRevokeDialog" @update:open="showRevokeDialog = $event">
      <DialogContent class="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle class="text-destructive">Revoke app key</DialogTitle>
          <DialogDescription>
            Revoke "{{ revokingKey?.name }}"? Apps using this key will immediately stop being able to send feedback.
            This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="showRevokeDialog = false">Cancel</Button>
          <Button variant="destructive" :disabled="isRevoking" @click="revokeKey">
            <Icon v-if="isRevoking" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
            Revoke
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'

export default {
  name: 'FeedbackSettingsAppKeys',
  props: {
    // Project payload from the settings panel (GET /api/projects/[slug]), including `products`
    project: {
      type: Object,
      required: true,
    },
  },
  data() {
    return {
      keys: [],
      isLoading: true,
      error: null,
      showCreateDialog: false,
      newKeyName: '',
      newKeyProductId: '',
      isCreating: false,
      showKeyDialog: false,
      createdKey: '',
      showRevokeDialog: false,
      revokingKey: null,
      isRevoking: false,
      copiedKey: false,
      copiedCurl: false,
    }
  },
  computed: {
    projectSlug() {
      return this.project.slug
    },
    products() {
      return Array.isArray(this.project.products) ? this.project.products : []
    },
    // With a single product the product layer stays hidden in the UI.
    showProductNames() {
      return this.products.length > 1
    },
    curlExample() {
      const origin = import.meta.client ? window.location.origin : ''
      return [
        `curl -X POST ${origin}/api/v1/feedback \\`,
        `  -H "Authorization: Bearer <your-api-key>" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -d '{"type":"bug","description":"Describe the problem here"}'`,
      ].join('\n')
    },
  },
  async mounted() {
    await this.loadKeys()
  },
  methods: {
    keysUrl() {
      return `/api/projects/${this.projectSlug}/api-keys`
    },
    formatDate(value) {
      return new Date(value).toLocaleString()
    },
    async loadKeys() {
      this.isLoading = true
      this.error = null
      try {
        const response = await $fetch(this.keysUrl())
        this.keys = Array.isArray(response?.data) ? response.data : []
      } catch (err) {
        console.error('Error loading app keys:', err)
        this.error = err?.data?.error?.message || err?.statusMessage || 'Failed to load app keys'
      } finally {
        this.isLoading = false
      }
    },
    openCreateDialog() {
      this.newKeyName = ''
      this.newKeyProductId = this.products[0]?.id || ''
      this.showCreateDialog = true
    },
    async createKey() {
      const name = this.newKeyName.trim()
      if (!name || this.isCreating) return
      this.isCreating = true
      try {
        const response = await $fetch(this.keysUrl(), {
          method: 'POST',
          body: this.products.length > 1 && this.newKeyProductId ? { name, productId: this.newKeyProductId } : { name },
        })
        const { key, ...summary } = response?.data || {}
        this.keys = [summary, ...this.keys]
        this.createdKey = key
        this.copiedKey = false
        this.showCreateDialog = false
        this.showKeyDialog = true
      } catch (err) {
        console.error('Error creating app key:', err)
        toast.error(err?.data?.error?.message || 'Failed to create app key')
      } finally {
        this.isCreating = false
      }
    },
    onKeyDialogToggle(open) {
      if (open) {
        this.showKeyDialog = true
      } else {
        this.closeKeyDialog()
      }
    },
    closeKeyDialog() {
      this.showKeyDialog = false
      this.createdKey = ''
      this.copiedKey = false
    },
    openRevokeDialog(apiKey) {
      this.revokingKey = apiKey
      this.showRevokeDialog = true
    },
    async revokeKey() {
      if (!this.revokingKey) return
      this.isRevoking = true
      try {
        await $fetch(`${this.keysUrl()}/${this.revokingKey.id}`, { method: 'DELETE' })
        toast.success('app key revoked')
        this.showRevokeDialog = false
        await this.loadKeys()
      } catch (err) {
        console.error('Error revoking app key:', err)
        toast.error(err?.data?.error?.message || 'Failed to revoke app key')
      } finally {
        this.isRevoking = false
      }
    },
    async copyText(text, which) {
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        const el = document.createElement('textarea')
        el.value = text
        document.body.appendChild(el)
        el.select()
        document.execCommand('copy')
        document.body.removeChild(el)
      }
      const flag = which === 'key' ? 'copiedKey' : 'copiedCurl'
      this[flag] = true
      setTimeout(() => {
        this[flag] = false
      }, 2000)
    },
  },
}
</script>
