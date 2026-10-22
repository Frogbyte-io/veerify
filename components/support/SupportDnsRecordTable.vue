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

    <div v-if="sortedRecords.length === 0" class="text-sm text-muted-foreground">No DNS records to publish yet.</div>

    <div v-else class="overflow-x-auto rounded-md border">
      <table class="w-full text-left text-sm">
        <thead class="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th class="px-3 py-2 font-medium">Purpose</th>
            <th class="px-3 py-2 font-medium">Type</th>
            <th class="px-3 py-2 font-medium">Host</th>
            <th class="px-3 py-2 font-medium">Value</th>
            <th class="px-3 py-2 font-medium">Priority</th>
            <th class="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(record, index) in sortedRecords"
            :key="rowKey(record, index)"
            class="border-t align-top"
            data-testid="support-dns-record-row"
            :data-purpose="record.purpose"
          >
            <td class="px-3 py-2 whitespace-nowrap">
              {{ purposeLabel(record.purpose) }}
              <span
                v-if="record.purpose === 'recommended'"
                class="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                >recommended</span
              >
            </td>
            <td class="px-3 py-2 whitespace-nowrap font-mono text-xs">{{ record.type }}</td>
            <td class="px-3 py-2">
              <div class="flex items-center gap-1">
                <code class="break-all text-xs" data-testid="support-dns-record-host">{{
                  relativeHost(record.name)
                }}</code>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-6 w-6 shrink-0 p-0"
                  aria-label="Copy host"
                  data-testid="support-dns-record-copy-host"
                  @click="copy(relativeHost(record.name))"
                >
                  <Icon name="lucide:copy" class="h-3.5 w-3.5" />
                </Button>
              </div>
              <div class="mt-1 flex items-center gap-1 text-muted-foreground">
                <code class="break-all text-[11px]" data-testid="support-dns-record-fqdn">{{ record.name }}</code>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-5 w-5 shrink-0 p-0"
                  aria-label="Copy full record name"
                  data-testid="support-dns-record-copy-fqdn"
                  @click="copy(record.name)"
                >
                  <Icon name="lucide:copy" class="h-3 w-3" />
                </Button>
              </div>
            </td>
            <td class="px-3 py-2 max-w-[22rem]">
              <div class="flex items-start gap-1">
                <code
                  class="text-xs"
                  :class="isExpanded(record, index) ? 'break-all' : 'block truncate max-w-[16rem]'"
                  :title="record.value"
                  data-testid="support-dns-record-value"
                  >{{ record.value }}</code
                >
                <Button
                  v-if="record.value.length > 40"
                  variant="ghost"
                  size="sm"
                  class="h-6 w-6 shrink-0 p-0"
                  :aria-label="isExpanded(record, index) ? 'Collapse value' : 'Expand value'"
                  @click="toggleExpanded(record, index)"
                >
                  <Icon
                    :name="isExpanded(record, index) ? 'lucide:chevron-up' : 'lucide:chevron-down'"
                    class="h-3.5 w-3.5"
                  />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-6 w-6 shrink-0 p-0"
                  aria-label="Copy value"
                  data-testid="support-dns-record-copy-value"
                  @click="copy(record.value)"
                >
                  <Icon name="lucide:copy" class="h-3.5 w-3.5" />
                </Button>
              </div>
            </td>
            <td class="px-3 py-2 whitespace-nowrap">{{ record.priority || '—' }}</td>
            <td class="px-3 py-2 whitespace-nowrap">
              <span
                class="inline-flex items-center gap-1 text-xs"
                :class="statusMeta(record.status).classes"
                data-testid="support-dns-record-status"
              >
                <Icon :name="statusMeta(record.status).icon" class="h-3.5 w-3.5" />
                {{ statusMeta(record.status).label }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'
import { relativeRecordHost } from '~/lib/support-sending-domains'

const PURPOSE_ORDER = ['ownership', 'sending', 'receiving', 'recommended']

const PURPOSE_LABELS = {
  ownership: 'Ownership',
  sending: 'Sending',
  receiving: 'Receiving',
  recommended: 'DMARC',
}

const STATUS_META = {
  valid: { label: 'Valid', icon: 'lucide:check-circle-2', classes: 'text-emerald-700 dark:text-emerald-400' },
  invalid: { label: 'Not found', icon: 'lucide:x-circle', classes: 'text-destructive' },
  unknown: { label: 'Pending', icon: 'lucide:clock', classes: 'text-muted-foreground' },
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
  },

  data() {
    return {
      expanded: {},
    }
  },

  computed: {
    sortedRecords() {
      const visible = (this.records || []).filter(
        (record) => !this.operatorManaged || record.purpose === 'ownership' || record.purpose === 'recommended'
      )
      return visible
        .map((record, index) => ({ record, index }))
        .sort(
          (a, b) =>
            PURPOSE_ORDER.indexOf(a.record.purpose) - PURPOSE_ORDER.indexOf(b.record.purpose) || a.index - b.index
        )
        .map(({ record }) => record)
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

    async copy(value) {
      if (!import.meta.client || !value) return
      try {
        await navigator.clipboard.writeText(value)
        toast.success('Copied')
      } catch {
        toast.error('Could not copy to clipboard')
      }
    },
  },
}
</script>
