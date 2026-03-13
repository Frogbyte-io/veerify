<template>
  <NuxtLayout name="dashboard">
    <div class="p-6">
      <div class="mb-6">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-3xl font-bold">Products</h1>
            <p class="text-muted-foreground">Manage your products and their public feedback pages</p>
          </div>
          <Button @click="showCreateDialog = true">
            <Icon name="lucide:plus" class="w-4 h-4 mr-2" />
            New Product
          </Button>
        </div>
      </div>

      <!-- Loading State -->
      <div v-if="isLoading" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div v-for="n in 3" :key="n" class="rounded-lg border bg-card p-6">
          <Skeleton class="h-6 w-40 mb-2" />
          <Skeleton class="h-4 w-60 mb-4" />
          <Skeleton class="h-4 w-32" />
        </div>
      </div>

      <!-- Error State -->
      <div v-else-if="error" class="rounded-lg border bg-card p-8 text-center">
        <Icon name="lucide:alert-circle" class="w-12 h-12 mx-auto text-destructive mb-4" />
        <p class="text-lg font-medium mb-2">Failed to load products</p>
        <p class="text-muted-foreground mb-4">{{ error }}</p>
        <Button variant="outline" @click="loadProducts">
          <Icon name="lucide:refresh-cw" class="w-4 h-4 mr-2" />
          Retry
        </Button>
      </div>

      <!-- Empty State -->
      <div v-else-if="products.length === 0" class="rounded-lg border bg-card p-12 text-center">
        <Icon name="lucide:package" class="w-16 h-16 mx-auto text-muted-foreground mb-4" />
        <h2 class="text-xl font-semibold mb-2">No products yet</h2>
        <p class="text-muted-foreground mb-6">
          Create your first product to start collecting feedback from your users.
        </p>
        <Button @click="showCreateDialog = true">
          <Icon name="lucide:plus" class="w-4 h-4 mr-2" />
          Create Your First Product
        </Button>
      </div>

      <!-- Products Grid -->
      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <NuxtLink
          v-for="product in products"
          :key="product.id"
          :to="`/products/${product.slug}`"
          prefetch-on="interaction"
          class="rounded-lg border bg-card hover:shadow-md hover:border-primary/50 transition-all cursor-pointer block"
        >
          <div class="p-6">
            <div class="flex items-start justify-between mb-3">
              <div>
                <h3 class="text-lg font-semibold">{{ product.name }}</h3>
                <p class="text-sm text-muted-foreground">{{ product.slug }}</p>
              </div>
              <span
                class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium"
                :class="
                  product.isPublic
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                    : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                "
              >
                {{ product.isPublic ? 'Public' : 'Private' }}
              </span>
            </div>
            <p v-if="product.description" class="text-sm text-muted-foreground mb-4 line-clamp-2">
              {{ product.description }}
            </p>
            <div class="flex items-center justify-between text-sm text-muted-foreground">
              <div class="flex items-center gap-1">
                <Icon name="lucide:message-square" class="w-4 h-4" />
                <span>{{ product.feedbackCount || 0 }} feedback</span>
              </div>
              <div v-if="product.customDomain" class="flex items-center gap-1">
                <Icon name="lucide:globe" class="w-4 h-4" />
                <span>{{ product.customDomain }}</span>
              </div>
            </div>
          </div>
          <div class="border-t px-6 py-3 flex items-center justify-between">
            <span
              class="text-sm text-primary hover:underline flex items-center gap-1"
              @click.prevent="openPublicPage(product)"
            >
              <Icon name="lucide:external-link" class="w-3 h-3" />
              View Public Page
            </span>
            <button class="text-sm text-muted-foreground hover:text-foreground" @click.prevent="copyPublicUrl(product)">
              <Icon name="lucide:copy" class="w-4 h-4" />
            </button>
          </div>
        </NuxtLink>
      </div>

      <!-- Create Product Dialog -->
      <Dialog :open="showCreateDialog" @update:open="handleDialogOpenChange">
        <DialogContent class="sm:max-w-[520px]">
          <!-- Step progress indicator -->
          <div class="flex items-center gap-2 mb-1">
            <div class="flex items-center gap-1.5">
              <div
                class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold transition-colors"
                :class="currentStep >= 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'"
              >
                1
              </div>
              <div class="w-8 h-0.5 transition-colors" :class="currentStep >= 2 ? 'bg-primary' : 'bg-muted'" />
              <div
                class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold transition-colors"
                :class="currentStep >= 2 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'"
              >
                2
              </div>
            </div>
            <span class="text-xs text-muted-foreground ml-1">Step {{ currentStep }} of 2</span>
          </div>

          <!-- Step 1: Basic Info -->
          <template v-if="currentStep === 1">
            <DialogHeader class="mb-4">
              <h2 class="text-lg font-semibold">Create New Product</h2>
              <p class="text-sm text-muted-foreground">Name your product and set up its public URL.</p>
            </DialogHeader>
            <div class="space-y-4">
              <div class="space-y-2">
                <Label for="name">Product Name</Label>
                <Input id="name" v-model="form.name" placeholder="My Awesome App" @input="generateSlug" />
              </div>
              <div class="space-y-2">
                <Label for="slug">URL Slug</Label>
                <Input id="slug" v-model="form.slug" placeholder="my-awesome-app" />
                <p class="text-xs text-muted-foreground">Public URL: {{ publicUrlPreview }}</p>
              </div>
              <div class="space-y-2">
                <Label for="description"
                  >Description <span class="text-muted-foreground font-normal">(optional)</span></Label
                >
                <Input id="description" v-model="form.description" placeholder="A brief description of your product" />
              </div>
            </div>
            <DialogFooter class="mt-6">
              <Button variant="outline" @click="handleDialogOpenChange(false)">Cancel</Button>
              <Button :disabled="!form.name || !form.slug" @click="currentStep = 2">
                Continue
                <Icon name="lucide:arrow-right" class="w-4 h-4 ml-2" />
              </Button>
            </DialogFooter>
          </template>

          <!-- Step 2: Feature Setup -->
          <template v-if="currentStep === 2">
            <DialogHeader class="mb-4">
              <h2 class="text-lg font-semibold">Configure Features</h2>
              <p class="text-sm text-muted-foreground">
                Choose what to enable for <strong>{{ form.name }}</strong
                >. You can change these later.
              </p>
            </DialogHeader>
            <div class="space-y-3">
              <!-- Public Feedback Board -->
              <div
                class="flex items-start justify-between rounded-lg border p-4 cursor-pointer transition-colors hover:bg-muted/50"
                :class="form.isPublic ? 'border-primary/50 bg-primary/5' : ''"
                @click="form.isPublic = !form.isPublic"
              >
                <div class="flex items-start gap-3 flex-1 min-w-0">
                  <div
                    class="w-8 h-8 rounded-md flex items-center justify-center shrink-0 mt-0.5"
                    :class="form.isPublic ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'"
                  >
                    <Icon name="lucide:message-square" class="w-4 h-4" />
                  </div>
                  <div class="min-w-0">
                    <p class="text-sm font-medium">Public Feedback Board</p>
                    <p class="text-xs text-muted-foreground mt-0.5">Anyone can view, submit, and vote on feedback</p>
                  </div>
                </div>
                <Switch
                  :checked="form.isPublic"
                  class="shrink-0 ml-3 mt-0.5"
                  @click.stop="form.isPublic = !form.isPublic"
                />
              </div>

              <!-- Changelog -->
              <div
                class="flex items-start justify-between rounded-lg border p-4 cursor-pointer transition-colors hover:bg-muted/50"
                :class="form.changelogEnabled ? 'border-primary/50 bg-primary/5' : ''"
                @click="form.changelogEnabled = !form.changelogEnabled"
              >
                <div class="flex items-start gap-3 flex-1 min-w-0">
                  <div
                    class="w-8 h-8 rounded-md flex items-center justify-center shrink-0 mt-0.5"
                    :class="form.changelogEnabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'"
                  >
                    <Icon name="lucide:newspaper" class="w-4 h-4" />
                  </div>
                  <div class="min-w-0">
                    <p class="text-sm font-medium">Changelog</p>
                    <p class="text-xs text-muted-foreground mt-0.5">Publish release notes and product updates</p>
                  </div>
                </div>
                <Switch
                  :checked="form.changelogEnabled"
                  class="shrink-0 ml-3 mt-0.5"
                  @click.stop="form.changelogEnabled = !form.changelogEnabled"
                />
              </div>

              <!-- Public Roadmap -->
              <div
                class="flex items-start justify-between rounded-lg border p-4 cursor-pointer transition-colors hover:bg-muted/50"
                :class="form.roadmapEnabled ? 'border-primary/50 bg-primary/5' : ''"
                @click="form.roadmapEnabled = !form.roadmapEnabled"
              >
                <div class="flex items-start gap-3 flex-1 min-w-0">
                  <div
                    class="w-8 h-8 rounded-md flex items-center justify-center shrink-0 mt-0.5"
                    :class="form.roadmapEnabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'"
                  >
                    <Icon name="lucide:map" class="w-4 h-4" />
                  </div>
                  <div class="min-w-0">
                    <p class="text-sm font-medium">Public Roadmap</p>
                    <p class="text-xs text-muted-foreground mt-0.5">
                      Share your planned features and priorities publicly
                    </p>
                  </div>
                </div>
                <Switch
                  :checked="form.roadmapEnabled"
                  class="shrink-0 ml-3 mt-0.5"
                  @click.stop="form.roadmapEnabled = !form.roadmapEnabled"
                />
              </div>
            </div>
            <DialogFooter class="mt-6">
              <Button variant="outline" @click="currentStep = 1">
                <Icon name="lucide:arrow-left" class="w-4 h-4 mr-2" />
                Back
              </Button>
              <Button :disabled="isCreating" @click="createProduct">
                <Icon v-if="isCreating" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
                Create Product
              </Button>
            </DialogFooter>
          </template>
        </DialogContent>
      </Dialog>
    </div>
  </NuxtLayout>
</template>

<script>
import { toast } from 'vue-sonner'

const ACTIVE_TEAM_CHANGED_EVENT = 'veerify:active-team-changed'

export default {
  name: 'ProductsPage',

  data() {
    return {
      products: [],
      isLoading: true,
      error: null,
      showCreateDialog: false,
      currentStep: 1,
      isCreating: false,
      activeTeamId: '',
      activeTeamSlug: '',
      activeOrgSlug: '',
      form: {
        name: '',
        slug: '',
        description: '',
        isPublic: true,
        changelogEnabled: false,
        roadmapEnabled: false,
      },
    }
  },

  computed: {
    publicUrlPreview() {
      if (!import.meta.client) return ''
      const appDomain = useRuntimeConfig().public.appDomain || 'localhost'
      const teamSlug = this.activeTeamSlug || '...'
      const protocol = window.location.protocol
      const port = window.location.port
      const portSuffix = port && port !== '80' && port !== '443' ? `:${port}` : ''
      return `${protocol}//${teamSlug}.${appDomain}${portSuffix}/${this.form.slug || '...'}`
    },
  },

  async mounted() {
    await this.initTeamContext()

    if (import.meta.client) {
      window.addEventListener(ACTIVE_TEAM_CHANGED_EVENT, this.handleActiveTeamChanged)
    }
  },

  beforeUnmount() {
    if (import.meta.client) {
      window.removeEventListener(ACTIVE_TEAM_CHANGED_EVENT, this.handleActiveTeamChanged)
    }
  },

  methods: {
    async handleActiveTeamChanged() {
      await this.initTeamContext()
    },

    async initTeamContext() {
      this.isLoading = true
      this.error = null

      try {
        // Load active team with organization data
        const teamResponse = await $fetch('/api/teams/active')
        const activeTeamData = teamResponse?.data

        if (!activeTeamData?.id) {
          this.error = 'No active team found'
          this.isLoading = false
          return
        }

        this.activeTeamId = activeTeamData.id
        this.activeTeamSlug = activeTeamData.slug || ''

        // Extract organization slug from the response
        if (activeTeamData.organization?.slug) {
          this.activeOrgSlug = activeTeamData.organization.slug
        }

        // Load products
        await this.loadProducts()
      } catch (err) {
        console.error('Error initializing team context:', err)
        this.error = err?.data?.message || 'Failed to load team context'
        this.isLoading = false
      }
    },

    async loadProducts() {
      if (!this.activeTeamId) return

      this.isLoading = true
      this.error = null

      try {
        const response = await $fetch(`/api/teams/${this.activeTeamId}/projects`)
        this.products = response?.data || []
      } catch (err) {
        console.error('Error loading products:', err)
        this.error = 'Failed to load products. Please try again.'
      } finally {
        this.isLoading = false
      }
    },

    generateSlug() {
      this.form.slug = this.form.name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
    },

    handleDialogOpenChange(open) {
      this.showCreateDialog = open
      if (!open) {
        this.currentStep = 1
        this.form = {
          name: '',
          slug: '',
          description: '',
          isPublic: true,
          changelogEnabled: false,
          roadmapEnabled: false,
        }
      }
    },

    async createProduct() {
      if (!this.activeTeamId || !this.form.name || !this.form.slug) return

      this.isCreating = true

      try {
        await $fetch(`/api/teams/${this.activeTeamId}/projects`, {
          method: 'POST',
          body: {
            name: this.form.name,
            slug: this.form.slug,
            description: this.form.description || null,
            isPublic: this.form.isPublic,
            settings: {
              changelogEnabled: this.form.changelogEnabled,
              roadmapEnabled: this.form.roadmapEnabled,
            },
          },
        })

        this.handleDialogOpenChange(false)
        await this.loadProducts()
      } catch (err) {
        console.error('Error creating product:', err)
        toast.error(err?.data?.error?.message || 'Failed to create product')
      } finally {
        this.isCreating = false
      }
    },

    getProductPublicUrl(product) {
      const appDomain = useRuntimeConfig().public.appDomain || 'localhost'
      const teamSlug = this.activeTeamSlug || '...'
      const protocol = window.location.protocol
      const port = window.location.port
      const portSuffix = port && port !== '80' && port !== '443' ? `:${port}` : ''
      return `${protocol}//${teamSlug}.${appDomain}${portSuffix}/${product.slug}`
    },

    openPublicPage(product) {
      window.open(this.getProductPublicUrl(product), '_blank')
    },

    copyPublicUrl(product) {
      navigator.clipboard.writeText(this.getProductPublicUrl(product)).catch(() => {})
    },
  },
}
</script>
