<template>
  <div class="space-y-6">
    <!-- Custom Domain Input -->
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
            <Input
              id="custom-domain"
              v-model="form.customDomain"
              placeholder="feedback.yourapp.com"
              class="font-mono"
            />
            <Button :disabled="isSaving" @click="save">
              <Icon v-if="isSaving" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
              Save
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">
            Enter a subdomain you control, e.g.
            <code class="font-mono bg-muted px-1 py-0.5 rounded">feedback.yourapp.com</code>.
          </p>
        </div>

        <!-- Verification Status -->
        <div v-if="form.customDomain" class="rounded-md border p-4 space-y-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span
                class="flex h-2 w-2 rounded-full"
                :class="{
                  'bg-green-500': verifyStatus === 'verified',
                  'bg-yellow-500': verifyStatus === 'unverified',
                  'bg-muted-foreground': verifyStatus === 'idle',
                  'bg-blue-500 animate-pulse': verifyStatus === 'checking',
                }"
              />
              <span class="text-sm font-medium">
                <span v-if="verifyStatus === 'idle'">Not checked yet</span>
                <span v-else-if="verifyStatus === 'checking'">Checking DNS…</span>
                <span v-else-if="verifyStatus === 'verified'" class="text-green-600 dark:text-green-400"
                  >CNAME verified</span
                >
                <span v-else class="text-yellow-600 dark:text-yellow-400">CNAME not detected</span>
              </span>
            </div>
            <Button variant="outline" size="sm" :disabled="verifyStatus === 'checking'" @click="verify">
              <Icon v-if="verifyStatus === 'checking'" name="lucide:loader-2" class="w-3.5 h-3.5 mr-1.5 animate-spin" />
              <Icon v-else name="lucide:search-check" class="w-3.5 h-3.5 mr-1.5" />
              Check DNS
            </Button>
          </div>

          <div v-if="verifyResult" class="text-xs text-muted-foreground space-y-1">
            <p>
              <span class="font-medium">Expected:</span>
              <code class="ml-1 font-mono bg-muted px-1 py-0.5 rounded">{{ verifyResult.expected }}</code>
            </p>
            <p v-if="verifyResult.resolvedTo.length">
              <span class="font-medium">Resolved to:</span>
              <code v-for="c in verifyResult.resolvedTo" :key="c" class="ml-1 font-mono bg-muted px-1 py-0.5 rounded">{{
                c
              }}</code>
            </p>
            <p v-else>
              No CNAME record found for
              <code class="font-mono bg-muted px-1 py-0.5 rounded">{{ form.customDomain }}</code
              >.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Setup Instructions -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Icon name="lucide:terminal" class="h-5 w-5" />
          How to point your CNAME
        </CardTitle>
        <CardDescription>
          Add a CNAME record with your DNS provider pointing your subdomain to Veerify.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <!-- DNS Record Summary -->
        <div class="rounded-md bg-muted p-4 space-y-3">
          <p class="text-sm font-medium">Add this DNS record:</p>
          <div class="grid grid-cols-3 gap-3 text-sm">
            <div class="space-y-1">
              <p class="text-xs text-muted-foreground uppercase tracking-wider font-medium">Type</p>
              <code class="block font-mono bg-background border rounded px-2 py-1">CNAME</code>
            </div>
            <div class="space-y-1">
              <p class="text-xs text-muted-foreground uppercase tracking-wider font-medium">Name / Host</p>
              <code class="block font-mono bg-background border rounded px-2 py-1 truncate">{{
                hostPart || 'feedback'
              }}</code>
            </div>
            <div class="space-y-1">
              <p class="text-xs text-muted-foreground uppercase tracking-wider font-medium">Value / Target</p>
              <code class="block font-mono bg-background border rounded px-2 py-1 truncate">{{ cnameTarget }}</code>
            </div>
          </div>
          <p class="text-xs text-muted-foreground">
            TTL can be set to <strong>Auto</strong> or <strong>3600</strong>. DNS changes can take up to 48 hours to
            propagate, though usually much faster.
          </p>
        </div>

        <!-- Provider Selector -->
        <div class="space-y-3">
          <div class="flex items-center gap-2">
            <Label for="provider-select" class="shrink-0">Step-by-step for</Label>
            <select
              id="provider-select"
              v-model="selectedProvider"
              class="flex h-8 w-full max-w-xs rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </div>

          <ol v-if="activeProvider" class="list-decimal list-inside space-y-2 text-sm text-muted-foreground pl-1">
            <li v-for="(step, i) in activeProvider.steps" :key="i" v-html="step" />
          </ol>
        </div>
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
      verifyStatus: 'idle', // idle | checking | verified | unverified
      verifyResult: null,
      selectedProvider: 'cloudflare',
    }
  },
  computed: {
    cnameTarget() {
      return useRuntimeConfig().public.cnameTarget || 'cname.veerify.com'
    },
    activeProvider() {
      return this.providers.find((p) => p.id === this.selectedProvider) || this.providers[0]
    },
    hostPart() {
      const domain = this.form.customDomain?.trim()
      if (!domain) return ''
      // Extract the subdomain portion (everything before the registrable domain)
      // e.g. "feedback.myapp.com" → "feedback"
      const parts = domain.split('.')
      if (parts.length > 2) return parts.slice(0, parts.length - 2).join('.')
      return domain
    },
    providers() {
      const cname = this.cnameTarget
      const host = this.hostPart || 'feedback'
      return [
        {
          id: 'cloudflare',
          name: 'Cloudflare',
          icon: 'lucide:cloud',
          steps: [
            'Log in to <strong>dash.cloudflare.com</strong> and select your domain.',
            'Go to <strong>DNS → Records</strong>.',
            `Click <strong>Add record</strong>. Set Type to <strong>CNAME</strong>, Name to <code class="font-mono bg-muted px-1 rounded">${host}</code>, and Target to <code class="font-mono bg-muted px-1 rounded">${cname}</code>.`,
            '<strong>Disable the orange proxy cloud</strong> (set to DNS only — grey cloud) so the CNAME passes through correctly.',
            'Click <strong>Save</strong>.',
          ],
        },
        {
          id: 'namecheap',
          name: 'Namecheap',
          icon: 'lucide:shield',
          steps: [
            'Sign in to <strong>namecheap.com</strong> and go to <strong>Domain List</strong>.',
            'Click <strong>Manage</strong> next to your domain, then select the <strong>Advanced DNS</strong> tab.',
            'Click <strong>Add New Record</strong>.',
            `Set Type to <strong>CNAME Record</strong>, Host to <code class="font-mono bg-muted px-1 rounded">${host}</code>, and Value to <code class="font-mono bg-muted px-1 rounded">${cname}</code>.`,
            'Click the green tick to save.',
          ],
        },
        {
          id: 'godaddy',
          name: 'GoDaddy',
          icon: 'lucide:server',
          steps: [
            'Sign in to <strong>godaddy.com</strong> and open <strong>My Products → DNS</strong>.',
            'Select your domain and click <strong>Add</strong>.',
            `Set Type to <strong>CNAME</strong>, Name to <code class="font-mono bg-muted px-1 rounded">${host}</code>, and Value to <code class="font-mono bg-muted px-1 rounded">${cname}</code>.`,
            'Set TTL to <strong>1 hour</strong> (or leave as default).',
            'Click <strong>Save</strong>.',
          ],
        },
        {
          id: 'route53',
          name: 'AWS Route 53',
          icon: 'lucide:database',
          steps: [
            'Open the <strong>Route 53</strong> console and choose <strong>Hosted zones</strong>.',
            'Select your hosted zone.',
            'Click <strong>Create record</strong>.',
            `Set Record type to <strong>CNAME</strong>, Record name to <code class="font-mono bg-muted px-1 rounded">${host}</code>, and Value to <code class="font-mono bg-muted px-1 rounded">${cname}</code>.`,
            'Click <strong>Create records</strong>.',
          ],
        },
        {
          id: 'vercel',
          name: 'Vercel DNS',
          icon: 'lucide:triangle',
          steps: [
            'Go to your <strong>Vercel dashboard → Domains</strong>.',
            'Select your domain and go to the <strong>DNS</strong> tab.',
            'Click <strong>Add</strong>.',
            `Set Type to <strong>CNAME</strong>, Name to <code class="font-mono bg-muted px-1 rounded">${host}</code>, and Value to <code class="font-mono bg-muted px-1 rounded">${cname}</code>.`,
            'Click <strong>Add record</strong>.',
          ],
        },
        {
          id: 'squarespace',
          name: 'Squarespace / Google Domains',
          icon: 'lucide:layout',
          steps: [
            'Open your domain settings in <strong>Squarespace</strong> (or <strong>Google Domains</strong>).',
            'Go to <strong>DNS → Custom records</strong>.',
            'Click <strong>Add record</strong>.',
            `Set Type to <strong>CNAME</strong>, Host name to <code class="font-mono bg-muted px-1 rounded">${host}</code>, and Data to <code class="font-mono bg-muted px-1 rounded">${cname}</code>.`,
            'Save the record.',
          ],
        },
        {
          id: 'other',
          name: 'Other',
          icon: 'lucide:help-circle',
          steps: [
            'Log in to your DNS provider and navigate to the DNS management panel for your domain.',
            'Look for an option to add a new record.',
            `Add a <strong>CNAME</strong> record with the name/host set to <code class="font-mono bg-muted px-1 rounded">${host}</code> and the value/target set to <code class="font-mono bg-muted px-1 rounded">${cname}</code>.`,
            'Set TTL to <strong>Auto</strong> or <strong>3600</strong> (1 hour).',
            'Save the record. Changes may take up to 48 hours to propagate.',
          ],
        },
      ]
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
          toast.success('CNAME verified successfully!')
        } else {
          toast.warning('CNAME not found yet — DNS may still be propagating.')
        }
      } catch (err) {
        console.error('DNS check failed:', err)
        toast.error('DNS check failed. Please try again.')
        this.verifyStatus = 'idle'
      }
    },
  },
}
</script>
