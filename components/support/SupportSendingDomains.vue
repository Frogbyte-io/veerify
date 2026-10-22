<template>
  <Card v-if="isVisible" data-testid="support-sending-domains">
    <CardHeader>
      <div class="flex items-start justify-between gap-3">
        <div>
          <CardTitle>Sending domains</CardTitle>
          <CardDescription>
            Register your own domain so replies are sent from your address. Publish the DNS records below, then Veerify
            checks them automatically.
          </CardDescription>
        </div>
        <Button
          v-if="canManage && data?.enabled"
          size="sm"
          class="shrink-0"
          data-testid="support-sending-domain-add"
          @click="openAddDialog"
        >
          <Icon name="lucide:plus" class="mr-1 h-4 w-4" />
          Add domain
        </Button>
      </div>
    </CardHeader>
    <CardContent class="space-y-4">
      <div v-if="isLoading" class="space-y-2" data-testid="support-sending-domains-loading">
        <Skeleton v-for="i in 2" :key="i" class="h-14 w-full" />
      </div>

      <div v-else-if="error" class="text-sm" data-testid="support-sending-domains-error">
        <p class="mb-2 text-destructive">{{ error }}</p>
        <Button variant="outline" size="sm" @click="load()">Retry</Button>
      </div>

      <template v-else-if="data">
        <p v-if="providerLabel" class="text-sm text-muted-foreground">
          Provider: <strong>{{ providerLabel }}</strong>
          <span v-if="!canManage"> · Only team admins can add or remove domains.</span>
        </p>

        <div
          v-if="!data.providerConfigured"
          class="rounded-md bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
          data-testid="support-sending-domains-unconfigured"
        >
          <p class="mb-1">
            The mail provider is not configured, so new domains cannot be registered. Set these and restart:
          </p>
          <ul class="list-disc space-y-0.5 pl-5">
            <li v-for="name in data.missingEnvVars" :key="name">
              <code>{{ name }}</code>
            </li>
          </ul>
        </div>

        <p
          v-if="data.domains.length === 0"
          class="text-sm text-muted-foreground"
          data-testid="support-sending-domains-empty"
        >
          No sending domains yet.
        </p>

        <ul v-else class="space-y-3">
          <li
            v-for="row in data.domains"
            :key="row.id"
            class="rounded-lg border p-3"
            data-testid="support-sending-domain-row"
            :data-domain="row.domain"
            :data-status="row.status"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex min-w-0 items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 w-7 shrink-0 p-0"
                  :aria-label="isExpanded(row.id) ? 'Hide DNS records' : 'Show DNS records'"
                  :aria-expanded="isExpanded(row.id)"
                  data-testid="support-sending-domain-expand"
                  @click="toggleExpanded(row.id)"
                >
                  <Icon :name="isExpanded(row.id) ? 'lucide:chevron-down' : 'lucide:chevron-right'" class="h-4 w-4" />
                </Button>
                <span class="truncate font-medium" data-testid="support-sending-domain-name">{{ row.domain }}</span>
                <span
                  class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium"
                  :class="statusMeta(row.status).classes"
                  data-testid="support-sending-domain-status"
                >
                  <Icon :name="statusMeta(row.status).icon" class="h-3.5 w-3.5" />
                  {{ statusMeta(row.status).label }}
                </span>
              </div>

              <div v-if="canManage" class="flex items-center gap-2">
                <Button
                  v-if="row.providerMismatch"
                  variant="outline"
                  size="sm"
                  :disabled="isBusy(row.id)"
                  data-testid="support-sending-domain-reregister"
                  @click="verify(row)"
                >
                  Register again
                </Button>
                <Button
                  v-else
                  variant="outline"
                  size="sm"
                  :disabled="isBusy(row.id) || isCoolingDown(row.id) || row.status === 'deleting'"
                  data-testid="support-sending-domain-verify"
                  @click="verify(row)"
                >
                  <Icon v-if="busy[row.id] === 'verify'" name="lucide:loader-2" class="mr-1 h-4 w-4 animate-spin" />
                  {{ row.status === 'failed' ? 'Retry' : 'Verify now' }}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="isBusy(row.id) || row.status === 'deleting'"
                  data-testid="support-sending-domain-delete"
                  @click="openDeleteDialog(row)"
                >
                  <Icon name="lucide:trash-2" class="mr-1 h-4 w-4" />
                  Delete
                </Button>
              </div>
            </div>

            <p class="mt-2 text-xs text-muted-foreground">
              <template v-if="row.lastCheckedAt">Last checked {{ formatAgo(row.lastCheckedAt) }}</template>
              <template v-else>Not checked yet</template>
              <template v-if="row.nextCheckAt && isActiveStatus(row.status)">
                · next check {{ formatIn(row.nextCheckAt) }}</template
              >
              <template v-if="row.status === 'pending' && row.expiresAt">
                · Expires {{ formatIn(row.expiresAt) }}</template
              >
            </p>

            <p
              v-if="row.lastErrorCode === 'owned_elsewhere' && row.lastError"
              class="mt-2 text-xs text-amber-700 dark:text-amber-400"
              data-testid="support-sending-domain-contested"
            >
              {{ row.lastError }} Publishing the DNS records will not change this. Use a subdomain, or ask the other
              service to release the domain.
            </p>
            <p
              v-else-if="row.status === 'suspended'"
              class="mt-2 text-xs text-amber-700 dark:text-amber-400"
              data-testid="support-sending-domain-reason"
            >
              DNS records no longer found. Replies from this domain are blocked until they are published again.
            </p>
            <p
              v-else-if="row.status === 'failed' && row.lastError"
              class="mt-2 text-xs text-destructive"
              data-testid="support-sending-domain-reason"
            >
              {{ row.lastError }}
            </p>
            <p v-if="row.providerMismatch" class="mt-2 text-xs text-amber-700 dark:text-amber-400">
              This domain was registered with a different mail provider configuration. Register it again to use it.
            </p>
            <p v-if="row.receivesViaProvider" class="mt-2 text-xs text-muted-foreground">
              Direct receiving is enabled for this domain.
            </p>

            <div v-if="isExpanded(row.id)" class="mt-3">
              <SupportDnsRecordTable :records="row.records" :zone="row.domain" :operator-managed="isOperatorManaged" />
            </div>
          </li>
        </ul>
      </template>
    </CardContent>

    <!-- Add domain -->
    <Dialog :open="isAddDialogOpen" @update:open="onAddDialogToggle">
      <DialogContent class="sm:max-w-[460px]" data-testid="support-sending-domain-add-dialog">
        <DialogHeader>
          <DialogTitle>Add sending domain</DialogTitle>
          <DialogDescription>
            Enter a domain you control, for example <code>acme.com</code> or <code>mail.acme.com</code>.
          </DialogDescription>
        </DialogHeader>
        <form class="space-y-2" @submit.prevent="addDomain">
          <Label for="sending-domain-input">Domain</Label>
          <Input
            id="sending-domain-input"
            v-model="newDomain"
            placeholder="acme.com"
            autocomplete="off"
            :disabled="isAdding"
            data-testid="support-sending-domain-input"
          />
          <p
            v-if="addError"
            class="text-sm text-destructive"
            role="alert"
            data-testid="support-sending-domain-add-error"
          >
            {{ addError }}
          </p>
        </form>
        <DialogFooter>
          <Button variant="outline" :disabled="isAdding" @click="onAddDialogToggle(false)">Cancel</Button>
          <Button :disabled="isAdding" data-testid="support-sending-domain-add-submit" @click="addDomain">
            <Icon v-if="isAdding" name="lucide:loader-2" class="mr-2 h-4 w-4 animate-spin" />
            Add domain
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Delete confirmation -->
    <Dialog :open="isDeleteDialogOpen" @update:open="onDeleteDialogToggle">
      <DialogContent class="sm:max-w-[460px]" data-testid="support-sending-domain-delete-dialog">
        <DialogHeader>
          <DialogTitle>Delete {{ deleteTarget?.domain }}</DialogTitle>
          <DialogDescription v-if="!deleteInUseInboxes">
            Replies can no longer be sent from this domain once it is removed.
          </DialogDescription>
          <DialogDescription v-else data-testid="support-sending-domain-in-use">
            This domain is used by {{ deleteInUseInboxes.length === 1 ? 'an inbox' : 'these inboxes' }}. If you delete
            it anyway, they will be blocked from sending until you choose another From address.
          </DialogDescription>
        </DialogHeader>
        <ul v-if="deleteInUseInboxes" class="space-y-1 text-sm">
          <li v-for="inbox in deleteInUseInboxes" :key="inbox.id" data-testid="support-sending-domain-in-use-inbox">
            <strong>{{ inbox.name }}</strong>
            <span v-if="inbox.emailAddress" class="text-muted-foreground"> · {{ inbox.emailAddress }}</span>
          </li>
        </ul>
        <p v-if="deleteError" class="text-sm text-destructive" role="alert">{{ deleteError }}</p>
        <DialogFooter>
          <Button variant="outline" :disabled="isDeleting" @click="onDeleteDialogToggle(false)">Cancel</Button>
          <Button
            variant="destructive"
            :disabled="isDeleting"
            data-testid="support-sending-domain-delete-confirm"
            @click="confirmDelete"
          >
            <Icon v-if="isDeleting" name="lucide:loader-2" class="mr-2 h-4 w-4 animate-spin" />
            {{ deleteInUseInboxes ? 'Delete anyway' : 'Delete domain' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </Card>
</template>

<script>
import { toast } from 'vue-sonner'
import { normalizeSendingDomain, validateSendingDomain } from '~/lib/support-sending-domains'

const POLL_INTERVAL_MS = 30_000
const VERIFY_COOLDOWN_MS = 20_000
const ACTIVE_STATUSES = ['provisioning', 'pending', 'deleting']

const STATUS_META = {
  provisioning: { label: 'Provisioning', icon: 'lucide:loader-2', classes: 'bg-muted text-muted-foreground' },
  pending: {
    label: 'Waiting for DNS',
    icon: 'lucide:clock',
    classes: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  verified: {
    label: 'Verified',
    icon: 'lucide:check-circle-2',
    classes: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
  suspended: {
    label: 'Suspended',
    icon: 'lucide:alert-triangle',
    classes: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  failed: { label: 'Failed', icon: 'lucide:x-circle', classes: 'bg-destructive/10 text-destructive' },
  deleting: { label: 'Removing', icon: 'lucide:loader-2', classes: 'bg-muted text-muted-foreground' },
}

const PROVIDER_LABELS = { mailgun: 'Mailgun / Frogmail', postmark: 'Postmark', fake: 'Fake (development)' }

export default {
  name: 'SupportSendingDomains',

  props: {
    teamId: {
      type: String,
      required: true,
    },
  },

  emits: ['loaded'],

  data() {
    return {
      /** @type {import('~/lib/support-sending-domains').SendingDomainListResponse | null} */
      data: null,
      isLoading: true,
      error: null,
      expanded: {},
      busy: {},
      cooldowns: {},
      requestToken: 0,
      pollTimer: null,

      isAddDialogOpen: false,
      newDomain: '',
      addError: '',
      isAdding: false,

      isDeleteDialogOpen: false,
      deleteTarget: null,
      deleteInUseInboxes: null,
      deleteError: '',
      isDeleting: false,
    }
  },

  computed: {
    isVisible() {
      // Hidden entirely once we know the feature is off; shown while loading or on error.
      return !(this.data && this.data.enabled === false)
    },

    canManage() {
      return this.data?.canManage === true
    },

    providerLabel() {
      const provider = this.data?.provider
      return provider ? PROVIDER_LABELS[provider] || provider : ''
    },

    isOperatorManaged() {
      return this.data?.capabilities ? this.data.capabilities.register === false : false
    },

    hasActiveRows() {
      return (this.data?.domains || []).some((row) => ACTIVE_STATUSES.includes(row.status))
    },
  },

  watch: {
    teamId() {
      this.expanded = {}
      this.load()
    },
  },

  mounted() {
    this.load()
    this.pollTimer = setInterval(() => this.pollTick(), POLL_INTERVAL_MS)
  },

  beforeUnmount() {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
    this.requestToken += 1
  },

  methods: {
    basePath() {
      return `/api/support/teams/${encodeURIComponent(this.teamId)}/sending-domains`
    },

    errorInfo(err) {
      // $fetch error bodies are the H3 error, whose `data` is our createErrorResponse() envelope.
      const payload = err?.data?.data?.error || {}
      return {
        status: err?.statusCode || 0,
        code: payload.code || '',
        message: payload.message || '',
        details: payload.details || null,
      }
    },

    async load({ silent = false } = {}) {
      if (!this.teamId) return
      const token = ++this.requestToken
      const teamId = this.teamId
      if (!silent) {
        this.isLoading = true
        this.error = null
      }
      try {
        const response = await $fetch(this.basePath())
        if (token !== this.requestToken || teamId !== this.teamId) return
        this.data = response?.data || null
        this.error = null
        this.$emit('loaded', this.data)
      } catch (err) {
        if (token !== this.requestToken) return
        if (!silent) {
          this.error = this.errorInfo(err).message || 'Failed to load sending domains'
          this.$emit('loaded', null)
        }
      } finally {
        if (token === this.requestToken) this.isLoading = false
      }
    },

    pollTick() {
      if (!import.meta.client || !this.hasActiveRows) return
      if (document.visibilityState !== 'visible') return
      if (this.isLoading || Object.keys(this.busy).length > 0) return
      this.load({ silent: true })
    },

    // --- presentation helpers -------------------------------------------------

    statusMeta(status) {
      return STATUS_META[status] || STATUS_META.pending
    },

    isActiveStatus(status) {
      return ACTIVE_STATUSES.includes(status)
    },

    isExpanded(id) {
      return this.expanded[id] === true
    },

    toggleExpanded(id) {
      this.expanded = { ...this.expanded, [id]: !this.expanded[id] }
    },

    isBusy(id) {
      return Boolean(this.busy[id])
    },

    isCoolingDown(id) {
      return Boolean(this.cooldowns[id])
    },

    formatDuration(ms) {
      const minutes = Math.max(1, Math.round(ms / 60_000))
      if (minutes < 60) return `${minutes} min`
      const hours = Math.round(minutes / 60)
      if (hours < 48) return `${hours} h`
      return `${Math.round(hours / 24)} days`
    },

    formatAgo(iso) {
      const diff = Date.now() - new Date(iso).getTime()
      if (!Number.isFinite(diff)) return ''
      if (diff < 60_000) return 'just now'
      return `${this.formatDuration(diff)} ago`
    },

    formatIn(iso) {
      const diff = new Date(iso).getTime() - Date.now()
      if (!Number.isFinite(diff)) return ''
      if (diff <= 60_000) return 'in under a minute'
      return `in ~${this.formatDuration(diff)}`
    },

    // --- add -------------------------------------------------------------------

    openAddDialog() {
      this.newDomain = ''
      this.addError = ''
      this.isAddDialogOpen = true
    },

    onAddDialogToggle(open) {
      if (!open && this.isAdding) return
      this.isAddDialogOpen = open
    },

    /**
     * Client-side check with the shared rules. The reserved list is server-only, so it is
     * empty here and the server stays authoritative. `.test` names are fake-provider only.
     */
    validateDomainInput(value) {
      return validateSendingDomain(value, { reserved: [], allowTestTld: !import.meta.env.PROD }) || ''
    },

    async addDomain() {
      if (this.isAdding) return
      const domain = normalizeSendingDomain(this.newDomain)
      const invalid = this.validateDomainInput(domain)
      if (invalid) {
        this.addError = invalid
        return
      }
      this.addError = ''
      this.isAdding = true
      try {
        const response = await $fetch(this.basePath(), { method: 'POST', body: { domain } })
        this.isAddDialogOpen = false
        toast.success(`Added ${domain}. Publish the DNS records to verify it.`)
        const created = response?.data
        if (created?.id) this.expanded = { ...this.expanded, [created.id]: true }
        await this.load({ silent: true })
      } catch (err) {
        const info = this.errorInfo(err)
        if (info.status === 429) {
          this.addError = info.message || 'Too many attempts. Try again in a little while.'
        } else {
          this.addError = info.message || 'Could not add this domain'
        }
      } finally {
        this.isAdding = false
      }
    },

    // --- verify ----------------------------------------------------------------

    async verify(row) {
      if (this.isBusy(row.id)) return
      this.busy = { ...this.busy, [row.id]: 'verify' }
      try {
        await $fetch(`${this.basePath()}/${encodeURIComponent(row.id)}/verify`, { method: 'POST' })
        this.startCooldown(row.id)
        await this.load({ silent: true })
      } catch (err) {
        const info = this.errorInfo(err)
        if (info.status === 429) this.startCooldown(row.id)
        toast.error(info.message || 'Could not verify this domain')
      } finally {
        this.busy = Object.fromEntries(Object.entries(this.busy).filter(([key]) => key !== row.id))
      }
    },

    startCooldown(id) {
      this.cooldowns = { ...this.cooldowns, [id]: true }
      setTimeout(() => {
        this.cooldowns = Object.fromEntries(Object.entries(this.cooldowns).filter(([key]) => key !== id))
      }, VERIFY_COOLDOWN_MS)
    },

    // --- delete ----------------------------------------------------------------

    openDeleteDialog(row) {
      this.deleteTarget = row
      this.deleteInUseInboxes = null
      this.deleteError = ''
      this.isDeleteDialogOpen = true
    },

    onDeleteDialogToggle(open) {
      if (!open && this.isDeleting) return
      this.isDeleteDialogOpen = open
    },

    async confirmDelete() {
      const row = this.deleteTarget
      if (!row || this.isDeleting) return
      const force = Array.isArray(this.deleteInUseInboxes)
      this.isDeleting = true
      this.deleteError = ''
      try {
        const response = await $fetch(`${this.basePath()}/${encodeURIComponent(row.id)}`, {
          method: 'DELETE',
          params: force ? { force: 'true' } : undefined,
        })
        this.isDeleteDialogOpen = false
        const result = response?.data || {}
        if (result.deleted === false) {
          toast.info(`Removal of ${row.domain} is in progress and will be retried automatically.`)
        } else if (result.operatorCleanupRequired) {
          toast.warning(
            'Veerify released this domain. Your operator must remove it from the mail provider because it receives mail there.'
          )
        } else {
          toast.success(`Deleted ${row.domain}`)
        }
        await this.load({ silent: true })
      } catch (err) {
        const info = this.errorInfo(err)
        if (info.status === 409 && info.code === 'DOMAIN_IN_USE') {
          this.deleteInUseInboxes = info.details?.inboxes ?? []
        } else {
          this.deleteError = info.message || 'Could not delete this domain'
        }
      } finally {
        this.isDeleting = false
      }
    },
  },
}
</script>
