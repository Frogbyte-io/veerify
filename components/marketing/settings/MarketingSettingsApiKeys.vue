<template>
  <Card data-testid="marketing-settings-keys">
    <CardHeader>
      <CardTitle>API keys</CardTitle>
      <CardDescription>
        Bring your own keys. They are encrypted before they are stored and never shown again. Only the last four
        characters are displayed. Usage is billed by the provider, not by Veerify.
      </CardDescription>
    </CardHeader>

    <CardContent>
      <div v-if="isLoading" class="space-y-3">
        <Skeleton v-for="i in 4" :key="i" class="h-20 w-full" />
      </div>

      <div v-else-if="error" class="text-center py-4" data-testid="marketing-keys-error">
        <p class="text-sm text-destructive mb-2">{{ error }}</p>
        <Button variant="outline" size="sm" @click="load">Retry</Button>
      </div>

      <div v-else class="space-y-3">
        <p
          v-if="!canManage"
          class="rounded-md border border-muted bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
          data-testid="marketing-keys-read-only"
        >
          You can see which keys are set, but only team admins can add, replace or remove them.
        </p>
        <p
          v-if="!secretsConfigured"
          class="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm"
          role="alert"
          data-testid="marketing-keys-no-secrets"
        >
          Keys cannot be stored on this installation yet. The server administrator must set
          <code class="font-mono">SECRETS_ENCRYPTION_KEY</code>
          (for example from <code class="font-mono">openssl rand -base64 32</code>).
        </p>

        <div
          v-for="provider in providers"
          :key="provider.id"
          class="rounded-lg border p-4 space-y-3"
          :data-testid="`marketing-key-${provider.id}`"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm font-medium">{{ provider.label }}</p>
              <p class="text-xs text-muted-foreground mt-0.5">{{ provider.hint }}</p>
            </div>
            <Badge v-if="credentialFor(provider.id)" :variant="statusVariant(credentialFor(provider.id))">
              {{ statusLabel(credentialFor(provider.id)) }}
            </Badge>
            <Badge v-else variant="outline">No key</Badge>
          </div>

          <template v-if="credentialFor(provider.id)">
            <p class="text-sm text-muted-foreground">
              Key
              <code class="font-mono">••••{{ credentialFor(provider.id).keyHint }}</code>
            </p>
            <p
              v-if="credentialFor(provider.id).lastError"
              class="text-sm"
              :class="credentialFor(provider.id).status === 'invalid' ? 'text-destructive' : 'text-muted-foreground'"
            >
              {{ credentialFor(provider.id).lastError }}
            </p>

            <div v-if="provider.llm" class="flex flex-wrap items-end gap-2">
              <div>
                <Label :for="`budget-${provider.id}`" class="text-xs">Monthly budget (USD, estimate)</Label>
                <Input
                  :id="`budget-${provider.id}`"
                  v-model="budgets[provider.id]"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="No cap"
                  class="mt-1 w-40"
                  :disabled="!canManage || busy === provider.id"
                />
              </div>
              <Button
                v-if="canManage"
                size="sm"
                variant="outline"
                :disabled="busy === provider.id || !budgetChanged(provider.id)"
                @click="saveBudget(provider.id)"
              >
                Save budget
              </Button>
            </div>
          </template>

          <div v-if="canManage" class="space-y-2">
            <form v-if="editing === provider.id" class="flex flex-wrap gap-2" @submit.prevent="saveKey(provider.id)">
              <Input
                v-model="keyDraft"
                type="password"
                autocomplete="off"
                spellcheck="false"
                placeholder="Paste API key"
                class="flex-1 min-w-48"
                :disabled="busy === provider.id"
                :aria-label="`${provider.label} API key`"
              />
              <Button type="submit" :disabled="busy === provider.id || keyDraft.trim().length < 8">
                <Icon v-if="busy === provider.id" name="lucide:loader-circle" class="w-4 h-4 mr-2 animate-spin" />
                Check and save
              </Button>
              <Button type="button" variant="ghost" :disabled="busy === provider.id" @click="cancelEdit">
                Cancel
              </Button>
            </form>
            <div v-else class="flex gap-2">
              <Button size="sm" variant="outline" :disabled="!secretsConfigured" @click="startEdit(provider.id)">
                {{ credentialFor(provider.id) ? 'Replace key' : 'Add key' }}
              </Button>
              <Button
                v-if="credentialFor(provider.id)"
                size="sm"
                variant="ghost"
                :disabled="busy === provider.id"
                @click="remove(provider.id)"
              >
                Remove
              </Button>
            </div>
            <p v-if="rowError[provider.id]" class="text-sm text-destructive" role="alert">
              {{ rowError[provider.id] }}
            </p>
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
</template>

<script>
import { apiErrorMessage } from '~/lib/api-error'
import { toast } from 'vue-sonner'

const PROVIDERS = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    hint: 'Used for AI visibility checks on Claude.',
    llm: true,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    hint: 'Used for AI visibility checks on ChatGPT models.',
    llm: true,
  },
  {
    id: 'firecrawl',
    label: 'Firecrawl',
    hint: 'Enables the full site crawl. Without it, audits cover the home page and site files only.',
    llm: false,
  },
  {
    id: 'pagespeed',
    label: 'PageSpeed Insights',
    hint: 'Adds Core Web Vitals to site audits. Saved without a check.',
    llm: false,
  },
]

export default {
  name: 'MarketingSettingsApiKeys',

  props: {
    teamId: { type: String, required: true },
  },

  emits: ['changed'],

  data() {
    return {
      providers: PROVIDERS,
      credentials: [],
      canManage: false,
      secretsConfigured: true,
      isLoading: true,
      error: null,
      editing: null,
      keyDraft: '',
      busy: null,
      budgets: {},
      rowError: {},
    }
  },

  watch: {
    teamId() {
      this.load()
    },
  },

  mounted() {
    this.load()
  },

  methods: {
    credentialFor(id) {
      return this.credentials.find((c) => c.provider === id) || null
    },

    statusLabel(credential) {
      if (credential.status === 'valid') return 'Valid'
      if (credential.status === 'invalid') return 'Rejected'
      return 'Not checked'
    },

    statusVariant(credential) {
      if (credential.status === 'valid') return 'default'
      if (credential.status === 'invalid') return 'destructive'
      return 'secondary'
    },

    centsToInput(cents) {
      return cents === null || cents === undefined ? '' : String(cents / 100)
    },

    inputToCents(value) {
      const text = String(value ?? '').trim()
      if (text === '') return null
      const dollars = Number(text)
      return Number.isFinite(dollars) && dollars >= 0 ? Math.round(dollars * 100) : undefined
    },

    budgetChanged(id) {
      const credential = this.credentialFor(id)
      return this.inputToCents(this.budgets[id]) !== (credential?.monthlyBudgetCents ?? null)
    },

    async load() {
      this.isLoading = true
      this.error = null
      try {
        const response = await $fetch(`/api/marketing/teams/${this.teamId}/credentials`)
        const data = response?.data || {}
        this.credentials = data.credentials || []
        this.canManage = data.canManage === true
        this.secretsConfigured = data.secretsConfigured !== false
        this.budgets = Object.fromEntries(
          this.credentials.map((credential) => [credential.provider, this.centsToInput(credential.monthlyBudgetCents)])
        )
      } catch (err) {
        this.error = apiErrorMessage(err, 'Failed to load API keys')
      } finally {
        this.isLoading = false
      }
    },

    startEdit(id) {
      this.editing = id
      this.keyDraft = ''
      this.rowError = { ...this.rowError, [id]: null }
    },

    cancelEdit() {
      this.editing = null
      this.keyDraft = ''
    },

    async saveKey(id) {
      this.busy = id
      this.rowError = { ...this.rowError, [id]: null }
      try {
        const response = await $fetch(`/api/marketing/teams/${this.teamId}/credentials/${id}`, {
          method: 'PUT',
          body: { apiKey: this.keyDraft.trim() },
        })
        const status = response?.data?.credential?.status
        this.editing = null
        // Drop the key from component state as soon as it has been sent
        this.keyDraft = ''
        if (status === 'valid') toast.success('Key saved')
        else toast.warning('Key saved, but it could not be checked right now')
        await this.load()
        this.$emit('changed')
      } catch (err) {
        this.rowError = { ...this.rowError, [id]: apiErrorMessage(err, 'Failed to save the key') }
      } finally {
        this.busy = null
      }
    },

    async saveBudget(id) {
      const cents = this.inputToCents(this.budgets[id])
      if (cents === undefined) {
        this.rowError = { ...this.rowError, [id]: 'Enter a positive amount, or leave empty for no cap' }
        return
      }
      this.busy = id
      this.rowError = { ...this.rowError, [id]: null }
      try {
        await $fetch(`/api/marketing/teams/${this.teamId}/credentials/${id}`, {
          method: 'PATCH',
          body: { monthlyBudgetCents: cents },
        })
        toast.success(cents === null ? 'Budget cap removed' : 'Budget saved')
        await this.load()
      } catch (err) {
        this.rowError = { ...this.rowError, [id]: apiErrorMessage(err, 'Failed to save the budget') }
      } finally {
        this.busy = null
      }
    },

    async remove(id) {
      this.busy = id
      this.rowError = { ...this.rowError, [id]: null }
      try {
        await $fetch(`/api/marketing/teams/${this.teamId}/credentials/${id}`, { method: 'DELETE' })
        toast.success('Key removed')
        await this.load()
        this.$emit('changed')
      } catch (err) {
        this.rowError = { ...this.rowError, [id]: apiErrorMessage(err, 'Failed to remove the key') }
      } finally {
        this.busy = null
      }
    },
  },
}
</script>
