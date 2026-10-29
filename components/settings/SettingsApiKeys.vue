<template>
  <div class="bg-card rounded-lg border" data-testid="user-api-keys">
    <div class="p-6 border-b flex items-start justify-between gap-4">
      <div>
        <h2 class="text-lg font-semibold">API keys</h2>
        <p class="text-sm text-muted-foreground">
          A personal API key acts as you, with your permissions. Use it to let an agent such as Claude Code work in
          Veerify on your behalf. Keep it secret and revoke it when it is no longer needed.
        </p>
      </div>
      <Button data-testid="user-api-keys-create" class="shrink-0" @click="openCreateDialog">
        <Icon name="lucide:plus" class="h-4 w-4 mr-2" />
        Create key
      </Button>
    </div>

    <div class="p-6">
      <div v-if="isLoading" class="space-y-3" data-testid="user-api-keys-loading">
        <Skeleton v-for="i in 3" :key="i" class="h-16 w-full" />
      </div>

      <div v-else-if="error" class="text-center py-4" data-testid="user-api-keys-error">
        <p class="text-sm text-destructive mb-2">{{ error }}</p>
        <Button variant="outline" size="sm" @click="loadKeys">Retry</Button>
      </div>

      <div v-else-if="keys.length === 0" class="text-center py-8 text-sm text-muted-foreground">No API keys yet</div>

      <div v-else class="space-y-3">
        <div
          v-for="apiKey in keys"
          :key="apiKey.id"
          data-testid="user-api-key-row"
          class="flex items-center justify-between gap-4 rounded-lg border p-4"
        >
          <div class="min-w-0 space-y-1">
            <div class="flex items-center gap-2">
              <p class="font-medium truncate">{{ apiKey.name }}</p>
              <Badge v-if="apiKey.createdVia === 'device'" variant="outline" data-testid="user-api-key-device-badge">
                via device login
              </Badge>
              <Badge v-if="apiKey.revokedAt" variant="destructive">Revoked</Badge>
              <Badge v-else-if="isExpired(apiKey)" variant="secondary">Expired</Badge>
            </div>
            <p class="text-sm font-mono text-muted-foreground">{{ apiKey.keyPrefix }}…</p>
            <p class="text-xs text-muted-foreground">
              Created {{ formatDate(apiKey.createdAt) }} · Last used
              {{ apiKey.lastUsedAt ? formatDate(apiKey.lastUsedAt) : 'Never' }} ·
              {{ apiKey.expiresAt ? `Expires ${formatDate(apiKey.expiresAt)}` : 'Never expires' }}
            </p>
          </div>
          <Button
            v-if="!apiKey.revokedAt"
            data-testid="user-api-key-revoke"
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
    </div>

    <!-- Create dialog -->
    <Dialog :open="showCreateDialog" @update:open="showCreateDialog = $event">
      <DialogContent class="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Create API key</DialogTitle>
          <DialogDescription>Give the key a name so you can recognise it later.</DialogDescription>
        </DialogHeader>
        <div class="space-y-4 py-4">
          <div class="space-y-2">
            <Label for="user-api-key-name">Name</Label>
            <Input
              id="user-api-key-name"
              v-model="newKeyName"
              data-testid="user-api-key-name"
              maxlength="60"
              placeholder="e.g. Claude Code on my laptop"
              @keydown.enter.prevent="createKey"
            />
          </div>
          <div class="space-y-2">
            <Label for="user-api-key-expiry">Expires</Label>
            <select
              id="user-api-key-expiry"
              v-model="newKeyExpiry"
              data-testid="user-api-key-expiry"
              class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            >
              <option v-for="option in expiryOptions" :key="option.label" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </div>
          <p v-if="createError" class="text-sm text-destructive" role="alert">{{ createError }}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showCreateDialog = false">Cancel</Button>
          <Button data-testid="user-api-key-submit" :disabled="isCreating || !newKeyName.trim()" @click="createKey">
            <Icon v-if="isCreating" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Show-once dialog -->
    <Dialog :open="showKeyDialog" @update:open="onKeyDialogToggle">
      <DialogContent class="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Your new API key</DialogTitle>
          <DialogDescription>Copy this key now. You won't be able to see it again.</DialogDescription>
        </DialogHeader>
        <div class="space-y-4 py-4">
          <div class="relative">
            <pre
              data-testid="user-api-key-secret"
              class="rounded-md bg-muted px-4 py-3 pr-12 text-sm font-mono whitespace-pre-wrap break-all"
              >{{ createdKey }}</pre
            >
            <Button
              variant="ghost"
              size="icon"
              class="absolute top-2 right-2 h-7 w-7"
              :title="copiedKey ? 'Copied!' : 'Copy key'"
              @click="copyText(createdKey, 'key')"
            >
              <Icon :name="copiedKey ? 'lucide:check' : 'lucide:copy'" class="h-4 w-4" />
            </Button>
          </div>
          <div class="space-y-2">
            <p class="text-sm text-muted-foreground">Connect Claude Code with this command:</p>
            <div class="relative">
              <pre
                data-testid="user-api-key-mcp-line"
                class="rounded-md bg-muted px-4 py-3 pr-12 text-sm font-mono whitespace-pre-wrap break-all"
                >{{ mcpLine }}</pre
              >
              <Button
                variant="ghost"
                size="icon"
                class="absolute top-2 right-2 h-7 w-7"
                :title="copiedLine ? 'Copied!' : 'Copy command'"
                @click="copyText(mcpLine, 'line')"
              >
                <Icon :name="copiedLine ? 'lucide:check' : 'lucide:copy'" class="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button data-testid="user-api-key-done" @click="closeKeyDialog">Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Revoke confirm dialog -->
    <Dialog :open="showRevokeDialog" @update:open="showRevokeDialog = $event">
      <DialogContent class="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle class="text-destructive">Revoke API key</DialogTitle>
          <DialogDescription>
            Revoke "{{ revokingKey?.name }}"? Anything using this key will immediately lose access. This cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <p v-if="revokeError" class="text-sm text-destructive" role="alert">{{ revokeError }}</p>
        <DialogFooter>
          <Button variant="outline" @click="showRevokeDialog = false">Cancel</Button>
          <Button
            data-testid="user-api-key-revoke-confirm"
            variant="destructive"
            :disabled="isRevoking"
            @click="revokeKey"
          >
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
import { apiErrorMessage } from '~/lib/api-error'

export default {
  name: 'SettingsApiKeys',
  data() {
    return {
      keys: [],
      isLoading: true,
      error: null,
      origin: '',
      expiryOptions: [
        { label: 'Never', value: null },
        { label: '30 days', value: 30 },
        { label: '90 days', value: 90 },
        { label: '365 days', value: 365 },
      ],
      showCreateDialog: false,
      newKeyName: '',
      newKeyExpiry: null,
      isCreating: false,
      createError: null,
      showKeyDialog: false,
      createdKey: '',
      copiedKey: false,
      copiedLine: false,
      showRevokeDialog: false,
      revokingKey: null,
      isRevoking: false,
      revokeError: null,
    }
  },
  computed: {
    mcpLine() {
      return `claude mcp add --transport http veerify ${this.origin}/mcp --header "Authorization: Bearer ${this.createdKey}"`
    },
  },
  async mounted() {
    if (import.meta.client) this.origin = window.location.origin
    await this.loadKeys()
  },
  methods: {
    formatDate(value) {
      return new Date(value).toLocaleDateString()
    },
    isExpired(apiKey) {
      return !!apiKey.expiresAt && new Date(apiKey.expiresAt).getTime() <= Date.now()
    },
    async loadKeys() {
      this.isLoading = true
      this.error = null
      try {
        const response = await $fetch('/api/user/api-keys')
        this.keys = Array.isArray(response?.data) ? response.data : []
      } catch (err) {
        this.error = apiErrorMessage(err, 'Failed to load API keys')
      } finally {
        this.isLoading = false
      }
    },
    openCreateDialog() {
      this.newKeyName = ''
      this.newKeyExpiry = null
      this.createError = null
      this.showCreateDialog = true
    },
    async createKey() {
      const name = this.newKeyName.trim()
      if (!name || this.isCreating) return
      this.isCreating = true
      this.createError = null
      try {
        const response = await $fetch('/api/user/api-keys', {
          method: 'POST',
          body: { name, expiresInDays: this.newKeyExpiry },
        })
        const { key, ...summary } = response?.data || {}
        this.keys = [summary, ...this.keys]
        this.createdKey = key
        this.copiedKey = false
        this.copiedLine = false
        this.showCreateDialog = false
        this.showKeyDialog = true
      } catch (err) {
        this.createError = apiErrorMessage(err, 'Failed to create API key')
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
      this.copiedLine = false
    },
    openRevokeDialog(apiKey) {
      this.revokingKey = apiKey
      this.revokeError = null
      this.showRevokeDialog = true
    },
    async revokeKey() {
      if (!this.revokingKey) return
      this.isRevoking = true
      this.revokeError = null
      try {
        await $fetch(`/api/user/api-keys/${this.revokingKey.id}`, { method: 'DELETE' })
        toast.success('API key revoked')
        this.showRevokeDialog = false
        await this.loadKeys()
      } catch (err) {
        this.revokeError = apiErrorMessage(err, 'Failed to revoke API key')
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
      const flag = which === 'key' ? 'copiedKey' : 'copiedLine'
      this[flag] = true
      setTimeout(() => {
        this[flag] = false
      }, 2000)
    },
  },
}
</script>
