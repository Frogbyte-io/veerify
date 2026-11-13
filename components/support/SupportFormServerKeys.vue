<template>
  <div class="space-y-3" data-testid="support-form-server-keys">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="min-w-0">
        <p class="flex items-center gap-1.5 text-sm font-medium">
          <Icon name="lucide:key-round" class="h-4 w-4" />
          Server keys
        </p>
        <p class="text-xs text-muted-foreground">
          Secret keys your website's backend sends as <code>Authorization: Bearer vfy_srv_…</code>. Never put them in
          browser code.
        </p>
      </div>
      <Button size="sm" variant="outline" data-testid="support-form-key-create" @click="openCreateDialog">
        <Icon name="lucide:plus" class="mr-1.5 h-4 w-4" />
        Create server key
      </Button>
    </div>

    <div v-if="isLoading" class="space-y-2">
      <Skeleton v-for="n in 2" :key="n" class="h-12 w-full" />
    </div>

    <div v-else-if="error" class="py-3 text-center">
      <p class="mb-2 text-sm text-destructive">{{ error }}</p>
      <Button variant="outline" size="sm" @click="loadKeys">
        <Icon name="lucide:refresh-cw" class="mr-2 h-4 w-4" />
        Retry
      </Button>
    </div>

    <p v-else-if="keys.length === 0" class="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
      No server keys yet. Create one for each site that submits forms.
    </p>

    <div v-else class="space-y-2">
      <div
        v-for="apiKey in keys"
        :key="apiKey.id"
        data-testid="support-form-key-row"
        class="flex items-center justify-between gap-3 rounded-lg border p-3"
      >
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <p class="truncate text-sm font-medium">{{ apiKey.name }}</p>
            <Badge v-if="apiKey.revokedAt" variant="destructive" class="text-xs">Revoked</Badge>
          </div>
          <p class="font-mono text-xs text-muted-foreground">{{ apiKey.keyPrefix }}…</p>
          <p class="text-xs text-muted-foreground">
            Created {{ formatDate(apiKey.createdAt) }} · Last used
            {{ apiKey.lastUsedAt ? formatDate(apiKey.lastUsedAt) : 'never' }}
          </p>
        </div>
        <Button
          v-if="!apiKey.revokedAt"
          variant="ghost"
          size="sm"
          class="text-destructive hover:text-destructive"
          @click="openRevokeDialog(apiKey)"
        >
          <Icon name="lucide:trash-2" class="mr-1.5 h-4 w-4" />
          Revoke
        </Button>
      </div>
    </div>

    <Dialog :open="showCreateDialog" @update:open="showCreateDialog = $event">
      <DialogContent class="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Create server key</DialogTitle>
          <DialogDescription>Name it after the site or service that will use it.</DialogDescription>
        </DialogHeader>
        <div class="space-y-2 py-4">
          <Label for="support-form-key-name">Name</Label>
          <Input
            id="support-form-key-name"
            v-model="newKeyName"
            maxlength="60"
            placeholder="e.g. DotMatrixLabs web shop"
            @keydown.enter.prevent="createKey"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showCreateDialog = false">Cancel</Button>
          <Button
            data-testid="support-form-key-create-confirm"
            :disabled="isCreating || !newKeyName.trim()"
            @click="createKey"
          >
            <Icon v-if="isCreating" name="lucide:loader-2" class="mr-2 h-4 w-4 animate-spin" />
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog :open="showKeyDialog" @update:open="onKeyDialogToggle">
      <DialogContent class="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>Your new server key</DialogTitle>
          <DialogDescription>
            Copy it now and store it as a secret on your server. You won't be able to see it again.
          </DialogDescription>
        </DialogHeader>
        <div class="relative py-4">
          <pre
            data-testid="support-form-key-value"
            class="whitespace-pre-wrap break-all rounded-md bg-muted px-4 py-3 pr-12 font-mono text-sm"
            >{{ createdKey }}</pre
          >
          <Button
            variant="ghost"
            size="icon"
            class="absolute right-2 top-6 h-7 w-7"
            :title="copiedKey ? 'Copied!' : 'Copy key'"
            @click="copyKey"
          >
            <Icon :name="copiedKey ? 'lucide:check' : 'lucide:copy'" class="h-4 w-4" />
          </Button>
        </div>
        <DialogFooter>
          <Button data-testid="support-form-key-done" @click="closeKeyDialog">Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog :open="showRevokeDialog" @update:open="showRevokeDialog = $event">
      <DialogContent class="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle class="text-destructive">Revoke server key</DialogTitle>
          <DialogDescription>
            Revoke "{{ revokingKey?.name }}"? Sites using it stop being able to submit forms right away. This cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="showRevokeDialog = false">Cancel</Button>
          <Button variant="destructive" :disabled="isRevoking" @click="revokeKey">
            <Icon v-if="isRevoking" name="lucide:loader-2" class="mr-2 h-4 w-4 animate-spin" />
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
  name: 'SupportFormServerKeys',
  props: {
    projectSlug: {
      type: String,
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
      isCreating: false,
      showKeyDialog: false,
      createdKey: '',
      copiedKey: false,
      showRevokeDialog: false,
      revokingKey: null,
      isRevoking: false,
    }
  },
  watch: {
    projectSlug() {
      this.loadKeys()
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
      return new Date(value).toLocaleDateString()
    },
    async loadKeys() {
      this.isLoading = true
      this.error = null
      try {
        const response = await $fetch(this.keysUrl(), { params: { kind: 'server' } })
        this.keys = Array.isArray(response?.data) ? response.data : []
      } catch (err) {
        this.error = err?.data?.error?.message || err?.statusMessage || 'Failed to load server keys'
      } finally {
        this.isLoading = false
      }
    },
    openCreateDialog() {
      this.newKeyName = ''
      this.showCreateDialog = true
    },
    async createKey() {
      const name = this.newKeyName.trim()
      if (!name || this.isCreating) return
      this.isCreating = true
      try {
        const response = await $fetch(this.keysUrl(), { method: 'POST', body: { name, kind: 'server' } })
        const { key, ...summary } = response?.data || {}
        this.keys = [summary, ...this.keys]
        this.createdKey = key
        this.copiedKey = false
        this.showCreateDialog = false
        this.showKeyDialog = true
      } catch (err) {
        toast.error(err?.data?.error?.message || 'Failed to create server key')
      } finally {
        this.isCreating = false
      }
    },
    onKeyDialogToggle(open) {
      if (open) this.showKeyDialog = true
      else this.closeKeyDialog()
    },
    closeKeyDialog() {
      this.showKeyDialog = false
      this.createdKey = ''
      this.copiedKey = false
    },
    async copyKey() {
      try {
        await navigator.clipboard.writeText(this.createdKey)
        this.copiedKey = true
      } catch {
        toast.error('Could not copy. Select the key and copy it by hand.')
      }
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
        toast.success('Server key revoked')
        this.showRevokeDialog = false
        await this.loadKeys()
      } catch (err) {
        toast.error(err?.data?.error?.message || 'Failed to revoke server key')
      } finally {
        this.isRevoking = false
      }
    },
  },
}
</script>
