<template>
  <div class="bg-card rounded-lg border">
    <div class="p-6 border-b">
      <h2 class="text-lg font-semibold">Organization</h2>
      <p class="text-sm text-muted-foreground">Manage your organization settings and team members.</p>
    </div>
    <div class="p-6">
      <div class="space-y-6">
        <div>
          <label class="block text-sm font-medium mb-2">Organization Name</label>
          <input type="text" value="Veerify" class="w-full px-3 py-2 border rounded-md bg-background focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
        </div>
        <div>
          <label class="block text-sm font-medium mb-2">Organization ID</label>
          <input type="text" value="VEER-2024-001" disabled class="w-full px-3 py-2 border rounded-md bg-muted text-muted-foreground">
        </div>
        <div class="flex justify-end">
          <button class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
            Save Changes
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'SettingsOrganization'
}
</script> 