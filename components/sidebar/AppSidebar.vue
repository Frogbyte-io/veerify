<script setup lang="ts">
import TeamSwitcher from './TeamSwitcher.vue'
import NavUser from './NavUser.vue'

interface SidebarProps {
  side?: 'left' | 'right'
  variant?: 'sidebar' | 'floating' | 'inset'
  collapsible?: 'offcanvas' | 'icon' | 'none'
  class?: string
}

const props = withDefaults(defineProps<SidebarProps>(), {
  collapsible: 'icon',
})

// Define teams data
const teams = [
  {
    name: "Veerify",
    logo: "lucide:zap",
    plan: "Pro",
  },
  {
    name: "Product Team",
    logo: "lucide:users",
    plan: "Team",
  },
]

// Define user data
const user = {
  name: "Mikal",
  email: "m@example.com",
  avatar: "/avatars/mikal.jpg",
}

// Define navigation items
const feedbackItems = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: "lucide:layout-dashboard",
  },
  {
    title: "Feedback",
    url: "/feedback",
    icon: "lucide:message-square",
  },
  {
    title: "Roadmap",
    url: "/roadmap",
    icon: "lucide:map",
  },
  {
    title: "Changelog",
    url: "/changelog",
    icon: "lucide:scroll-text",
  },
]

const managementItems = [
  {
    title: "Users",
    url: "/users",
    icon: "lucide:users",
  },
  {
    title: "Analytics",
    url: "/reports",
    icon: "lucide:bar-chart-3",
  },
  {
    title: "Team",
    url: "/team",
    icon: "lucide:user-plus",
  },
]

const supportItems = [
  {
    title: "Help Center",
    url: "/help",
    icon: "lucide:help-circle",
  },
  {
    title: "Settings",
    url: "/settings",
    icon: "lucide:settings",
  },
]
</script>

<template>
  <Sidebar v-bind="props">
    <SidebarHeader>
      <TeamSwitcher :teams="teams" />
    </SidebarHeader>

    <SidebarContent>
      <!-- Feedback Section -->
      <SidebarGroup>
        <SidebarGroupLabel>Feedback</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="item in feedbackItems" :key="item.title">
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

      <!-- Support Section -->
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
      <NavUser :user="user" />
    </SidebarFooter>
    <SidebarRail />
  </Sidebar>
</template> 