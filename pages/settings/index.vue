<template>
  <NuxtLayout name="dashboard">
    <div class="p-6">
      <div class="mb-6">
        <h1 class="text-3xl font-bold">Settings</h1>
        <p class="text-muted-foreground">Manage your account and application preferences</p>
      </div>
      
      <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <!-- Settings Navigation -->
        <div class="lg:col-span-1">
          <nav class="bg-card rounded-lg border p-4">
            <ul class="space-y-2">
              <li>
                <button 
                  @click="activeTab = 'profile'"
                  :class="[
                    'w-full text-left px-3 py-2 rounded-md transition-colors',
                    activeTab === 'profile' 
                      ? 'bg-accent text-accent-foreground font-medium' 
                      : 'text-muted-foreground hover:bg-accent/50'
                  ]"
                >
                  <Icon name="lucide:user" class="w-4 h-4 mr-2 inline" />
                  Profile
                </button>
              </li>
              <li>
                <button 
                  @click="activeTab = 'security'"
                  :class="[
                    'w-full text-left px-3 py-2 rounded-md transition-colors',
                    activeTab === 'security' 
                      ? 'bg-accent text-accent-foreground font-medium' 
                      : 'text-muted-foreground hover:bg-accent/50'
                  ]"
                >
                  <Icon name="lucide:shield" class="w-4 h-4 mr-2 inline" />
                  Security
                </button>
              </li>
              <li>
                <button 
                  @click="activeTab = 'notifications'"
                  :class="[
                    'w-full text-left px-3 py-2 rounded-md transition-colors',
                    activeTab === 'notifications' 
                      ? 'bg-accent text-accent-foreground font-medium' 
                      : 'text-muted-foreground hover:bg-accent/50'
                  ]"
                >
                  <Icon name="lucide:bell" class="w-4 h-4 mr-2 inline" />
                  Notifications
                </button>
              </li>
              <li>
                <button 
                  @click="activeTab = 'organization'"
                  :class="[
                    'w-full text-left px-3 py-2 rounded-md transition-colors',
                    activeTab === 'organization' 
                      ? 'bg-accent text-accent-foreground font-medium' 
                      : 'text-muted-foreground hover:bg-accent/50'
                  ]"
                >
                  <Icon name="lucide:building" class="w-4 h-4 mr-2 inline" />
                  Organization
                </button>
              </li>
              <li>
                <button 
                  @click="activeTab = 'billing'"
                  :class="[
                    'w-full text-left px-3 py-2 rounded-md transition-colors',
                    activeTab === 'billing' 
                      ? 'bg-accent text-accent-foreground font-medium' 
                      : 'text-muted-foreground hover:bg-accent/50'
                  ]"
                >
                  <Icon name="lucide:credit-card" class="w-4 h-4 mr-2 inline" />
                  Billing
                </button>
              </li>
              <li>
                <button 
                  @click="activeTab = 'appearance'"
                  :class="[
                    'w-full text-left px-3 py-2 rounded-md transition-colors',
                    activeTab === 'appearance' 
                      ? 'bg-accent text-accent-foreground font-medium' 
                      : 'text-muted-foreground hover:bg-accent/50'
                  ]"
                >
                  <Icon name="lucide:palette" class="w-4 h-4 mr-2 inline" />
                  Appearance
                </button>
              </li>
            </ul>
          </nav>
        </div>

        <!-- Settings Content -->
        <div class="lg:col-span-3 space-y-6">
          <!-- Profile Settings -->
          <div v-show="activeTab === 'profile'" class="bg-card rounded-lg border">
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

          <!-- Security Settings -->
          <div v-show="activeTab === 'security'" class="bg-card rounded-lg border">
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

          <!-- Notification Preferences -->
          <div v-show="activeTab === 'notifications'" class="bg-card rounded-lg border">
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
                    <input type="checkbox" class="sr-only peer" checked>
                    <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
                
                <div class="flex items-center justify-between">
                  <div>
                    <h3 class="font-medium">Push Notifications</h3>
                    <p class="text-sm text-muted-foreground">Receive push notifications on your devices</p>
                  </div>
                  <label class="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" class="sr-only peer" checked>
                    <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
                
                <div class="flex items-center justify-between">
                  <div>
                    <h3 class="font-medium">Safety Alerts</h3>
                    <p class="text-sm text-muted-foreground">Immediate notifications for safety-related issues</p>
                  </div>
                  <label class="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" class="sr-only peer" checked>
                    <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
                
                <div class="flex items-center justify-between">
                  <div>
                    <h3 class="font-medium">Marketing Communications</h3>
                    <p class="text-sm text-muted-foreground">Updates about new features and company news</p>
                  </div>
                  <label class="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" class="sr-only peer">
                    <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <!-- Organization Settings -->
          <div v-show="activeTab === 'organization'" class="bg-card rounded-lg border">
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

          <!-- Billing Settings -->
          <div v-show="activeTab === 'billing'" class="bg-card rounded-lg border">
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

          <!-- Appearance Settings -->
          <div v-show="activeTab === 'appearance'" class="bg-card rounded-lg border">
            <div class="p-6 border-b">
              <h2 class="text-lg font-semibold">Appearance</h2>
              <p class="text-sm text-muted-foreground">Customize the look and feel of your interface.</p>
            </div>
            <div class="p-6">
              <div class="space-y-6">
                <div>
                  <h3 class="font-medium mb-4">Theme</h3>
                  <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <button 
                      @click="setColorMode('light')"
                      :class="[
                        'relative p-4 border-2 rounded-lg transition-all',
                        isClient && currentTheme === 'light'
                          ? 'border-blue-500 bg-blue-50'
                          : 'border hover:border-gray-400'
                      ]"
                    >
                      <div class="absolute top-2 right-2">
                        <div v-if="isClient && currentTheme === 'light'" class="w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                          <Icon name="lucide:check" class="w-2 h-2 text-white" />
                        </div>
                      </div>
                      <div class="space-y-2">
                        <div class="w-full h-8 bg-white border border-gray-200 rounded"></div>
                        <div class="w-full h-4 bg-gray-100 rounded"></div>
                        <div class="w-2/3 h-4 bg-gray-100 rounded"></div>
                      </div>
                      <p class="text-sm font-medium mt-3">Light</p>
                    </button>

                    <button 
                      @click="setColorMode('dark')"
                      :class="[
                        'relative p-4 border-2 rounded-lg transition-all',
                        isClient && currentTheme === 'dark'
                          ? 'border-blue-500 bg-blue-900/20'
                          : 'border hover:border-gray-400'
                      ]"
                    >
                      <div class="absolute top-2 right-2">
                        <div v-if="isClient && currentTheme === 'dark'" class="w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                          <Icon name="lucide:check" class="w-2 h-2 text-white" />
                        </div>
                      </div>
                      <div class="space-y-2">
                        <div class="w-full h-8 bg-gray-800 border border-gray-700 rounded"></div>
                        <div class="w-full h-4 bg-gray-700 rounded"></div>
                        <div class="w-2/3 h-4 bg-gray-700 rounded"></div>
                      </div>
                      <p class="text-sm font-medium mt-3">Dark</p>
                    </button>

                    <button 
                      @click="setColorMode('system')"
                      :class="[
                        'relative p-4 border-2 rounded-lg transition-all',
                        isClient && currentTheme === 'system'
                          ? 'border-blue-500 bg-blue-100'
                          : 'border hover:border-gray-400'
                      ]"
                    >
                      <div class="absolute top-2 right-2">
                        <div v-if="isClient && currentTheme === 'system'" class="w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                          <Icon name="lucide:check" class="w-2 h-2 text-white" />
                        </div>
                      </div>
                      <div class="space-y-2">
                        <div class="w-full h-8 bg-gradient-to-r from-white to-gray-800 border border-gray-300 rounded"></div>
                        <div class="w-full h-4 bg-gradient-to-r from-gray-100 to-gray-700 rounded"></div>
                        <div class="w-2/3 h-4 bg-gradient-to-r from-gray-100 to-gray-700 rounded"></div>
                      </div>
                      <p class="text-sm font-medium mt-3">System</p>
                    </button>
                  </div>
                  
                  <div class="mt-4 p-4 bg-muted rounded-lg">
                    <div class="flex items-start space-x-3">
                      <Icon name="lucide:info" class="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <p class="text-sm font-medium">Current setting: {{ isClient ? currentTheme : 'loading...' }}</p>
                        <p class="text-sm text-muted-foreground mt-1">
                          <span v-if="isClient && currentTheme === 'system'">
                            Automatically switches between light and dark mode based on your system preference.
                          </span>
                          <span v-else-if="isClient && currentTheme === 'light'">
                            Always use light mode regardless of system preference.
                          </span>
                          <span v-else-if="isClient && currentTheme === 'dark'">
                            Always use dark mode regardless of system preference.
                          </span>
                          <span v-else-if="!isClient">
                            Loading theme preferences...
                          </span>
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </NuxtLayout>
</template>

<script setup>
const activeTab = ref('profile')

// Color mode functionality
const colorMode = useColorMode()

// Ensure reactivity for class bindings
const currentTheme = computed(() => colorMode.preference)

const setColorMode = (mode) => {
  colorMode.preference = mode
}

// Handle client-side hydration
const isClient = ref(false)
onMounted(() => {
  isClient.value = true
})
</script> 