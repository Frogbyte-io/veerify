<template>
  <DropdownMenu @update:open="handleOpenChange">
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        size="icon"
        class="relative h-8 w-8"
        data-testid="notification-bell"
      >
        <Icon name="lucide:bell" class="h-4 w-4" />
        <span
          v-if="unreadCount > 0"
          class="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground"
        >
          {{ unreadCount > 99 ? '99+' : unreadCount }}
        </span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-80">
      <div class="flex items-center justify-between px-3 py-2">
        <span class="text-sm font-semibold">Notifications</span>
        <Button
          v-if="unreadCount > 0"
          variant="ghost"
          size="sm"
          class="h-auto px-2 py-1 text-xs"
          @click="markAllRead"
        >
          Mark all read
        </Button>
      </div>
      <DropdownMenuSeparator />
      <ScrollArea class="max-h-80">
        <div v-if="isLoading" class="space-y-2 p-3">
          <Skeleton v-for="i in 3" :key="i" class="h-14 w-full" />
        </div>
        <div v-else-if="notifications.length === 0" class="px-3 py-8 text-center">
          <Icon name="lucide:bell-off" class="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
          <p class="text-sm text-muted-foreground">No notifications yet</p>
        </div>
        <div v-else>
          <div
            v-for="item in notifications"
            :key="item.id"
            class="flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors hover:bg-accent"
            :class="{ 'bg-accent/50': !item.isRead }"
            @click="handleClick(item)"
          >
            <div class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
              <Icon :name="getIcon(item.type)" class="h-4 w-4 text-muted-foreground" />
            </div>
            <div class="flex-1 space-y-0.5 overflow-hidden">
              <p class="text-sm font-medium leading-tight truncate">{{ item.title }}</p>
              <p v-if="item.body" class="text-xs text-muted-foreground truncate">{{ item.body }}</p>
              <p class="text-xs text-muted-foreground">{{ formatTime(item.createdAt) }}</p>
            </div>
            <button
              class="mt-0.5 shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Dismiss"
              @click.stop="deleteNotification(item.id)"
            >
              <Icon name="lucide:x" class="h-3 w-3" />
            </button>
          </div>
        </div>
      </ScrollArea>
      <DropdownMenuSeparator v-if="hasMore" />
      <div v-if="hasMore" class="p-1">
        <Button
          variant="ghost"
          size="sm"
          class="w-full text-xs"
          :disabled="isLoadingMore"
          @click.prevent="loadMore"
        >
          {{ isLoadingMore ? 'Loading...' : 'Load more' }}
        </Button>
      </div>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<script>
import { fetchDashboardBootstrap, getCachedDashboardBootstrap } from '~/lib/dashboard-bootstrap-client'

export default {
  name: 'NotificationBell',
  data() {
    return {
      notifications: [],
      unreadCount: 0,
      isLoading: true,
      isLoadingMore: false,
      hasMore: false,
      nextCursor: null,
      ws: null,
      wsReconnectTimer: null,
      wsReconnectAttempts: 0,
      pollInterval: null,
      useWebSocket: true,
      hasLoadedNotifications: false,
    }
  },
  mounted() {
    this.initializeFromBootstrap()
  },
  beforeUnmount() {
    this.cleanup()
  },
  methods: {
    async fetchNotifications() {
      try {
        const res = await $fetch('/api/notifications', {
          params: { limit: 10 },
        })
        if (res.success) {
          this.notifications = res.data.notifications
          this.unreadCount = res.data.unreadCount
          this.hasMore = res.data.hasMore
          this.nextCursor = res.data.nextCursor
          this.hasLoadedNotifications = true
        }
      } catch {
        // Silently fail — bell just shows no notifications
      } finally {
        this.isLoading = false
      }
    },
    async connectWebSocket(sessionToken = null) {
      if (!import.meta.client) return

      const token = sessionToken || getCachedDashboardBootstrap()?.session?.session?.token
      if (!token) {
        this.fallbackToPolling()
        return
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${protocol}//${window.location.host}/_ws?token=${encodeURIComponent(token)}`

      try {
        this.ws = new WebSocket(wsUrl)

        this.ws.onopen = () => {
          this.wsReconnectAttempts = 0
          // Stop polling if it was running as fallback
          this.stopPolling()
        }

        this.ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data)
            if (msg.type === 'notification') {
              // Prepend the new notification to the list
              this.notifications.unshift(msg.data)
              this.unreadCount++
            }
          } catch {
            // Ignore non-JSON messages (e.g. "pong")
          }
        }

        this.ws.onclose = (event) => {
          this.ws = null
          // Don't reconnect if closed intentionally (code 4001 = auth failure)
          if (event.code === 4001) {
            this.fallbackToPolling()
            return
          }
          this.scheduleReconnect()
        }

        this.ws.onerror = () => {
          // onclose will fire after onerror, handling reconnect there
        }

        // Keep-alive ping every 30 seconds
        this.startPing()
      } catch {
        this.fallbackToPolling()
      }
    },
    startPing() {
      this.stopPing()
      this._pingInterval = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send('ping')
        }
      }, 30000)
    },
    stopPing() {
      if (this._pingInterval) {
        clearInterval(this._pingInterval)
        this._pingInterval = null
      }
    },
    scheduleReconnect() {
      if (this.wsReconnectAttempts >= 5) {
        this.fallbackToPolling()
        return
      }
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s
      const delay = Math.min(1000 * Math.pow(2, this.wsReconnectAttempts), 16000)
      this.wsReconnectAttempts++
      this.wsReconnectTimer = setTimeout(() => {
        this.connectWebSocket()
      }, delay)
    },
    fallbackToPolling() {
      this.useWebSocket = false
      this.startPolling()
    },
    startPolling() {
      this.stopPolling()
      this.pollInterval = setInterval(() => {
        this.pollUnreadCount()
      }, 30000)
    },
    stopPolling() {
      if (this.pollInterval) {
        clearInterval(this.pollInterval)
        this.pollInterval = null
      }
    },
    async pollUnreadCount() {
      try {
        const res = await $fetch('/api/notifications/unread-count')
        if (res.success) {
          // If unread count increased, refetch to get new items
          if (res.data.unreadCount > this.unreadCount) {
            await this.fetchNotifications()
          } else {
            this.unreadCount = res.data.unreadCount
          }
        }
      } catch {
        // Silently fail
      }
    },
    async initializeFromBootstrap() {
      try {
        const bootstrap = getCachedDashboardBootstrap() || (await fetchDashboardBootstrap())
        this.unreadCount = bootstrap?.notifications?.unreadCount || 0
        this.isLoading = false
        this.scheduleRealtimeConnection(bootstrap?.session?.session?.token || null)
      } catch {
        this.isLoading = false
        this.fallbackToPolling()
      }
    },
    scheduleRealtimeConnection(sessionToken) {
      if (!import.meta.client) return

      const connect = () => {
        this.connectWebSocket(sessionToken)
      }

      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(connect, { timeout: 5000 })
        return
      }

      window.setTimeout(connect, 2000)
    },
    handleOpenChange(open) {
      if (open && !this.hasLoadedNotifications) {
        this.fetchNotifications()
      }
    },
    async loadMore() {
      if (!this.nextCursor || this.isLoadingMore) return
      this.isLoadingMore = true
      try {
        const res = await $fetch('/api/notifications', {
          params: { limit: 10, cursor: this.nextCursor },
        })
        if (res.success) {
          this.notifications.push(...res.data.notifications)
          this.hasMore = res.data.hasMore
          this.nextCursor = res.data.nextCursor
        }
      } catch {
        // Silently fail
      } finally {
        this.isLoadingMore = false
      }
    },
    async markAllRead() {
      try {
        await $fetch('/api/notifications/read', { method: 'PATCH' })
        this.notifications.forEach((n) => {
          n.isRead = true
        })
        this.unreadCount = 0
      } catch {
        // Silently fail
      }
    },
    async handleClick(item) {
      if (!item.isRead) {
        try {
          await $fetch('/api/notifications/read', {
            method: 'PATCH',
            body: { id: item.id },
          })
          item.isRead = true
          this.unreadCount = Math.max(0, this.unreadCount - 1)
        } catch {
          // Continue with navigation even if marking read fails
        }
      }
      if (item.link) {
        navigateTo(item.link)
      }
    },
    async deleteNotification(id) {
      try {
        await $fetch(`/api/notifications/${id}`, { method: 'DELETE' })
        const idx = this.notifications.findIndex((n) => n.id === id)
        if (idx !== -1) {
          const wasUnread = !this.notifications[idx].isRead
          this.notifications.splice(idx, 1)
          if (wasUnread) {
            this.unreadCount = Math.max(0, this.unreadCount - 1)
          }
        }
      } catch {
        // Silently fail
      }
    },
    getIcon(type) {
      const icons = {
        status_change: 'lucide:arrow-right-left',
        new_comment: 'lucide:message-circle',
        new_feedback: 'lucide:message-square-plus',
        feedback_pinned: 'lucide:pin',
      }
      return icons[type] || 'lucide:bell'
    },
    formatTime(dateStr) {
      const date = new Date(dateStr)
      const now = new Date()
      const diffMs = now - date
      const diffMin = Math.floor(diffMs / 60000)
      if (diffMin < 1) return 'Just now'
      if (diffMin < 60) return `${diffMin}m ago`
      const diffHours = Math.floor(diffMin / 60)
      if (diffHours < 24) return `${diffHours}h ago`
      const diffDays = Math.floor(diffHours / 24)
      if (diffDays < 7) return `${diffDays}d ago`
      return date.toLocaleDateString()
    },
    cleanup() {
      this.stopPolling()
      this.stopPing()
      if (this.wsReconnectTimer) {
        clearTimeout(this.wsReconnectTimer)
        this.wsReconnectTimer = null
      }
      if (this.ws) {
        this.ws.onclose = null // Prevent reconnect on intentional close
        this.ws.close()
        this.ws = null
      }
    },
  },
}
</script>
