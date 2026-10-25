<template>
  <Card id="keys" class="scroll-mt-20" data-testid="workspace-settings-keys">
    <CardHeader>
      <CardTitle role="heading" aria-level="2">API keys</CardTitle>
      <CardDescription>
        Bring your own keys. They are encrypted before they are stored and never shown again. Only the last four
        characters are displayed. Usage is billed by the provider, not by Veerify. Cap the monthly spend per provider or
        for the whole workspace.
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
          You can see which keys are set. Only workspace owners and admins can change this.
        </p>
        <p
          v-if="!secretsConfigured"
          class="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm"
          role="alert"
          data-testid="marketing-keys-no-secrets"
        >
          Keys cannot be stored on this installation yet. Ask your server admin to set
          <code class="font-mono">SECRETS_ENCRYPTION_KEY</code>
          (for example from <code class="font-mono">openssl rand -base64 32</code>).
        </p>

        <!-- Monthly AI spend and the workspace-wide cap -->
        <div class="rounded-lg border p-4 space-y-3" data-testid="workspace-ai-spend">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm font-medium">AI spend this month</p>
              <p class="text-xs text-muted-foreground mt-0.5">
                Estimated from usage at list prices and updated live. Your provider's invoice is the final number.
              </p>
            </div>
            <p class="text-sm font-semibold tabular-nums shrink-0" data-testid="workspace-ai-spend-total">
              {{ formatMicros(spend.totalUsdMicros) }}
              <span v-if="spend.workspaceCapCents != null" class="font-normal text-muted-foreground">
                of {{ formatCents(spend.workspaceCapCents) }}
              </span>
            </p>
          </div>
          <div
            v-if="spend.workspaceCapCents != null"
            class="h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            :aria-valuenow="capPercent(spend.totalUsdMicros, spend.workspaceCapCents)"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-label="Workspace AI spend against the monthly cap"
          >
            <div
              class="h-full rounded-full transition-all"
              :class="barClass(spend.totalUsdMicros, spend.workspaceCapCents)"
              :style="{ width: `${capPercent(spend.totalUsdMicros, spend.workspaceCapCents)}%` }"
            />
          </div>
          <p v-if="spend.inFlightUsdMicros > 0" class="text-xs text-muted-foreground">
            {{ formatMicros(spend.inFlightUsdMicros) }} reserved for checks running right now.
          </p>
          <p
            v-if="capReached"
            class="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            role="alert"
            data-testid="workspace-ai-spend-cap-reached"
          >
            The monthly cap is reached. AI checks are paused until next month or until the cap is raised.
          </p>
          <form v-if="canManage" class="flex flex-wrap items-end gap-2" @submit.prevent="saveCap">
            <div>
              <Label for="workspace-spend-cap" class="text-xs">Monthly spend cap for all providers (USD)</Label>
              <Input
                id="workspace-spend-cap"
                v-model="capDraft"
                data-testid="workspace-spend-cap-input"
                type="number"
                min="0"
                step="1"
                placeholder="No cap"
                class="mt-1 w-40"
                :disabled="savingCap"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              data-testid="workspace-spend-cap-save"
              :disabled="savingCap || !capChanged"
            >
              Save cap
            </Button>
          </form>
          <p v-else class="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon name="lucide:lock" class="w-3.5 h-3.5" />
            Workspace owners and admins can change the spend cap.
          </p>
          <p v-if="capError" class="text-sm text-destructive" role="alert">{{ capError }}</p>
          <p v-if="spendError" class="text-xs text-muted-foreground">
            {{ spendError }}
            <button type="button" class="underline" @click="loadSpend">Retry</button>
          </p>
        </div>

        <!-- Paste any key: the provider is detected from the key itself -->
        <form
          v-if="canManage && secretsConfigured"
          class="rounded-lg border border-dashed p-4 space-y-2"
          data-testid="workspace-key-paste"
          @submit.prevent
        >
          <Label for="workspace-key-paste-input" class="text-sm font-medium">Paste any API key</Label>
          <p class="text-xs text-muted-foreground">
            We recognize the provider from the key and file it in the right place.
          </p>
          <Input
            id="workspace-key-paste-input"
            v-model="pasteDraft"
            data-testid="workspace-key-paste-input"
            type="password"
            autocomplete="off"
            spellcheck="false"
            placeholder="sk-ant-…, sk-proj-…, AIza…, pplx-…, fc-…"
            :disabled="!!busy"
          />
          <div
            v-if="pasteDraft.trim()"
            class="flex flex-wrap items-center gap-2"
            data-testid="workspace-key-paste-matches"
          >
            <template v-if="pasteMatches.length">
              <span class="text-xs text-muted-foreground">
                {{ pasteMatches.length > 1 ? 'This Google key works for:' : 'Looks like:' }}
              </span>
              <Button
                v-for="match in pasteMatches"
                :key="match.id"
                type="button"
                size="sm"
                :data-testid="`workspace-key-paste-save-${match.id}`"
                :disabled="!!busy"
                @click="savePasted(match.id)"
              >
                <Icon v-if="busy === match.id" name="lucide:loader-circle" class="w-4 h-4 mr-2 animate-spin" />
                Check and save as {{ match.label }}
              </Button>
            </template>
            <span v-else class="text-xs text-muted-foreground" data-testid="workspace-key-paste-unknown">
              We couldn't tell which provider this key is for. Use Add key on the right provider below.
            </span>
          </div>
          <p v-if="pasteError" class="text-sm text-destructive" role="alert">{{ pasteError }}</p>
        </form>

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
              <p
                v-if="canManage && (!credentialFor(provider.id) || editing === provider.id)"
                class="text-xs text-muted-foreground mt-1"
              >
                <a
                  :href="keyLinks[provider.id].url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                  :data-testid="`marketing-key-link-${provider.id}`"
                >
                  Get a key
                  <Icon name="lucide:external-link" class="w-3 h-3" />
                </a>
                <span class="ml-1">{{ keyLinks[provider.id].steps }}</span>
              </p>
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

            <div v-if="provider.llm" class="space-y-1.5" :data-testid="`marketing-key-spend-${provider.id}`">
              <p class="text-xs text-muted-foreground tabular-nums">
                {{ formatMicros(providerSpend(provider.id).spentUsdMicros) }} spent this month
                <template v-if="credentialFor(provider.id).monthlyBudgetCents != null">
                  of {{ formatCents(credentialFor(provider.id).monthlyBudgetCents) }}
                </template>
              </p>
              <div
                v-if="credentialFor(provider.id).monthlyBudgetCents != null"
                class="h-1.5 w-full overflow-hidden rounded-full bg-muted"
              >
                <div
                  class="h-full rounded-full transition-all"
                  :class="
                    barClass(providerSpend(provider.id).spentUsdMicros, credentialFor(provider.id).monthlyBudgetCents)
                  "
                  :style="{
                    width: `${capPercent(providerSpend(provider.id).spentUsdMicros, credentialFor(provider.id).monthlyBudgetCents)}%`,
                  }"
                />
              </div>
            </div>

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
                :aria-label="`Save budget for ${provider.label}`"
                :disabled="busy === provider.id || !budgetChanged(provider.id)"
                @click="saveBudget(provider.id)"
              >
                Save budget
              </Button>
            </div>
          </template>

          <div v-if="canManage" class="space-y-2">
            <form
              v-if="editing === provider.id"
              class="flex flex-wrap gap-2"
              :data-inline-form="`key-${provider.id}`"
              @submit.prevent="saveKey(provider.id)"
            >
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
              <Button
                size="sm"
                variant="outline"
                :disabled="!secretsConfigured"
                :aria-label="`${credentialFor(provider.id) ? 'Replace key' : 'Add key'} for ${provider.label}`"
                :data-inline-opener="`key-${provider.id}`"
                @click="startEdit(provider.id)"
              >
                {{ credentialFor(provider.id) ? 'Replace key' : 'Add key' }}
              </Button>
              <Button
                v-if="credentialFor(provider.id)"
                size="sm"
                variant="ghost"
                :disabled="busy === provider.id"
                :aria-label="`Remove key for ${provider.label}`"
                @click="remove(provider.id)"
              >
                Remove
              </Button>
            </div>
            <p
              v-if="editing === provider.id && mismatchFor(provider.id)"
              class="text-xs text-amber-700 dark:text-amber-400"
              :data-testid="`marketing-key-mismatch-${provider.id}`"
            >
              This looks like a {{ mismatchFor(provider.id) }} key, not a {{ provider.label }} key.
            </p>
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
import inlineFormMixin from '~/lib/inline-form-mixin'
import { detectKeyProviders, PROVIDER_KEY_LINKS } from '~/lib/api-key-detect'

const SPEND_REFRESH_MS = 15_000

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
    id: 'gemini',
    label: 'Google Gemini',
    hint: 'Used for AI visibility checks on Gemini, with Google Search grounding.',
    llm: true,
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    hint: 'Used for AI visibility checks on Perplexity, which searches the web on every answer.',
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
  name: 'WorkspaceApiKeys',

  mixins: [inlineFormMixin],

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
      keyLinks: PROVIDER_KEY_LINKS,
      spend: { totalUsdMicros: 0, inFlightUsdMicros: 0, workspaceCapCents: null, providers: [] },
      spendError: null,
      capDraft: '',
      savingCap: false,
      capError: null,
      pasteDraft: '',
      pasteError: null,
      spendTimer: null,
    }
  },

  computed: {
    pasteMatches() {
      return detectKeyProviders(this.pasteDraft)
        .map((id) => this.providers.find((provider) => provider.id === id))
        .filter(Boolean)
    },
    capChanged() {
      return this.inputToCents(this.capDraft) !== (this.spend.workspaceCapCents ?? null)
    },
    capReached() {
      return this.spend.workspaceCapCents != null && this.spend.totalUsdMicros >= this.spend.workspaceCapCents * 10_000
    },
  },

  watch: {
    editing(id) {
      if (id) this.inlineOpen(`key-${id}`, () => this.cancelEdit())
      else this.inlineClose()
    },
  },

  mounted() {
    this.load()
    this.loadSpend()
    if (import.meta.client) {
      // Live spend: refresh while the tab is visible, and right away when it becomes visible again
      this.spendTimer = window.setInterval(() => {
        if (document.visibilityState === 'visible') this.loadSpend()
      }, SPEND_REFRESH_MS)
      document.addEventListener('visibilitychange', this.onVisibilityChange)
    }
  },

  beforeUnmount() {
    if (import.meta.client) {
      window.clearInterval(this.spendTimer)
      document.removeEventListener('visibilitychange', this.onVisibilityChange)
    }
  },

  methods: {
    onVisibilityChange() {
      if (document.visibilityState === 'visible') this.loadSpend()
    },

    async loadSpend() {
      try {
        const response = await $fetch('/api/workspace/spend')
        const data = response?.data || {}
        const capWasSynced = !this.capChanged
        this.spend = {
          totalUsdMicros: Number(data.totalUsdMicros || 0),
          inFlightUsdMicros: Number(data.inFlightUsdMicros || 0),
          workspaceCapCents: data.workspaceCapCents ?? null,
          providers: Array.isArray(data.providers) ? data.providers : [],
        }
        // Keep the user's unsaved edit; otherwise follow the stored cap
        if (capWasSynced) this.capDraft = this.centsToInput(this.spend.workspaceCapCents)
        this.spendError = null
      } catch (err) {
        this.spendError = apiErrorMessage(err, 'Could not load this month’s spend.')
      }
    },

    providerSpend(id) {
      return this.spend.providers.find((p) => p.provider === id) || { spentUsdMicros: 0, inFlightUsdMicros: 0 }
    },

    formatMicros(micros) {
      return this.formatUsd(Number(micros || 0) / 1_000_000)
    },

    formatCents(cents) {
      return this.formatUsd(Number(cents || 0) / 100)
    },

    formatUsd(dollars) {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(dollars)
    },

    capPercent(spentMicros, capCents) {
      if (!capCents) return spentMicros > 0 ? 100 : 0
      return Math.min(100, Math.round((Number(spentMicros || 0) / (capCents * 10_000)) * 100))
    },

    barClass(spentMicros, capCents) {
      const percent = this.capPercent(spentMicros, capCents)
      if (percent >= 100) return 'bg-destructive'
      if (percent >= 80) return 'bg-amber-500'
      return 'bg-primary'
    },

    async saveCap() {
      const cents = this.inputToCents(this.capDraft)
      if (cents === undefined) {
        this.capError = 'Enter a positive amount, or leave empty for no cap'
        return
      }
      this.savingCap = true
      this.capError = null
      try {
        await $fetch('/api/workspace/spend', { method: 'PUT', body: { monthlyCapCents: cents } })
        toast.success(cents === null ? 'Spend cap removed' : 'Spend cap saved')
        this.spend = { ...this.spend, workspaceCapCents: cents }
        this.capDraft = this.centsToInput(cents)
        await this.loadSpend()
      } catch (err) {
        this.capError = apiErrorMessage(err, 'Failed to save the spend cap')
      } finally {
        this.savingCap = false
      }
    },

    mismatchFor(id) {
      const detected = detectKeyProviders(this.keyDraft)
      if (!detected.length || detected.includes(id)) return null
      return this.providers.find((provider) => provider.id === detected[0])?.label || null
    },

    async savePasted(id) {
      this.pasteError = null
      const saved = await this.storeKey(id, this.pasteDraft.trim())
      if (saved) this.pasteDraft = ''
      else this.pasteError = this.rowError[id]
    },

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
        const response = await $fetch('/api/workspace/api-keys')
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
      const saved = await this.storeKey(id, this.keyDraft.trim())
      if (!saved) return
      this.editing = null
      // Drop the key from component state once it is stored
      this.keyDraft = ''
    },

    /** Sends a key to be checked and stored. Resolves true when it was saved. */
    async storeKey(id, apiKey) {
      this.busy = id
      this.rowError = { ...this.rowError, [id]: null }
      try {
        const response = await $fetch(`/api/workspace/api-keys/${id}`, {
          method: 'PUT',
          body: { apiKey },
        })
        const status = response?.data?.credential?.status
        if (status === 'valid') toast.success('Key saved')
        else toast.warning('Key saved, but it could not be checked right now')
        await this.load()
        this.$emit('changed')
        return true
      } catch (err) {
        this.rowError = { ...this.rowError, [id]: apiErrorMessage(err, 'Failed to save the key') }
        return false
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
        await $fetch(`/api/workspace/api-keys/${id}`, {
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
        await $fetch(`/api/workspace/api-keys/${id}`, { method: 'DELETE' })
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
