<template>
  <SidebarMenu>
    <SidebarMenuItem>
      <!-- Show loading state while checking auth -->
      <div v-if="isLoading" class="flex items-center space-x-2 p-2">
        <div class="h-8 w-8 bg-gray-200 rounded-lg animate-pulse"></div>
        <div class="space-y-1">
          <div class="h-4 w-20 bg-gray-200 rounded animate-pulse"></div>
          <div class="h-3 w-16 bg-gray-200 rounded animate-pulse"></div>
        </div>
      </div>

      <!-- Show user dropdown when authenticated -->
      <DropdownMenu v-else-if="user">
        <DropdownMenuTrigger as-child>
          <SidebarMenuButton
            size="lg"
            class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            <Avatar class="h-8 w-8 rounded-lg">
              <AvatarImage :src="user.avatar" :alt="user.name" />
              <AvatarFallback class="rounded-lg">
                {{ getInitials(user.name) }}
              </AvatarFallback>
            </Avatar>
            <div class="grid flex-1 text-left text-sm leading-tight">
              <span class="truncate font-semibold">{{ user.name }}</span>
              <span class="truncate text-xs">{{ user.email }}</span>
            </div>
            <Icon name="lucide:chevrons-up-down" class="ml-auto size-4" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          class="w-[--reka-dropdown-menu-trigger-width] min-w-56 rounded-lg"
          :side="isMobile ? 'bottom' : 'right'"
          align="end"
          :side-offset="4"
        >
          <DropdownMenuLabel class="p-0 font-normal">
            <div class="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
              <Avatar class="h-8 w-8 rounded-lg">
                <AvatarImage :src="user.avatar" :alt="user.name" />
                <AvatarFallback class="rounded-lg">
                  {{ getInitials(user.name) }}
                </AvatarFallback>
              </Avatar>
              <div class="grid flex-1 text-left text-sm leading-tight">
                <span class="truncate font-semibold">{{ user.name }}</span>
                <span class="truncate text-xs">{{ user.email }}</span>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem @click="navigateTo('/settings#profile')">
              <Icon name="lucide:badge-check" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem @click="navigateTo('/settings#notifications')">
              <Icon name="lucide:bell" />
              Notifications
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem @click="handleLogout">
            <Icon name="lucide:log-out" />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <!-- Show sign in prompt when not authenticated -->
      <div v-else class="p-2 text-sm text-muted-foreground">
        <NuxtLink to="/auth" class="hover:underline">
          Sign in to continue
        </NuxtLink>
      </div>
    </SidebarMenuItem>
  </SidebarMenu>
</template>

<script>
import { authClient } from '~/lib/auth-client'

export default {
  name: 'NavUser',
  
  setup() {
    // Use the session composable at the top level
    // This ensures proper reactivity
    const sessionComposable = authClient.useSession()
    
    return {
      sessionComposable
    }
  },

  data() {
    return {
      session: null,
      isPending: true
    }
  },

  mounted() {
    if (!import.meta.client) return
    
    try {
      // Access the composable result
      const sessionRef = this.sessionComposable?.data || this.sessionComposable
      const isPendingRef = this.sessionComposable?.isPending
      
      // Set initial values
      if (sessionRef && typeof sessionRef === 'object' && 'value' in sessionRef) {
        this.session = sessionRef.value
      } else if (sessionRef) {
        this.session = sessionRef
      }
      
      if (isPendingRef && typeof isPendingRef === 'object' && 'value' in isPendingRef) {
        this.isPending = isPendingRef.value ?? false
      }
      
      // Watch for changes - only watch if it's a ref
      if (sessionRef && typeof sessionRef === 'object' && 'value' in sessionRef) {
        watch(sessionRef, (newSession) => {
          this.session = newSession
        }, { immediate: false })
      }
      
      if (isPendingRef && typeof isPendingRef === 'object' && 'value' in isPendingRef) {
        watch(isPendingRef, (newPending) => {
          // Only update isPending if we don't have a session yet
          // This prevents white flash when switching tabs if session already exists
          if (!this.session || newPending === false) {
            this.isPending = newPending
          }
        }, { immediate: false })
      }
      
    } catch (error) {
      console.error('Error fetching session:', error)
      this.isPending = false
    }
  },

  computed: {
    user() {
      if (this.session?.user) {
        return {
          name: this.session.user.name || 'User',
          email: this.session.user.email || '',
          avatar: this.session.user.image || '',
        }
      }
      return null
    },
    
    isLoading() {
      // Only show loading if we don't have a session yet
      // This prevents white flash when switching tabs if session already exists
      return this.isPending && !this.session
    },
    
    isMobile() {
      if (import.meta.client) {
        return window.innerWidth < 768
      }
      return false
    }
  },

  methods: {
    getInitials(name) {
      if (!name) return ''
      return name.split(' ').map(n => n[0]).join('').toUpperCase()
    },

    async handleLogout() {
      try {
        await authClient.signOut()
        await navigateTo('/login')
      } catch (error) {
        console.error('Error signing out:', error)
      }
    }
  }
}
</script> 