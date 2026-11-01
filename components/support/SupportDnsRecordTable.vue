<template>
  <div class="space-y-3" data-testid="support-dns-record-table">
    <p v-if="operatorManaged" class="text-sm text-muted-foreground" data-testid="support-dns-operator-managed">
      Your operator provides the sending records for this domain. Publish the ownership record below to prove you
      control it.
    </p>

    <p
      v-if="zone && sortedRecords.length > 0"
      class="text-sm text-muted-foreground"
      data-testid="support-dns-zone-note"
    >
      Add these in the DNS zone for <strong>{{ zone }}</strong
      >. The <em>Host</em> column is relative to that zone; the full record name is shown under it.
      <template v-if="domain && domain !== zone">
        If <code>{{ domain }}</code> has its own separate DNS zone, use the full name with that zone's own suffix
        removed instead.
      </template>
    </p>

    <!-- MX takeover warning: publishing the MX moves all of the domain's mail. -->
    <div
      v-if="mxWarningNeeded"
      class="space-y-2 rounded-md bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300"
      role="alert"
      data-testid="support-dns-mx-warning"
    >
      <p class="flex items-start gap-2">
        <Icon name="lucide:alert-triangle" class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          <strong>{{ domain }}</strong> currently receives mail at
          <span class="break-all font-mono text-xs">{{ existingMxHosts.join(', ') }}</span
          >. Adding this MX moves all mail for <strong>@{{ domain }}</strong> to Veerify. To keep your current mailbox,
          connect a subdomain like <strong>{{ subdomainSuggestion }}</strong> instead.
        </span>
      </p>
      <label class="flex items-start gap-2 pl-6">
        <input
          type="checkbox"
          class="mt-0.5 h-4 w-4 shrink-0 rounded border-input"
          :checked="mxAcknowledged"
          data-testid="support-dns-mx-acknowledge"
          @change="$emit('acknowledge-mx', $event.target.checked)"
        />
        <span>I understand: all mail for @{{ domain }} will go to Veerify instead of its current mailbox.</span>
      </label>
    </div>

    <div v-if="sortedRecords.length === 0" class="text-sm text-muted-foreground">No DNS records to publish yet.</div>

    <!-- One table: rows stack into cards below the md breakpoint (labels shown inline), so there is no
         six-column horizontal scroll on phones and every test id exists once. -->
    <div v-else class="rounded-md border md:overflow-x-auto">
      <table class="block w-full text-left text-sm md:table">
        <thead class="hidden bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground md:table-header-group">
          <tr>
            <th class="px-3 py-2 font-medium">Purpose</th>
            <th class="px-3 py-2 font-medium">Type</th>
            <th class="px-3 py-2 font-medium">Host</th>
            <th class="px-3 py-2 font-medium">Value</th>
            <th class="px-3 py-2 font-medium">Priority</th>
            <th class="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody class="block md:table-row-group">
          <tr
            v-for="(record, index) in sortedRecords"
            :key="rowKey(record, index)"
            class="block border-t px-3 py-2 align-top first:border-t-0 md:table-row md:px-0 md:py-0 md:first:border-t"
            data-testid="support-dns-record-row"
            :data-purpose="record.purpose"
          >
            <td class="flex items-center gap-2 py-1 md:table-cell md:whitespace-nowrap md:px-3 md:py-2">
              <span class="w-20 shrink-0 text-xs text-muted-foreground md:hidden">Purpose</span>
              <span>
                {{ purposeLabel(record.purpose) }}
                <span
                  v-if="record.purpose === 'recommended'"
                  class="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  >recommended</span
                >
              </span>
            </td>
            <td class="flex items-center gap-2 py-1 md:table-cell md:whitespace-nowrap md:px-3 md:py-2">
              <span class="w-20 shrink-0 text-xs text-muted-foreground md:hidden">Type</span>
              <span class="font-mono text-xs">{{ record.type }}</span>
            </td>
            <td class="flex items-start gap-2 py-1 md:table-cell md:px-3 md:py-2">
              <span class="w-20 shrink-0 pt-0.5 text-xs text-muted-foreground md:hidden">Host</span>
              <div class="min-w-0">
                <div class="flex items-center gap-1">
                  <code class="break-all text-xs" data-testid="support-dns-record-host">{{
                    relativeHost(record.name)
                  }}</code>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-6 w-6 shrink-0 p-0"
                    :aria-label="`Copy ${record.type} host`"
                    data-testid="support-dns-record-copy-host"
                    @click="copy(relativeHost(record.name), `${record.type} host`)"
                  >
                    <Icon name="lucide:copy" class="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
                <div class="mt-1 flex items-center gap-1 text-muted-foreground">
                  <code class="break-all text-[11px]" data-testid="support-dns-record-fqdn">{{ record.name }}</code>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-5 w-5 shrink-0 p-0"
                    :aria-label="`Copy full ${record.type} record name`"
                    data-testid="support-dns-record-copy-fqdn"
                    @click="copy(record.name, `Full ${record.type} record name`)"
                  >
                    <Icon name="lucide:copy" class="h-3 w-3" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </td>
            <td class="flex items-start gap-2 py-1 md:table-cell md:max-w-[22rem] md:px-3 md:py-2">
              <span class="w-20 shrink-0 pt-0.5 text-xs text-muted-foreground md:hidden">Value</span>
              <div v-if="isValueHidden(record)" class="min-w-0 text-xs text-muted-foreground">
                <span data-testid="support-dns-record-value-hidden">
                  Confirm the warning above to show this value.
                </span>
              </div>
              <div v-else class="flex min-w-0 items-start gap-1">
                <code
                  class="min-w-0 text-xs"
                  :class="isExpanded(record, index) ? 'break-all' : 'block max-w-[16rem] truncate'"
                  data-testid="support-dns-record-value"
                  >{{ record.value }}</code
                >
                <Button
                  v-if="record.value.length > 40"
                  variant="ghost"
                  size="sm"
                  class="h-6 w-6 shrink-0 p-0"
                  :aria-label="isExpanded(record, index) ? 'Collapse value' : 'Show the full value'"
                  :aria-expanded="isExpanded(record, index)"
                  @click="toggleExpanded(record, index)"
                >
                  <Icon
                    :name="isExpanded(record, index) ? 'lucide:chevron-up' : 'lucide:chevron-down'"
                    class="h-3.5 w-3.5"
                    aria-hidden="true"
                  />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-6 w-6 shrink-0 p-0"
                  :aria-label="`Copy ${record.type} value`"
                  data-testid="support-dns-record-copy-value"
                  @click="copy(record.value, `${record.type} value`)"
                >
                  <Icon name="lucide:copy" class="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            </td>
            <td
              class="py-1 md:table-cell md:whitespace-nowrap md:px-3 md:py-2"
              :class="record.priority ? 'flex items-center gap-2' : 'hidden'"
            >
              <span class="w-20 shrink-0 text-xs text-muted-foreground md:hidden">Priority</span>
              <span>{{ record.priority || '—' }}</span>
            </td>
            <td class="flex items-center gap-2 py-1 md:table-cell md:whitespace-nowrap md:px-3 md:py-2">
              <span class="w-20 shrink-0 text-xs text-muted-foreground md:hidden">Status</span>
              <span
                class="inline-flex items-center gap-1 text-xs"
                :class="statusMeta(record.status).classes"
                data-testid="support-dns-record-status"
              >
                <Icon :name="statusMeta(record.status).icon" class="h-3.5 w-3.5" aria-hidden="true" />
                {{ statusMeta(record.status).label }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="hasSendingRecords" class="text-xs text-muted-foreground" data-testid="support-dns-spf-note">
      No SPF change needed: replies are signed with DKIM, which is what DMARC checks. Keep any existing SPF includes for
      your other mail services.
    </p>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'
import { relativeRecordHost } from '~/lib/support-sending-domains'

const PURPOSE_ORDER = ['ownership', 'sending', 'receiving', 'recommended']

const PURPOSE_LABELS = {
  ownership: 'Ownership',
  sending: 'Sending (DKIM)',
  receiving: 'Receiving (MX)',
  recommended: 'DMARC',
}

const STATUS_META = {
  valid: { label: 'Found', icon: 'lucide:check-circle-2', classes: 'text-emerald-700 dark:text-emerald-400' },
  invalid: { label: 'Not found', icon: 'lucide:x-circle', classes: 'text-destructive' },
  unknown: { label: 'Not checked yet', icon: 'lucide:clock', classes: 'text-muted-foreground' },
}

export default {
  name: 'SupportDnsRecordTable',

  props: {
    /** @type {import('~/lib/support-sending-domains').SendingDomainDnsRecord[]} */
    records: {
      type: Array,
      default: () => [],
    },
    /** The claimed domain (may be a subdomain such as mail.acme.com). */
    domain: {
      type: String,
      default: '',
    },
    /** The DNS zone the records live in: the registrable domain (acme.com). Hosts are shown relative to it. */
    zone: {
      type: String,
      default: '',
    },
    /** True when the provider is list-only (Postmark): provider rows are not ours to show. */
    operatorManaged: {
      type: Boolean,
      default: false,
    },
    /** Only these purposes are shown (all when empty). */
    purposes: {
      type: Array,
      default: () => [],
    },
    /**
     * Mail hosts the domain uses today (not ours). When non-empty, the receiving MX value stays
     * hidden until `mxAcknowledged`, and the takeover warning asks for it.
     */
    existingMxHosts: {
      type: Array,
      default: () => [],
    },
    mxAcknowledged: {
      type: Boolean,
      default: false,
    },
  },

  emits: ['acknowledge-mx'],

  data() {
    return {
      expanded: {},
    }
  },

  computed: {
    sortedRecords() {
      const visible = (this.records || []).filter(
        (record) =>
          (!this.operatorManaged || record.purpose === 'ownership' || record.purpose === 'recommended') &&
          (this.purposes.length === 0 || this.purposes.includes(record.purpose))
      )
      return visible
        .map((record, index) => ({ record, index }))
        .sort(
          (a, b) =>
            PURPOSE_ORDER.indexOf(a.record.purpose) - PURPOSE_ORDER.indexOf(b.record.purpose) || a.index - b.index
        )
        .map(({ record }) => record)
    },

    hasMxRecord() {
      return this.sortedRecords.some((record) => this.isReceivingMx(record))
    },

    hasSendingRecords() {
      return !this.operatorManaged && this.sortedRecords.some((record) => record.purpose === 'sending')
    },

    /** Non-blocking for a domain with no other mail hosts. */
    mxWarningNeeded() {
      return this.hasMxRecord && (this.existingMxHosts || []).length > 0
    },

    subdomainSuggestion() {
      return `mail.${this.domain || 'example.com'}`
    },
  },

  methods: {
    purposeLabel(purpose) {
      return PURPOSE_LABELS[purpose] || purpose
    },

    statusMeta(status) {
      return STATUS_META[status] || STATUS_META.unknown
    },

    rowKey(record, index) {
      return `${record.purpose}:${record.type}:${record.name}:${index}`
    },

    isReceivingMx(record) {
      return record.purpose === 'receiving' && record.type === 'MX'
    },

    isValueHidden(record) {
      return this.isReceivingMx(record) && this.mxWarningNeeded && !this.mxAcknowledged
    },

    isExpanded(record, index) {
      return this.expanded[this.rowKey(record, index)] === true
    },

    toggleExpanded(record, index) {
      const key = this.rowKey(record, index)
      this.expanded = { ...this.expanded, [key]: !this.expanded[key] }
    },

    relativeHost(fqdn) {
      return this.zone ? relativeRecordHost(fqdn, this.zone) : fqdn
    },

    /** The toast names what was copied ("MX value copied"), not just "Copied". */
    async copy(value, what) {
      if (!import.meta.client || !value) return
      try {
        await navigator.clipboard.writeText(value)
        toast.success(`${what} copied`)
      } catch {
        toast.error(`Could not copy the ${what.toLowerCase()} to the clipboard`)
      }
    },
  },
}
</script>
