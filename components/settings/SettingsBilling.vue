<template>
  <div data-testid="settings-billing-panel" class="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle>Billing</CardTitle>
        <CardDescription>Manage your subscription and billing information.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-6">
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div class="flex items-center justify-between gap-4">
            <div>
              <h3 class="font-medium text-blue-900">Professional Plan</h3>
              <p class="text-sm text-blue-700">$29/month - Billed monthly</p>
            </div>
            <button class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">Manage Subscription</button>
          </div>
        </div>

        <div>
          <h3 class="font-medium mb-3">Payment Method</h3>
          <div class="flex items-center justify-between p-4 border rounded-lg">
            <div class="flex items-center space-x-3">
              <div class="w-8 h-6 bg-blue-600 rounded flex items-center justify-center">
                <span class="text-white text-xs font-bold">VISA</span>
              </div>
              <span>•••• •••• •••• 4242</span>
            </div>
            <button class="text-blue-600 hover:text-blue-700">Change</button>
          </div>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Billing Contacts</CardTitle>
        <CardDescription>Add additional emails that should receive billing receipts and invoices in copy.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div v-if="isLoading" class="space-y-2">
          <Skeleton class="h-10 w-full" />
          <Skeleton class="h-10 w-full" />
        </div>

        <template v-else>
          <div v-if="billingCcEmails.length" class="flex flex-wrap gap-2" data-testid="billing-contacts-list">
            <Badge
              v-for="email in billingCcEmails"
              :key="email"
              variant="secondary"
              class="flex items-center gap-1 pr-1"
              data-testid="billing-contact-item"
            >
              <span>{{ email }}</span>
              <button
                type="button"
                class="inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                @click="removeContactEmail(email)"
              >
                <Icon name="lucide:x" class="h-3 w-3" />
              </button>
            </Badge>
          </div>
          <p v-else class="text-sm text-muted-foreground" data-testid="billing-contacts-empty">
            No additional billing contacts configured.
          </p>

          <div class="flex flex-col gap-2 sm:flex-row">
            <Input
              id="billing-contacts-input"
              v-model="newContactEmail"
              data-testid="billing-contacts-input"
              type="email"
              placeholder="finance@example.com"
              @keydown.enter.prevent="addContactEmail"
            />
            <Button
              type="button"
              data-testid="billing-contacts-add"
              variant="outline"
              :disabled="!canAddContact"
              @click="addContactEmail"
            >
              Add Contact
            </Button>
          </div>

          <p v-if="newContactEmail && !isValidNewEmail" class="text-xs text-destructive">
            Enter a valid email address.
          </p>
          <p v-else-if="isDuplicateNewEmail" class="text-xs text-destructive">
            This contact email is already added.
          </p>

          <div class="flex justify-end">
            <Button
              type="button"
              data-testid="billing-contacts-save"
              :disabled="isSaving || !hasChanges || !organizationSlug"
              @click="saveBillingContacts"
            >
              <Icon v-if="isSaving" name="lucide:loader-2" class="h-4 w-4 mr-2 animate-spin" />
              Save Contacts
            </Button>
          </div>
        </template>
      </CardContent>
    </Card>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'

export default {
  name: 'SettingsBilling',
  data() {
    return {
      organizationSlug: '',
      billingCcEmails: [],
      originalBillingCcEmails: [],
      newContactEmail: '',
      isLoading: true,
      isSaving: false,
    }
  },
  computed: {
    normalizedNewEmail() {
      return this.newContactEmail.trim().toLowerCase()
    },
    isValidNewEmail() {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.normalizedNewEmail)
    },
    isDuplicateNewEmail() {
      return this.billingCcEmails.includes(this.normalizedNewEmail)
    },
    canAddContact() {
      return this.isValidNewEmail && !this.isDuplicateNewEmail && this.billingCcEmails.length < 10
    },
    hasChanges() {
      return JSON.stringify(this.billingCcEmails) !== JSON.stringify(this.originalBillingCcEmails)
    },
  },
  async mounted() {
    await this.loadBillingContacts()
  },
  methods: {
    async loadBillingContacts() {
      this.isLoading = true
      try {
        const activeOrg = await $fetch('/api/auth/organization/get-full-organization').catch(() => null)
        let slug = activeOrg?.slug || ''

        if (!slug && activeOrg?.id) {
          const listedOrgs = await $fetch('/api/auth/organization/list').catch(() => null)
          const organizations = Array.isArray(listedOrgs) ? listedOrgs : listedOrgs?.data || []
          const matched = organizations.find((org) => org.id === activeOrg.id)
          slug = matched?.slug || ''
        }

        if (!slug) return

        this.organizationSlug = slug
        const response = await $fetch(`/api/orgs/${slug}`).catch(() => null)
        const savedEmails = response?.data?.settings?.billingCcEmails
        const normalized = Array.isArray(savedEmails)
          ? Array.from(
              new Set(
                savedEmails
                  .filter((email) => typeof email === 'string')
                  .map((email) => email.trim().toLowerCase())
                  .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
              )
            )
          : []

        this.billingCcEmails = normalized
        this.originalBillingCcEmails = [...normalized]
      } catch (error) {
        console.error('Failed to load billing contacts:', error)
        toast.error('Failed to load billing contacts')
      } finally {
        this.isLoading = false
      }
    },
    addContactEmail() {
      if (!this.canAddContact) return
      this.billingCcEmails = [...this.billingCcEmails, this.normalizedNewEmail]
      this.newContactEmail = ''
    },
    removeContactEmail(email) {
      this.billingCcEmails = this.billingCcEmails.filter((item) => item !== email)
    },
    async saveBillingContacts() {
      if (!this.organizationSlug || !this.hasChanges) return

      this.isSaving = true
      try {
        await $fetch(`/api/orgs/${this.organizationSlug}`, {
          method: 'PUT',
          body: {
            settings: {
              billingCcEmails: this.billingCcEmails,
            },
          },
        })

        this.originalBillingCcEmails = [...this.billingCcEmails]
        toast.success('Billing contacts updated')
      } catch (error) {
        console.error('Failed to save billing contacts:', error)
        toast.error('Failed to save billing contacts')
      } finally {
        this.isSaving = false
      }
    },
  },
}
</script>
