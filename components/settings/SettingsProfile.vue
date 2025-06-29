<template>
  <div class="bg-card rounded-lg border">
    <div class="p-6 border-b">
      <h2 class="text-lg font-semibold">Profile Information</h2>
      <p class="text-sm text-muted-foreground">Update your account profile information and email address.</p>
    </div>
    <div class="p-6">
      <!-- Loading state -->
      <div v-if="isLoading" class="space-y-6">
        <Skeleton class="h-12 w-full" />
        <Skeleton class="h-12 w-full" />
        <Skeleton class="h-10 w-20" />
      </div>
      
      <!-- Error state -->
      <div v-else-if="!user" class="text-center py-8">
        <p class="text-muted-foreground">Unable to load profile information</p>
        <Button variant="outline" @click="loadProfile" class="mt-4">
          Try Again
        </Button>
      </div>
      
      <!-- Profile form -->
      <form v-else @submit.prevent="handleSubmit" class="space-y-6">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="md:col-span-2">
            <Label for="name" :class="{ 'text-destructive': fieldErrors.name }">
              Full Name
            </Label>
            <Input
              id="name"
              v-model="formData.name"
              type="text"
              placeholder="Enter your full name"
              required
              :disabled="isSaving"
              :class="{ 
                'border-destructive focus:border-destructive focus:ring-destructive': fieldErrors.name,
                'mt-2': true
              }"
              @input="clearFieldError('name')"
            />
            <p v-if="fieldErrors.name" class="text-sm text-destructive mt-1">
              {{ fieldErrors.name }}
            </p>
          </div>
          
          <div class="md:col-span-2">
            <Label for="email" :class="{ 'text-destructive': fieldErrors.email }">
              Email Address
            </Label>
            <Input
              id="email"
              v-model="formData.email"
              type="email"
              placeholder="Enter your email address"
              required
              :disabled="isSaving"
              :class="{ 
                'border-destructive focus:border-destructive focus:ring-destructive': fieldErrors.email,
                'mt-2': true
              }"
              @input="clearFieldError('email')"
            />
            <p v-if="fieldErrors.email" class="text-sm text-destructive mt-1">
              {{ fieldErrors.email }}
            </p>
          </div>
        </div>
        
        <div class="flex justify-end space-x-3">
          <Button
            type="button"
            variant="outline"
            @click="resetForm"
            :disabled="isSaving || !hasChanges"
          >
            Reset
          </Button>
          <Button
            type="submit"
            :disabled="isSaving || !hasChanges"
          >
            <template v-if="isSaving">
              <Icon name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </template>
            <template v-else>
              Save Changes
            </template>
          </Button>
        </div>
      </form>
    </div>
  </div>
</template>

<script>
import { authClient } from '~/lib/auth-client'
import { toast } from 'vue-sonner'

export default {
  name: 'SettingsProfile',
  
  data() {
    return {
      session: null,
      isPending: true,
      formData: {
        name: '',
        email: ''
      },
      originalData: {
        name: '',
        email: ''
      },
      fieldErrors: {
        name: '',
        email: ''
      },
      isSaving: false
    }
  },

  async mounted() {
    await this.loadProfile()
  },

  computed: {
    user() {
      return this.session?.user || null
    },
    
    isLoading() {
      return this.isPending
    },
    
    hasChanges() {
      return this.formData.name !== this.originalData.name || 
             this.formData.email !== this.originalData.email
    }
  },

  methods: {
    async loadProfile() {
      try {
        this.isPending = true
        
        const { data: session, isPending } = await authClient.useSession(useFetch)
        this.session = session.value
        this.isPending = isPending.value
        
        if (this.session?.user) {
          this.formData = {
            name: this.session.user.name || '',
            email: this.session.user.email || ''
          }
          this.originalData = { ...this.formData }
        }
        
        // Watch for changes
        watch(session, (newSession) => {
          this.session = newSession
          if (newSession?.user) {
            this.formData = {
              name: newSession.user.name || '',
              email: newSession.user.email || ''
            }
            this.originalData = { ...this.formData }
          }
        })
        
        watch(isPending, (newPending) => {
          this.isPending = newPending
        })
        
      } catch (error) {
        console.error('Error loading profile:', error)
        toast.error('Failed to load profile information')
        this.isPending = false
      }
    },

    validateForm() {
      let isValid = true
      this.fieldErrors = { name: '', email: '' }

      // Validate name
      if (!this.formData.name.trim()) {
        this.fieldErrors.name = 'Name is required'
        isValid = false
      }

      // Validate email
      if (!this.formData.email.trim()) {
        this.fieldErrors.email = 'Email is required'
        isValid = false
      } else {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(this.formData.email)) {
          this.fieldErrors.email = 'Please enter a valid email address'
          isValid = false
        }
      }

      return isValid
    },

    clearFieldError(field) {
      this.fieldErrors[field] = ''
    },

    clearAllErrors() {
      this.fieldErrors = { name: '', email: '' }
    },

    async handleSubmit() {
      try {
        this.isSaving = true
        this.clearAllErrors()

        // Validate form
        if (!this.validateForm()) {
          // Show toast for first error found
          const firstError = this.fieldErrors.name || this.fieldErrors.email
          if (firstError) {
            toast.error(firstError)
          }
          return
        }

        // Submit update
        const response = await $fetch('/api/user/profile', {
          method: 'PUT',
          body: {
            name: this.formData.name.trim(),
            email: this.formData.email.trim()
          }
        })

        if (response.success) {
          toast.success('Profile updated successfully')
          this.originalData = { ...this.formData }
        }

      } catch (error) {
        console.error('Error updating profile:', error)
        
        let errorMessage = 'Failed to update profile. Please try again.'
        
        if (error.data?.statusMessage) {
          errorMessage = error.data.statusMessage
          
          // Handle specific field errors from server
          if (errorMessage.includes('email')) {
            this.fieldErrors.email = errorMessage
          } else if (errorMessage.includes('name')) {
            this.fieldErrors.name = errorMessage
          }
        } else if (error.statusMessage) {
          errorMessage = error.statusMessage
        }
        
        toast.error(errorMessage)
      } finally {
        this.isSaving = false
      }
    },

    resetForm() {
      this.formData = { ...this.originalData }
      this.clearAllErrors()
    }
  }
}
</script> 