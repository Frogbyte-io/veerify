<template>
  <div class="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Icon name="lucide:palette" class="h-5 w-5" />
          Board Appearance
        </CardTitle>
        <CardDescription>Customize how your public feedback board looks.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="space-y-2">
          <Label>Accent Color</Label>
          <ColorPicker v-model="form.accentColor" />
          <p class="text-xs text-muted-foreground">Used for buttons and links on your public board.</p>
        </div>

        <div class="space-y-2">
          <Label for="logo-file">Logo Image</Label>
          <Input
            id="logo-file"
            :key="logoInputKey"
            data-testid="appearance-logo-upload-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            @change="handleFileSelect('logo', $event)"
          />
          <div class="flex flex-wrap items-center gap-2">
            <p class="text-xs text-muted-foreground">JPEG, PNG, or WebP. Max 2 MB.</p>
            <p v-if="logoFile" class="text-xs text-muted-foreground">
              Selected: <span class="font-medium text-foreground">{{ logoFile.name }}</span>
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Button
              v-if="logoFile"
              type="button"
              variant="outline"
              size="sm"
              data-testid="appearance-logo-clear-selection"
              @click="clearSelectedFile('logo')"
            >
              Clear selection
            </Button>
            <Button
              v-if="showLogoRemoveButton"
              type="button"
              variant="outline"
              size="sm"
              data-testid="appearance-logo-remove"
              @click="markAssetForRemoval('logo')"
            >
              Remove logo
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">Displayed in the header of your public feedback board.</p>
        </div>

        <div class="space-y-2">
          <Label for="banner-file">Banner Image</Label>
          <Input
            id="banner-file"
            :key="bannerInputKey"
            data-testid="appearance-banner-upload-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            @change="handleFileSelect('banner', $event)"
          />
          <div class="flex flex-wrap items-center gap-2">
            <p class="text-xs text-muted-foreground">JPEG, PNG, or WebP. Max 8 MB.</p>
            <p v-if="bannerFile" class="text-xs text-muted-foreground">
              Selected: <span class="font-medium text-foreground">{{ bannerFile.name }}</span>
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Button
              v-if="bannerFile"
              type="button"
              variant="outline"
              size="sm"
              data-testid="appearance-banner-clear-selection"
              @click="clearSelectedFile('banner')"
            >
              Clear selection
            </Button>
            <Button
              v-if="showBannerRemoveButton"
              type="button"
              variant="outline"
              size="sm"
              data-testid="appearance-banner-remove"
              @click="markAssetForRemoval('banner')"
            >
              Remove banner
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">
            Displayed as a hero banner at the top of your public board. Recommended size: 1200x300px.
          </p>
        </div>

        <div class="space-y-2">
          <Label>Theme Mode</Label>
          <select
            v-model="form.themeMode"
            class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="system">System (follow visitor's preference)</option>
            <option value="light">Always Light</option>
            <option value="dark">Always Dark</option>
          </select>
          <p class="text-xs text-muted-foreground">Controls the default theme for your public feedback board.</p>
        </div>

        <div class="space-y-2">
          <Label>Vote Style</Label>
          <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2" data-testid="appearance-vote-style-selector">
            <button
              v-for="style in voteStyleOptions"
              :key="style.value"
              type="button"
              class="flex flex-col items-center gap-1.5 rounded-md border px-3 py-2.5 text-sm transition-colors hover:bg-accent"
              :class="form.voteStyle === style.value ? 'border-primary bg-primary/5 text-primary font-medium' : 'border-border text-muted-foreground'"
              :data-testid="'appearance-vote-style-' + style.value"
              @click="form.voteStyle = style.value"
            >
              <div class="flex items-center gap-1">
                <Icon :name="style.upIcon" class="w-4 h-4" />
                <Icon :name="style.downIcon" class="w-4 h-4" />
              </div>
              <span class="text-xs">{{ style.label }}</span>
            </button>
          </div>
          <p class="text-xs text-muted-foreground">The icons shown on vote buttons on your public board.</p>
        </div>

        <div class="flex items-center justify-between">
          <div>
            <p class="font-medium text-sm">Show "Powered by Veerify"</p>
            <p class="text-xs text-muted-foreground">Display a small attribution badge on your public board.</p>
          </div>
          <Switch v-model="form.showPoweredBy" data-testid="appearance-toggle-powered-by" />
        </div>

        <div class="flex items-center justify-between">
          <div>
            <p class="font-medium text-sm">Show GitHub footer links</p>
            <p class="text-xs text-muted-foreground">
              Display open-source and issue-report links in the public board footer.
            </p>
          </div>
          <Switch v-model="form.showGithubFooter" data-testid="appearance-toggle-github-footer" />
        </div>

        <div class="rounded-lg border p-4 space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <p class="font-medium text-sm">Use custom footer</p>
              <p class="text-xs text-muted-foreground">
                Replace Veerify footer links with your own branding and links.
              </p>
            </div>
            <Switch v-model="form.customFooterEnabled" data-testid="appearance-toggle-custom-footer" />
          </div>

          <div v-if="form.customFooterEnabled" class="space-y-3">
            <div class="space-y-2">
              <Label for="custom-footer-branding">Branding</Label>
              <Input
                id="custom-footer-branding"
                v-model="form.customFooterBranding"
                data-testid="appearance-custom-footer-branding"
                placeholder="Acme Inc."
              />
            </div>

            <div class="space-y-2">
              <Label for="custom-footer-text">Footer text</Label>
              <textarea
                id="custom-footer-text"
                v-model="form.customFooterText"
                data-testid="appearance-custom-footer-text"
                rows="2"
                placeholder="Built with care by the Acme product team."
                class="flex min-h-[64px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div class="space-y-2">
                <Label for="custom-footer-primary-label">Primary link label</Label>
                <Input
                  id="custom-footer-primary-label"
                  v-model="form.customFooterPrimaryLabel"
                  data-testid="appearance-custom-footer-primary-label"
                  placeholder="Visit Acme"
                />
              </div>
              <div class="space-y-2">
                <Label for="custom-footer-primary-url">Primary link URL</Label>
                <Input
                  id="custom-footer-primary-url"
                  v-model="form.customFooterPrimaryUrl"
                  data-testid="appearance-custom-footer-primary-url"
                  placeholder="https://acme.com"
                />
              </div>
              <div class="space-y-2">
                <Label for="custom-footer-secondary-label">Secondary link label</Label>
                <Input
                  id="custom-footer-secondary-label"
                  v-model="form.customFooterSecondaryLabel"
                  data-testid="appearance-custom-footer-secondary-label"
                  placeholder="Support"
                />
              </div>
              <div class="space-y-2">
                <Label for="custom-footer-secondary-url">Secondary link URL</Label>
                <Input
                  id="custom-footer-secondary-url"
                  v-model="form.customFooterSecondaryUrl"
                  data-testid="appearance-custom-footer-secondary-url"
                  placeholder="https://acme.com/support"
                />
              </div>
            </div>
            <p class="text-xs text-muted-foreground">Leave link label or URL empty to hide that link.</p>
          </div>
        </div>

        <div class="flex justify-end">
          <Button :disabled="isSaving || !hasChanges" @click="save">
            <Icon v-if="isSaving" name="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
            Save Changes
          </Button>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Icon name="lucide:eye" class="h-5 w-5" />
          Preview
        </CardTitle>
        <CardDescription>A preview of your public board header.</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="rounded-lg border overflow-hidden" :class="previewThemeClass">
          <img
            v-if="previewBannerUrl"
            :src="previewBannerUrl"
            alt="Banner"
            class="w-full h-32 object-cover"
            @error="$event.target.style.display = 'none'"
          />
          <div class="p-4 flex items-center gap-3" :style="{ backgroundColor: form.accentColor || '#3b82f6' }">
            <img
              v-if="previewLogoUrl"
              :src="previewLogoUrl"
              alt="Logo"
              class="h-8 w-8 rounded object-cover bg-white/20"
              @error="$event.target.style.display = 'none'"
            />
            <div v-else class="h-8 w-8 rounded bg-white/20 flex items-center justify-center">
              <Icon name="lucide:message-square" class="w-4 h-4 text-white" />
            </div>
            <div>
              <p class="font-semibold text-white text-sm">{{ project.name }}</p>
              <p class="text-white/70 text-xs">Share your feedback and ideas</p>
            </div>
          </div>
          <div class="p-4 bg-background">
            <div class="flex items-center gap-2 mb-3">
              <div
                class="h-7 rounded-full px-3 flex items-center text-xs font-medium text-white"
                :style="{ backgroundColor: form.accentColor || '#3b82f6' }"
              >
                All
              </div>
              <div class="h-7 rounded-full px-3 flex items-center text-xs font-medium bg-muted text-muted-foreground">
                Feature
              </div>
              <div class="h-7 rounded-full px-3 flex items-center text-xs font-medium bg-muted text-muted-foreground">
                Bug
              </div>
            </div>
            <div class="h-10 rounded-md bg-muted" />
          </div>
          <div class="border-t px-4 py-2 text-center space-y-1">
            <template v-if="showPreviewCustomFooter">
              <p v-if="form.customFooterBranding" class="text-xs font-medium text-foreground">
                {{ form.customFooterBranding }}
              </p>
              <p v-if="form.customFooterText" class="text-xs text-muted-foreground">
                {{ form.customFooterText }}
              </p>
              <div
                v-if="previewCustomFooterLinks.length > 0"
                class="flex items-center justify-center gap-3 text-xs text-muted-foreground"
              >
                <a
                  v-for="link in previewCustomFooterLinks"
                  :key="`${link.label}-${link.url}`"
                  :href="link.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="hover:underline"
                >
                  {{ link.label }}
                </a>
              </div>
            </template>
            <template v-else>
              <a
                v-if="form.showPoweredBy"
                href="https://veerify.io"
                target="_blank"
                rel="noopener noreferrer"
                class="block text-xs text-muted-foreground hover:underline"
              >
                Powered by Veerify
              </a>
              <p v-if="form.showGithubFooter" class="text-xs text-muted-foreground">
                Open source &amp; contributions welcome
              </p>
            </template>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'

const IMAGE_RULES = {
  logo: {
    maxBytes: 2 * 1024 * 1024,
  },
  banner: {
    maxBytes: 8 * 1024 * 1024,
  },
}

export default {
  name: 'ProductSettingsAppearance',
  props: {
    project: {
      type: Object,
      required: true,
    },
  },
  emits: ['updated'],
  data() {
    const settings = this.project.settings || {}
    return {
      form: {
        accentColor: settings.accentColor || '#3b82f6',
        logoUrl: settings.logoUrl || '',
        bannerUrl: settings.bannerUrl || '',
        showPoweredBy: settings.showPoweredBy !== false,
        showGithubFooter: settings.showGithubFooter !== false,
        themeMode: settings.themeMode || 'system',
        voteStyle: settings.voteStyle || 'arrows',
        customFooterEnabled: settings.customFooterEnabled === true,
        customFooterBranding: settings.customFooterBranding || '',
        customFooterText: settings.customFooterText || '',
        customFooterPrimaryLabel: settings.customFooterPrimaryLabel || '',
        customFooterPrimaryUrl: settings.customFooterPrimaryUrl || '',
        customFooterSecondaryLabel: settings.customFooterSecondaryLabel || '',
        customFooterSecondaryUrl: settings.customFooterSecondaryUrl || '',
      },
      logoFile: null,
      bannerFile: null,
      logoPreviewUrl: '',
      bannerPreviewUrl: '',
      removeLogo: false,
      removeBanner: false,
      logoInputKey: 0,
      bannerInputKey: 0,
      isSaving: false,
    }
  },
  computed: {
    currentSettings() {
      const settings = this.project.settings || {}
      return {
        accentColor: settings.accentColor || '#3b82f6',
        logoUrl: settings.logoUrl || '',
        bannerUrl: settings.bannerUrl || '',
        showPoweredBy: settings.showPoweredBy !== false,
        showGithubFooter: settings.showGithubFooter !== false,
        themeMode: settings.themeMode || 'system',
        voteStyle: settings.voteStyle || 'arrows',
        customFooterEnabled: settings.customFooterEnabled === true,
        customFooterBranding: settings.customFooterBranding || '',
        customFooterText: settings.customFooterText || '',
        customFooterPrimaryLabel: settings.customFooterPrimaryLabel || '',
        customFooterPrimaryUrl: settings.customFooterPrimaryUrl || '',
        customFooterSecondaryLabel: settings.customFooterSecondaryLabel || '',
        customFooterSecondaryUrl: settings.customFooterSecondaryUrl || '',
      }
    },
    voteStyleOptions() {
      return [
        { value: 'arrows', label: 'Arrows', upIcon: 'lucide:chevron-up', downIcon: 'lucide:chevron-down' },
        { value: 'thumbs', label: 'Thumbs', upIcon: 'lucide:thumbs-up', downIcon: 'lucide:thumbs-down' },
        { value: 'rockets', label: 'Rockets', upIcon: 'lucide:rocket', downIcon: 'lucide:thumbs-down' },
        { value: 'hearts', label: 'Hearts', upIcon: 'lucide:heart', downIcon: 'lucide:heart-off' },
        { value: 'stars', label: 'Stars', upIcon: 'lucide:star', downIcon: 'lucide:star-off' },
        { value: 'zap', label: 'Zap', upIcon: 'lucide:zap', downIcon: 'lucide:zap-off' },
        { value: 'plusminus', label: '+/−', upIcon: 'lucide:plus', downIcon: 'lucide:minus' },
      ]
    },
    previewThemeClass() {
      if (this.form.themeMode === 'dark') return 'dark'
      if (this.form.themeMode === 'light') return ''
      return ''
    },
    previewBannerUrl() {
      if (this.removeBanner) return ''
      return this.bannerPreviewUrl || this.form.bannerUrl || ''
    },
    previewLogoUrl() {
      if (this.removeLogo) return ''
      return this.logoPreviewUrl || this.form.logoUrl || ''
    },
    showLogoRemoveButton() {
      return (this.currentSettings.logoUrl || this.logoPreviewUrl) && !this.removeLogo
    },
    showBannerRemoveButton() {
      return (this.currentSettings.bannerUrl || this.bannerPreviewUrl) && !this.removeBanner
    },
    showPreviewCustomFooter() {
      return (
        this.form.customFooterEnabled &&
        (this.form.customFooterBranding?.trim() ||
          this.form.customFooterText?.trim() ||
          this.previewCustomFooterLinks.length > 0)
      )
    },
    previewCustomFooterLinks() {
      const links = [
        {
          label: this.form.customFooterPrimaryLabel?.trim(),
          url: this.form.customFooterPrimaryUrl?.trim(),
        },
        {
          label: this.form.customFooterSecondaryLabel?.trim(),
          url: this.form.customFooterSecondaryUrl?.trim(),
        },
      ]
      return links.filter((link) => link.label && link.url)
    },
    hasChanges() {
      return (
        this.form.accentColor !== this.currentSettings.accentColor ||
        this.form.showPoweredBy !== this.currentSettings.showPoweredBy ||
        this.form.showGithubFooter !== this.currentSettings.showGithubFooter ||
        this.form.themeMode !== this.currentSettings.themeMode ||
        this.form.voteStyle !== this.currentSettings.voteStyle ||
        this.form.customFooterEnabled !== this.currentSettings.customFooterEnabled ||
        this.form.customFooterBranding !== this.currentSettings.customFooterBranding ||
        this.form.customFooterText !== this.currentSettings.customFooterText ||
        this.form.customFooterPrimaryLabel !== this.currentSettings.customFooterPrimaryLabel ||
        this.form.customFooterPrimaryUrl !== this.currentSettings.customFooterPrimaryUrl ||
        this.form.customFooterSecondaryLabel !== this.currentSettings.customFooterSecondaryLabel ||
        this.form.customFooterSecondaryUrl !== this.currentSettings.customFooterSecondaryUrl ||
        Boolean(this.logoFile) ||
        Boolean(this.bannerFile) ||
        (this.removeLogo && Boolean(this.currentSettings.logoUrl)) ||
        (this.removeBanner && Boolean(this.currentSettings.bannerUrl))
      )
    },
  },
  watch: {
    project: {
      handler(newProject) {
        const settings = newProject.settings || {}
        this.form.accentColor = settings.accentColor || '#3b82f6'
        this.form.logoUrl = settings.logoUrl || ''
        this.form.bannerUrl = settings.bannerUrl || ''
        this.form.showPoweredBy = settings.showPoweredBy !== false
        this.form.showGithubFooter = settings.showGithubFooter !== false
        this.form.themeMode = settings.themeMode || 'system'
        this.form.voteStyle = settings.voteStyle || 'arrows'
        this.form.customFooterEnabled = settings.customFooterEnabled === true
        this.form.customFooterBranding = settings.customFooterBranding || ''
        this.form.customFooterText = settings.customFooterText || ''
        this.form.customFooterPrimaryLabel = settings.customFooterPrimaryLabel || ''
        this.form.customFooterPrimaryUrl = settings.customFooterPrimaryUrl || ''
        this.form.customFooterSecondaryLabel = settings.customFooterSecondaryLabel || ''
        this.form.customFooterSecondaryUrl = settings.customFooterSecondaryUrl || ''
        this.resetPendingAssets()
      },
      deep: true,
    },
  },
  beforeUnmount() {
    this.resetPendingAssets()
  },
  methods: {
    resetPendingAssets() {
      this.revokePreviewUrl('logo')
      this.revokePreviewUrl('banner')
      this.logoFile = null
      this.bannerFile = null
      this.removeLogo = false
      this.removeBanner = false
      this.clearFileInput('logo')
      this.clearFileInput('banner')
    },
    revokePreviewUrl(kind) {
      if (!import.meta.client) return
      const key = kind === 'logo' ? 'logoPreviewUrl' : 'bannerPreviewUrl'
      if (this[key]) {
        URL.revokeObjectURL(this[key])
        this[key] = ''
      }
    },
    clearFileInput(kind) {
      if (kind === 'logo') {
        this.logoInputKey += 1
      } else {
        this.bannerInputKey += 1
      }
    },
    validateFile(kind, file) {
      if (!file) return false

      const contentType = (file.type || '').toLowerCase()
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
        toast.error('Only JPEG, PNG, and WebP files are supported')
        return false
      }

      if (file.size > IMAGE_RULES[kind].maxBytes) {
        const maxMb = Math.floor(IMAGE_RULES[kind].maxBytes / (1024 * 1024))
        toast.error(`Selected ${kind} file exceeds ${maxMb} MB`)
        return false
      }

      return true
    },
    handleFileSelect(kind, event) {
      const file = event?.target?.files?.[0]
      if (!file) return
      if (!this.validateFile(kind, file)) {
        this.clearFileInput(kind)
        return
      }

      this.revokePreviewUrl(kind)
      const previewUrl = import.meta.client ? URL.createObjectURL(file) : ''
      if (kind === 'logo') {
        this.logoFile = file
        this.logoPreviewUrl = previewUrl
        this.removeLogo = false
      } else {
        this.bannerFile = file
        this.bannerPreviewUrl = previewUrl
        this.removeBanner = false
      }
    },
    clearSelectedFile(kind) {
      this.revokePreviewUrl(kind)
      if (kind === 'logo') {
        this.logoFile = null
      } else {
        this.bannerFile = null
      }
      this.clearFileInput(kind)
    },
    markAssetForRemoval(kind) {
      this.clearSelectedFile(kind)
      if (kind === 'logo') {
        this.removeLogo = true
      } else {
        this.removeBanner = true
      }
    },
    async uploadSelectedFile(kind, file) {
      const contentType = (file.type || '').toLowerCase()
      const presignResponse = await $fetch(`/api/projects/${this.project.slug}/assets/presign`, {
        method: 'POST',
        body: {
          kind,
          filename: file.name || `${kind}.webp`,
          contentType,
          sizeBytes: file.size,
        },
      })

      const uploadTarget = presignResponse?.data
      if (!uploadTarget?.uploadId || !uploadTarget?.uploadUrl) {
        throw new Error('Upload target response is invalid')
      }

      const uploadHeaders = {
        ...(uploadTarget.headers || {}),
        'content-type': contentType,
      }

      const uploadResponse = await fetch(uploadTarget.uploadUrl, {
        method: uploadTarget.method || 'PUT',
        headers: uploadHeaders,
        body: file,
      })
      if (!uploadResponse.ok) {
        throw new Error(`Upload failed (${uploadResponse.status})`)
      }

      return uploadTarget.uploadId
    },
    async save() {
      if (!this.hasChanges) return
      this.isSaving = true

      try {
        const existingSettings = this.project.settings || {}
        let logoUploadId = null
        let bannerUploadId = null

        if (this.logoFile) {
          logoUploadId = await this.uploadSelectedFile('logo', this.logoFile)
        }
        if (this.bannerFile) {
          bannerUploadId = await this.uploadSelectedFile('banner', this.bannerFile)
        }

        const settingsPayload = {
          ...existingSettings,
          accentColor: this.form.accentColor,
          showPoweredBy: this.form.showPoweredBy,
          showGithubFooter: this.form.showGithubFooter,
          themeMode: this.form.themeMode,
          voteStyle: this.form.voteStyle,
          customFooterEnabled: this.form.customFooterEnabled,
          customFooterBranding: this.form.customFooterBranding?.trim() || null,
          customFooterText: this.form.customFooterText?.trim() || null,
          customFooterPrimaryLabel: this.form.customFooterPrimaryLabel?.trim() || null,
          customFooterPrimaryUrl: this.form.customFooterPrimaryUrl?.trim() || null,
          customFooterSecondaryLabel: this.form.customFooterSecondaryLabel?.trim() || null,
          customFooterSecondaryUrl: this.form.customFooterSecondaryUrl?.trim() || null,
        }

        if (logoUploadId) {
          settingsPayload.logoUploadId = logoUploadId
        }
        if (bannerUploadId) {
          settingsPayload.bannerUploadId = bannerUploadId
        }
        if (this.removeLogo) {
          settingsPayload.logoUrl = null
          settingsPayload.logoAssetKey = null
        }
        if (this.removeBanner) {
          settingsPayload.bannerUrl = null
          settingsPayload.bannerAssetKey = null
        }

        const response = await $fetch(`/api/projects/${this.project.slug}`, {
          method: 'PUT',
          body: {
            settings: settingsPayload,
          },
        })

        this.$emit('updated', response.data)
        this.resetPendingAssets()
        toast.success('Appearance settings saved')
      } catch (err) {
        console.error('Error saving appearance:', err)
        toast.error(err?.data?.error?.message || 'Failed to save appearance settings')
      } finally {
        this.isSaving = false
      }
    },
  },
}
</script>
