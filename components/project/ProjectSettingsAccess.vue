<template>
  <div class="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Icon name="lucide:shield" class="h-5 w-5" />
          Who can open this project
        </CardTitle>
        <CardDescription>Controls who sees {{ project.name }} in the project switcher.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        <label
          v-for="option in accessOptions"
          :key="option.value"
          class="flex cursor-pointer items-start gap-3 rounded-lg border p-4"
          :class="accessMode === option.value ? 'border-primary bg-primary/5' : ''"
        >
          <input
            type="radio"
            name="project-access-mode"
            class="mt-1"
            :value="option.value"
            :checked="accessMode === option.value"
            :disabled="savingMode"
            :data-testid="`project-access-${option.value}`"
            @change="setAccessMode(option.value)"
          />
          <span>
            <span class="block text-sm font-medium">{{ option.label }}</span>
            <span class="block text-xs text-muted-foreground">{{ option.description }}</span>
          </span>
        </label>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Icon name="lucide:users" class="h-5 w-5" />
          People
        </CardTitle>
        <CardDescription>
          Workspace owners and admins are always project admins. Everyone else can be added as Admin or Member.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <!-- Loading -->
        <div v-if="isLoading" class="space-y-2">
          <Skeleton v-for="n in 3" :key="n" class="h-12 w-full rounded-lg" />
        </div>

        <!-- Error -->
        <div v-else-if="error" class="rounded-lg border p-6 text-center">
          <Icon name="lucide:alert-circle" class="mx-auto mb-2 h-8 w-8 text-destructive" />
          <p class="mb-3 text-sm text-muted-foreground">{{ error }}</p>
          <Button variant="outline" size="sm" @click="loadMembers">
            <Icon name="lucide:refresh-cw" class="mr-2 h-4 w-4" />
            Retry
          </Button>
        </div>

        <template v-else>
          <div class="flex flex-wrap items-center gap-2" data-testid="project-access-add">
            <select
              v-model="addUserId"
              class="h-9 min-w-48 flex-1 rounded-md border border-input bg-transparent px-3 text-sm"
              aria-label="Person to add"
            >
              <option value="" disabled>Add a person from {{ organization.name }}…</option>
              <option v-for="c in candidates" :key="c.userId" :value="c.userId">{{ c.name }} ({{ c.email }})</option>
            </select>
            <select
              v-model="addRole"
              class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              aria-label="Role"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <Button size="sm" :disabled="!addUserId || isAdding" @click="addMember">
              <Icon v-if="isAdding" name="lucide:loader-2" class="mr-2 h-4 w-4 animate-spin" />
              Add
            </Button>
          </div>
          <p v-if="candidates.length === 0" class="text-xs text-muted-foreground">
            Everyone in {{ organization.name }} already has an explicit role here. Invite more people from workspace
            settings.
          </p>

          <ul class="divide-y rounded-lg border">
            <li v-for="m in members" :key="m.userId" class="flex flex-wrap items-center gap-3 p-3">
              <Avatar class="h-8 w-8">
                <AvatarImage v-if="m.image" :src="m.image" :alt="m.name" />
                <AvatarFallback>{{ initials(m.name) }}</AvatarFallback>
              </Avatar>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{{ m.name }}</p>
                <p class="truncate text-xs text-muted-foreground">{{ m.email }} · {{ sourceLabel(m.source) }}</p>
              </div>
              <span
                v-if="m.source === 'organization_admin'"
                class="inline-flex items-center gap-1 text-xs text-muted-foreground"
              >
                <Icon name="lucide:lock" class="h-3 w-3" />
                Admin
              </span>
              <template v-else-if="m.source === 'project_member'">
                <select
                  :value="m.role"
                  class="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
                  :disabled="busyUserId === m.userId"
                  :aria-label="`Role for ${m.name}`"
                  @change="changeRole(m, $event.target.value)"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8 text-destructive"
                  :disabled="busyUserId === m.userId"
                  @click="removeMember(m)"
                >
                  <Icon name="lucide:user-minus" class="h-4 w-4" />
                  <span class="sr-only">Remove {{ m.name }}</span>
                </Button>
              </template>
              <span v-else class="text-xs text-muted-foreground">Member</span>
            </li>
          </ul>
        </template>
      </CardContent>
    </Card>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'

export default {
  name: 'ProjectSettingsAccess',
  props: {
    project: { type: Object, required: true },
    organization: { type: Object, required: true },
  },
  emits: ['updated'],
  data() {
    return {
      accessMode: this.project.accessMode || 'workspace',
      savingMode: false,
      members: [],
      orgMembers: [],
      isLoading: true,
      error: null,
      addUserId: '',
      addRole: 'member',
      isAdding: false,
      busyUserId: null,
    }
  },
  computed: {
    base() {
      return `/api/projects/${this.project.slug}/members`
    },
    accessOptions() {
      return [
        {
          value: 'workspace',
          label: `Everyone in ${this.organization.name}`,
          description: 'Every workspace member can open this project. You can still make individual people admins.',
        },
        {
          value: 'restricted',
          label: 'Only people added below',
          description: 'Workspace owners and admins plus the people listed here. Everyone else cannot see the project.',
        },
      ]
    },
    candidates() {
      const explicit = new Set(
        this.members.filter((m) => m.source !== 'workspace' || this.accessMode === 'restricted').map((m) => m.userId)
      )
      return this.orgMembers.filter((m) => !explicit.has(m.userId))
    },
  },
  watch: {
    'project.accessMode'(value) {
      if (value) this.accessMode = value
    },
    'project.slug'() {
      this.loadMembers()
    },
  },
  mounted() {
    this.loadMembers()
  },
  methods: {
    errorMessage(err, fallback) {
      return err?.data?.error?.message || err?.statusMessage || fallback
    },
    initials(name) {
      return (name || '?')
        .split(' ')
        .map((part) => part[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    },
    sourceLabel(source) {
      if (source === 'organization_admin') return 'Workspace admin'
      if (source === 'project_member') return 'Added to project'
      return 'Via workspace'
    },
    async loadMembers() {
      this.isLoading = true
      this.error = null
      try {
        const [membersRes, orgRes] = await Promise.all([
          $fetch(this.base),
          $fetch(`/api/orgs/${this.organization.slug}/members`),
        ])
        const data = membersRes?.data || membersRes
        this.members = Array.isArray(data?.members) ? data.members : []
        if (data?.accessMode) this.accessMode = data.accessMode
        const orgData = orgRes?.data || orgRes
        this.orgMembers = Array.isArray(orgData) ? orgData : orgData?.members || []
      } catch (err) {
        this.error = this.errorMessage(err, 'Failed to load people')
      } finally {
        this.isLoading = false
      }
    },
    async setAccessMode(value) {
      if (value === this.accessMode) return
      const previous = this.accessMode
      this.accessMode = value
      this.savingMode = true
      try {
        const response = await $fetch(`/api/projects/${this.project.slug}`, {
          method: 'PUT',
          body: { accessMode: value },
        })
        this.$emit('updated', response?.data || response)
        await this.loadMembers()
      } catch (err) {
        this.accessMode = previous
        toast.error(this.errorMessage(err, 'Failed to update access'))
      } finally {
        this.savingMode = false
      }
    },
    async addMember() {
      if (!this.addUserId) return
      this.isAdding = true
      try {
        await $fetch(this.base, { method: 'POST', body: { userId: this.addUserId, role: this.addRole } })
        this.addUserId = ''
        this.addRole = 'member'
        await this.loadMembers()
      } catch (err) {
        toast.error(this.errorMessage(err, 'Failed to add person'))
      } finally {
        this.isAdding = false
      }
    },
    async changeRole(member, role) {
      this.busyUserId = member.userId
      try {
        await $fetch(`${this.base}/${member.userId}`, { method: 'PATCH', body: { role } })
        await this.loadMembers()
      } catch (err) {
        toast.error(this.errorMessage(err, 'Failed to change role'))
        await this.loadMembers()
      } finally {
        this.busyUserId = null
      }
    },
    async removeMember(member) {
      this.busyUserId = member.userId
      try {
        await $fetch(`${this.base}/${member.userId}`, { method: 'DELETE' })
        await this.loadMembers()
      } catch (err) {
        toast.error(this.errorMessage(err, 'Failed to remove person'))
      } finally {
        this.busyUserId = null
      }
    },
  },
}
</script>
