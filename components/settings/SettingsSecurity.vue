<template>
  <div class="bg-card rounded-lg border">
    <div class="p-6 border-b">
      <h2 class="text-lg font-semibold">Security</h2>
      <p class="text-sm text-muted-foreground">Manage your account security and authentication settings.</p>
    </div>
    <div class="p-6">
      <div class="space-y-6">
        <div>
          <h3 class="font-medium mb-3">Change Password</h3>
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium mb-2">Current Password</label>
              <input type="password" class="w-full px-3 py-2 border rounded-md bg-background focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
            </div>
            <div>
              <label class="block text-sm font-medium mb-2">New Password</label>
              <input type="password" class="w-full px-3 py-2 border rounded-md bg-background focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
            </div>
            <div>
              <label class="block text-sm font-medium mb-2">Confirm New Password</label>
              <input type="password" class="w-full px-3 py-2 border rounded-md bg-background focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
            </div>
            <button class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
              Update Password
            </button>
          </div>
        </div>
        
        <hr class="border">
        
        <div>
          <h3 class="font-medium mb-3">Two-Factor Authentication</h3>
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-muted-foreground">Add an extra layer of security to your account</p>
            </div>
            <button class="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors">
              Enable 2FA
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'SettingsSecurity'
}
</script> 