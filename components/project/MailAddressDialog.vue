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
          <Label for="mail-address-primary">Primary sending address</Label>
        </div>

        <p class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon name="lucide:forward" class="h-3.5 w-3.5" />
          Forwarding to other addresses is coming.
        </p>

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
  },

  emits: ['update:open', 'saved'],

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
    canSubmit() {
      if (!this.inboxId) return false
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
  },

  methods: {
    cn,

    reset() {
      this.errorMessage = ''
      this.isSaving = false
      const address = this.address
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
