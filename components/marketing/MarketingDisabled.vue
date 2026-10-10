<template>
  <Card data-testid="marketing-disabled">
    <CardContent class="py-10 text-center space-y-4">
      <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Icon name="lucide:megaphone" class="w-6 h-6 text-muted-foreground" />
      </div>
      <div class="space-y-1">
        <p class="font-medium">Marketing is switched off</p>
        <p class="text-sm text-muted-foreground max-w-md mx-auto">
          {{ message || 'Marketing needs to be enabled for your team and for this product.' }}
        </p>
        <p class="text-sm text-muted-foreground max-w-md mx-auto">
          Both switches have to be on: the team switch under Settings, Tools, and the product switch under the product's
          Features tab.
        </p>
      </div>
      <div class="flex flex-wrap items-center justify-center gap-2">
        <Button as-child variant="outline">
          <NuxtLink to="/settings#tools">
            <Icon name="lucide:layout-grid" class="w-4 h-4 mr-2" />
            Settings: Tools
          </NuxtLink>
        </Button>
        <Button v-if="product" as-child variant="outline">
          <NuxtLink :to="`/products/${product.slug}#features`">
            <Icon name="lucide:package" class="w-4 h-4 mr-2" />
            {{ product.name }}: Features
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
    product: { type: Object, default: null },
    message: { type: String, default: '' },
  },
}
</script>
