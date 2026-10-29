<template>
  <div class="space-y-6" data-testid="project-settings-email">
    <!-- Domains -->
    <SupportSendingDomains :project-id="project.id" @loaded="onDomainsLoaded" />

    <!-- Addresses -->
    <Card data-testid="mail-addresses">
      <CardHeader>
        <div class="flex items-start justify-between gap-3">
          <div>
            <CardTitle class="flex items-center gap-2">
              <Icon name="lucide:at-sign" class="h-5 w-5" />
              Addresses
            </CardTitle>
            <CardDescription>
              Email addresses on your domains. Mail sent to an address is delivered to an inbox.
              <span v-if="usageLine" class="whitespace-nowrap" data-testid="mail-addresses-usage">
                {{ usageLine }}
              </span>
            </CardDescription>
          </div>
          <Button
            v-if="canAdmin && inboxEnabled"
            size="sm"
            class="shrink-0"
            :disabled="isLoading || Boolean(error) || inboxes.length === 0"
            data-testid="mail-address-add"
            @click="openCreate"
          >
            <Icon name="lucide:plus" class="mr-1 h-4 w-4" />
            New address
          </Button>
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        <!-- Inbox tool is off -->
        <div
          v-if="!inboxEnabled"
          class="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted p-3 text-sm"
          data-testid="mail-addresses-inbox-off"
        >
          <p class="min-w-0 flex-1 text-muted-foreground">
            Addresses deliver to the Inbox, which is switched off for this project. Switch it on to create addresses and
            read their mail.
          </p>
          <Button
            v-if="canAdmin"
            size="sm"
            :disabled="isEnablingInbox"
            data-testid="mail-addresses-enable-inbox"
            @click="enableInbox"
          >
            <Icon v-if="isEnablingInbox" name="lucide:loader-2" class="mr-1.5 h-4 w-4 animate-spin" />
            Turn on Inbox
          </Button>
          <p v-else class="text-xs text-muted-foreground">Project admins can switch it on.</p>
        </div>

        <div v-if="isLoading" class="space-y-2" data-testid="mail-addresses-loading">
          <Skeleton v-for="i in 3" :key="i" class="h-11 w-full" />
        </div>

        <div v-else-if="error" class="text-sm" data-testid="mail-addresses-error">
          <p class="mb-2 text-destructive">{{ error }}</p>
          <Button variant="outline" size="sm" @click="load()">
            <Icon name="lucide:refresh-cw" class="mr-1.5 h-4 w-4" />
            Retry
          </Button>
        </div>

        <template v-else>
          <p
            v-if="inboxEnabled && !inboxesLoadFailed && inboxes.length === 0 && canAdmin"
            class="rounded-md bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
            data-testid="mail-addresses-no-inbox"
          >
            This project has no inbox yet. Create one in
            <NuxtLink to="/inbox/settings" class="underline">Inbox settings</NuxtLink>
            before adding addresses.
          </p>
          <p v-if="inboxesLoadFailed" class="text-sm text-destructive" data-testid="mail-addresses-inboxes-error">
            Could not load the project's inboxes.
            <Button variant="link" size="sm" class="h-auto p-0" @click="loadInboxes">Retry</Button>
          </p>

          <p v-if="addresses.length === 0" class="text-sm text-muted-foreground" data-testid="mail-addresses-empty">
            No addresses yet.
          </p>

          <div v-else class="overflow-x-auto rounded-lg border">
            <table class="w-full text-sm" data-testid="mail-addresses-table">
              <thead class="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th class="px-3 py-2 font-medium">Address</th>
                  <th class="px-3 py-2 font-medium">Delivers to</th>
                  <th v-if="showProducts" class="px-3 py-2 font-medium">Product</th>
                  <th class="px-3 py-2 font-medium">Status</th>
                  <th v-if="canAdmin" class="px-3 py-2"><span class="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody class="divide-y">
                <tr v-for="row in addresses" :key="row.id" data-testid="mail-address-row" :data-address="row.address">
                  <td class="px-3 py-2.5">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="break-all font-mono text-[13px]">{{ row.address }}</span>
                      <Badge v-if="row.isCatchAll" variant="secondary" class="text-xs">Catch-all</Badge>
                    </div>
                  </td>
                  <td class="whitespace-nowrap px-3 py-2.5">
                    {{ row.inboxName }}
                    <span class="text-muted-foreground">· {{ row.behaviour }}</span>
                  </td>
                  <td v-if="showProducts" class="px-3 py-2.5">
                    <span v-if="row.productName">{{ row.productName }}</span>
                    <span v-else class="text-muted-foreground">—</span>
                  </td>
                  <td class="px-3 py-2.5">
                    <div class="flex flex-wrap items-center gap-1.5">
                      <span
                        class="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium"
                        :class="statusMeta(row).classes"
                        data-testid="mail-address-status"
                      >
                        <Icon :name="statusMeta(row).icon" class="h-3 w-3" />
                        {{ statusMeta(row).label }}
                      </span>
                      <Badge v-if="row.isPrimary" variant="outline" class="text-xs">Primary</Badge>
                    </div>
                  </td>
                  <td v-if="canAdmin" class="px-3 py-2.5">
                    <div v-if="row.kind !== 'platform'" class="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        :disabled="!inboxEnabled"
                        :aria-label="`Edit ${row.address}`"
                        data-testid="mail-address-edit"
                        @click="openEdit(row)"
                      >
                        <Icon name="lucide:pencil" class="mr-1 h-3.5 w-3.5" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="h-8 w-8 text-destructive hover:text-destructive"
                        :aria-label="`Delete ${row.address}`"
                        title="Delete"
                        data-testid="mail-address-delete"
                        @click="openDelete(row)"
                      >
                        <Icon name="lucide:trash-2" class="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </CardContent>
    </Card>

    <MailAddressDialog
      v-model:open="isEditorOpen"
      :address="editing"
      :domains="domains"
      :inboxes="inboxes"
      :products="products"
      @saved="load({ silent: true })"
    />

    <!-- Delete confirmation -->
    <Dialog :open="isDeleteOpen" @update:open="onDeleteToggle">
      <DialogContent class="sm:max-w-[440px]" data-testid="mail-address-delete-dialog">
        <DialogHeader>
          <DialogTitle>Delete {{ deleteTarget?.address }}</DialogTitle>
          <DialogDescription>
            Mail sent to this address will no longer reach
            {{ deleteTarget?.inboxName ? `the "${deleteTarget.inboxName}" inbox` : 'the inbox' }}. Existing
            conversations are kept.
          </DialogDescription>
        </DialogHeader>
        <p v-if="deleteError" class="text-sm text-destructive" role="alert">{{ deleteError }}</p>
        <DialogFooter>
          <Button variant="outline" :disabled="isDeleting" @click="onDeleteToggle(false)">Cancel</Button>
          <Button
            variant="destructive"
            :disabled="isDeleting"
            data-testid="mail-address-delete-confirm"
            @click="confirmDelete"
          >
            <Icon v-if="isDeleting" name="lucide:loader-2" class="mr-2 h-4 w-4 animate-spin" />
            Delete address
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'
import { resolveProjectModules } from '~/lib/modules'

const STATUS_META = {
  active: {
    label: 'Active',
    icon: 'lucide:check-circle-2',
    classes: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
  failed: { label: 'Route failed', icon: 'lucide:x-circle', classes: 'bg-destructive/10 text-destructive' },
  forwarded: { label: 'Forwarded in', icon: 'lucide:corner-down-right', classes: 'bg-muted text-muted-foreground' },
}

export default {
  name: 'ProjectSettingsEmail',

  props: {
    project: { type: Object, required: true },
    products: { type: Array, default: () => [] },
  },

  emits: ['updated'],

  data() {
    return {
      addresses: [],
      usage: null,
      isLoading: true,
      error: null,
      inboxes: [],
      inboxesLoadFailed: false,
      /** Domains from the SupportSendingDomains list (already filtered to the project). */
      domainsInfo: null,
      requestToken: 0,
      isUnmounted: false,

      isEditorOpen: false,
      editing: null,

      isDeleteOpen: false,
      deleteTarget: null,
      deleteError: '',
      isDeleting: false,

      isEnablingInbox: false,
    }
  },

  computed: {
    canAdmin() {
      return this.project?.role === 'admin'
    },
    inboxEnabled() {
      return resolveProjectModules(this.project?.settings).supportEnabled === true
    },
    showProducts() {
      return this.products.length > 1
    },
    domains() {
      return this.domainsInfo?.domains || []
    },
    usageLine() {
      const used = this.usage?.used?.addresses
      const limit = this.usage?.limits?.addresses
      if (typeof used !== 'number' || typeof limit !== 'number') return ''
      return `${used} of ${limit} addresses in this workspace.`
    },
  },

  watch: {
    'project.id'() {
      this.addresses = []
      this.usage = null
      this.inboxes = []
      this.domainsInfo = null
      this.load()
      this.loadInboxes()
    },
    inboxEnabled() {
      this.loadInboxes()
    },
  },

  mounted() {
    this.load()
    this.loadInboxes()
  },

  beforeUnmount() {
    this.isUnmounted = true
    this.requestToken += 1
  },

  methods: {
    errorMessage(err, fallback) {
      return err?.data?.data?.error?.message || err?.data?.error?.message || err?.statusMessage || fallback
    },

    statusMeta(row) {
      if (row.routeStatus === 'active') return STATUS_META.active
      if (row.routeStatus === 'failed') return STATUS_META.failed
      return STATUS_META.forwarded
    },

    onDomainsLoaded(info, projectId) {
      if (projectId && projectId !== this.project.id) return
      this.domainsInfo = info
    },

    async load({ silent = false } = {}) {
      const token = ++this.requestToken
      const slug = this.project.slug
      if (!silent) {
        this.isLoading = true
        this.error = null
      }
      try {
        const response = await $fetch(`/api/projects/${encodeURIComponent(slug)}/mail/addresses`)
        if (this.isUnmounted || token !== this.requestToken) return
        const data = response?.data || response
        this.addresses = data?.addresses || []
        this.usage = data?.usage || null
        this.error = null
      } catch (err) {
        if (this.isUnmounted || token !== this.requestToken) return
        if (!silent) this.error = this.errorMessage(err, 'Failed to load addresses')
        else toast.error(this.errorMessage(err, 'Failed to refresh addresses'))
      } finally {
        if (!this.isUnmounted && token === this.requestToken) this.isLoading = false
      }
    },

    async loadInboxes() {
      this.inboxesLoadFailed = false
      if (!this.inboxEnabled) {
        this.inboxes = []
        return
      }
      const projectId = this.project.id
      try {
        const response = await $fetch('/api/support/inboxes', { params: { projectId } })
        if (this.isUnmounted || projectId !== this.project.id) return
        this.inboxes = response?.data?.inboxes || []
      } catch {
        if (this.isUnmounted || projectId !== this.project.id) return
        this.inboxes = []
        this.inboxesLoadFailed = true
      }
    },

    openCreate() {
      this.editing = null
      this.isEditorOpen = true
    },

    openEdit(row) {
      this.editing = row
      this.isEditorOpen = true
    },

    openDelete(row) {
      this.deleteTarget = row
      this.deleteError = ''
      this.isDeleteOpen = true
    },

    onDeleteToggle(open) {
      if (!open && this.isDeleting) return
      this.isDeleteOpen = open
    },

    async confirmDelete() {
      const row = this.deleteTarget
      if (!row || this.isDeleting) return
      this.isDeleting = true
      this.deleteError = ''
      try {
        await $fetch(
          `/api/support/inboxes/${encodeURIComponent(row.inboxId)}/addresses/${encodeURIComponent(row.id)}`,
          {
            method: 'DELETE',
          }
        )
        toast.success(`Deleted ${row.address}`)
        this.isDeleteOpen = false
        await this.load({ silent: true })
      } catch (err) {
        this.deleteError = this.errorMessage(err, 'Could not delete this address')
      } finally {
        this.isDeleting = false
      }
    },

    /** Same call as the Tools tab: PUT the merged project settings. */
    async enableInbox() {
      if (this.isEnablingInbox) return
      this.isEnablingInbox = true
      try {
        const response = await $fetch(`/api/projects/${encodeURIComponent(this.project.slug)}`, {
          method: 'PUT',
          body: { settings: { ...this.project.settings, supportEnabled: true } },
        })
        this.$emit('updated', response?.data || response)
        if (import.meta.client) window.dispatchEvent(new CustomEvent('veerify:project-modules-changed'))
        toast.success('Inbox is on')
      } catch (err) {
        toast.error(this.errorMessage(err, 'Failed to switch on the Inbox'))
      } finally {
        this.isEnablingInbox = false
      }
    },
  },
}
</script>
