<template>
  <Dialog :open="open" @update:open="onToggle">
    <DialogContent class="sm:max-w-[520px]" data-testid="mail-address-dialog">
      <DialogHeader>
        <DialogTitle>{{ isEdit ? 'Edit address' : 'New address' }}</DialogTitle>
        <DialogDescription>
          <template v-if="isEdit">
            Change where <span class="font-mono">{{ address.address }}</span> delivers and how it behaves.
          </template>
          <template v-else>Mail sent to this address lands in one of the project's inboxes.</template>
        </DialogDescription>
      </DialogHeader>

      <form class="space-y-4" @submit.prevent="submit">
        <!-- Address (create only) -->
        <div v-if="!isEdit" class="space-y-2">
          <Label for="mail-address-local">Address</Label>
          <div v-if="!isOtherDomain" class="flex items-center gap-2">
            <Input
              id="mail-address-local"
              v-model="localPart"
              :placeholder="isCatchAll ? '*' : 'hello'"
              autocomplete="off"
              spellcheck="false"
              class="min-w-0 flex-1 font-mono"
              :disabled="isSaving || isCatchAll"
              data-testid="mail-address-local"
            />
            <span class="text-muted-foreground">@</span>
            <select
              v-model="domainChoice"
              :class="cn(selectClasses, 'min-w-0 flex-1')"
              :disabled="isSaving"
              aria-label="Domain"
              data-testid="mail-address-domain"
            >
              <option v-for="domain in domains" :key="domain.id" :value="domain.id">
                {{ domainOptionLabel(domain) }}
              </option>
              <option :value="OTHER">Another domain…</option>
            </select>
          </div>
          <div v-else class="flex items-center gap-2">
            <Input
              id="mail-address-local"
              v-model="fullAddress"
              type="email"
              placeholder="hello@example.com"
              autocomplete="off"
              spellcheck="false"
              class="min-w-0 flex-1 font-mono"
              :disabled="isSaving"
              data-testid="mail-address-full"
            />
            <Button
              v-if="domains.length > 0"
              type="button"
              variant="ghost"
              size="sm"
              :disabled="isSaving"
              @click="domainChoice = domains[0].id"
            >
              Use a project domain
            </Button>
          </div>
          <p v-if="isOtherDomain" class="text-xs text-muted-foreground">
            Addresses on a domain that is not connected here only receive mail you forward in, for example from Google
            Workspace.
          </p>
          <label v-if="!isOtherDomain" class="flex items-center gap-2 pt-1 text-sm">
            <input
              v-model="isCatchAll"
              type="checkbox"
              class="h-4 w-4 rounded border-input"
              :disabled="isSaving || domains.length === 0"
              data-testid="mail-address-catch-all"
            />
            Catch-all
            <span class="text-xs text-muted-foreground">Takes mail to any address on the domain without its own.</span>
          </label>
        </div>

        <!-- Inbox -->
        <div class="space-y-2">
          <Label for="mail-address-inbox">Delivers to</Label>
          <select
            id="mail-address-inbox"
            v-model="inboxId"
            :class="selectClasses"
            :disabled="isSaving"
            data-testid="mail-address-inbox"
          >
            <option v-for="inbox in inboxes" :key="inbox.id" :value="inbox.id">{{ inbox.name }}</option>
          </select>
        </div>

        <!-- Behaviour -->
        <fieldset class="space-y-2" :disabled="isSaving">
          <legend class="text-sm font-medium leading-none">Behaviour</legend>
          <div class="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Behaviour">
            <label
              v-for="option in behaviourOptions"
              :key="option.value"
              class="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5"
              :data-testid="`mail-address-behaviour-${option.value}`"
            >
              <input
                v-model="behaviour"
                type="radio"
                name="mail-address-behaviour"
                :value="option.value"
                class="mt-1"
              />
              <span class="min-w-0">
                <span class="block text-sm font-medium">{{ option.label }}</span>
                <span class="mt-0.5 block text-xs text-muted-foreground">{{ option.description }}</span>
              </span>
            </label>
          </div>
        </fieldset>

        <!-- Product -->
        <div v-if="products.length > 1" class="space-y-2">
          <Label for="mail-address-product">Product</Label>
          <select
            id="mail-address-product"
            v-model="productId"
            :class="selectClasses"
            :disabled="isSaving"
            data-testid="mail-address-product"
          >
            <option value="">None</option>
            <option v-for="product in products" :key="product.id" :value="product.id">{{ product.name }}</option>
          </select>
        </div>

        <div class="flex items-center gap-2">
          <Switch id="mail-address-primary" v-model="isPrimary" :disabled="isSaving" />
          <Label for="mail-address-primary">Primary address of the inbox</Label>
        </div>
        <p class="text-xs text-muted-foreground">
          Replies go out from the address a conversation arrived on, once its domain is verified.
        </p>

        <!-- Delivery and forwarding (only when the provider can forward) -->
        <fieldset v-if="forwarding" class="space-y-3" :disabled="isSaving" data-testid="mail-address-delivery">
          <legend class="text-sm font-medium leading-none">Delivery</legend>
          <div class="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Delivery">
            <label
              v-for="option in deliveryOptions"
              :key="option.value"
              class="flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5"
              :data-testid="`mail-address-delivery-${option.value}`"
            >
              <input
                v-model="deliveryMode"
                type="radio"
                name="mail-address-delivery"
                :value="option.value"
                class="mt-1"
              />
              <span class="min-w-0 text-sm font-medium">{{ option.label }}</span>
            </label>
          </div>

          <div v-if="forwardsEnabled" class="space-y-2" data-testid="mail-address-forwards">
            <Label>Forward to</Label>
            <ul v-if="keptForwards.length > 0" class="space-y-2">
              <li
                v-for="forward in keptForwards"
                :key="forward.id"
                class="rounded-lg border p-2.5"
                data-testid="mail-address-forward-existing"
                :data-status="forward.status"
              >
                <div class="flex items-center gap-2">
                  <span class="min-w-0 flex-1 break-all font-mono text-[13px]">{{ forward.email }}</span>
                  <span
                    class="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium"
                    :class="forwardMeta(forward).classes"
                    data-testid="mail-address-forward-status"
                  >
                    <Icon :name="forwardMeta(forward).icon" class="h-3 w-3" />
                    {{ forwardMeta(forward).label }}
                  </span>
                  <Button
                    v-if="forward.status !== 'verified' && forward.status !== 'revoked'"
                    type="button"
                    variant="ghost"
                    size="sm"
                    class="h-7 shrink-0 px-2 text-xs"
                    :disabled="resending[forward.id] || isResendWaiting(forward.id)"
                    data-testid="mail-address-forward-resend"
                    @click="resend(forward)"
                  >
                    <Icon v-if="resending[forward.id]" name="lucide:loader-2" class="mr-1 h-3 w-3 animate-spin" />
                    Resend
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7 shrink-0"
                    :aria-label="`Stop forwarding to ${forward.email}`"
                    data-testid="mail-address-forward-remove-existing"
                    @click="removeExisting(forward.id)"
                  >
                    <Icon name="lucide:x" class="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p v-if="forwardNote(forward)" class="mt-1 text-xs text-muted-foreground">
                  {{ forwardNote(forward) }}
                </p>
                <p
                  v-if="resendNotes[forward.id]"
                  class="mt-1 text-xs text-muted-foreground"
                  data-testid="mail-address-forward-resend-note"
                >
                  {{ resendNotes[forward.id] }}
                </p>
              </li>
            </ul>

            <div v-for="(row, index) in newForwards" :key="row.key" class="flex items-center gap-2">
              <Input
                v-model="row.email"
                type="email"
                placeholder="you@example.com"
                autocomplete="off"
                spellcheck="false"
                class="min-w-0 flex-1 font-mono"
                :aria-label="`Forward address ${index + 1}`"
                :aria-invalid="forwardRowError(row) ? 'true' : undefined"
                data-testid="mail-address-forward-input"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                class="h-9 w-9 shrink-0"
                aria-label="Remove forward address"
                data-testid="mail-address-forward-remove"
                @click="removeNew(index)"
              >
                <Icon name="lucide:x" class="h-4 w-4" />
              </Button>
            </div>
            <p v-if="forwardError" class="text-xs text-destructive" data-testid="mail-address-forward-error">
              {{ forwardError }}
            </p>
            <Button
              v-if="totalForwards < MAX_FORWARDS"
              type="button"
              variant="outline"
              size="sm"
              data-testid="mail-address-forward-add"
              @click="addNew"
            >
              <Icon name="lucide:plus" class="mr-1 h-3.5 w-3.5" />
              Add address
            </Button>
            <p v-else class="text-xs text-muted-foreground">
              An address can forward to at most {{ MAX_FORWARDS }} addresses.
            </p>
            <p class="text-xs text-muted-foreground">
              Each recipient gets one confirmation email and must confirm once per domain before mail is forwarded. Spam
              and viruses are never forwarded.
            </p>
          </div>
        </fieldset>

        <p v-if="errorMessage" class="text-sm text-destructive" role="alert" data-testid="mail-address-error">
          {{ errorMessage }}
        </p>
      </form>

      <DialogFooter>
        <Button variant="outline" :disabled="isSaving" @click="onToggle(false)">Cancel</Button>
        <Button :disabled="isSaving || !canSubmit" data-testid="mail-address-submit" @click="submit">
          <Icon v-if="isSaving" name="lucide:loader-2" class="mr-2 h-4 w-4 animate-spin" />
          {{ isEdit ? 'Save changes' : 'Create address' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script>
import { toast } from 'vue-sonner'
import { cn } from '~/lib/utils'
import { CATCH_ALL_LOCAL_PART, DEFAULT_MAIL_ADDRESS_BEHAVIOUR } from '~/lib/mail-address'

const OTHER = '__other__'
const MAX_FORWARDS = 5
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
let rowCounter = 0

const FORWARD_META = {
  pending: {
    label: 'Waiting for confirmation',
    icon: 'lucide:clock',
    classes: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  verified: {
    label: 'Confirmed',
    icon: 'lucide:check-circle-2',
    classes: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
  suspended: { label: 'Bounced', icon: 'lucide:alert-triangle', classes: 'bg-destructive/10 text-destructive' },
  revoked: { label: 'Stopped', icon: 'lucide:ban', classes: 'bg-muted text-muted-foreground' },
}

const REVOKE_REASONS = {
  unsubscribed: 'The recipient unsubscribed.',
  complained: 'The recipient marked a forwarded message as spam.',
  expired: 'The confirmation link expired.',
  domain_disabled: 'Receiving is switched off for this domain.',
}

const STATUS_LABELS = {
  provisioning: 'provisioning',
  pending: 'waiting for DNS',
  verified: 'verified',
  suspended: 'suspended',
  failed: 'failed',
  deleting: 'removing',
}

/** Error code (from the address API) to the message shown inline. */
const ERROR_MESSAGES = {
  MAIL_ADDRESS_LIMIT_REACHED:
    'Your workspace has reached its address limit. Remove an address you no longer use to create a new one.',
  CATCH_ALL_DOMAIN_REQUIRED: 'A catch-all needs one of this project’s connected domains. Pick a domain from the list.',
  ADDRESS_DOMAIN_CLAIMED: 'This domain is connected to another project, so addresses on it cannot be created here.',
  ADDRESS_DOMAIN_RESERVED: 'This domain is reserved by Veerify. Use your own domain.',
  ADDRESS_DOMAIN_UNVERIFIED: 'This domain is not verified yet. Publish its DNS records and verify it first.',
}

export default {
  name: 'MailAddressDialog',

  props: {
    open: { type: Boolean, default: false },
    /** The address being edited; null creates a new one. */
    address: { type: Object, default: null },
    /** Project mail domains (sending-domain list rows). */
    domains: { type: Array, default: () => [] },
    inboxes: { type: Array, default: () => [] },
    products: { type: Array, default: () => [] },
    /** Provider capability: false hides everything about forwarding. */
    forwarding: { type: Boolean, default: false },
    /** Needed for the resend call. */
    projectSlug: { type: String, default: '' },
  },

  emits: ['update:open', 'saved', 'saved-forwards'],

  data() {
    return {
      OTHER,
      localPart: '',
      domainChoice: '',
      fullAddress: '',
      isCatchAll: false,
      inboxId: '',
      behaviour: DEFAULT_MAIL_ADDRESS_BEHAVIOUR,
      productId: '',
      isPrimary: false,
      isSaving: false,
      errorMessage: '',
      MAX_FORWARDS,
      deliveryMode: 'inbox',
      /** Ids of existing forwards the user removed in this session. */
      removedForwardIds: [],
      newForwards: [],
      resending: {},
      resendNotes: {},
      /** Destination id to the time (ms) its resend wait ends. */
      resendUntil: {},
      showForwardErrors: false,
      now: Date.now(),
      nowTimer: null,
      deliveryOptions: [
        { value: 'inbox', label: 'Inbox' },
        { value: 'forward', label: 'Forward' },
        { value: 'both', label: 'Inbox + forward' },
      ],
      selectClasses:
        'flex h-10 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none transition-all duration-200 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
      behaviourOptions: [
        { value: 'mail', label: 'Mail', description: 'No auto-reply, SLA or satisfaction survey. Just mail.' },
        {
          value: 'helpdesk',
          label: 'Helpdesk',
          description: 'Uses the inbox’s auto-replies, SLAs, CSAT and rules.',
        },
      ],
    }
  },

  computed: {
    isEdit() {
      return Boolean(this.address)
    },
    isOtherDomain() {
      return this.domainChoice === OTHER
    },
    selectedDomain() {
      return this.domains.find((domain) => domain.id === this.domainChoice) || null
    },
    /** The full address this dialog would create. */
    composedAddress() {
      if (this.isOtherDomain) return this.fullAddress.trim().toLowerCase()
      const domain = this.selectedDomain?.domain
      const local = (this.isCatchAll ? CATCH_ALL_LOCAL_PART : this.localPart).trim().toLowerCase()
      return domain && local ? `${local}@${domain}` : ''
    },
    forwardsEnabled() {
      return this.forwarding && this.deliveryMode !== 'inbox'
    },
    keptForwards() {
      const forwards = this.address?.forwards || []
      return forwards.filter((forward) => !this.removedForwardIds.includes(forward.id))
    },
    totalForwards() {
      return this.keptForwards.length + this.newForwards.length
    },
    /** Emails the address would forward to after saving. */
    forwardTargets() {
      const emails = this.keptForwards.map((forward) => forward.email.toLowerCase())
      for (const row of this.newForwards) {
        const email = row.email.trim().toLowerCase()
        if (email) emails.push(email)
      }
      return emails
    },
    forwardError() {
      if (!this.forwardsEnabled) return ''
      for (const row of this.newForwards) {
        const message = this.forwardRowError(row)
        if (message) return message
      }
      if (this.forwardTargets.length === 0 && this.showForwardErrors) return 'Add at least one address to forward to.'
      return ''
    },
    canSubmit() {
      if (!this.inboxId) return false
      if (this.forwardsEnabled && (this.forwardTargets.length === 0 || this.forwardError)) return false
      return this.isEdit || Boolean(this.composedAddress)
    },
  },

  watch: {
    open(value) {
      if (value) this.reset()
    },
    isCatchAll(value) {
      if (value) this.localPart = CATCH_ALL_LOCAL_PART
      else if (this.localPart === CATCH_ALL_LOCAL_PART) this.localPart = ''
    },
  },

  mounted() {
    if (this.open) this.reset()
    this.nowTimer = setInterval(() => {
      this.now = Date.now()
    }, 1000)
  },

  beforeUnmount() {
    if (this.nowTimer) clearInterval(this.nowTimer)
  },

  methods: {
    cn,

    reset() {
      this.errorMessage = ''
      this.isSaving = false
      this.removedForwardIds = []
      this.newForwards = []
      this.resendNotes = {}
      this.resendUntil = {}
      this.showForwardErrors = false
      const address = this.address
      this.deliveryMode = this.modeOf(address)
      if (address) {
        this.inboxId = address.inboxId
        this.behaviour = address.behaviour
        this.productId = address.productId || ''
        this.isPrimary = address.isPrimary
        return
      }
      this.localPart = ''
      this.fullAddress = ''
      this.isCatchAll = false
      this.domainChoice = this.domains[0]?.id || OTHER
      this.inboxId = this.inboxes[0]?.id || ''
      this.behaviour = DEFAULT_MAIL_ADDRESS_BEHAVIOUR
      this.productId = ''
      this.isPrimary = false
    },

    modeOf(address) {
      const hasForwards = (address?.forwards?.length || 0) > 0
      if (address?.deliverToInbox === false) return 'forward'
      return hasForwards ? 'both' : 'inbox'
    },

    addNew() {
      this.newForwards.push({ key: ++rowCounter, email: '' })
    },

    removeNew(index) {
      this.newForwards.splice(index, 1)
    },

    removeExisting(id) {
      this.removedForwardIds.push(id)
    },

    forwardRowError(row) {
      const email = row.email.trim().toLowerCase()
      if (!email) return this.showForwardErrors ? 'Enter an email address or remove the empty row.' : ''
      if (!EMAIL_PATTERN.test(email)) return `${row.email.trim()} is not a valid email address.`
      const duplicates = this.forwardTargets.filter((target) => target === email).length
      if (duplicates > 1) return `${email} is listed more than once.`
      return ''
    },

    forwardMeta(forward) {
      return FORWARD_META[forward.status] || FORWARD_META.pending
    },

    forwardNote(forward) {
      if (forward.status === 'pending' && !forward.verificationSentAt) return 'Confirmation email not sent yet.'
      if (forward.status === 'revoked') return REVOKE_REASONS[forward.statusReason] || ''
      if (forward.status === 'suspended') return 'Mail to this address bounced, so forwarding is paused.'
      return ''
    },

    isResendWaiting(id) {
      return (this.resendUntil[id] || 0) > this.now
    },

    async resend(forward) {
      if (this.resending[forward.id]) return
      this.resending = { ...this.resending, [forward.id]: true }
      this.resendNotes = { ...this.resendNotes, [forward.id]: '' }
      try {
        await $fetch(
          `/api/projects/${encodeURIComponent(this.projectSlug)}/mail/destinations/${encodeURIComponent(forward.id)}/resend`,
          { method: 'POST' }
        )
        this.resendNotes = { ...this.resendNotes, [forward.id]: 'Confirmation email sent.' }
        toast.success(`Confirmation email sent to ${forward.email}`)
        this.$emit('saved-forwards')
      } catch (err) {
        const info = this.errorInfo(err)
        let note = info.message || 'Could not resend the confirmation email.'
        if (info.status === 429) {
          const header = err?.response?.headers?.get?.('retry-after') ?? err?.data?.data?.retryAfter
          const seconds = Number.parseInt(header, 10)
          if (Number.isFinite(seconds) && seconds > 0) {
            this.resendUntil = { ...this.resendUntil, [forward.id]: Date.now() + seconds * 1000 }
            note = `Too many requests. Try again in ${this.formatWait(seconds)}.`
          } else {
            note = 'Too many requests. Try again in a little while.'
          }
        } else if (info.status === 409) {
          note = 'This address has already confirmed. Reload to see its status.'
        }
        this.resendNotes = { ...this.resendNotes, [forward.id]: note }
      } finally {
        this.resending = { ...this.resending, [forward.id]: false }
      }
    },

    formatWait(seconds) {
      if (seconds < 60) return `${seconds} seconds`
      const minutes = Math.ceil(seconds / 60)
      if (minutes < 60) return minutes === 1 ? '1 minute' : `${minutes} minutes`
      const hours = Math.ceil(minutes / 60)
      return hours === 1 ? '1 hour' : `${hours} hours`
    },

    domainOptionLabel(domain) {
      if (domain.status === 'verified') return domain.domain
      return `${domain.domain} (${STATUS_LABELS[domain.status] || domain.status})`
    },

    onToggle(value) {
      if (!value && this.isSaving) return
      this.$emit('update:open', value)
    },

    errorInfo(err) {
      const payloads = [err?.data?.data?.error, err?.data?.error, err?.data?.data, err?.data]
      const payload = payloads.find((entry) => entry && typeof entry === 'object' && entry.code) || payloads[0] || {}
      return {
        status: err?.statusCode || err?.status || 0,
        code: typeof payload.code === 'string' ? payload.code : '',
        message: typeof payload.message === 'string' ? payload.message : '',
      }
    },

    messageFor(err, fallback) {
      const info = this.errorInfo(err)
      if (ERROR_MESSAGES[info.code]) return ERROR_MESSAGES[info.code]
      if (info.status === 409) return 'This address is already in use.'
      if (info.status === 429) return 'Too many attempts. Try again in a little while.'
      return info.message || fallback
    },

    async submit() {
      this.showForwardErrors = true
      if (this.isSaving || !this.canSubmit) return
      this.errorMessage = ''
      this.isSaving = true
      try {
        if (this.isEdit) {
          await this.save()
        } else {
          await this.create()
        }
        this.$emit('saved')
        this.$emit('update:open', false)
      } catch (err) {
        this.errorMessage = this.messageFor(
          err,
          this.isEdit ? 'Could not save this address' : 'Could not create this address'
        )
      } finally {
        this.isSaving = false
      }
    },

    async create() {
      const address = this.composedAddress
      const body = {
        address,
        isPrimary: this.isPrimary,
        behaviour: this.behaviour,
      }
      if (this.products.length > 1) body.productId = this.productId || null
      if (this.forwarding && this.deliveryMode !== 'inbox') {
        body.deliverToInbox = this.deliveryMode === 'both'
        body.forwardTo = this.forwardTargets
      }
      await $fetch(`/api/support/inboxes/${encodeURIComponent(this.inboxId)}/addresses`, { method: 'POST', body })
      toast.success(`Created ${address}`)
    },

    async save() {
      const address = this.address
      const body = {}
      if (this.behaviour !== address.behaviour) body.behaviour = this.behaviour
      if (this.products.length > 1 && (this.productId || null) !== address.productId) {
        body.productId = this.productId || null
      }
      if (this.isPrimary !== address.isPrimary) body.isPrimary = this.isPrimary
      if (this.inboxId !== address.inboxId) body.inboxId = this.inboxId
      if (this.forwarding) {
        const targets = this.deliveryMode === 'inbox' ? [] : this.forwardTargets
        const before = (address.forwards || []).map((forward) => forward.email.toLowerCase())
        const deliverToInbox = this.deliveryMode !== 'forward'
        if (deliverToInbox !== (address.deliverToInbox !== false)) body.deliverToInbox = deliverToInbox
        const changed = targets.length !== before.length || targets.some((email) => !before.includes(email))
        if (changed) body.forwardTo = targets
      }
      if (Object.keys(body).length === 0) return
      await $fetch(
        `/api/support/inboxes/${encodeURIComponent(address.inboxId)}/addresses/${encodeURIComponent(address.id)}`,
        { method: 'PATCH', body }
      )
      toast.success(`Saved ${address.address}`)
    },
  },
}
</script>
