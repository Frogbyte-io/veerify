<template>
  <div class="bg-card rounded-lg border">
    <div class="p-6 border-b">
      <h2 class="text-lg font-semibold">Security</h2>
      <p class="text-sm text-muted-foreground">Manage your account security and authentication settings.</p>
    </div>
    <div class="p-6">
      <div class="space-y-8">
        <!-- Password Change Section -->
        <div>
          <h3 class="font-medium mb-4">Change Password</h3>
          <form class="space-y-4" @submit.prevent="handlePasswordChange">
            <div class="space-y-2">
              <Label for="currentPassword">Current Password</Label>
              <Input
                id="currentPassword"
                v-model="passwordForm.currentPassword"
                type="password"
                :disabled="isChangingPassword"
                placeholder="Enter your current password"
                required
              />
            </div>
            <div class="space-y-2">
              <Label for="newPassword">New Password</Label>
              <Input
                id="newPassword"
                v-model="passwordForm.newPassword"
                type="password"
                :disabled="isChangingPassword"
                placeholder="Enter your new password"
                required
              />
            </div>
            <div class="space-y-2">
              <Label for="confirmPassword">Confirm New Password</Label>
              <Input
                id="confirmPassword"
                v-model="passwordForm.confirmPassword"
                type="password"
                :disabled="isChangingPassword"
                placeholder="Confirm your new password"
                required
              />
            </div>

            <!-- Password Error Display -->
            <div v-if="passwordError" class="p-3 border border-red-200 rounded-lg bg-red-50">
              <div class="flex items-center gap-2 text-red-600">
                <Icon name="lucide:alert-circle" class="h-4 w-4" />
                <span class="text-sm font-medium">{{ passwordError }}</span>
              </div>
            </div>

            <Button type="submit" :disabled="isChangingPassword || !isPasswordFormValid">
              <Icon v-if="isChangingPassword" name="lucide:loader-2" class="h-4 w-4 mr-2 animate-spin" />
              <Icon v-else name="lucide:key" class="h-4 w-4 mr-2" />
              {{ isChangingPassword ? 'Updating Password...' : 'Update Password' }}
            </Button>
          </form>
        </div>

        <Separator />

        <!-- Two-Factor Authentication Section -->

        <div>
          <h3 class="font-medium mb-4">Two-Factor Authentication</h3>

          <!-- 2FA Status -->
          <div class="flex items-center justify-between p-4 border rounded-lg mb-4">
            <div class="flex items-center gap-3">
              <div class="p-2 rounded-full" :class="user?.twoFactorEnabled ? 'bg-green-100' : 'bg-gray-100'">
                <Icon
                  :name="user?.twoFactorEnabled ? 'lucide:shield-check' : 'lucide:shield'"
                  class="h-4 w-4"
                  :class="user?.twoFactorEnabled ? 'text-green-600' : 'text-gray-600'"
                />
              </div>
              <div>
                <p class="font-medium">
                  Two-Factor Authentication {{ user?.twoFactorEnabled ? 'Enabled' : 'Disabled' }}
                </p>
                <p class="text-sm text-muted-foreground">
                  {{
                    user?.twoFactorEnabled
                      ? 'Your account is secured with 2FA'
                      : 'Add an extra layer of security to your account'
                  }}
                </p>
              </div>
            </div>
            <Badge :variant="user?.twoFactorEnabled ? 'default' : 'secondary'">
              {{ user?.twoFactorEnabled ? 'Active' : 'Inactive' }}
            </Badge>
          </div>

          <!-- 2FA Actions -->
          <div v-if="!user?.twoFactorEnabled" class="space-y-4">
            <div class="p-4 border rounded-lg bg-blue-50 border-blue-200">
              <div class="flex items-start gap-3">
                <Icon name="lucide:info" class="h-5 w-5 text-blue-600 mt-0.5" />
                <div>
                  <h4 class="font-medium text-blue-900">Enable Two-Factor Authentication</h4>
                  <p class="text-sm text-blue-700 mt-1">
                    Use an authenticator app like Google Authenticator or Authy to generate time-based codes for
                    enhanced security.
                  </p>
                </div>
              </div>
            </div>

            <!-- Enable 2FA Form -->
            <form class="space-y-4" @submit.prevent="handleEnable2FA">
              <div class="space-y-2">
                <Label for="enable2faPassword">Confirm Password</Label>
                <Input
                  id="enable2faPassword"
                  v-model="twoFactorForm.password"
                  type="password"
                  :disabled="isEnabling2FA"
                  placeholder="Enter your password to enable 2FA"
                  required
                />
              </div>

              <!-- 2FA Error Display -->
              <div v-if="twoFactorError" class="p-3 border border-red-200 rounded-lg bg-red-50">
                <div class="flex items-center gap-2 text-red-600">
                  <Icon name="lucide:alert-circle" class="h-4 w-4" />
                  <span class="text-sm font-medium">{{ twoFactorError }}</span>
                </div>
              </div>

              <Button type="submit" :disabled="isEnabling2FA || !twoFactorForm.password">
                <Icon v-if="isEnabling2FA" name="lucide:loader-2" class="h-4 w-4 mr-2 animate-spin" />
                <Icon v-else name="lucide:shield-plus" class="h-4 w-4 mr-2" />
                {{ isEnabling2FA ? 'Setting up 2FA...' : 'Enable 2FA' }}
              </Button>
            </form>
          </div>

          <!-- 2FA QR Code Setup -->
          <div v-if="showQRSetup" class="space-y-4 p-4 border rounded-lg bg-gray-50">
            <h4 class="font-medium">Set up your authenticator app</h4>
            <ol class="text-sm space-y-2 text-muted-foreground">
              <li class="flex gap-2">
                <span class="font-medium text-primary">1.</span>
                Download an authenticator app like Google Authenticator or Authy
              </li>
              <li class="flex gap-2">
                <span class="font-medium text-primary">2.</span>
                Scan the QR code below with your authenticator app
              </li>
              <li class="flex gap-2">
                <span class="font-medium text-primary">3.</span>
                Enter the 6-digit code from your app to complete setup
              </li>
            </ol>

            <!-- QR Code Display -->
            <div v-if="qrCodeData" class="flex flex-col items-center space-y-4 p-4 bg-white rounded-lg border">
              <div class="p-4 bg-white rounded-lg border-2 border-dashed">
                <canvas ref="qrCanvas" class="w-48 h-48" />
              </div>
              <p class="text-xs text-center text-muted-foreground max-w-sm">
                Scan this QR code with your authenticator app
              </p>
            </div>

            <!-- TOTP Verification -->
            <form class="space-y-4" @submit.prevent="handleVerifyTOTP">
              <div class="space-y-2">
                <Label for="totpCode">Enter verification code</Label>
                <Input
                  id="totpCode"
                  v-model="totpVerificationCode"
                  type="text"
                  :disabled="isVerifyingTOTP"
                  placeholder="000000"
                  maxlength="6"
                  pattern="[0-9]{6}"
                  required
                />
              </div>

              <div class="flex gap-2">
                <Button type="submit" :disabled="isVerifyingTOTP || !totpVerificationCode">
                  <Icon v-if="isVerifyingTOTP" name="lucide:loader-2" class="h-4 w-4 mr-2 animate-spin" />
                  <Icon v-else name="lucide:check" class="h-4 w-4 mr-2" />
                  {{ isVerifyingTOTP ? 'Verifying...' : 'Verify & Complete Setup' }}
                </Button>
                <Button type="button" variant="outline" :disabled="isVerifyingTOTP" @click="cancelQRSetup">
                  Cancel
                </Button>
              </div>
            </form>
          </div>

          <!-- 2FA Management (when enabled) -->
          <div v-if="user?.twoFactorEnabled && !showQRSetup" class="space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Button variant="outline" :disabled="isLoadingBackupCodes" @click="handleViewBackupCodes">
                <Icon v-if="isLoadingBackupCodes" name="lucide:loader-2" class="h-4 w-4 mr-2 animate-spin" />
                <Icon v-else name="lucide:download" class="h-4 w-4 mr-2" />
                View Backup Codes
              </Button>
              <Button variant="destructive" :disabled="isDisabling2FA" @click="handleDisable2FA">
                <Icon v-if="isDisabling2FA" name="lucide:loader-2" class="h-4 w-4 mr-2 animate-spin" />
                <Icon v-else name="lucide:shield-off" class="h-4 w-4 mr-2" />
                Disable 2FA
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Backup Codes Dialog -->
    <Dialog v-model:open="showBackupCodesDialog">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <Icon name="lucide:shield-check" class="h-5 w-5" />
            Backup Recovery Codes
          </DialogTitle>
          <DialogDescription>
            Save these codes securely. Each code can only be used once to recover your account if you lose access to
            your authenticator app.
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4">
          <div class="p-4 bg-gray-50 rounded-lg border-2 border-dashed">
            <div class="grid grid-cols-2 gap-2 font-mono text-sm">
              <div v-for="(code, index) in displayBackupCodes" :key="index" class="p-2 bg-white rounded border">
                {{ code }}
              </div>
            </div>
          </div>

          <div class="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <Icon name="lucide:triangle-alert" class="h-4 w-4 text-amber-600 mt-0.5" />
            <div class="text-sm text-amber-700">
              <p class="font-medium">Important:</p>
              <ul class="mt-1 space-y-1 text-xs">
                <li>• Store these codes in a secure location</li>
                <li>• Each code can only be used once</li>
                <li>• Generate new codes if you lose these</li>
              </ul>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="copyBackupCodes">
            <Icon name="lucide:copy" class="h-4 w-4 mr-2" />
            Copy Codes
          </Button>
          <Button @click="showBackupCodesDialog = false">
            <Icon name="lucide:check" class="h-4 w-4 mr-2" />
            I've Saved Them
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script>
import { authClient } from '~/lib/auth-client'
import { toast } from 'vue-sonner'
import QRCode from 'qrcode'

export default {
  name: 'SettingsSecurity',
  data() {
    return {
      // Session and user data
      user: null,

      // Password change form
      passwordForm: {
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      },
      isChangingPassword: false,
      passwordError: null,

      // Two-factor authentication
      twoFactorForm: {
        password: '',
      },
      isEnabling2FA: false,
      isDisabling2FA: false,
      isVerifyingTOTP: false,
      isLoadingBackupCodes: false,
      twoFactorError: null,

      // QR Code setup
      showQRSetup: false,
      qrCodeData: null,
      totpVerificationCode: '',

      // Backup codes
      backupCodes: [],
      displayBackupCodes: [],
      showBackupCodesDialog: false,
    }
  },

  computed: {
    isPasswordFormValid() {
      return (
        this.passwordForm.currentPassword &&
        this.passwordForm.newPassword &&
        this.passwordForm.confirmPassword &&
        this.passwordForm.newPassword === this.passwordForm.confirmPassword &&
        this.passwordForm.newPassword.length >= 8
      )
    },
  },

  async mounted() {
    await this.loadUserSession()
  },

  methods: {
    async loadUserSession() {
      try {
        const { data: session } = await authClient.useSession(useFetch)
        this.user = session.value?.user || null
      } catch (error) {
        console.error('Failed to load user session:', error)
        toast.error('Failed to load user information')
      }
    },

    async handlePasswordChange() {
      if (!this.isPasswordFormValid) return

      this.isChangingPassword = true
      this.passwordError = null

      try {
        await authClient.changePassword({
          currentPassword: this.passwordForm.currentPassword,
          newPassword: this.passwordForm.newPassword,
          revokeOtherSessions: true,
        })

        // Reset form
        this.passwordForm = {
          currentPassword: '',
          newPassword: '',
          confirmPassword: '',
        }

        toast.success('Password updated successfully! You have been signed out of other devices.')
      } catch (error) {
        this.passwordError = error.message || 'Failed to update password. Please try again.'
        toast.error('Failed to update password')
      } finally {
        this.isChangingPassword = false
      }
    },

    async handleEnable2FA() {
      if (!this.twoFactorForm.password) return

      this.isEnabling2FA = true
      this.twoFactorError = null

      try {
        const { data } = await authClient.twoFactor.enable({
          password: this.twoFactorForm.password,
        })

        if (data?.totpURI) {
          this.qrCodeData = data.totpURI
          this.backupCodes = data.backupCodes || []
          this.showQRSetup = true
          await this.generateQRCode(data.totpURI)
          toast.success('2FA setup initiated. Please scan the QR code with your authenticator app.')
        }
      } catch (error) {
        this.twoFactorError = error.message || 'Failed to enable 2FA. Please try again.'
        toast.error('Failed to enable 2FA')
      } finally {
        this.isEnabling2FA = false
      }
    },

    async handleVerifyTOTP() {
      if (!this.totpVerificationCode) return

      this.isVerifyingTOTP = true
      this.twoFactorError = null

      try {
        await authClient.twoFactor.verifyTotp({
          code: this.totpVerificationCode,
        })

        // Refresh user data
        await this.loadUserSession()

        // Reset form and hide QR setup
        this.totpVerificationCode = ''
        this.showQRSetup = false
        this.twoFactorForm.password = ''

        // Show backup codes if available
        if (this.backupCodes.length > 0) {
          this.displayBackupCodes = this.backupCodes
          this.showBackupCodesDialog = true
        }

        toast.success('Two-factor authentication enabled successfully!')
      } catch (error) {
        this.twoFactorError = error.message || 'Invalid verification code. Please try again.'
        toast.error('Invalid verification code')
      } finally {
        this.isVerifyingTOTP = false
      }
    },

    async handleDisable2FA() {
      const password = prompt('Please enter your password to disable 2FA:')
      if (!password) return

      this.isDisabling2FA = true

      try {
        await authClient.twoFactor.disable({
          password,
        })

        // Refresh user data
        await this.loadUserSession()

        toast.success('Two-factor authentication disabled successfully')
      } catch (error) {
        const errorMessage = error.message || 'Failed to disable 2FA. Please try again.'
        toast.error(errorMessage)
      } finally {
        this.isDisabling2FA = false
      }
    },

    async handleViewBackupCodes() {
      this.isLoadingBackupCodes = true

      try {
        const password = prompt('Please enter your password to view backup codes:')
        if (!password) {
          this.isLoadingBackupCodes = false
          return
        }

        const { data } = await authClient.twoFactor.generateBackupCodes({
          password,
        })

        if (data?.backupCodes) {
          this.displayBackupCodes = data.backupCodes
          this.showBackupCodesDialog = true
        }
      } catch (error) {
        toast.error(error.message || 'Failed to generate backup codes')
      } finally {
        this.isLoadingBackupCodes = false
      }
    },

    async copyBackupCodes() {
      if (!import.meta.client || !this.displayBackupCodes.length) return

      try {
        const codesText = this.displayBackupCodes.join('\n')
        await navigator.clipboard.writeText(codesText)
        toast.success('Backup codes copied to clipboard')
      } catch (_error) {
        toast.error('Failed to copy backup codes')
      }
    },

    cancelQRSetup() {
      this.showQRSetup = false
      this.qrCodeData = null
      this.totpVerificationCode = ''
      this.twoFactorForm.password = ''
      toast.info('2FA setup cancelled')
    },

    async generateQRCode(uri) {
      if (!import.meta.client || !this.$refs.qrCanvas) return

      try {
        const canvas = this.$refs.qrCanvas
        await QRCode.toCanvas(canvas, uri, {
          width: 192,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#FFFFFF',
          },
        })
      } catch (error) {
        console.error('Failed to generate QR code:', error)
        toast.error('Failed to generate QR code')
      }
    },
  },
}
</script>
