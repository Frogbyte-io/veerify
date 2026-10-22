<template>
  <div data-testid="support-from-picker" :data-policy="effectivePolicy">
    <Skeleton v-if="loading" class="mt-2 h-10 w-full" />

    <!-- legacy policy: today's free-text input -->
    <Input
      v-else-if="effectivePolicy === 'legacy'"
      :id="inputId"
      :model-value="modelValue"
      type="email"
      placeholder="support@yourdomain.com"
      class="mt-2"
      :disabled="disabled"
      :readonly="readonly"
      data-testid="support-from-picker-input"
      @update:model-value="$emit('update:modelValue', $event)"
    />

    <!-- team policy: local part @ owned domain -->
    <div v-else class="mt-2 space-y-2">
      <div class="flex items-center gap-2">
        <Input
          v-if="!isPlatformSelected"
          :id="inputId"
          v-model="localPart"
          placeholder="support"
          autocomplete="off"
          class="min-w-0 flex-1"
          :disabled="disabled"
          :readonly="readonly"
          data-testid="support-from-picker-local"
          @update:model-value="emitValue"
        />
        <span v-if="!isPlatformSelected" class="text-muted-foreground">@</span>
        <Input
          v-if="!isPlatformSelected && subdomainEnabled && selectedVerifiedParent"
          v-model="subPrefix"
          placeholder="mail"
          autocomplete="off"
          class="w-28"
          :disabled="disabled"
          :readonly="readonly"
          aria-label="Subdomain"
          data-testid="support-from-picker-subdomain"
          @update:model-value="emitValue"
        />
        <span v-if="!isPlatformSelected && subdomainEnabled && selectedVerifiedParent" class="text-muted-foreground"
          >.</span
        >
        <select
          :id="isPlatformSelected ? inputId : undefined"
          :value="selectedKey"
          :class="selectClasses"
          :disabled="disabled || readonly"
          aria-label="Sending domain"
          data-testid="support-from-picker-select"
          @change="onSelect($event.target.value)"
        >
          <option value="" disabled>Select a domain</option>
          <optgroup v-if="platformAddresses.length" label="Veerify address">
            <option v-for="address in platformAddresses" :key="address" :value="`platform:${address}`">
              {{ address }}
            </option>
          </optgroup>
          <optgroup v-if="verifiedDomains.length" label="Verified domains">
            <option v-for="row in verifiedDomains" :key="row.id" :value="`domain:${row.domain}`">
              {{ row.domain }}
            </option>
          </optgroup>
          <optgroup v-if="pendingDomains.length" label="Not yet verified">
            <option v-for="row in pendingDomains" :key="row.id" :value="`domain:${row.domain}`">
              {{ row.domain }} (waiting for DNS)
            </option>
          </optgroup>
          <option v-if="unknownHost" :value="`custom:${unknownHost}`">{{ unknownHost }} (not registered)</option>
        </select>
      </div>

      <div v-if="!isPlatformSelected && selectedVerifiedParent && !readonly" class="flex items-center gap-2">
        <Switch
          id="support-from-picker-use-subdomain"
          :model-value="subdomainEnabled"
          :disabled="disabled"
          data-testid="support-from-picker-use-subdomain"
          @update:model-value="onToggleSubdomain"
        />
        <Label for="support-from-picker-use-subdomain" class="text-sm text-muted-foreground">Use a subdomain</Label>
      </div>

      <p v-if="!hasOptions" class="text-sm text-muted-foreground" data-testid="support-from-picker-empty">
        Add and verify a sending domain above to choose a From address.
      </p>
    </div>
  </div>
</template>

<script>
const SELECT_CLASSES =
  'flex h-10 rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none transition-all duration-200 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 min-w-0 flex-1'

export default {
  name: 'SupportFromAddressPicker',

  props: {
    /** Full From address, e.g. "support@acme.com". */
    modelValue: {
      type: String,
      default: '',
    },
    /** 'team' shows the picker; anything else is the legacy free-text input. */
    policy: {
      type: String,
      default: 'legacy',
    },
    /** Waits for the sending-domain list before choosing a mode. */
    loading: {
      type: Boolean,
      default: false,
    },
    /** @type {import('~/lib/support-sending-domains').SendingDomainView[]} */
    domains: {
      type: Array,
      default: () => [],
    },
    /** Team-owned Veerify platform addresses that may be used as From. */
    platformAddresses: {
      type: Array,
      default: () => [],
    },
    inputId: {
      type: String,
      default: 'general-from-address',
    },
    disabled: {
      type: Boolean,
      default: false,
    },
    readonly: {
      type: Boolean,
      default: false,
    },
  },

  emits: ['update:modelValue'],

  data() {
    return {
      localPart: '',
      selectedKey: '',
      subdomainEnabled: false,
      subPrefix: '',
      lastEmitted: null,
      selectClasses: SELECT_CLASSES,
    }
  },

  computed: {
    effectivePolicy() {
      return this.policy === 'team' ? 'team' : 'legacy'
    },

    // Unverified claims (deleting rows no longer authorize anything and are not offered).
    verifiedDomains() {
      return (this.domains || []).filter((row) => row.status === 'verified')
    },

    pendingDomains() {
      return (this.domains || []).filter((row) => row.status !== 'verified' && row.status !== 'deleting')
    },

    hasOptions() {
      return this.platformAddresses.length + this.verifiedDomains.length + this.pendingDomains.length > 0
    },

    isPlatformSelected() {
      return this.selectedKey.startsWith('platform:')
    },

    selectedVerifiedParent() {
      if (!this.selectedKey.startsWith('domain:')) return null
      const domain = this.selectedKey.slice('domain:'.length)
      return this.verifiedDomains.find((row) => row.domain === domain) || null
    },

    /** Host of the current value when it matches no offered option (so it stays visible). */
    unknownHost() {
      return this.selectedKey.startsWith('custom:') ? this.selectedKey.slice('custom:'.length) : ''
    },
  },

  watch: {
    modelValue(value) {
      if (value !== this.lastEmitted) this.syncFromValue(value)
    },
    // Lists load asynchronously; never clobber state the user has already edited.
    domains() {
      if (this.lastEmitted === null) this.syncFromValue(this.modelValue)
    },
    platformAddresses() {
      if (this.lastEmitted === null) this.syncFromValue(this.modelValue)
    },
  },

  created() {
    this.syncFromValue(this.modelValue)
  },

  methods: {
    /** Derive the picker state from a full address. */
    syncFromValue(value) {
      const address = String(value || '').trim()
      const at = address.lastIndexOf('@')
      const local = at >= 0 ? address.slice(0, at) : address
      const host = at >= 0 ? address.slice(at + 1).toLowerCase() : ''

      if (address && this.platformAddresses.includes(address)) {
        this.selectedKey = `platform:${address}`
        this.localPart = ''
        this.subdomainEnabled = false
        this.subPrefix = ''
        return
      }

      this.localPart = local
      const exact = (this.domains || []).find((row) => row.domain === host && row.status !== 'deleting')
      if (exact) {
        this.selectedKey = `domain:${exact.domain}`
        this.subdomainEnabled = false
        this.subPrefix = ''
        return
      }
      const parent = this.verifiedDomains
        .filter((row) => host.endsWith(`.${row.domain}`))
        .sort((a, b) => b.domain.length - a.domain.length)[0]
      if (parent) {
        this.selectedKey = `domain:${parent.domain}`
        this.subdomainEnabled = true
        this.subPrefix = host.slice(0, -(parent.domain.length + 1))
        return
      }
      this.selectedKey = host ? `custom:${host}` : ''
      this.subdomainEnabled = false
      this.subPrefix = ''
    },

    onSelect(key) {
      this.selectedKey = key
      if (!key.startsWith('domain:')) {
        this.subdomainEnabled = false
        this.subPrefix = ''
      } else if (!this.selectedVerifiedParent) {
        this.subdomainEnabled = false
      }
      this.emitValue()
    },

    onToggleSubdomain(enabled) {
      this.subdomainEnabled = enabled
      if (!enabled) this.subPrefix = ''
      this.emitValue()
    },

    emitValue() {
      let next = ''
      if (this.selectedKey.startsWith('platform:')) {
        next = this.selectedKey.slice('platform:'.length)
      } else {
        const local = this.localPart.trim()
        let host = ''
        if (this.selectedKey.startsWith('domain:')) {
          host = this.selectedKey.slice('domain:'.length)
          const prefix = this.subPrefix.trim().replace(/^\.+|\.+$/g, '')
          if (this.subdomainEnabled && this.selectedVerifiedParent && prefix) host = `${prefix}.${host}`
        } else if (this.selectedKey.startsWith('custom:')) {
          host = this.selectedKey.slice('custom:'.length)
        }
        next = local && host ? `${local}@${host}` : local && !host ? local : ''
      }
      this.lastEmitted = next
      this.$emit('update:modelValue', next)
    },
  },
}
</script>
