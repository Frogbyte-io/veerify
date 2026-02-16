<template>
  <NuxtLayout name="dashboard">
    <div class="p-6">
      <!-- Loading State -->
      <div v-if="isLoading" class="space-y-6">
        <div class="flex items-center gap-3">
          <Skeleton class="h-5 w-5" />
          <Skeleton class="h-8 w-48" />
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div class="lg:col-span-1">
            <Skeleton class="h-48 w-full rounded-lg" />
          </div>
          <div class="lg:col-span-3">
            <Skeleton class="h-64 w-full rounded-lg" />
          </div>
        </div>
      </div>

      <!-- Error State -->
      <div v-else-if="error" class="rounded-lg border bg-card p-8 text-center">
        <Icon name="lucide:alert-circle" class="w-12 h-12 mx-auto text-destructive mb-4" />
        <p class="text-lg font-medium mb-2">Failed to load project</p>
        <p class="text-muted-foreground mb-4">{{ error }}</p>
        <div class="flex items-center justify-center gap-3">
          <Button variant="outline" @click="$router.push('/products')">
            <Icon name="lucide:arrow-left" class="w-4 h-4 mr-2" />
            Back to Products
          </Button>
          <Button variant="outline" @click="loadProject">
            <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>

      <!-- Project Settings -->
      <template v-else-if="projectData">
        <div class="mb-6">
          <div class="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <NuxtLink to="/products" class="hover:text-foreground transition-colors">Products</NuxtLink>
            <Icon name="lucide:chevron-right" class="w-4 h-4" />
            <span class="text-foreground">{{ projectData.name }}</span>
          </div>
          <div class="flex items-center justify-between">
            <div>
              <h1 class="text-3xl font-bold">{{ projectData.name }}</h1>
              <p class="text-muted-foreground">Manage your product settings and configuration</p>
            </div>
            <span
              class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
              :class="projectData.isPublic ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'"
            >
              {{ projectData.isPublic ? 'Public' : 'Private' }}
            </span>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <!-- Settings Navigation -->
          <div class="lg:col-span-1">
            <nav class="bg-card rounded-lg border p-4">
              <ul class="space-y-2">
                <li v-for="tab in tabs" :key="tab.id">
                  <button
                    :class="[
                      'w-full text-left px-3 py-2 rounded-md transition-colors flex items-center',
                      activeTab === tab.id
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'text-muted-foreground hover:bg-accent/50',
                    ]"
                    @click="setActiveTab(tab.id)"
                  >
                    <Icon :name="tab.icon" class="w-4 h-4 mr-2" />
                    {{ tab.label }}
                  </button>
                </li>
              </ul>
            </nav>
          </div>

          <!-- Settings Content -->
          <div class="lg:col-span-3">
            <component
              :is="currentComponent"
              :project="projectData"
              @updated="onProjectUpdated"
              @deleted="onProjectDeleted"
            />
          </div>
        </div>
      </template>
    </div>
  </NuxtLayout>
</template>

<script>
import ProductSettingsGeneral from '~/components/products/ProductSettingsGeneral.vue'
import ProductSettingsCategories from '~/components/products/ProductSettingsCategories.vue'
import ProductSettingsAppearance from '~/components/products/ProductSettingsAppearance.vue'
import ProductSettingsDomain from '~/components/products/ProductSettingsDomain.vue'
import ProductSettingsDanger from '~/components/products/ProductSettingsDanger.vue'

export default {
  name: 'ProductSettingsPage',
  components: {
    ProductSettingsGeneral,
    ProductSettingsCategories,
    ProductSettingsAppearance,
    ProductSettingsDomain,
    ProductSettingsDanger,
  },
  data() {
    return {
      projectData: null,
      isLoading: true,
      error: null,
      activeTab: 'general',
      tabs: [
        { id: 'general', label: 'General', icon: 'lucide:settings' },
        { id: 'categories', label: 'Categories', icon: 'lucide:tags' },
        { id: 'appearance', label: 'Appearance', icon: 'lucide:palette' },
        { id: 'domain', label: 'Custom Domain', icon: 'lucide:globe' },
        { id: 'danger', label: 'Danger Zone', icon: 'lucide:alert-triangle' },
      ],
    }
  },
  computed: {
    currentComponent() {
      const componentMap = {
        general: 'ProductSettingsGeneral',
        categories: 'ProductSettingsCategories',
        appearance: 'ProductSettingsAppearance',
        domain: 'ProductSettingsDomain',
        danger: 'ProductSettingsDanger',
      }
      return componentMap[this.activeTab] || 'ProductSettingsGeneral'
    },
  },
  async mounted() {
    const hash = window.location.hash.replace('#', '')
    if (hash && ['general', 'categories', 'appearance', 'domain', 'danger'].includes(hash)) {
      this.activeTab = hash
    }
    await this.loadProject()
  },
  methods: {
    async loadProject() {
      this.isLoading = true
      this.error = null

      try {
        const slug = this.$route.params.slug
        const response = await $fetch(`/api/projects/${slug}`)
        this.projectData = response?.data || null

        if (!this.projectData) {
          this.error = 'Project not found'
        }
      } catch (err) {
        console.error('Error loading project:', err)
        this.error = err?.data?.error?.message || 'Failed to load project'
      } finally {
        this.isLoading = false
      }
    },

    setActiveTab(tab) {
      this.activeTab = tab
      window.history.replaceState(null, '', `#${tab}`)
    },

    onProjectUpdated(updatedProject) {
      this.projectData = { ...this.projectData, ...updatedProject }
    },

    onProjectDeleted() {
      this.$router.push('/products')
    },
  },
}
</script>
