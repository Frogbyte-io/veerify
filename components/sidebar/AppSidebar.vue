<script setup lang="ts">
import TeamSwitcher from './TeamSwitcher.vue'
import NavUser from './NavUser.vue'

interface SidebarProps {
  side?: 'left' | 'right'
  variant?: 'sidebar' | 'floating' | 'inset'
  collapsible?: 'offcanvas' | 'icon' | 'none'
  class?: string
}

interface SidebarNavItem {
  title: string
  url: string
  icon: string
  disabled?: boolean
}

const props = withDefaults(defineProps<SidebarProps>(), {
  collapsible: 'icon',
})

// Shared state set by TeamSwitcher — defaults to true to avoid flash of missing content
const hasActiveOrganization = useState('hasActiveOrganization', () => true)

// Always-visible personal items
const personalItems: SidebarNavItem[] = [
  {
    title: 'Dashboard',
    url: '/dashboard',
    icon: 'lucide:layout-dashboard',
  },
  {
    title: 'My Submissions',
    url: '/submissions',
    icon: 'lucide:list',
  },
  {
    title: 'Notifications',
    url: '/settings#notifications',
    icon: 'lucide:bell',
  },
]

// Workspace navigation items (only shown when org is active)
const feedbackItems: SidebarNavItem[] = [
  {
    title: 'Feedback',
    url: '/feedback',
    icon: 'lucide:message-square',
  },
  {
    title: 'Roadmap',
    url: '/roadmap',
    icon: 'lucide:map',
    disabled: true,
  },
  {
    title: 'Changelog',
    url: '/changelog',
    icon: 'lucide:scroll-text',
    disabled: true,
  },
]

const managementItems: SidebarNavItem[] = [
  {
    title: 'Products',
    url: '/products',
    icon: 'lucide:package',
  },
  {
    title: 'Members',
    url: '/settings#organization',
    icon: 'lucide:user-plus',
  },
]

const supportItems: SidebarNavItem[] = [
  {
    title: 'Help Center',
    url: '/help',
    icon: 'lucide:help-circle',
  },
  {
    title: 'Settings',
    url: '/settings',
    icon: 'lucide:settings',
  },
]
</script>

<template>
  <Sidebar data-testid="app-sidebar" v-bind="props">
    <SidebarHeader>
      <!-- Show TeamSwitcher when user has an org, otherwise show a Create Workspace CTA -->
      <TeamSwitcher v-if="hasActiveOrganization" />
      <SidebarMenu v-else>
        <SidebarMenuItem>
          <SidebarMenuButton as-child size="lg" tooltip="Create a workspace">
            <NuxtLink to="/get-started">
              <div
                class="flex aspect-square size-8 items-center justify-center rounded-lg border-2 border-dashed border-sidebar-border text-sidebar-foreground/60"
              >
                <Icon name="lucide:plus" class="size-4" />
              </div>
              <div class="grid flex-1 text-left text-sm leading-tight">
                <span class="truncate font-semibold">Create workspace</span>
                <span class="truncate text-xs text-muted-foreground">Get started</span>
              </div>
            </NuxtLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>

    <SidebarContent>
      <!-- Personal Section (always visible) -->
      <SidebarGroup>
        <SidebarGroupLabel>Personal</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="item in personalItems" :key="item.title">
              <SidebarMenuButton as-child :tooltip="item.title">
                <NuxtLink :to="item.url">
                  <Icon :name="item.icon" class="w-5 h-5 shrink-0" />
                  <span>{{ item.title }}</span>
                </NuxtLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <!-- Workspace sections (only when org is active) -->
      <template v-if="hasActiveOrganization">
        <!-- Feedback Section -->
        <SidebarGroup>
          <SidebarGroupLabel>Feedback</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem v-for="item in feedbackItems" :key="item.title">
                <SidebarMenuButton v-if="item.disabled" :tooltip="item.title" disabled aria-disabled="true">
                  <Icon :name="item.icon" class="w-5 h-5 shrink-0" />
                  <span>{{ item.title }}</span>
                </SidebarMenuButton>
                <SidebarMenuButton v-else as-child :tooltip="item.title">
                  <NuxtLink :to="item.url">
                    <Icon :name="item.icon" class="w-5 h-5 shrink-0" />
                    <span>{{ item.title }}</span>
                  </NuxtLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <!-- Management Section -->
        <SidebarGroup>
          <SidebarGroupLabel>Management</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem v-for="item in managementItems" :key="item.title">
                <SidebarMenuButton as-child :tooltip="item.title">
                  <NuxtLink :to="item.url">
                    <Icon :name="item.icon" class="w-5 h-5 shrink-0" />
                    <span>{{ item.title }}</span>
                  </NuxtLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </template>

      <!-- Support Section (always visible) -->
      <SidebarGroup>
        <SidebarGroupLabel>Support</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="item in supportItems" :key="item.title">
              <SidebarMenuButton as-child :tooltip="item.title">
                <NuxtLink :to="item.url">
                  <Icon :name="item.icon" class="w-5 h-5 shrink-0" />
                  <span>{{ item.title }}</span>
                </NuxtLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>

    <SidebarFooter>
      <NavUser />
    </SidebarFooter>
    <SidebarRail />
  </Sidebar>
</template>
