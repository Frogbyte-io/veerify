<template>
  <div class="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Icon name="lucide:globe" class="h-5 w-5" />
          Custom Domain
        </CardTitle>
        <CardDescription>
          Serve your feedback board on your own domain instead of the default Veerify URL.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="space-y-2">
          <Label for="custom-domain">Domain</Label>
          <div class="flex gap-2">
            <Input id="custom-domain" v-model="form.customDomain" placeholder="feedback.yourapp.com" class="font-mono" />
            <Button :disabled="isSaving" @click="save">
              <Icon v-if="isSaving" name="lucide:loader-2" class="mr-2 h-4 w-4 animate-spin" />
              Save
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">
            Enter a subdomain you control, for example
            <code class="rounded bg-muted px-1 py-0.5 font-mono">feedback.yourapp.com</code>.
          </p>
        </div>

        <div v-if="form.customDomain" class="space-y-3 rounded-md border p-4 transition-colors" :class="statusPanelClass">
          <div class="flex items-center justify-between">
            <div class="flex items-start gap-3">
              <span
                class="flex h-2 w-2 rounded-full"
                :class="statusDotClass"
              />
              <div class="space-y-1">
                <p data-testid="product-domain-status-title" class="text-sm font-medium" :class="statusTextClass">
                  {{ statusTitle }}
                </p>
                <p v-if="statusHint" data-testid="product-domain-status-hint" class="text-xs text-muted-foreground">
                  {{ statusHint }}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" :disabled="verifyStatus === 'checking'" @click="verify">
              <Icon v-if="verifyStatus === 'checking'" name="lucide:loader-2" class="mr-1.5 h-3.5 w-3.5 animate-spin" />
              <Icon v-else name="lucide:search-check" class="mr-1.5 h-3.5 w-3.5" />
              Check DNS
            </Button>
          </div>

          <div v-if="verifyResult" class="space-y-1 text-xs text-muted-foreground">
            <p v-if="verifyResult.expected">
              <span class="font-medium">Expected:</span>
              <code class="ml-1 rounded bg-muted px-1 py-0.5 font-mono">{{ verifyResult.expected }}</code>
            </p>
            <p v-if="verifyResult.resolvedTo.length">
              <span class="font-medium">Resolved to:</span>
              <code
                v-for="value in verifyResult.resolvedTo"
                :key="value"
                class="ml-1 rounded bg-muted px-1 py-0.5 font-mono"
              >
                {{ value }}
              </code>
            </p>
            <p v-else>
              No matching DNS records found for
              <code class="rounded bg-muted px-1 py-0.5 font-mono">{{ form.customDomain }}</code>.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Icon name="lucide:terminal" class="h-5 w-5" />
          DNS Setup
        </CardTitle>
        <CardDescription>
          Add the DNS records below with your DNS provider, then verify the domain here.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="space-y-3 rounded-md bg-muted p-4">
          <p class="text-sm font-medium">Required DNS records</p>
          <div v-if="displayDnsRecords.length" class="space-y-3">
            <div
              v-for="(record, index) in displayDnsRecords"
              :key="`${record.type}-${record.name}-${record.value}-${index}`"
              class="grid grid-cols-1 gap-3 rounded-md border bg-background p-3 text-sm md:grid-cols-3"
            >
              <div class="space-y-1">
                <p class="text-xs font-medium uppercase tracking-wider text-muted-foreground">Type</p>
                <code class="block rounded border bg-background px-2 py-1 font-mono">{{ record.type }}</code>
              </div>
              <div class="space-y-1">
                <p class="text-xs font-medium uppercase tracking-wider text-muted-foreground">Name / Host</p>
                <code class="block break-all rounded border bg-background px-2 py-1 font-mono">{{ record.name }}</code>
              </div>
              <div class="space-y-1">
                <p class="text-xs font-medium uppercase tracking-wider text-muted-foreground">Value / Target</p>
                <code class="block break-all rounded border bg-background px-2 py-1 font-mono">{{ record.value }}</code>
              </div>
            </div>
          </div>
          <p v-else class="text-sm text-muted-foreground">Save a domain to generate the required DNS records.</p>
          <p class="text-xs text-muted-foreground">
            TTL can be set to <strong>Auto</strong> or <strong>3600</strong>. DNS changes can take up to 48 hours to
            propagate, though usually much faster.
          </p>
        </div>

        <ol class="list-inside list-decimal space-y-2 pl-1 text-sm text-muted-foreground">
          <li>Save the domain if you have not already done so.</li>
          <li>Add every DNS record shown above with your DNS provider.</li>
          <li>Wait for DNS propagation.</li>
          <li>Click <strong>Check DNS</strong> until the domain becomes verified.</li>
        </ol>
      </CardContent>
    </Card>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'

export default {
  name: 'ProductSettingsDomain',
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  emits: ['updated'],
  data() {
    return {
      form: {
        customDomain: this.project.customDomain || '',
      },
      isSaving: false,
      verifyStatus: 'idle',
      verifyResult: null,
    }
  },
  computed: {
    cnameTarget() {
      return useRuntimeConfig().public.cnameTarget || 'cname.veerify.io'
    },
    storedDomainRecords() {
      const records = this.project?.settings?.domainDnsRecords
      if (!Array.isArray(records)) return []
      return this.normalizeDnsRecords(records.filter((record) => {
        return record && typeof record.type === 'string' && typeof record.name === 'string' && typeof record.value === 'string'
      }))
    },
    fallbackDnsRecord() {
      const domain = this.form.customDomain?.trim()
      if (!domain) return []
      return this.normalizeDnsRecords([
        {
          type: 'CNAME',
          name: domain,
          value: this.cnameTarget,
        },
      ])
    },
    displayDnsRecords() {
      if (Array.isArray(this.verifyResult?.dnsRecords) && this.verifyResult.dnsRecords.length > 0) {
        return this.normalizeDnsRecords(this.verifyResult.dnsRecords)
      }
      if (this.storedDomainRecords.length > 0) {
        return this.storedDomainRecords
      }
      return this.fallbackDnsRecord
    },
    effectiveDomainStatus() {
      if (this.verifyResult?.status) return this.verifyResult.status
      return this.project?.settings?.domainStatus || null
    },
    hasStoredVerifiedDomain() {
      return this.project?.settings?.domainStatus === 'active'
    },
    statusPresentation() {
      if (this.verifyStatus === 'checking') return 'checking'

      if (this.verifyResult) {
        if (this.verifyResult.verified) return 'active'
        if (this.verifyResult.status === 'ownership_verification_required') {
          return 'ownership_verification_required'
        }
        if (this.hasStoredVerifiedDomain) {
          return 'dns_incomplete'
        }
        return 'dns_required'
      }

      if (this.effectiveDomainStatus === 'active') return 'active'
      if (this.effectiveDomainStatus === 'ownership_verification_required') {
        return 'ownership_verification_required'
      }
      if (this.effectiveDomainStatus === 'dns_required') return 'dns_required'
      return 'idle'
    },
    statusTitle() {
      if (this.statusPresentation === 'checking') return 'Checking DNS...'
      if (this.statusPresentation === 'active') return 'Domain verified'
      if (this.statusPresentation === 'ownership_verification_required') return 'Ownership verification required'
      if (this.statusPresentation === 'dns_incomplete') return 'DNS configuration incomplete'
      if (this.statusPresentation === 'dns_required') return 'DNS not configured yet'
      return 'Not checked yet'
    },
    statusHint() {
      if (this.statusPresentation === 'active') {
        return 'The current DNS records match the required setup.'
      }
      if (this.statusPresentation === 'ownership_verification_required') {
        return 'Add the verification records below to finish connecting this domain.'
      }
      if (this.statusPresentation === 'dns_incomplete') {
        return 'The domain is added, but the latest DNS check did not find the required records.'
      }
      if (this.statusPresentation === 'dns_required') {
        return 'Add the required DNS records below, then check again.'
      }
      return ''
    },
    statusDotClass() {
      if (this.statusPresentation === 'checking') return 'bg-blue-500 animate-pulse'
      if (this.statusPresentation === 'active') return 'bg-green-500'
      if (this.statusPresentation === 'ownership_verification_required' || this.statusPresentation === 'dns_incomplete' || this.statusPresentation === 'dns_required') {
        return 'bg-amber-500'
      }
      return 'bg-muted-foreground'
    },
    statusTextClass() {
      if (this.statusPresentation === 'active') return 'text-green-600 dark:text-green-400'
      if (this.statusPresentation === 'checking') return 'text-blue-600 dark:text-blue-400'
      if (this.statusPresentation === 'ownership_verification_required' || this.statusPresentation === 'dns_incomplete' || this.statusPresentation === 'dns_required') {
        return 'text-amber-700 dark:text-amber-300'
      }
      return ''
    },
    statusPanelClass() {
      if (this.statusPresentation === 'active') return 'border-green-500/30 bg-green-500/5'
      if (this.statusPresentation === 'checking') return 'border-blue-500/30 bg-blue-500/5'
      if (this.statusPresentation === 'ownership_verification_required' || this.statusPresentation === 'dns_incomplete' || this.statusPresentation === 'dns_required') {
        return 'border-amber-500/30 bg-amber-500/5'
      }
      return ''
    },
  },
  watch: {
    project: {
      handler(newProject) {
        this.form.customDomain = newProject.customDomain || ''
        this.verifyStatus = 'idle'
        this.verifyResult = null
      },
      deep: true,
    },
    'form.customDomain'() {
      this.verifyStatus = 'idle'
      this.verifyResult = null
    },
  },
  methods: {
    normalizeDnsRecords(records) {
      const seen = new Set()
      const seenCnameHosts = new Set()
      const normalized = []

      for (const record of records) {
        const nextRecord = {
          type: String(record.type || '').trim().toUpperCase(),
          name: String(record.name || '').trim().toLowerCase().replace(/\.$/, ''),
          value: String(record.value || '').trim(),
        }

        if (!nextRecord.type || !nextRecord.name || !nextRecord.value) continue

        const key = `${nextRecord.type}:${nextRecord.name}:${nextRecord.value}`
        if (seen.has(key)) continue
        if (nextRecord.type === 'CNAME' && seenCnameHosts.has(nextRecord.name)) continue

        seen.add(key)
        if (nextRecord.type === 'CNAME') {
          seenCnameHosts.add(nextRecord.name)
        }
        normalized.push(nextRecord)
      }

      return normalized
    },

    async save() {
      this.isSaving = true
      try {
        const response = await $fetch(`/api/projects/${this.project.slug}`, {
          method: 'PUT',
          body: {
            customDomain: this.form.customDomain?.trim() || null,
          },
        })
        this.$emit('updated', response.data)
        toast.success('Custom domain saved')
      } catch (err) {
        console.error('Error saving domain:', err)
        toast.error(err?.data?.error?.message || 'Failed to save domain')
      } finally {
        this.isSaving = false
      }
    },

    async verify() {
      const domain = this.form.customDomain?.trim()
      if (!domain) return

      this.verifyStatus = 'checking'
      this.verifyResult = null

      try {
        const result = await $fetch(`/api/projects/${this.project.slug}/verify-domain`, {
          query: { domain },
        })
        this.verifyResult = result
        this.verifyStatus = result.verified ? 'verified' : 'unverified'

        if (result.verified) {
          toast.success('Domain verified successfully!')
        } else {
          toast.warning('Domain is not fully configured yet. DNS may still be propagating.')
        }
      } catch (err) {
        console.error('DNS check failed:', err)
        toast.error(err?.data?.error?.message || 'DNS check failed. Please try again.')
        this.verifyStatus = 'idle'
      }
    },
  },
}
</script>
