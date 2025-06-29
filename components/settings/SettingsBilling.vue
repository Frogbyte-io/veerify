<template>
  <div class="bg-card rounded-lg border">
    <div class="p-6 border-b">
      <h2 class="text-lg font-semibold">Billing</h2>
      <p class="text-sm text-muted-foreground">Manage your subscription and billing information.</p>
    </div>
    <div class="p-6">
      <div class="space-y-6">
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="font-medium text-blue-900">Professional Plan</h3>
              <p class="text-sm text-blue-700">$29/month - Billed monthly</p>
            </div>
            <button class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
              Manage Subscription
            </button>
          </div>
        </div>
        <div>
          <h3 class="font-medium mb-3">Payment Method</h3>
          <div class="flex items-center justify-between p-4 border rounded-lg">
            <div class="flex items-center space-x-3">
              <div class="w-8 h-6 bg-blue-600 rounded flex items-center justify-center">
                <span class="text-white text-xs font-bold">VISA</span>
              </div>
              <span>•••• •••• •••• 4242</span>
            </div>
            <button class="text-blue-600 hover:text-blue-700">
              Change
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'SettingsBilling'
}
</script> 