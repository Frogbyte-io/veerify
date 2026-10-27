<template>
  <Card data-testid="marketing-disabled">
    <CardContent class="py-10 text-center space-y-4">
      <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Icon name="lucide:megaphone" class="w-6 h-6 text-muted-foreground" />
      </div>
      <div class="space-y-1">
        <p class="font-medium">Marketing is switched off</p>
        <p class="text-sm text-muted-foreground max-w-md mx-auto">
          {{ message || 'Marketing needs to be switched on for this project.' }}
        </p>
        <p v-if="isAdmin" class="text-sm text-muted-foreground max-w-md mx-auto">
          Switch it on under Project settings, Tools.
        </p>
        <p v-else class="text-sm text-muted-foreground max-w-md mx-auto flex items-center justify-center gap-1.5">
          <Icon name="lucide:lock" class="w-3.5 h-3.5" />
          Project admins can switch Marketing on.
        </p>
      </div>
      <div v-if="isAdmin" class="flex flex-wrap items-center justify-center gap-2">
        <Button as-child variant="outline">
          <NuxtLink to="/project/settings?tab=tools">
            <Icon name="lucide:layout-grid" class="w-4 h-4 mr-2" />
            Project settings: Tools
          </NuxtLink>
        </Button>
      </div>
    </CardContent>
  </Card>
</template>

<script>
export default {
  name: 'MarketingDisabled',

  props: {
    project: { type: Object, default: null },
    message: { type: String, default: '' },
  },

  computed: {
    isAdmin() {
      return this.project?.role === 'admin'
    },
  },
}
</script>
