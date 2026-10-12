<template>
  <Card data-testid="search-connect">
    <CardContent class="space-y-4 py-8 text-center">
      <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Icon name="lucide:search" class="h-6 w-6 text-muted-foreground" />
      </div>

      <template v-if="!configured">
        <div class="space-y-1">
          <p class="font-medium">Search Console is not configured on this server</p>
          <p class="mx-auto max-w-lg text-sm text-muted-foreground">
            Veerify reads Search Console through an OAuth app you own. Ask your server admin to set it up.
          </p>
        </div>
        <ol
          class="mx-auto max-w-lg list-decimal space-y-1 pl-5 text-left text-sm text-muted-foreground"
          data-testid="search-self-host-steps"
        >
          <li>In Google Cloud, enable the Search Console API and create an OAuth client of type Web application.</li>
          <li>
            Add
            <code class="break-all rounded bg-muted px-1 py-0.5 text-xs">{{ callbackUrl }}</code>
            as an authorized redirect URI.
          </li>
          <li>
            Ask your server admin to set
            <code class="rounded bg-muted px-1 py-0.5 text-xs">GOOGLE_CLIENT_ID</code>
            and
            <code class="rounded bg-muted px-1 py-0.5 text-xs">GOOGLE_CLIENT_SECRET</code>
            on the server. Refresh tokens are encrypted, so
            <code class="rounded bg-muted px-1 py-0.5 text-xs">SECRETS_ENCRYPTION_KEY</code>
            must be set too.
          </li>
        </ol>
      </template>

      <template v-else>
        <div class="space-y-1">
          <p class="font-medium">{{ reconnect ? 'Reconnect Search Console' : 'Connect Google Search Console' }}</p>
          <p class="mx-auto max-w-md text-sm text-muted-foreground">
            See the clicks, impressions and queries Google reports for {{ origin }}. Veerify only asks for read-only
            access.
          </p>
        </div>

        <div v-if="canManage" class="space-y-2">
          <Button :disabled="connecting" data-testid="search-connect-button" @click="$emit('connect')">
            <Icon
              :name="connecting ? 'lucide:loader-circle' : 'lucide:link'"
              class="mr-2 h-4 w-4"
              :class="{ 'animate-spin': connecting }"
            />
            {{ connecting ? 'Redirecting...' : reconnect ? 'Reconnect with Google' : 'Connect with Google' }}
          </Button>
          <p v-if="connectError" class="text-sm text-destructive" role="alert">{{ connectError }}</p>
        </div>
        <p v-else class="text-sm text-muted-foreground" data-testid="search-connect-readonly">
          Only team admins can connect Search Console. Ask an admin of this team to do it.
        </p>
      </template>
    </CardContent>
  </Card>
</template>

<script>
export default {
  name: 'MarketingSearchConnect',

  props: {
    configured: { type: Boolean, default: false },
    canManage: { type: Boolean, default: false },
    origin: { type: String, default: '' },
    reconnect: { type: Boolean, default: false },
    connecting: { type: Boolean, default: false },
    connectError: { type: String, default: null },
  },

  emits: ['connect'],

  data() {
    return { appOrigin: '' }
  },

  computed: {
    callbackUrl() {
      return `${this.appOrigin || '<your app URL>'}/api/marketing/google/callback`
    },
  },

  mounted() {
    if (import.meta.client) this.appOrigin = window.location.origin
  },
}
</script>
