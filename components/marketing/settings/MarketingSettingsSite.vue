<template>
  <Card data-testid="marketing-settings-site">
    <CardHeader>
      <div class="flex items-start justify-between gap-3">
        <div>
          <CardTitle>Site</CardTitle>
          <CardDescription>
            The website Marketing audits and monitors. You must prove you own it before anything runs.
          </CardDescription>
        </div>
        <Badge v-if="site && site.verified" variant="default" data-testid="marketing-site-verified">
          <Icon name="lucide:check" />
          Verified{{ methodLabel ? ` (${methodLabel})` : '' }}
        </Badge>
        <Badge v-else-if="site" variant="outline" data-testid="marketing-site-unverified">
          <Icon name="lucide:clock" />
          Not verified
        </Badge>
      </div>
    </CardHeader>

    <CardContent class="space-y-5">
      <p v-if="!canManage" class="rounded-md border border-muted bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        Only team admins can change the site or verify it.
      </p>

      <form class="space-y-2" @submit.prevent="saveOrigin">
        <Label for="marketing-site-origin">Site address</Label>
        <div class="flex gap-2">
          <Input
            id="marketing-site-origin"
            v-model="origin"
            placeholder="example.com"
            autocomplete="off"
            :disabled="!canManage || saving"
            data-testid="marketing-site-origin"
          />
          <Button type="submit" :disabled="!canManage || saving || !originChanged">
            <Icon v-if="saving" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
            {{ site ? 'Change' : 'Add site' }}
          </Button>
        </div>
        <p v-if="site && originChanged" class="text-xs text-muted-foreground">
          Changing the address resets verification and creates a new token.
        </p>
        <p v-if="saveError" class="text-sm text-destructive" role="alert">{{ saveError }}</p>
      </form>

      <div v-if="site && verification && !site.verified" class="space-y-4" data-testid="marketing-site-verification">
        <Separator />
        <div>
          <p class="text-sm font-medium">Verify ownership</p>
          <p class="text-xs text-muted-foreground mt-0.5">Pick one method, set it up, then press Verify.</p>
        </div>

        <div class="flex flex-wrap gap-2">
          <Button
            v-for="option in methods"
            :key="option.id"
            size="sm"
            :variant="method === option.id ? 'default' : 'outline'"
            @click="method = option.id"
          >
            <Icon :name="option.icon" class="w-4 h-4 mr-2" />
            {{ option.label }}
          </Button>
        </div>

        <div v-if="method === 'dns'" class="space-y-3">
          <p class="text-sm text-muted-foreground">Add this TXT record at your DNS provider.</p>
          <div class="grid gap-3 sm:grid-cols-[6rem_1fr]">
            <div>
              <Label class="text-xs text-muted-foreground">Type</Label>
              <p class="font-mono text-sm mt-1">{{ verification.dnsRecord.type }}</p>
            </div>
            <div>
              <Label class="text-xs text-muted-foreground">Host</Label>
              <MarketingCopyField :value="verification.dnsRecord.host" />
            </div>
          </div>
          <div>
            <Label class="text-xs text-muted-foreground">Value</Label>
            <MarketingCopyField :value="verification.dnsRecord.value" />
          </div>
          <p class="text-xs text-muted-foreground">DNS changes can take a while to show up.</p>
        </div>

        <div v-else-if="method === 'meta'" class="space-y-3">
          <p class="text-sm text-muted-foreground">
            Add this tag inside the <code class="font-mono">&lt;head&gt;</code> of your home page.
          </p>
          <MarketingCopyField :value="verification.metaTag" />
        </div>

        <div v-else class="space-y-3">
          <p class="text-sm text-muted-foreground">Serve a plain text file at this path containing only the token.</p>
          <div>
            <Label class="text-xs text-muted-foreground">Path</Label>
            <MarketingCopyField :value="`${site.origin}${verification.filePath}`" />
          </div>
          <div>
            <Label class="text-xs text-muted-foreground">File content</Label>
            <MarketingCopyField :value="verification.fileContent" />
          </div>
        </div>

        <div v-if="site.lastVerificationError" class="rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <p class="text-sm text-destructive" role="alert" data-testid="marketing-site-verify-error">
            {{ site.lastVerificationError }}
          </p>
        </div>

        <Button :disabled="!canManage || verifying" data-testid="marketing-site-verify" @click="verify">
          <Icon v-if="verifying" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
          <Icon v-else name="lucide:shield-check" class="w-4 h-4 mr-2" />
          Verify
        </Button>
        <p v-if="verifyError" class="text-sm text-destructive" role="alert">{{ verifyError }}</p>
      </div>
    </CardContent>
  </Card>
</template>

<script>
import { toast } from 'vue-sonner'

const METHOD_LABELS = { dns: 'DNS record', meta: 'meta tag', file: 'file', domain: 'custom domain' }

export default {
  name: 'MarketingSettingsSite',

  props: {
    product: { type: Object, required: true },
    site: { type: Object, default: null },
    verification: { type: Object, default: null },
    canManage: { type: Boolean, default: false },
  },

  emits: ['changed'],

  data() {
    return {
      origin: this.site?.origin || '',
      method: 'dns',
      saving: false,
      verifying: false,
      saveError: null,
      verifyError: null,
      methods: [
        { id: 'dns', label: 'DNS record', icon: 'lucide:globe' },
        { id: 'meta', label: 'Meta tag', icon: 'lucide:code' },
        { id: 'file', label: 'File', icon: 'lucide:file-text' },
      ],
    }
  },

  computed: {
    methodLabel() {
      return METHOD_LABELS[this.site?.verificationMethod] || ''
    },

    originChanged() {
      const typed = this.origin.trim()
      if (!typed) return false
      if (!this.site) return true
      // The server normalizes (scheme, case); compare loosely to enable the button
      return typed.replace(/^https?:\/\//i, '').toLowerCase() !== this.site.origin.replace(/^https:\/\//, '')
    },
  },

  watch: {
    'site.origin'(value) {
      this.origin = value || ''
    },
  },

  methods: {
    async saveOrigin() {
      if (!this.canManage || !this.originChanged) return
      this.saving = true
      this.saveError = null
      try {
        await $fetch(`/api/marketing/projects/${this.product.id}/site`, {
          method: 'PUT',
          body: { origin: this.origin },
        })
        this.$emit('changed')
        toast.success('Site saved')
      } catch (err) {
        this.saveError = err?.data?.error?.message || 'Failed to save the site'
      } finally {
        this.saving = false
      }
    },

    async verify() {
      this.verifying = true
      this.verifyError = null
      try {
        const response = await $fetch(`/api/marketing/projects/${this.product.id}/site/verify`, {
          method: 'POST',
          body: { method: this.method },
        })
        if (response?.data?.site?.verified) toast.success('Site verified')
        this.$emit('changed')
      } catch (err) {
        this.verifyError = err?.data?.error?.message || 'Verification failed'
      } finally {
        this.verifying = false
      }
    },
  },
}
</script>
