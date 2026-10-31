<template>
  <Card v-if="isCardVisible" data-testid="support-sending-domains">
    <CardHeader>
      <div class="flex items-start justify-between gap-3">
        <div>
          <CardTitle class="flex items-center gap-2">
            <Icon name="lucide:globe" class="h-5 w-5" />
            Domains
          </CardTitle>
          <CardDescription>
            Connect your own domain to send email from it and to create addresses on it. Publish the DNS records below,
            then Veerify checks them automatically.
            <span v-if="usageLine" class="whitespace-nowrap" data-testid="support-sending-domains-usage">
              {{ usageLine }}
            </span>
            <span v-if="pendingUsageLine" class="whitespace-nowrap" data-testid="support-sending-domains-pending-usage">
              {{ pendingUsageLine }}
            </span>
          </CardDescription>
        </div>
        <Button
          v-if="canManage && data?.enabled"
          size="sm"
          class="shrink-0"
          :disabled="Boolean(addDisabledReason)"
          :aria-describedby="addDisabledReason ? 'support-sending-domain-add-reason' : undefined"
          data-testid="support-sending-domain-add"
          @click="openAddDialog"
        >
          <Icon name="lucide:plus" class="mr-1 h-4 w-4" aria-hidden="true" />
          Add domain
        </Button>
      </div>
      <p
        v-if="canManage && data?.enabled && addDisabledReason"
        id="support-sending-domain-add-reason"
        class="text-xs text-muted-foreground sm:text-right"
        data-testid="support-sending-domain-add-reason"
      >
        {{ addDisabledReason }}
      </p>
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
        <p v-if="!canManage" class="text-sm text-muted-foreground" data-testid="support-sending-domains-read-only">
          Only project admins can add or remove domains.
        </p>

        <div
          v-if="!data.providerConfigured"
          class="rounded-md bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
          role="status"
          data-testid="support-sending-domains-unconfigured"
        >
          Email isn't available right now. Contact support.
        </div>

        <p
          v-if="data.domains.length === 0"
          class="text-sm text-muted-foreground"
          data-testid="support-sending-domains-empty"
        >
          No domains yet.
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
                  <Icon
                    :name="isExpanded(row.id) ? 'lucide:chevron-down' : 'lucide:chevron-right'"
                    class="h-4 w-4"
                    aria-hidden="true"
                  />
                </Button>
                <span class="truncate font-medium" data-testid="support-sending-domain-name">{{ row.domain }}</span>
                <span
                  class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium"
                  :class="statusMeta(row.status).classes"
                  data-testid="support-sending-domain-status"
                >
                  <Icon :name="statusMeta(row.status).icon" class="h-3.5 w-3.5" aria-hidden="true" />
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
            <!-- Setup checklist: 1. ownership (TXT + DKIM) → 2. MX for receiving → 3. a test email. -->
            <ol
              v-if="row.status !== 'deleting'"
              class="mt-3 space-y-3 border-l pl-4"
              data-testid="support-domain-steps"
              :aria-label="`Setup steps for ${row.domain}`"
            >
              <li data-testid="support-domain-step-ownership" :data-state="setupFor(row).ownership" class="relative">
                <span
                  class="absolute -left-[1.4rem] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-background"
                  aria-hidden="true"
                >
                  <Icon
                    :name="stepIcon(setupFor(row).ownership === 'done')"
                    :class="stepIconClass(setupFor(row).ownership)"
                  />
                </span>
                <p class="text-sm font-medium">1. Verify ownership (TXT + DKIM records)</p>
                <p class="text-xs text-muted-foreground" data-testid="support-domain-step-ownership-status">
                  <span class="sr-only">Status: </span>{{ ownershipStepText(row) }}
                </p>
                <div v-if="isExpanded(row.id)" class="mt-2">
                  <SupportDnsRecordTable
                    :records="row.records"
                    :domain="row.domain"
                    :zone="row.registrableDomain ?? row.domain"
                    :operator-managed="isOperatorManaged"
                    :purposes="forwarding ? ['ownership', 'sending', 'recommended'] : []"
                  />
                </div>
              </li>

              <li
                v-if="forwarding"
                data-testid="support-domain-step-receiving"
                :data-state="setupFor(row).receiving"
                class="relative"
              >
                <span
                  class="absolute -left-[1.4rem] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-background"
                  aria-hidden="true"
                >
                  <Icon
                    :name="stepIcon(setupFor(row).receiving === 'active')"
                    :class="stepIconClass(setupFor(row).receiving)"
                  />
                </span>
                <p
                  class="text-sm font-medium"
                  :class="setupFor(row).receiving === 'locked' ? 'text-muted-foreground' : ''"
                >
                  2. Add the MX record to start receiving
                </p>
                <p
                  class="text-xs"
                  :class="
                    setupFor(row).receiving === 'active'
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-muted-foreground'
                  "
                  data-testid="support-domain-step-receiving-status"
                >
                  <span class="sr-only">Status: </span>{{ receivingStepText(row) }}
                </p>
                <template v-if="setupFor(row).receiving === 'waiting_mx'">
                  <div v-if="isExpanded(row.id)" class="mt-2">
                    <SupportDnsRecordTable
                      :records="row.records"
                      :domain="row.domain"
                      :zone="row.registrableDomain ?? row.domain"
                      :purposes="['receiving']"
                      :existing-mx-hosts="row.existingMxHosts || []"
                      :mx-acknowledged="isMxAcknowledged(row.id)"
                      @acknowledge-mx="(value) => setMxAcknowledged(row.id, value)"
                    />
                  </div>
                  <Button
                    v-else
                    variant="link"
                    size="sm"
                    class="h-auto p-0 text-xs"
                    data-testid="support-domain-show-mx"
                    @click="toggleExpanded(row.id)"
                  >
                    Show the MX record
                  </Button>
                </template>
              </li>

              <li
                v-if="forwarding && setupFor(row).receiving === 'active' && canManage"
                data-testid="support-domain-step-test"
                :data-state="testStateFor(row)"
                class="relative"
              >
                <span
                  class="absolute -left-[1.4rem] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-background"
                  aria-hidden="true"
                >
                  <Icon
                    :name="stepIcon(testStateFor(row) === 'done')"
                    :class="testStateFor(row) === 'done' ? 'h-4 w-4 text-emerald-600' : 'h-4 w-4 text-muted-foreground'"
                  />
                </span>
                <p class="text-sm font-medium">3. Send a test email</p>
                <p
                  v-if="testStateFor(row) === 'no_address'"
                  class="text-xs text-muted-foreground"
                  data-testid="support-domain-test-no-address"
                >
                  Create your first address on {{ row.domain }} below, then send it a test email.
                </p>
                <p
                  v-else-if="testStateFor(row) === 'done'"
                  class="text-xs text-emerald-700 dark:text-emerald-400"
                  role="status"
                  data-testid="support-domain-test-done"
                >
                  Receiving works ✓ Your test email arrived.
                </p>
                <div v-else class="space-y-2 text-xs text-muted-foreground">
                  <p>
                    From any mailbox (Gmail, Outlook, your phone), send a message to
                    <code class="break-all text-foreground" data-testid="support-domain-test-address">{{
                      testAddressFor(row)
                    }}</code>
                    <Button
                      variant="ghost"
                      size="sm"
                      class="ml-0.5 h-5 w-5 p-0 align-middle"
                      :aria-label="`Copy ${testAddressFor(row)}`"
                      @click="copyText(testAddressFor(row), 'Address')"
                    >
                      <Icon name="lucide:copy" class="h-3 w-3" aria-hidden="true" />
                    </Button>
                  </p>
                  <p v-if="testStateFor(row) === 'waiting'" role="status" data-testid="support-domain-test-waiting">
                    <Icon name="lucide:loader-2" class="mr-1 inline h-3 w-3 animate-spin" aria-hidden="true" />
                    Waiting for your message to arrive. This page checks every few seconds.
                  </p>
                  <p v-else-if="testStateFor(row) === 'timed_out'" data-testid="support-domain-test-timed-out">
                    Nothing arrived yet. Check that the MX record is published, then try again.
                  </p>
                  <Button
                    v-if="testStateFor(row) !== 'waiting'"
                    variant="outline"
                    size="sm"
                    data-testid="support-domain-test-start"
                    @click="startTestWatch(row)"
                  >
                    I sent it
                  </Button>
                </div>
              </li>
            </ol>
          </li>
        </ul>
      </template>
    </CardContent>

    <!-- Add domain -->
    <Dialog :open="isAddDialogOpen" @update:open="onAddDialogToggle">
      <DialogContent class="sm:max-w-[460px]" data-testid="support-sending-domain-add-dialog">
        <DialogHeader>
          <DialogTitle>Add domain</DialogTitle>
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
          <div
            v-if="forwarding"
            class="space-y-1 rounded-md bg-muted p-3 text-xs text-muted-foreground"
            data-testid="support-sending-domain-add-receiving-note"
          >
            <p>
              To receive mail, the domain gets an MX record pointing to Veerify. That moves
              <strong>all</strong> mail for the domain: if {{ newDomainLabel }} already has a mailbox (Google Workspace,
              Microsoft 365 and so on), it stops getting new mail.
            </p>
            <p>
              To keep your current mailbox, use a subdomain such as <code>mail.{{ newDomainLabel }}</code
              >: addresses then look like <code>hello@mail.{{ newDomainLabel }}</code
              >.
            </p>
          </div>
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

  <!-- Feature state not known yet (first GET failed): a quiet inline retry, not a full error card. -->
  <div
    v-else-if="showInlineError"
    class="flex items-center gap-2 text-sm text-muted-foreground"
    data-testid="support-sending-domains-error"
  >
    <span>Couldn't load sending domains.</span>
    <Button variant="link" size="sm" class="h-auto p-0" @click="load()">Retry</Button>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'
import { normalizeSendingDomain, validateSendingDomain } from '~/lib/support-sending-domains'
import { domainSetupState, isAtLimit, receivedSince, receivingActiveLine, testAddressForDomain } from '~/lib/mail-setup'

// Whether the deployment has the feature on is a deployment-wide fact, so remember the answer for the page
// session: a "disabled" answer must not flash a skeleton on every later load, and an "enabled" one keeps
// the card (with a skeleton) across project switches. null = not known yet.
let featureEnabledForSession = null

const POLL_INTERVAL_MS = 30_000
const VERIFY_COOLDOWN_MS = 20_000
const ACTIVE_STATUSES = ['provisioning', 'pending', 'deleting']
/** While waiting for a test email: ask the provider this often, and give up after this long. */
const TEST_CHECK_INTERVAL_MS = 15_000
const TEST_WATCH_MAX_MS = 10 * 60_000

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

export default {
  name: 'SupportSendingDomains',

  props: {
    projectId: {
      type: String,
      required: true,
    },
    /** The project's addresses (from the Email tab), for the "send a test email" step. */
    addresses: {
      type: Array,
      default: () => [],
    },
  },

  /**
   * `loaded` carries the list response (or null), the project it belongs to and
   * `{ poll: true }` when it came from the background refresh.
   */
  emits: ['loaded'],

  data() {
    return {
      /** @type {import('~/lib/support-sending-domains').SendingDomainListResponse | null} */
      data: null,
      isLoading: true,
      isUnmounted: false,
      error: null,
      featureEnabled: featureEnabledForSession,
      expanded: {},
      busy: {},
      cooldowns: {},
      requestToken: 0,
      pollTimer: null,
      testTimer: null,
      /** domain id -> true once the admin confirmed the MX takeover warning. */
      mxAcknowledged: {},
      /** domain id -> { baseline, startedAt, done, timedOut } while a test email is awaited. */
      testWatches: {},

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
    /** The card only renders once we know the feature is on; off or unknown renders nothing. */
    isCardVisible() {
      return this.featureEnabled === true
    },

    /** The first GET failed and we still do not know if the feature is on. */
    showInlineError() {
      return this.featureEnabled === null && Boolean(this.error)
    },

    canManage() {
      return this.data?.canManage === true
    },

    /** The deployment receives mail through Frogmail (SES), so domains have the MX step. */
    forwarding() {
      return this.data?.capabilities?.forwarding === true
    },

    pendingUsageLine() {
      const usage = this.data?.usage
      if (!usage || typeof usage.used?.pendingDomains !== 'number' || typeof usage.limits?.pendingDomains !== 'number')
        return ''
      return `${usage.used.pendingDomains} of ${usage.limits.pendingDomains} waiting for DNS at a time.`
    },

    /** Why "Add domain" is off, shown next to it; empty while a domain can be added. */
    addDisabledReason() {
      const usage = this.data?.usage
      if (!usage) return ''
      if (isAtLimit(usage.used?.domains, usage.limits?.domains)) {
        return `Your workspace uses all ${usage.limits.domains} domains of its plan. Remove a domain to add another.`
      }
      if (isAtLimit(usage.used?.pendingDomains, usage.limits?.pendingDomains)) {
        return `${usage.limits.pendingDomains} domains are already waiting for DNS. Finish or remove one to add another.`
      }
      return ''
    },

    newDomainLabel() {
      return normalizeSendingDomain(this.newDomain) || 'example.com'
    },

    isOperatorManaged() {
      return this.data?.capabilities ? this.data.capabilities.register === false : false
    },

    /** "N of M in this workspace"; falls back to the project-level counts when `usage` is missing. */
    usageLine() {
      const usage = this.data?.usage
      if (usage && typeof usage.used?.domains === 'number' && typeof usage.limits?.domains === 'number') {
        return `${usage.used.domains} of ${usage.limits.domains} in this workspace.`
      }
      const limit = this.data?.limits?.maxDomains
      if (this.data && typeof limit === 'number') return `${this.data.domains.length} of ${limit} in this workspace.`
      return ''
    },

    /** Keep refreshing while a domain is pending, waiting for receiving, or being removed. */
    hasActiveRows() {
      return (this.data?.domains || []).some(
        (row) => ACTIVE_STATUSES.includes(row.status) || this.setupFor(row).inProgress
      )
    },

    hasTestWatch() {
      return Object.values(this.testWatches).some((watch) => watch && !watch.done && !watch.timedOut)
    },
  },

  watch: {
    projectId() {
      this.expanded = {}
      this.busy = {}
      this.cooldowns = {}
      this.data = null
      this.isAddDialogOpen = false
      this.isDeleteDialogOpen = false
      this.mxAcknowledged = {}
      this.testWatches = {}
      this.load()
    },
  },

  mounted() {
    this.load()
    this.pollTimer = setInterval(() => this.pollTick(), POLL_INTERVAL_MS)
    this.testTimer = setInterval(() => this.testTick(), TEST_CHECK_INTERVAL_MS)
    if (import.meta.client) document.addEventListener('visibilitychange', this.onVisibilityChange)
  },

  beforeUnmount() {
    this.isUnmounted = true
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.testTimer) clearInterval(this.testTimer)
    this.pollTimer = null
    this.testTimer = null
    if (import.meta.client) document.removeEventListener('visibilitychange', this.onVisibilityChange)
    this.requestToken += 1
  },

  methods: {
    basePath() {
      return `/api/support/projects/${encodeURIComponent(this.projectId)}/sending-domains`
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
      if (!this.projectId || this.isUnmounted) return
      const token = ++this.requestToken
      const projectId = this.projectId
      if (!silent) {
        // Known-off deployments never show a loading state.
        if (this.featureEnabled !== false) this.isLoading = true
        this.error = null
      }
      try {
        const response = await $fetch(this.basePath())
        if (this.isStale(token, projectId)) return
        this.data = response?.data || null
        if (this.data) {
          featureEnabledForSession = this.data.enabled === true
          this.featureEnabled = featureEnabledForSession
        }
        this.error = null
        this.$emit('loaded', this.data, projectId, { poll: silent })
      } catch (err) {
        if (this.isStale(token, projectId)) return
        if (!silent) {
          if (this.featureEnabled !== false)
            this.error = this.errorInfo(err).message || 'Failed to load sending domains'
          this.$emit('loaded', null, projectId)
        }
      } finally {
        if (!this.isUnmounted && token === this.requestToken) this.isLoading = false
      }
    },

    isStale(token, projectId) {
      return this.isUnmounted || token !== this.requestToken || projectId !== this.projectId
    },

    pollTick() {
      if (!import.meta.client || !this.hasActiveRows) return
      if (document.visibilityState !== 'visible') return
      if (this.isLoading || Object.keys(this.busy).length > 0) return
      this.load({ silent: true })
    },

    /** Coming back to a hidden tab refreshes at once instead of waiting for the next tick. */
    onVisibilityChange() {
      if (document.visibilityState === 'visible') this.pollTick()
    },

    // --- setup checklist -------------------------------------------------------

    setupFor(row) {
      return domainSetupState(row, { forwarding: this.forwarding })
    },

    stepIcon(done) {
      return done ? 'lucide:check-circle-2' : 'lucide:circle'
    },

    stepIconClass(state) {
      if (state === 'done' || state === 'active') return 'h-4 w-4 text-emerald-600 dark:text-emerald-400'
      if (state === 'problem' || state === 'off') return 'h-4 w-4 text-amber-600 dark:text-amber-400'
      return 'h-4 w-4 text-muted-foreground'
    },

    ownershipStepText(row) {
      const state = this.setupFor(row).ownership
      if (state === 'done') return 'Verified.'
      if (state === 'problem') {
        return row.status === 'suspended'
          ? 'The records are no longer found. Publish them again.'
          : "Couldn't register the domain yet. Use Retry."
      }
      const records = this.isExpanded(row.id)
        ? 'Publish the records below at your DNS host.'
        : 'Publish its DNS records.'
      return this.forwarding
        ? `${records} After verification (usually a few minutes) one more record — the MX — appears here.`
        : `${records} Veerify checks them automatically.`
    },

    receivingStepText(row) {
      switch (this.setupFor(row).receiving) {
        case 'locked':
          return 'Available once step 1 is done.'
        case 'preparing':
          return 'Setting up receiving. This usually takes a few minutes.'
        case 'waiting_mx':
          return 'Add this MX record at your DNS host. Mail starts arriving once it is found.'
        case 'active':
          return receivingActiveLine(row.lastReceivedAt)
        case 'off':
          return 'Receiving is switched off for this domain.'
        default:
          return ''
      }
    },

    isMxAcknowledged(id) {
      return this.mxAcknowledged[id] === true
    },

    setMxAcknowledged(id, value) {
      this.mxAcknowledged = { ...this.mxAcknowledged, [id]: value === true }
    },

    testAddressFor(row) {
      return testAddressForDomain(this.addresses || [], row.domain)
    },

    /** no_address | ready | waiting | done | timed_out */
    testStateFor(row) {
      if (!this.testAddressFor(row)) return 'no_address'
      const watch = this.testWatches[row.id]
      if (!watch) return 'ready'
      if (watch.done) return 'done'
      if (watch.timedOut) return 'timed_out'
      return 'waiting'
    },

    startTestWatch(row) {
      this.testWatches = {
        ...this.testWatches,
        [row.id]: { baseline: row.lastReceivedAt || null, startedAt: Date.now(), done: false, timedOut: false },
      }
      this.checkReceiving(row.id)
    },

    testTick() {
      if (!import.meta.client || !this.hasTestWatch) return
      if (document.visibilityState !== 'visible') return
      for (const [id, watch] of Object.entries(this.testWatches)) {
        if (!watch || watch.done || watch.timedOut) continue
        if (Date.now() - watch.startedAt > TEST_WATCH_MAX_MS) {
          this.testWatches = { ...this.testWatches, [id]: { ...watch, timedOut: true } }
          continue
        }
        this.checkReceiving(id)
      }
    },

    /** Ask the provider for the domain's receiving state; the list row is replaced with the answer. */
    async checkReceiving(id) {
      const projectId = this.projectId
      try {
        const response = await $fetch(`${this.basePath()}/${encodeURIComponent(id)}/receiving-check`, {
          method: 'POST',
        })
        if (this.isUnmounted || projectId !== this.projectId || !this.data) return
        const updated = response?.data
        if (!updated?.id) return
        this.data = {
          ...this.data,
          domains: this.data.domains.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)),
        }
        const watch = this.testWatches[id]
        if (watch && !watch.done && receivedSince(watch.baseline, updated.lastReceivedAt)) {
          this.testWatches = { ...this.testWatches, [id]: { ...watch, done: true } }
          toast.success(`Receiving works on ${updated.domain}`)
        }
      } catch {
        // Rate limited or a provider blip: the next tick tries again.
      }
    },

    async copyText(value, what) {
      if (!import.meta.client || !value) return
      try {
        await navigator.clipboard.writeText(value)
        toast.success(`${what} copied`)
      } catch {
        toast.error('Could not copy to the clipboard')
      }
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
     * empty here and the server stays authoritative. `.test` names are fake-provider only,
     * matching the server's rule.
     */
    validateDomainInput(value) {
      const allowTestTld = this.data?.provider === 'fake'
      return validateSendingDomain(value, { reserved: [], allowTestTld }) || ''
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
        toast.success(`Added ${domain}. Publish the DNS records to verify it.`)
        if (this.isUnmounted) return
        this.isAddDialogOpen = false
        const created = response?.data
        if (created?.id) this.expanded = { ...this.expanded, [created.id]: true }
        await this.load({ silent: true })
      } catch (err) {
        if (this.isUnmounted) return
        const info = this.errorInfo(err)
        if (info.status === 429) {
          this.addError = info.message || 'Too many attempts. Try again in a little while.'
        } else {
          this.addError = info.message || 'Could not add this domain'
        }
      } finally {
        if (!this.isUnmounted) this.isAdding = false
      }
    },

    // --- verify ----------------------------------------------------------------

    async verify(row) {
      if (this.isBusy(row.id)) return
      this.busy = { ...this.busy, [row.id]: 'verify' }
      try {
        await $fetch(`${this.basePath()}/${encodeURIComponent(row.id)}/verify`, { method: 'POST' })
        if (this.isUnmounted) return
        this.startCooldown(row.id)
        await this.load({ silent: true })
      } catch (err) {
        if (this.isUnmounted) return
        const info = this.errorInfo(err)
        if (info.status === 429) this.startCooldown(row.id)
        toast.error(info.message || 'Could not verify this domain')
      } finally {
        if (!this.isUnmounted)
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
        const result = response?.data || {}
        // A 202 with deleted:false means the provider removal is still being retried in the background.
        if (result.deleted === false) {
          toast.info('Removal in progress', {
            description: `${row.domain} is being removed and will be retried automatically until it is gone.`,
          })
        } else if (result.operatorCleanupRequired) {
          toast.warning(
            'Veerify released this domain. Your operator must remove it from the mail provider because it receives mail there.'
          )
        } else {
          toast.success(`Deleted ${row.domain}`)
        }
        if (this.isUnmounted) return
        this.isDeleteDialogOpen = false
        await this.load({ silent: true })
      } catch (err) {
        if (this.isUnmounted) return
        const info = this.errorInfo(err)
        if (info.status === 409 && info.code === 'DOMAIN_IN_USE') {
          this.deleteInUseInboxes = info.details?.inboxes ?? []
        } else {
          this.deleteError = info.message || 'Could not delete this domain'
        }
      } finally {
        if (!this.isUnmounted) this.isDeleting = false
      }
    },
  },
}
</script>
