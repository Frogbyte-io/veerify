<template>
  <div class="bg-card rounded-lg border">
    <div class="p-6 border-b">
      <h2 class="text-lg font-semibold">Notification Preferences</h2>
      <p class="text-sm text-muted-foreground">Configure how you receive notifications about your projects.</p>
    </div>
    <div class="p-6">
      <div class="space-y-6">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="font-medium">Email Notifications</h3>
            <p class="text-sm text-muted-foreground">Receive email updates about project activities</p>
          </div>
          <label class="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" class="sr-only peer" checked @change="handleEmailNotificationsChange" />
            <div
              class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"
            />
          </label>
        </div>

        <div class="flex items-center justify-between">
          <div>
            <h3 class="font-medium">Push Notifications</h3>
            <p class="text-sm text-muted-foreground">Receive push notifications on your devices</p>
          </div>
          <label class="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" class="sr-only peer" checked />
            <div
              class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"
            />
          </label>
        </div>
        <div class="flex items-center justify-between">
          <div>
            <h3 class="font-medium">Marketing Communications</h3>
            <p class="text-sm text-muted-foreground">Updates about new features and company news</p>
          </div>
          <label class="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" class="sr-only peer" />
            <div
              class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"
            />
          </label>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'SettingsNotifications',
  methods: {
    handleEmailNotificationsChange(_event) {
      fetch('/api/mail/send-mail', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: 'test@test.com',
          subject: 'Test Email',
          html: '<p>Hello, this is a test email</p>',
        }),
      })
    },
  },
}
</script>
