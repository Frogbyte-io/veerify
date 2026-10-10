<template>
  <Card data-testid="marketing-settings-integrations">
    <CardHeader>
      <CardTitle>Integration status</CardTitle>
      <CardDescription>What works on this installation, and what to set up for the rest.</CardDescription>
    </CardHeader>

    <CardContent>
      <div v-if="isLoading" class="space-y-2">
        <Skeleton v-for="i in 6" :key="i" class="h-12 w-full" />
      </div>

      <div v-else-if="error" class="text-center py-4" data-testid="marketing-integrations-error">
        <p class="text-sm text-destructive mb-2">{{ error }}</p>
        <Button variant="outline" size="sm" @click="$emit('retry')">Retry</Button>
      </div>

      <ul v-else class="divide-y rounded-lg border">
        <li
          v-for="item in integrations"
          :key="item.id"
          class="flex items-start gap-3 p-3"
          :data-testid="`marketing-integration-${item.id}`"
        >
          <Icon :name="icon(item.state)" class="w-4 h-4 mt-0.5 shrink-0" :class="iconClass(item.state)" />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium">
              {{ item.label }}
              <span class="font-normal text-muted-foreground">{{ item.capability }}</span>
            </p>
            <p class="text-xs mt-0.5" :class="item.state === 'failing' ? 'text-destructive' : 'text-muted-foreground'">
              {{ item.detail }}
            </p>
          </div>
          <Badge :variant="badge(item.state)">{{ stateLabel(item.state) }}</Badge>
        </li>
      </ul>
    </CardContent>
  </Card>
</template>

<script>
export default {
  name: 'MarketingSettingsIntegrations',

  props: {
    integrations: { type: Array, default: () => [] },
    isLoading: { type: Boolean, default: false },
    error: { type: String, default: null },
  },

  emits: ['retry'],

  methods: {
    icon(state) {
      if (state === 'ready') return 'lucide:circle-check'
      if (state === 'failing') return 'lucide:circle-alert'
      return 'lucide:circle-dashed'
    },

    iconClass(state) {
      if (state === 'ready') return 'text-green-600 dark:text-green-500'
      if (state === 'failing') return 'text-destructive'
      return 'text-muted-foreground'
    },

    badge(state) {
      if (state === 'ready') return 'default'
      if (state === 'failing') return 'destructive'
      return 'outline'
    },

    stateLabel(state) {
      if (state === 'ready') return 'Ready'
      if (state === 'failing') return 'Failing'
      return 'Not configured'
    },
  },
}
</script>
