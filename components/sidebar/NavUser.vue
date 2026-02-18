<template>
  <SidebarMenu>
    <SidebarMenuItem>
      <!-- Show loading state while checking auth -->
      <div v-if="isLoading" data-testid="nav-user-loading" class="flex items-center space-x-2 p-2">
        <div class="h-8 w-8 bg-gray-200 rounded-lg animate-pulse" />
        <div class="space-y-1">
          <div class="h-4 w-20 bg-gray-200 rounded animate-pulse" />
          <div class="h-3 w-16 bg-gray-200 rounded animate-pulse" />
        </div>
      </div>

      <!-- Show user dropdown when authenticated -->
      <DropdownMenu v-else-if="user">
        <DropdownMenuTrigger as-child>
          <SidebarMenuButton
            data-testid="nav-user-trigger"
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
              <span data-testid="nav-user-name" class="truncate font-semibold">{{ user.name }}</span>
              <span data-testid="nav-user-email" class="truncate text-xs">{{ user.email }}</span>
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
          <template v-if="otherAccounts.length > 0">
            <DropdownMenuSeparator />
            <DropdownMenuLabel class="text-xs text-muted-foreground">Switch account</DropdownMenuLabel>
            <DropdownMenuItem
              v-for="account in otherAccounts"
              :key="account.session.id"
              class="gap-2 py-1.5"
              @click="switchAccount(account.session.token)"
            >
              <Avatar class="h-6 w-6 rounded-lg">
                <AvatarImage :src="account.user.image" :alt="account.user.name" />
                <AvatarFallback class="rounded-lg text-xs">
                  {{ getInitials(account.user.name) }}
                </AvatarFallback>
              </Avatar>
              <div class="grid flex-1 text-left text-sm leading-tight">
                <span class="truncate text-sm">{{ account.user.name || 'User' }}</span>
                <span class="truncate text-xs text-muted-foreground">{{ account.user.email }}</span>
              </div>
            </DropdownMenuItem>
          </template>
          <DropdownMenuSeparator />
          <DropdownMenuItem @click="navigateTo('/login?addAccount=true')">
            <Icon name="lucide:plus" />
            Add account
          </DropdownMenuItem>
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
        <NuxtLink to="/auth" class="hover:underline"> Sign in to continue </NuxtLink>
      </div>
    </SidebarMenuItem>
  </SidebarMenu>
</template>

<script>
import { authClient } from '~/lib/auth-client'

const NAV_USER_CACHE_MAX_AGE_MS = 5 * 60 * 1000

const navUserCache = {
  session: null,
  loadedAt: 0,
  initialized: false,
  pendingRequest: null,
}

function hasCachedNavUserSession() {
  return import.meta.client && navUserCache.initialized
}

function isNavUserSessionCacheFresh() {
  return hasCachedNavUserSession() && Date.now() - navUserCache.loadedAt < NAV_USER_CACHE_MAX_AGE_MS
}

function clearNavUserSessionCache() {
  navUserCache.session = null
  navUserCache.loadedAt = 0
  navUserCache.initialized = false
  navUserCache.pendingRequest = null
}

export default {
  name: 'NavUser',

  data() {
    const hasCachedSession = hasCachedNavUserSession()
    return {
      session: hasCachedSession ? navUserCache.session : null,
      isPending: !hasCachedSession,
      stopSessionWatcher: null,
      otherAccounts: [],
      switchingAccount: false,
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
      return this.isPending && !this.session
    },

    isMobile() {
      if (import.meta.client) {
        return window.innerWidth < 768
      }
      return false
    },
  },

  async mounted() {
    await this.initializeSession()
    this.loadOtherAccounts()
  },

  beforeUnmount() {
    this.stopSessionWatcher?.()
    this.stopSessionWatcher = null
  },

  methods: {
    applySessionFromCache() {
      this.session = navUserCache.session
      this.isPending = false
    },

    async fetchSessionState() {
      const { data: session } = await authClient.useSession(useFetch)
      return {
        session: session.value || null,
        sessionRef: session,
      }
    },

    async fetchAndCacheSession() {
      if (!navUserCache.pendingRequest) {
        navUserCache.pendingRequest = this.fetchSessionState()
          .then((sessionState) => {
            navUserCache.session = sessionState.session
            navUserCache.loadedAt = Date.now()
            navUserCache.initialized = true
            return sessionState
          })
          .finally(() => {
            navUserCache.pendingRequest = null
          })
      }

      return navUserCache.pendingRequest
    },

    startSessionWatcher(sessionRef) {
      this.stopSessionWatcher?.()
      this.stopSessionWatcher = watch(sessionRef, (nextSession) => {
        navUserCache.session = nextSession || null
        navUserCache.loadedAt = Date.now()
        navUserCache.initialized = true
        this.session = navUserCache.session
      })
    },

    async initializeSession(options = {}) {
      const { force = false, silent = false } = options
      const hasCachedSession = hasCachedNavUserSession()

      if (!force && hasCachedSession) {
        this.applySessionFromCache()

        if (!isNavUserSessionCacheFresh() && !navUserCache.pendingRequest) {
          void this.initializeSession({ force: true, silent: true })
        }
        return
      }

      try {
        if (!silent || !hasCachedSession) {
          this.isPending = true
        }

        const sessionState = await this.fetchAndCacheSession()
        this.session = sessionState.session
        this.isPending = false
        this.startSessionWatcher(sessionState.sessionRef)
      } catch (error) {
        if (!hasCachedSession) {
          clearNavUserSessionCache()
          this.session = null
        }
        this.isPending = false
        console.error('Error fetching session:', error)
      }
    },

    async loadOtherAccounts() {
      try {
        const { data } = await authClient.multiSession.listDeviceSessions()
        if (!data || !this.session?.user) return
        this.otherAccounts = data.filter(
          (entry) => entry.user.id !== this.session.user.id,
        )
      } catch (error) {
        console.error('Error loading device sessions:', error)
      }
    },

    async switchAccount(sessionToken) {
      if (this.switchingAccount) return
      this.switchingAccount = true
      try {
        await authClient.multiSession.setActive({ sessionToken })
        clearNavUserSessionCache()
        window.location.reload()
      } catch (error) {
        console.error('Error switching account:', error)
        this.switchingAccount = false
      }
    },

    getInitials(name) {
      if (!name) return ''
      return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
    },

    async handleLogout() {
      try {
        await authClient.signOut()
        clearNavUserSessionCache()
        this.session = null
        this.isPending = false
        await navigateTo('/login')
      } catch (error) {
        console.error('Error signing out:', error)
      }
    },
  },
}
</script>
