<template>
  <div class="bg-card rounded-lg border">
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
                  ? 'border-blue-500 bg-blue-900/20'
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
</template>

<script>
export default {
  name: 'SettingsAppearance',
  data() {
    return {
      isClient: false,
      colorMode: null
    }
  },
  computed: {
    currentTheme() {
      return this.colorMode?.preference || 'system'
    }
  },
  mounted() {
    this.isClient = true
    this.colorMode = useColorMode()
  },
  methods: {
    setColorMode(mode) {
      if (this.colorMode) {
        this.colorMode.preference = mode
      }
    }
  }
}
</script> 