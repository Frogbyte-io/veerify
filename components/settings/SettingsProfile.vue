<template>
  <div class="bg-card rounded-lg border">
    <div class="p-6 border-b">
      <h2 class="text-lg font-semibold">Profile Information</h2>
      <p class="text-sm text-muted-foreground">Update your account profile information and email address.</p>
    </div>
    <div class="p-6">
      <div class="flex items-center space-x-6 mb-6">
        <div class="w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center">
          <span class="text-white text-2xl font-medium">M</span>
        </div>
        <div>
          <button class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
            Change Photo
          </button>
          <p class="text-sm text-muted-foreground mt-1">JPG, GIF or PNG. 1MB max.</p>
        </div>
      </div>
      
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label class="block text-sm font-medium mb-2">First Name</label>
          <input type="text" value="Mikal" class="w-full px-3 py-2 border rounded-md bg-background focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
        </div>
        <div>
          <label class="block text-sm font-medium mb-2">Last Name</label>
          <input type="text" value="Anderson" class="w-full px-3 py-2 border rounded-md bg-background focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
        </div>
        <div class="md:col-span-2">
          <label class="block text-sm font-medium mb-2">Email Address</label>
          <input type="email" value="m@example.com" class="w-full px-3 py-2 border rounded-md bg-background focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
        </div>
        <div>
          <label class="block text-sm font-medium mb-2">Phone Number</label>
          <input type="tel" value="+1 (555) 123-4567" class="w-full px-3 py-2 border rounded-md bg-background focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
        </div>
        <div>
          <label class="block text-sm font-medium mb-2">Job Title</label>
          <input type="text" value="Project Manager" class="w-full px-3 py-2 border rounded-md bg-background focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
        </div>
      </div>
      
      <div class="mt-6 flex justify-end">
        <button class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
          Save Changes
        </button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'SettingsProfile'
}
</script> 