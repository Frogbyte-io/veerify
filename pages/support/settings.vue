<template>
  <NuxtLayout name="dashboard">
    <div class="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 class="text-3xl font-bold tracking-tight text-foreground">Support settings</h1>
        <p class="text-muted-foreground mt-1">Configure your team's shared inbox</p>
      </div>

      <div
        v-if="inboxAccessError"
        data-testid="support-inbox-access-error"
        class="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        role="alert"
      >
        {{ inboxAccessError }}
      </div>

      <!-- Loading -->
      <div v-if="isLoading" class="space-y-6">
        <Skeleton class="h-10 w-full" />
        <Skeleton class="h-48 w-full" />
        <Skeleton class="h-48 w-full" />
        <Skeleton class="h-48 w-full" />
      </div>

      <!-- Error -->
      <Card v-else-if="error">
        <CardContent class="text-center py-8">
          <Icon name="lucide:alert-circle" class="w-8 h-8 text-destructive mx-auto mb-3" />
          <p class="font-medium mb-2">Failed to load support settings</p>
          <p class="text-sm text-muted-foreground mb-4">{{ error }}</p>
          <Button variant="outline" @click="initPage">
            <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
            Try again
          </Button>
        </CardContent>
      </Card>

      <!-- No inbox yet -->
      <Card v-else-if="!hasInboxes && canManageTeamSupport">
        <CardHeader>
          <CardTitle>Create your support inbox</CardTitle>
          <CardDescription>
            Your team doesn't have a support inbox yet. Create one to start receiving and managing customer
            conversations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <Label for="new-inbox-name">Name</Label>
              <Input
                id="new-inbox-name"
                v-model="newInboxName"
                placeholder="e.g. Customer Support"
                class="mt-2"
                :disabled="isCreatingInbox"
                @input="onNewInboxNameInput"
              />
            </div>
            <div>
              <Label for="new-inbox-slug">Slug</Label>
              <Input
                id="new-inbox-slug"
                v-model="newInboxSlug"
                placeholder="customer-support"
                class="mt-2"
                :disabled="isCreatingInbox"
                @input="onNewInboxSlugInput"
              />
            </div>
          </div>
          <div class="flex justify-end mt-4">
            <Button :disabled="isCreatingInbox || !newInboxName.trim() || !newInboxSlug.trim()" @click="createInbox">
              <Icon v-if="isCreatingInbox" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
              Create inbox
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card v-else-if="!hasInboxes" data-testid="support-no-assignment">
        <CardHeader>
          <CardTitle>No support inboxes are assigned to you.</CardTitle>
          <CardDescription>Ask a support administrator to add you to an inbox.</CardDescription>
        </CardHeader>
      </Card>

      <Card v-else-if="!selectedInboxId" data-testid="support-no-assignment">
        <CardHeader>
          <CardTitle>No support inboxes are assigned to you.</CardTitle>
          <CardDescription>Ask a support administrator to add you to an inbox.</CardDescription>
        </CardHeader>
      </Card>

      <template v-else>
        <Card v-if="canManageTeamSupport" data-testid="support-team-policy">
          <CardHeader>
            <CardTitle>Team support policy</CardTitle>
            <CardDescription>Controls how signed-in customer feedback is linked to support contacts.</CardDescription>
          </CardHeader>
          <CardContent>
            <div class="flex items-center justify-between gap-4 rounded-lg border p-4">
              <Label for="support-team-policy-toggle" class="text-sm font-medium">
                Automatically link signed-in customer feedback
              </Label>
              <Switch
                id="support-team-policy-toggle"
                v-model="autoLinkFeedback"
                data-testid="support-team-policy-toggle"
                :disabled="isSavingTeamPolicy"
                @update:model-value="saveTeamPolicy"
              />
            </div>
          </CardContent>
        </Card>

        <!-- Inbox settings -->
        <template v-if="hasInboxes">
          <div v-if="inboxes.length > 1" class="flex items-center gap-3">
            <Label for="inbox-switcher" class="shrink-0">Inbox</Label>
            <select
              id="inbox-switcher"
              v-model="selectedInboxId"
              :class="selectClasses + ' max-w-xs'"
              @change="handleInboxSwitch"
            >
              <option v-for="inbox in inboxes" :key="inbox.id" :value="inbox.id">{{ inbox.name }}</option>
            </select>
          </div>

          <!-- General -->
          <Card>
            <CardHeader>
              <CardTitle>General</CardTitle>
              <CardDescription>Basic identity for this inbox.</CardDescription>
            </CardHeader>
            <CardContent class="space-y-4">
              <div>
                <Label for="general-name">Name</Label>
                <Input
                  id="general-name"
                  v-model="generalName"
                  class="mt-2"
                  :disabled="isSavingGeneral || !canManageInbox"
                  :readonly="!canManageInbox"
                />
              </div>
              <div class="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label for="general-from-address">From address</Label>
                  <Input
                    id="general-from-address"
                    v-model="generalEmailAddress"
                    type="email"
                    placeholder="support@yourdomain.com"
                    class="mt-2"
                    :disabled="isSavingGeneral || !canManageInbox"
                    :readonly="!canManageInbox"
                  />
                  <p class="text-sm text-muted-foreground mt-1">Used as the From on outgoing replies.</p>
                </div>
                <div>
                  <Label for="general-from-name">From name</Label>
                  <Input
                    id="general-from-name"
                    v-model="generalFromName"
                    placeholder="Acme Support"
                    class="mt-2"
                    :disabled="isSavingGeneral || !canManageInbox"
                    :readonly="!canManageInbox"
                  />
                </div>
              </div>

              <div v-if="isLoadingSendingStatus" class="space-y-2">
                <Skeleton class="h-10 w-full" />
              </div>
              <div v-else-if="sendingStatusError" class="text-sm">
                <p class="text-destructive mb-2">{{ sendingStatusError }}</p>
                <Button variant="outline" size="sm" @click="loadSendingStatus">Retry</Button>
              </div>
              <template v-else-if="sendingStatus">
                <p v-if="!sendingStatus.address" class="text-sm text-muted-foreground">
                  Set a From address above to have it checked against your provider.
                </p>
                <div
                  v-else-if="sendingStatus.authorization.status === 'unauthorized'"
                  class="flex items-start gap-2 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 p-3 text-sm"
                  data-testid="support-settings-sending-unauthorized"
                >
                  <Icon name="lucide:alert-triangle" class="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    "{{ sendingStatus.address }}" is not on a domain your provider is verified to send from. Replies
                    sent as this address may be rejected. Verify the domain with your provider, or use an address on a
                    verified domain.
                  </span>
                </div>
                <div
                  v-else-if="sendingStatus.authorization.status === 'authorized'"
                  class="flex items-center gap-2 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 p-3 text-sm"
                  data-testid="support-settings-sending-authorized"
                >
                  <Icon name="lucide:check-circle-2" class="w-4 h-4 shrink-0" />
                  <span>Your provider is verified to send as "{{ sendingStatus.address }}".</span>
                </div>
                <div
                  v-else
                  class="flex items-start gap-2 rounded-md bg-muted p-3 text-sm text-muted-foreground"
                  data-testid="support-settings-sending-unknown"
                >
                  <Icon name="lucide:help-circle" class="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    Cannot verify whether "{{ sendingStatus.address }}" is authorized to send ({{
                      sendingStatus.authorization.reason
                    }}). This is not a failure — most deployments have not set a provider account credential yet.
                  </span>
                </div>
              </template>

              <div>
                <Label for="general-signature">Signature</Label>
                <Textarea
                  id="general-signature"
                  v-model="generalSignature"
                  rows="5"
                  class="mt-2"
                  :disabled="isSavingGeneral || !canManageInbox"
                  :readonly="!canManageInbox"
                />
                <p class="text-sm text-muted-foreground mt-1">Appended to outgoing replies.</p>
              </div>
              <div v-if="canManageInbox" class="flex justify-end">
                <Button
                  data-testid="support-inbox-settings-save"
                  :disabled="isSavingGeneral || !generalHasChanges"
                  @click="saveGeneral"
                >
                  <Icon v-if="isSavingGeneral" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
                  Save changes
                </Button>
              </div>
            </CardContent>
          </Card>

          <!-- Channel (SUP-03-13) -->
          <Card data-testid="support-settings-channel">
            <CardHeader>
              <CardTitle>Channel</CardTitle>
              <CardDescription>
                How inbound mail reaches this inbox. The provider and its webhook credentials are set once per
                deployment as environment variables, not here — so this shows what is configured rather than editing it.
              </CardDescription>
            </CardHeader>
            <CardContent class="space-y-4">
              <div v-if="isLoadingChannel" class="space-y-2">
                <Skeleton v-for="i in 3" :key="i" class="h-10 w-full" />
              </div>

              <div v-else-if="channelError" class="text-sm">
                <p class="text-destructive mb-2">Could not load channel status</p>
                <Button variant="outline" size="sm" @click="loadChannelStatus">Retry</Button>
              </div>

              <template v-else-if="channel">
                <div class="flex items-center gap-2">
                  <span
                    class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium"
                    :class="
                      channelReady
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                        : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                    "
                    data-testid="support-settings-channel-state"
                  >
                    <Icon
                      :name="channelReady ? 'lucide:check-circle-2' : 'lucide:alert-triangle'"
                      class="w-3.5 h-3.5"
                    />
                    {{ channelReady ? 'Ready to receive' : 'Not receiving mail' }}
                  </span>
                  <span class="text-sm text-muted-foreground"
                    >Provider: <strong>{{ channel.provider }}</strong></span
                  >
                </div>

                <p v-if="!channel.driverAvailable" class="text-sm text-muted-foreground">
                  <code>SUPPORT_CHANNEL_PROVIDER</code> is set to <code>{{ channel.provider }}</code
                  >, which is not one of {{ channel.supportedProviders.join(', ') }}. Inbound mail is rejected until it
                  names a supported provider.
                </p>

                <div v-else-if="channel.missingEnvVars.length > 0" class="text-sm text-muted-foreground">
                  <p class="mb-1">
                    Credentials are missing, so inbound mail is rejected. An unset credential never means “accept
                    anything”. Set these and restart:
                  </p>
                  <ul class="list-disc pl-5 space-y-0.5">
                    <li v-for="name in channel.missingEnvVars" :key="name">
                      <code>{{ name }}</code>
                    </li>
                  </ul>
                </div>

                <div class="space-y-1">
                  <Label>Webhook URL to register with {{ channel.provider }}</Label>
                  <div class="flex items-center gap-2">
                    <Input :model-value="webhookUrl" readonly data-testid="support-settings-channel-webhook" />
                    <Button variant="outline" size="sm" @click="copy(webhookUrl)">Copy</Button>
                  </div>
                </div>

                <div v-if="primaryAddress" class="space-y-1">
                  <Label>Forward mail to</Label>
                  <div class="flex items-center gap-2">
                    <Input :model-value="primaryAddress" readonly data-testid="support-settings-channel-forward" />
                    <Button variant="outline" size="sm" @click="copy(primaryAddress)">Copy</Button>
                  </div>
                  <p class="text-xs text-muted-foreground">
                    Point an MX record or a forwarding rule at this address. Add more addresses below to route different
                    products into this inbox.
                  </p>
                </div>
                <p v-else class="text-sm text-muted-foreground">
                  Add a receiving address below before pointing mail at this inbox.
                </p>
              </template>
            </CardContent>
          </Card>

          <!-- Agents -->
          <Card>
            <CardHeader>
              <CardTitle>Agents</CardTitle>
              <CardDescription>
                People who can work this inbox. Inbox access is separate from team membership — a team member does not
                automatically get access to this inbox.
              </CardDescription>
            </CardHeader>
            <CardContent class="space-y-4">
              <div v-if="isSwitchingInbox" class="space-y-2">
                <Skeleton v-for="i in 2" :key="i" class="h-14 w-full" />
              </div>
              <div v-else>
                <p v-if="members.length === 0" class="text-sm text-muted-foreground">
                  No agents have access to this inbox yet.
                </p>
                <div v-else class="space-y-2">
                  <div
                    v-for="member in members"
                    :key="member.id"
                    data-testid="support-inbox-member-row"
                    class="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div class="flex items-center gap-3 min-w-0">
                      <Avatar class="h-9 w-9 shrink-0">
                        <AvatarFallback>{{ initials(member.userName || member.userEmail) }}</AvatarFallback>
                      </Avatar>
                      <div class="min-w-0">
                        <p class="font-medium truncate">{{ member.userName || member.userEmail }}</p>
                        <p class="text-sm text-muted-foreground truncate">{{ member.userEmail }}</p>
                      </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0 ml-4">
                      <Badge variant="outline">{{ member.role }}</Badge>
                      <Button
                        v-if="canManageMembers"
                        data-testid="support-remove-inbox-member"
                        :aria-label="
                          'Remove inbox member ' +
                          (member.userName || member.userEmail) +
                          (member.userName && member.userEmail ? ' (' + member.userEmail + ')' : '')
                        "
                        variant="ghost"
                        size="icon"
                        :disabled="removingMemberId === member.id"
                        @click="openRemoveMemberDialog(member)"
                      >
                        <Icon name="lucide:x" class="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <Separator />

              <p v-if="!isSwitchingInbox && availableTeamMembers.length === 0" class="text-sm text-muted-foreground">
                Every team member already has access to this inbox.
              </p>
              <div
                v-else-if="!isSwitchingInbox && canManageMembers"
                class="flex flex-col sm:flex-row gap-2 sm:items-end"
              >
                <div class="flex-1">
                  <Label for="new-member-select">Team member</Label>
                  <select id="new-member-select" v-model="newMemberUserId" :class="selectClasses + ' mt-2'">
                    <option value="" disabled>Select a team member</option>
                    <option v-for="tm in availableTeamMembers" :key="tm.id" :value="tm.userId">
                      {{ tm.userName || tm.userEmail }}
                    </option>
                  </select>
                </div>
                <div>
                  <Label for="new-member-role">Role</Label>
                  <select id="new-member-role" v-model="newMemberRole" :class="selectClasses + ' mt-2'">
                    <option value="agent">Agent</option>
                    <option value="supervisor">Supervisor</option>
                    <option value="admin">Admin</option>
                  </select>
                  <p class="mt-1 text-xs text-muted-foreground">{{ roleDescriptions[newMemberRole] }}</p>
                </div>
                <Button
                  data-testid="support-add-inbox-member"
                  :disabled="isAddingMember || !newMemberUserId"
                  @click="addMember"
                >
                  <Icon v-if="isAddingMember" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
                  Add inbox member
                </Button>
              </div>
            </CardContent>
          </Card>

          <!-- Receiving addresses -->
          <Card>
            <CardHeader>
              <CardTitle>Receiving addresses</CardTitle>
              <CardDescription>
                An inbound email carries no product signal of its own — the address it arrived at is what attributes it
                to a product. Setting a new primary address clears the previous one.
              </CardDescription>
            </CardHeader>
            <CardContent class="space-y-4">
              <div v-if="isSwitchingInbox" class="space-y-2">
                <Skeleton v-for="i in 2" :key="i" class="h-14 w-full" />
              </div>
              <div v-else>
                <p v-if="addresses.length === 0" class="text-sm text-muted-foreground">
                  No receiving addresses configured yet.
                </p>
                <div v-else class="space-y-2">
                  <div
                    v-for="address in addresses"
                    :key="address.id"
                    class="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="font-mono text-sm truncate">{{ address.address }}</span>
                        <Badge v-if="address.isPrimary" variant="outline" class="text-xs">Primary</Badge>
                      </div>
                      <p class="text-sm mt-0.5">
                        <span v-if="productName(address.projectId)">{{ productName(address.projectId) }}</span>
                        <span v-else class="text-muted-foreground">Unattributed</span>
                      </p>
                    </div>
                    <Button
                      v-if="canManageInbox"
                      variant="ghost"
                      size="icon"
                      class="shrink-0 ml-4"
                      :aria-label="`Remove receiving address ${address.address}`"
                      :disabled="removingAddressId === address.id"
                      @click="openRemoveAddressDialog(address)"
                    >
                      <Icon name="lucide:x" class="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <Separator />

              <div v-if="!isSwitchingInbox && canManageInbox" class="space-y-3">
                <div class="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label for="new-address">Email address</Label>
                    <Input
                      id="new-address"
                      v-model="newAddress"
                      type="email"
                      placeholder="support@yourdomain.com"
                      class="mt-2"
                      :disabled="isAddingAddress"
                    />
                  </div>
                  <div>
                    <Label for="new-address-project">Product</Label>
                    <select id="new-address-project" v-model="newAddressProjectId" :class="selectClasses + ' mt-2'">
                      <option value="">Unattributed</option>
                      <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
                    </select>
                  </div>
                </div>
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <Switch id="new-address-primary" v-model="newAddressIsPrimary" :disabled="isAddingAddress" />
                    <Label for="new-address-primary">Primary sending address</Label>
                  </div>
                  <Button
                    data-testid="support-address-add"
                    :disabled="isAddingAddress || !newAddress.trim()"
                    @click="addAddress"
                  >
                    <Icon v-if="isAddingAddress" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
                    Add address
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </template>
      </template>

      <!-- Remove member confirmation -->
      <Dialog :open="isRemoveMemberDialogOpen" @update:open="isRemoveMemberDialogOpen = $event">
        <DialogContent class="sm:max-w-[420px]" data-testid="support-remove-member-dialog">
          <DialogHeader>
            <DialogTitle>Remove agent</DialogTitle>
            <DialogDescription v-if="isSelfRemoval">
              You are removing your own access. You will lose access to this inbox immediately; a team admin can add you
              back later.
            </DialogDescription>
            <DialogDescription v-else>
              Are you sure you want to remove "{{ memberPendingRemoval?.userName || memberPendingRemoval?.userEmail }}"
              from this inbox? They will lose access to its conversations.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" @click="isRemoveMemberDialogOpen = false">Cancel</Button>
            <Button
              variant="destructive"
              :disabled="removingMemberId === memberPendingRemoval?.id"
              @click="confirmRemoveMember"
            >
              <Icon
                v-if="removingMemberId === memberPendingRemoval?.id"
                name="lucide:loader-2"
                class="w-4 h-4 mr-2 animate-spin"
              />
              Remove member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <!-- Remove address confirmation -->
      <Dialog :open="isRemoveAddressDialogOpen" @update:open="isRemoveAddressDialogOpen = $event">
        <DialogContent class="sm:max-w-[420px]" data-testid="support-remove-address-dialog">
          <DialogHeader>
            <DialogTitle>Remove address</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove "{{ addressPendingRemoval?.address }}"? Mail sent to this address will no
              longer reach this inbox.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" @click="isRemoveAddressDialogOpen = false"> Cancel </Button>
            <Button
              variant="destructive"
              :disabled="removingAddressId === addressPendingRemoval?.id"
              @click="confirmRemoveAddress"
            >
              <Icon
                v-if="removingAddressId === addressPendingRemoval?.id"
                name="lucide:loader-2"
                class="w-4 h-4 mr-2 animate-spin"
              />
              Remove address
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  </NuxtLayout>
</template>

<script>
import { toast } from 'vue-sonner'

const ACTIVE_TEAM_CHANGED_EVENT = 'veerify:active-team-changed'

export default {
  name: 'SupportSettingsPage',

  data() {
    return {
      activeTeamId: '',
      inboxes: [],
      selectedInboxId: '',
      members: [],
      addresses: [],
      teamMembers: [],
      projects: [],
      teamSettings: null,
      teamSettingsCapabilities: {},
      autoLinkFeedback: false,
      currentUserId: '',
      inboxAccessError: null,
      requestToken: 0,
      isRecoveringInbox: false,

      isLoading: true,
      error: null,
      isSwitchingInbox: false,
      isSavingTeamPolicy: false,

      roleDescriptions: {
        agent: 'Works conversations and applies existing tags.',
        supervisor: 'Also manages the shared tag list.',
        admin: 'Also manages inbox settings and members.',
      },

      // native <select> styling shared across the pickers on this page —
      // there is no shadcn Select component available in this worktree yet.
      selectClasses:
        'flex h-10 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none transition-all duration-200 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',

      // create-inbox form (empty state)
      newInboxName: '',
      newInboxSlug: '',
      slugManuallyEdited: false,
      isCreatingInbox: false,

      // general form
      generalName: '',
      generalSignature: '',
      generalEmailAddress: '',
      generalFromName: '',
      isSavingGeneral: false,

      // sending authorization (SUP-04-6)
      sendingStatus: null,
      isLoadingSendingStatus: true,
      sendingStatusError: null,

      // channel
      channel: null,
      isLoadingChannel: true,
      channelError: null,

      // agents
      newMemberUserId: '',
      newMemberRole: 'agent',
      isAddingMember: false,
      removingMemberId: null,
      memberPendingRemoval: null,
      isRemoveMemberDialogOpen: false,

      // receiving addresses
      newAddress: '',
      newAddressProjectId: '',
      newAddressIsPrimary: false,
      isAddingAddress: false,
      removingAddressId: null,
      addressPendingRemoval: null,
      isRemoveAddressDialogOpen: false,
    }
  },

  computed: {
    hasInboxes() {
      return this.inboxes.length > 0
    },

    selectedInbox() {
      return this.inboxes.find((inbox) => inbox.id === this.selectedInboxId) || null
    },

    selectedCapabilities() {
      return this.selectedInbox?.capabilities || {}
    },

    canManageInbox() {
      return this.selectedCapabilities.canManageInbox === true
    },

    canManageMembers() {
      return this.selectedCapabilities.canManageMembers === true
    },

    canManageTeamSupport() {
      return this.teamSettingsCapabilities.canManageTeamSupport === true
    },

    isSelfRemoval() {
      return this.memberPendingRemoval?.userId === this.currentUserId
    },

    availableTeamMembers() {
      const memberUserIds = new Set(this.members.map((m) => m.userId))
      return this.teamMembers.filter((tm) => !memberUserIds.has(tm.userId))
    },

    generalHasChanges() {
      if (!this.selectedInbox) return false
      return (
        this.generalName !== (this.selectedInbox.name || '') ||
        this.generalSignature !== (this.selectedInbox.signature || '') ||
        this.generalEmailAddress !== (this.selectedInbox.emailAddress || '') ||
        this.generalFromName !== (this.selectedInbox.fromName || '')
      )
    },
    channelReady() {
      return Boolean(this.channel?.driverAvailable && this.channel?.credentialsConfigured)
    },

    webhookUrl() {
      if (!this.channel || !import.meta.client) return ''
      return `${window.location.origin}${this.channel.inboundPath}`
    },

    /**
     * The address a provider or MX record should point at. Prefers the one
     * flagged primary, since that is the inbox's canonical receiving address.
     */
    primaryAddress() {
      const list = this.addresses || []
      return (list.find((a) => a.isPrimary) || list[0])?.address || ''
    },
  },

  async mounted() {
    await this.initPage()
    if (import.meta.client) {
      window.addEventListener(ACTIVE_TEAM_CHANGED_EVENT, this.handleActiveTeamChanged)
    }
  },

  beforeUnmount() {
    if (import.meta.client) {
      window.removeEventListener(ACTIVE_TEAM_CHANGED_EVENT, this.handleActiveTeamChanged)
    }
  },

  methods: {
    async handleActiveTeamChanged() {
      await this.initPage()
    },

    async initPage() {
      const token = ++this.requestToken
      this.isLoading = true
      this.error = null
      this.inboxAccessError = null
      this.clearInboxScopedState()

      try {
        const [teamResponse, sessionResponse] = await Promise.all([
          $fetch('/api/teams/active'),
          $fetch('/api/auth/session'),
        ])
        const activeTeamData = teamResponse?.data
        if (token !== this.requestToken) return
        this.currentUserId = sessionResponse?.data?.user?.id || ''

        if (!activeTeamData?.id) {
          if (token === this.requestToken) {
            this.error = 'No active team found'
            this.isLoading = false
          }
          return
        }

        this.activeTeamId = activeTeamData.id

        const [inboxesResponse, teamMembersResponse, projectsResponse, teamSettingsResponse] = await Promise.all([
          $fetch('/api/support/inboxes', { params: { teamId: this.activeTeamId } }),
          $fetch('/api/teams/members', { params: { teamId: this.activeTeamId } }),
          $fetch(`/api/teams/${this.activeTeamId}/projects`),
          $fetch(`/api/support/teams/${this.activeTeamId}/settings`),
        ])
        if (token !== this.requestToken) return

        this.inboxes = inboxesResponse?.data?.inboxes || []
        // These two endpoints return the array directly as `data`, not wrapped
        // in a named property like the inbox endpoints above.
        this.teamMembers = teamMembersResponse?.data || []
        this.projects = projectsResponse?.data || []
        this.teamSettings = teamSettingsResponse?.data?.settings || null
        this.teamSettingsCapabilities = teamSettingsResponse?.data?.capabilities || {}
        this.autoLinkFeedback = this.teamSettings?.autoLinkFeedback === true

        if (this.inboxes.length > 0) {
          const requestedInboxId = this.$route.query.inboxId
          const requestedIsAccessible =
            typeof requestedInboxId === 'string' && this.inboxes.some((inbox) => inbox.id === requestedInboxId)
          this.selectedInboxId = requestedIsAccessible ? requestedInboxId : this.inboxes[0].id
          if (requestedInboxId && !requestedIsAccessible) {
            this.inboxAccessError = 'You do not have access to this support inbox'
            await this.replaceInboxQuery(this.selectedInboxId)
          }
          this.syncGeneralForm()
          await this.loadInboxContext({ recovering: Boolean(requestedInboxId && !requestedIsAccessible) })
        } else if (this.$route.query.inboxId) {
          this.inboxAccessError = 'You do not have access to this support inbox'
          await this.replaceInboxQuery(null)
        }
      } catch (error) {
        if (token !== this.requestToken) return
        if (this.isForbiddenError(error)) {
          await this.recoverFromForbiddenInbox()
          return
        }
        this.error = 'Something went wrong. Please try again.'
      } finally {
        if (token === this.requestToken) this.isLoading = false
      }
    },

    clearInboxScopedState() {
      this.selectedInboxId = ''
      this.members = []
      this.addresses = []
      this.sendingStatus = null
      this.sendingStatusError = null
      this.channel = null
      this.channelError = null
      this.isSwitchingInbox = false
      this.isLoadingSendingStatus = false
      this.isLoadingChannel = false
    },

    async replaceInboxQuery(inboxId) {
      if (!import.meta.client) return
      const query = { ...this.$route.query }
      if (inboxId) query.inboxId = inboxId
      else delete query.inboxId
      await this.$router.replace({ query }).catch(() => {})
    },

    async recoverFromForbiddenInbox({ teamId = this.activeTeamId } = {}) {
      if (this.isRecoveringInbox) return
      this.isRecoveringInbox = true
      this.inboxAccessError = 'You do not have access to this support inbox'
      this.clearInboxScopedState()
      const token = ++this.requestToken
      try {
        const response = await $fetch('/api/support/inboxes', { params: { teamId } })
        if (!this.isCurrentRequest(token, teamId, null)) return
        this.inboxes = response?.data?.inboxes || []
        const fallback = this.inboxes[0]?.id || null
        await this.replaceInboxQuery(fallback)
        if (fallback) {
          this.selectedInboxId = fallback
          this.syncGeneralForm()
          const loaded = await this.loadInboxContext({ recovering: true })
          if (loaded === false && this.isCurrentRequest(token, teamId, null)) {
            this.clearInboxScopedState()
            await this.replaceInboxQuery(null)
          }
        }
      } catch {
        if (this.isCurrentRequest(token, teamId, null)) this.inboxes = []
      } finally {
        this.isRecoveringInbox = false
        if (this.isCurrentRequest(token, teamId, null)) this.isLoading = false
      }
    },

    isCurrentRequest(token, teamId = this.activeTeamId, inboxId = this.selectedInboxId) {
      return token === this.requestToken && teamId === this.activeTeamId && (!inboxId || inboxId === this.selectedInboxId)
    },

    syncGeneralForm() {
      this.generalName = this.selectedInbox?.name || ''
      this.generalSignature = this.selectedInbox?.signature || ''
      this.generalEmailAddress = this.selectedInbox?.emailAddress || ''
      this.generalFromName = this.selectedInbox?.fromName || ''
    },

    async saveTeamPolicy(value) {
      if (!this.canManageTeamSupport) return
      const token = this.requestToken
      const teamId = this.activeTeamId
      this.isSavingTeamPolicy = true
      try {
        const response = await $fetch(`/api/support/teams/${teamId}/settings`, {
          method: 'PUT',
          body: { autoLinkFeedback: value === true },
        })
        if (!this.isCurrentRequest(token, teamId)) return
        this.teamSettings = response?.data?.settings || this.teamSettings
        this.autoLinkFeedback = this.teamSettings?.autoLinkFeedback === true
      } catch (err) {
        if (!this.isCurrentRequest(token, teamId)) return
        if (this.isForbiddenError(err)) {
          await this.recoverFromForbiddenInbox({ teamId })
          return
        }
        this.autoLinkFeedback = this.teamSettings?.autoLinkFeedback === true
        toast.error(this.extractErrorMessage(err, 'Failed to save team support policy'))
      } finally {
        if (this.isCurrentRequest(token, teamId)) this.isSavingTeamPolicy = false
      }
    },

    async loadInboxContext({ recovering = false } = {}) {
      if (!this.selectedInboxId) return false
      const token = this.requestToken
      const teamId = this.activeTeamId
      const inboxId = this.selectedInboxId
      this.isSwitchingInbox = true
      this.members = []
      this.addresses = []
      this.sendingStatus = null
      this.channel = null

      try {
        const [membersResponse, addressesResponse] = await Promise.all([
          $fetch(`/api/support/inboxes/${inboxId}/members`),
          $fetch(`/api/support/inboxes/${inboxId}/addresses`),
        ])
        if (!this.isCurrentRequest(token, teamId, inboxId)) return
        this.members = membersResponse?.data?.members || []
        this.addresses = addressesResponse?.data?.addresses || []
      } catch (err) {
        if (!recovering && this.isForbiddenError(err)) {
          await this.recoverFromForbiddenInbox({ teamId })
          return
        }
        if (recovering && this.isForbiddenError(err)) {
          this.clearInboxScopedState()
          await this.replaceInboxQuery(null)
          return false
        }
        if (!recovering) toast.error('Failed to load inbox details')
      } finally {
        if (this.isCurrentRequest(token, teamId, inboxId)) this.isSwitchingInbox = false
      }

      if (this.isCurrentRequest(token, teamId, inboxId)) {
        const statuses = await Promise.all([
          this.loadSendingStatus({ recovering, token, teamId, inboxId }),
          this.loadChannelStatus({ recovering, token, teamId, inboxId }),
        ])
        if (statuses.some((loaded) => loaded === false) && this.isCurrentRequest(token, teamId, inboxId)) {
          this.clearInboxScopedState()
          await this.replaceInboxQuery(null)
          return false
        }
      }
      return this.isCurrentRequest(token, teamId, inboxId)
    },

    async loadSendingStatus({ recovering = false, token = this.requestToken, teamId = this.activeTeamId, inboxId = this.selectedInboxId } = {}) {
      if (!inboxId || !this.isCurrentRequest(token, teamId, inboxId)) return false
      this.isLoadingSendingStatus = true
      this.sendingStatusError = null

      try {
        const response = await $fetch(`/api/support/inboxes/${inboxId}/sending-status`)
        if (this.isCurrentRequest(token, teamId, inboxId)) this.sendingStatus = response?.data || null
      } catch (err) {
        if (!recovering && this.isForbiddenError(err)) {
          await this.recoverFromForbiddenInbox({ teamId })
          return false
        }
        if (recovering && this.isForbiddenError(err)) return false
        if (this.isCurrentRequest(token, teamId, inboxId))
          this.sendingStatusError = this.extractErrorMessage(err, 'Failed to check sending authorization')
      } finally {
        if (this.isCurrentRequest(token, teamId, inboxId)) this.isLoadingSendingStatus = false
      }
      return this.isCurrentRequest(token, teamId, inboxId)
    },

    async handleInboxSwitch() {
      this.requestToken += 1
      await this.replaceInboxQuery(this.selectedInboxId)
      this.syncGeneralForm()
      await this.loadInboxContext()
    },

    isForbiddenError(err) {
      return err?.statusCode === 403 || err?.status === 403 || err?.response?.status === 403
    },

    extractErrorMessage(err, fallback) {
      return err?.data?.data?.error?.message || fallback
    },

    deriveSlug(value) {
      return (value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
    },

    onNewInboxNameInput() {
      if (!this.slugManuallyEdited) {
        this.newInboxSlug = this.deriveSlug(this.newInboxName)
      }
    },

    onNewInboxSlugInput() {
      this.slugManuallyEdited = true
      this.newInboxSlug = this.deriveSlug(this.newInboxSlug)
    },

    async createInbox() {
      if (!this.newInboxName.trim() || !this.newInboxSlug.trim()) {
        toast.error('Name and slug are required')
        return
      }

      this.isCreatingInbox = true
      const token = this.requestToken
      const teamId = this.activeTeamId

      try {
        const response = await $fetch('/api/support/inboxes', {
          method: 'POST',
          body: {
            teamId,
            name: this.newInboxName.trim(),
            slug: this.newInboxSlug.trim(),
          },
        })
        const created = response?.data?.inbox

        toast.success('Inbox created')
        this.newInboxName = ''
        this.newInboxSlug = ''
        this.slugManuallyEdited = false

        const inboxesResponse = await $fetch('/api/support/inboxes', { params: { teamId } })
        if (!this.isCurrentRequest(token, teamId, null)) return
        this.inboxes = inboxesResponse?.data?.inboxes || []
        this.selectedInboxId = created?.id || this.inboxes[0]?.id || ''

        if (this.selectedInboxId) {
          this.syncGeneralForm()
          await this.loadInboxContext()
        }
      } catch (err) {
        if (!this.isCurrentRequest(token, teamId, null)) return
        if (this.isForbiddenError(err)) {
          await this.recoverFromForbiddenInbox()
          return
        }
        toast.error(this.extractErrorMessage(err, 'Failed to create inbox'))
      } finally {
        if (this.isCurrentRequest(token, teamId, null)) this.isCreatingInbox = false
      }
    },

    async saveGeneral() {
      if (!this.selectedInbox) return
      this.isSavingGeneral = true
      const token = this.requestToken
      const teamId = this.activeTeamId
      const inboxId = this.selectedInboxId

      try {
        await $fetch(`/api/support/inboxes/${inboxId}`, {
          method: 'PUT',
          body: {
            name: this.generalName.trim(),
            signature: this.generalSignature,
            emailAddress: this.generalEmailAddress.trim() || null,
            fromName: this.generalFromName.trim() || null,
          },
        })

        const inboxesResponse = await $fetch('/api/support/inboxes', { params: { teamId } })
        if (!this.isCurrentRequest(token, teamId, inboxId)) return
        this.inboxes = inboxesResponse?.data?.inboxes || []
        this.syncGeneralForm()
        toast.success('Inbox settings saved')
        await this.loadSendingStatus({ token, teamId, inboxId })
      } catch (err) {
        if (!this.isCurrentRequest(token, teamId, inboxId)) return
        if (this.isForbiddenError(err)) {
          await this.recoverFromForbiddenInbox({ teamId })
          return
        }
        toast.error(this.extractErrorMessage(err, 'Failed to save inbox settings'))
      } finally {
        if (this.isCurrentRequest(token, teamId, inboxId)) this.isSavingGeneral = false
      }
    },

    async reloadMembers({ token = this.requestToken, teamId = this.activeTeamId, inboxId = this.selectedInboxId } = {}) {
      if (!inboxId || !this.isCurrentRequest(token, teamId, inboxId)) return false
      try {
        const membersResponse = await $fetch(`/api/support/inboxes/${inboxId}/members`)
        if (!this.isCurrentRequest(token, teamId, inboxId)) return false
        this.members = membersResponse?.data?.members || []
        return true
      } catch (err) {
        if (!this.isCurrentRequest(token, teamId, inboxId)) return false
        if (this.isForbiddenError(err)) return this.recoverFromForbiddenInbox({ teamId })
        throw err
      }
    },

    async addMember() {
      if (!this.newMemberUserId) {
        toast.error('Select a team member to add')
        return
      }

      this.isAddingMember = true
      const token = this.requestToken
      const teamId = this.activeTeamId
      const inboxId = this.selectedInboxId

      try {
        await $fetch(`/api/support/inboxes/${inboxId}/members`, {
          method: 'POST',
          body: { userId: this.newMemberUserId, role: this.newMemberRole },
        })

        if (!this.isCurrentRequest(token, teamId, inboxId)) return
        toast.success('Agent added')
        this.newMemberUserId = ''
        this.newMemberRole = 'agent'
        await this.reloadMembers({ token, teamId, inboxId })
      } catch (err) {
        if (!this.isCurrentRequest(token, teamId, inboxId)) return
        if (this.isForbiddenError(err)) {
          await this.recoverFromForbiddenInbox({ teamId })
          return
        }
        toast.error(this.extractErrorMessage(err, 'Failed to add agent'))
      } finally {
        if (this.isCurrentRequest(token, teamId, inboxId)) this.isAddingMember = false
      }
    },

    openRemoveMemberDialog(member) {
      this.memberPendingRemoval = member
      this.isRemoveMemberDialogOpen = true
    },

    async confirmRemoveMember() {
      if (!this.memberPendingRemoval) return
      const memberId = this.memberPendingRemoval.id
      this.removingMemberId = memberId
      const token = this.requestToken
      const teamId = this.activeTeamId
      const inboxId = this.selectedInboxId

      try {
        await $fetch(`/api/support/inboxes/${inboxId}/members/${memberId}`, { method: 'DELETE' })
        if (!this.isCurrentRequest(token, teamId, inboxId)) return
        toast.success('Agent removed')
        this.isRemoveMemberDialogOpen = false
        this.memberPendingRemoval = null
        await this.reloadMembers({ token, teamId, inboxId })
      } catch (err) {
        if (!this.isCurrentRequest(token, teamId, inboxId)) return
        if (this.isForbiddenError(err)) {
          await this.recoverFromForbiddenInbox({ teamId })
          return
        }
        toast.error(this.extractErrorMessage(err, 'Failed to remove agent'))
      } finally {
        if (this.isCurrentRequest(token, teamId, inboxId)) this.removingMemberId = null
      }
    },

    async loadChannelStatus({ recovering = false, token = this.requestToken, teamId = this.activeTeamId, inboxId = this.selectedInboxId } = {}) {
      if (!inboxId) {
        this.channel = null
        this.isLoadingChannel = false
        return false
      }
      if (!this.isCurrentRequest(token, teamId, inboxId)) return false
      this.isLoadingChannel = true
      this.channelError = null
      try {
        const response = await $fetch('/api/support/channel-status', { params: { inboxId } })
        if (this.isCurrentRequest(token, teamId, inboxId)) this.channel = response?.data || null
      } catch (err) {
        if (!recovering && this.isForbiddenError(err)) {
          await this.recoverFromForbiddenInbox({ teamId })
          return false
        }
        if (recovering && this.isForbiddenError(err)) return false
        if (this.isCurrentRequest(token, teamId, inboxId))
          this.channelError = err?.data?.error?.message || 'Failed to load channel status'
      } finally {
        if (this.isCurrentRequest(token, teamId, inboxId)) this.isLoadingChannel = false
      }
      return this.isCurrentRequest(token, teamId, inboxId)
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

    async reloadAddresses({ token = this.requestToken, teamId = this.activeTeamId, inboxId = this.selectedInboxId } = {}) {
      if (!inboxId || !this.isCurrentRequest(token, teamId, inboxId)) return false
      try {
        const addressesResponse = await $fetch(`/api/support/inboxes/${inboxId}/addresses`)
        if (!this.isCurrentRequest(token, teamId, inboxId)) return false
        this.addresses = addressesResponse?.data?.addresses || []
        return true
      } catch (err) {
        if (!this.isCurrentRequest(token, teamId, inboxId)) return false
        if (this.isForbiddenError(err)) return this.recoverFromForbiddenInbox({ teamId })
        throw err
      }
    },

    async addAddress() {
      if (!this.newAddress.trim()) {
        toast.error('Enter an email address')
        return
      }

      this.isAddingAddress = true
      const token = this.requestToken
      const teamId = this.activeTeamId
      const inboxId = this.selectedInboxId

      try {
        await $fetch(`/api/support/inboxes/${inboxId}/addresses`, {
          method: 'POST',
          body: {
            address: this.newAddress.trim(),
            projectId: this.newAddressProjectId || undefined,
            isPrimary: this.newAddressIsPrimary,
          },
        })

        if (!this.isCurrentRequest(token, teamId, inboxId)) return
        toast.success('Address added')
        this.newAddress = ''
        this.newAddressProjectId = ''
        this.newAddressIsPrimary = false
        await this.reloadAddresses({ token, teamId, inboxId })
      } catch (err) {
        if (!this.isCurrentRequest(token, teamId, inboxId)) return
        if (this.isForbiddenError(err)) {
          await this.recoverFromForbiddenInbox({ teamId })
          return
        }
        toast.error(this.extractErrorMessage(err, 'Failed to add address'))
      } finally {
        if (this.isCurrentRequest(token, teamId, inboxId)) this.isAddingAddress = false
      }
    },

    openRemoveAddressDialog(address) {
      this.addressPendingRemoval = address
      this.isRemoveAddressDialogOpen = true
    },

    async confirmRemoveAddress() {
      if (!this.addressPendingRemoval) return
      const addressId = this.addressPendingRemoval.id
      this.removingAddressId = addressId
      const token = this.requestToken
      const teamId = this.activeTeamId
      const inboxId = this.selectedInboxId

      try {
        await $fetch(`/api/support/inboxes/${inboxId}/addresses/${addressId}`, { method: 'DELETE' })
        if (!this.isCurrentRequest(token, teamId, inboxId)) return
        toast.success('Address removed')
        this.isRemoveAddressDialogOpen = false
        this.addressPendingRemoval = null
        await this.reloadAddresses({ token, teamId, inboxId })
      } catch (err) {
        if (!this.isCurrentRequest(token, teamId, inboxId)) return
        if (this.isForbiddenError(err)) {
          await this.recoverFromForbiddenInbox({ teamId })
          return
        }
        toast.error(this.extractErrorMessage(err, 'Failed to remove address'))
      } finally {
        if (this.isCurrentRequest(token, teamId, inboxId)) this.removingAddressId = null
      }
    },

    productName(projectId) {
      if (!projectId) return null
      const found = this.projects.find((p) => p.id === projectId)
      return found ? found.name : 'Unknown product'
    },

    initials(value) {
      if (!value) return '?'
      const parts = value.trim().split(/\s+/)
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    },
  },
}
</script>
