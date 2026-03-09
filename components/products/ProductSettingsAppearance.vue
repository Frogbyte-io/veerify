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
        <!-- Hidden file inputs triggered from the preview -->
        <input
          ref="logoInput"
          :key="logoInputKey"
          data-testid="appearance-logo-upload-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          class="sr-only"
          @change="handleFileSelect('logo', $event)"
        />
        <input
          ref="bannerInput"
          :key="bannerInputKey"
          data-testid="appearance-banner-upload-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          class="sr-only"
          @change="handleFileSelect('banner', $event)"
        />

        <div class="space-y-2">
          <Label>Accent Color</Label>
          <ColorPicker v-model="form.accentColor" />
          <p class="text-xs text-muted-foreground">Used for buttons and links on your public board.</p>
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

    <!-- Live Preview -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Icon name="lucide:eye" class="h-5 w-5" />
          Preview
        </CardTitle>
        <CardDescription>
          Live preview — updates as you change settings above.
          <span v-if="hasChanges" class="text-amber-500 font-medium">Unsaved changes.</span>
          Click the banner or logo to change them.
        </CardDescription>
      </CardHeader>
      <CardContent class="p-0">
        <!-- Board preview wrapper -->
        <div
          class="rounded-b-lg overflow-hidden border-t text-[13px] leading-snug"
          :class="previewThemeClass"
        >
          <!-- Banner: click to change -->
          <div
            class="w-full h-28 relative overflow-hidden cursor-pointer group"
            data-testid="appearance-preview-banner"
            @click="$refs.bannerInput.click()"
          >
            <img
              v-if="previewBannerUrl"
              :src="previewBannerUrl"
              alt="Banner"
              class="w-full h-full object-cover"
              @error="$event.target.style.display = 'none'"
            />
            <div
              v-else
              class="absolute inset-0"
              :style="{ background: `linear-gradient(135deg, ${form.accentColor} 0%, ${form.accentColor}cc 50%, ${form.accentColor}80 100%)` }"
            />
            <div v-if="!previewBannerUrl" class="absolute inset-0 flex items-end px-5 pb-3">
              <p class="text-white/60 text-xs font-medium tracking-wide uppercase">Feedback Board</p>
            </div>
            <!-- Hover overlay -->
            <div
              class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5 text-white"
            >
              <Icon name="lucide:image-plus" class="w-6 h-6" />
              <span class="text-xs font-medium">{{ previewBannerUrl ? 'Change banner' : 'Upload banner' }}</span>
            </div>
            <!-- Remove banner button -->
            <button
              v-if="showBannerRemoveButton"
              type="button"
              class="absolute top-2 right-2 z-10 rounded-md bg-black/60 hover:bg-black/80 text-white px-2 py-1 text-xs flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
              data-testid="appearance-banner-remove"
              @click.stop="markAssetForRemoval('banner')"
            >
              <Icon name="lucide:x" class="w-3 h-3" />
              Remove
            </button>
          </div>

          <!-- Header -->
          <div class="px-5 pt-5 pb-4 bg-background">
            <div class="flex items-center gap-2.5 mb-1.5">
              <!-- Logo: click to change -->
              <div
                class="relative cursor-pointer group/logo shrink-0"
                data-testid="appearance-preview-logo"
                @click="$refs.logoInput.click()"
              >
                <img
                  v-if="previewLogoUrl"
                  :src="previewLogoUrl"
                  alt="Logo"
                  class="h-9 w-9 rounded object-cover border bg-muted"
                  @error="$event.target.style.display = 'none'"
                />
                <div
                  v-else
                  class="h-9 w-9 rounded flex items-center justify-center text-white font-bold text-base select-none"
                  :style="{ backgroundColor: form.accentColor }"
                >
                  {{ project.name?.[0]?.toUpperCase() || '?' }}
                </div>
                <!-- Logo hover overlay -->
                <div
                  class="absolute inset-0 bg-black/50 rounded opacity-0 group-hover/logo:opacity-100 transition-opacity flex items-center justify-center"
                >
                  <Icon name="lucide:camera" class="w-4 h-4 text-white" />
                </div>
                <!-- Remove logo button -->
                <button
                  v-if="showLogoRemoveButton"
                  type="button"
                  class="absolute -top-1.5 -right-1.5 z-10 rounded-full bg-destructive text-destructive-foreground w-4 h-4 flex items-center justify-center opacity-0 group-hover/logo:opacity-100 transition-opacity"
                  data-testid="appearance-logo-remove"
                  @click.stop="markAssetForRemoval('logo')"
                >
                  <Icon name="lucide:x" class="w-2.5 h-2.5" />
                </button>
              </div>
              <span class="text-xs text-muted-foreground">{{ project.team?.name || 'Your Team' }}</span>
            </div>
            <h2 class="text-xl font-bold text-foreground">{{ project.name }}</h2>
            <p v-if="project.description" class="text-xs text-muted-foreground mt-1">{{ project.description }}</p>

            <!-- Navigation tabs -->
            <div class="flex items-center gap-1 mt-4 border-b">
              <span
                class="px-3 py-1.5 text-xs font-medium border-b-2 -mb-px flex items-center gap-1"
                :style="{ borderColor: form.accentColor, color: form.accentColor }"
              >
                <Icon name="lucide:message-square" class="w-3 h-3" />
                Feedback
              </span>
              <span
                class="px-3 py-1.5 text-xs font-medium text-muted-foreground border-b-2 border-transparent -mb-px flex items-center gap-1"
              >
                <Icon name="lucide:map" class="w-3 h-3" />
                Roadmap
              </span>
            </div>
          </div>

          <!-- Stats -->
          <div class="grid grid-cols-4 gap-3 px-5 pb-4 bg-background">
            <div class="rounded-lg border bg-card p-3">
              <p class="text-[10px] text-muted-foreground">Total</p>
              <p class="text-lg font-bold text-foreground">12</p>
            </div>
            <div class="rounded-lg border bg-card p-3">
              <p class="text-[10px] text-muted-foreground">Open</p>
              <p class="text-lg font-bold text-orange-600">7</p>
            </div>
            <div class="rounded-lg border bg-card p-3">
              <p class="text-[10px] text-muted-foreground">In Progress</p>
              <p class="text-lg font-bold text-blue-600">3</p>
            </div>
            <div class="rounded-lg border bg-card p-3">
              <p class="text-[10px] text-muted-foreground">Completed</p>
              <p class="text-lg font-bold text-green-600">2</p>
            </div>
          </div>

          <!-- Actions bar -->
          <div class="px-5 pb-4 bg-background flex items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <div class="h-8 rounded-md border bg-background px-3 flex items-center text-xs text-muted-foreground gap-1">
                All Status
                <Icon name="lucide:chevron-down" class="w-3 h-3 ml-1 opacity-60" />
              </div>
              <div class="h-8 rounded-md border bg-background px-3 flex items-center text-xs text-muted-foreground gap-1">
                Category
                <Icon name="lucide:chevron-down" class="w-3 h-3 ml-1 opacity-60" />
              </div>
            </div>
            <button
              type="button"
              class="h-8 rounded-md px-3 text-xs font-medium text-white flex items-center gap-1.5"
              :style="{ backgroundColor: form.accentColor }"
            >
              <Icon name="lucide:plus" class="w-3 h-3" />
              Submit Feedback
            </button>
          </div>

          <!-- Mock feedback items -->
          <div class="px-5 pb-5 space-y-3 bg-background">
            <div
              v-for="item in mockFeedbackItems"
              :key="item.id"
              class="rounded-lg border bg-card p-3 flex gap-3"
            >
              <!-- Vote column -->
              <div class="flex flex-col items-center gap-0.5 shrink-0 pt-0.5">
                <button
                  type="button"
                  class="p-1 rounded hover:bg-accent transition-colors"
                  :style="{ color: item.voted ? form.accentColor : undefined }"
                >
                  <Icon :name="voteIcons.up" class="w-4 h-4" />
                </button>
                <span class="text-xs font-semibold leading-none">{{ item.votes }}</span>
                <button type="button" class="p-1 rounded hover:bg-accent transition-colors text-muted-foreground">
                  <Icon :name="voteIcons.down" class="w-4 h-4" />
                </button>
              </div>
              <!-- Content -->
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-foreground">{{ item.title }}</p>
                <p class="text-xs text-muted-foreground mt-0.5 line-clamp-1">{{ item.body }}</p>
                <div class="flex items-center gap-2 mt-2">
                  <span
                    v-if="item.category"
                    class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
                    :style="{ backgroundColor: item.category.color + '20', color: item.category.color }"
                  >
                    {{ item.category.name }}
                  </span>
                  <span class="text-[10px] text-muted-foreground">{{ item.status }}</span>
                  <span class="text-[10px] text-muted-foreground ml-auto flex items-center gap-1">
                    <Icon name="lucide:message-circle" class="w-3 h-3" />
                    {{ item.comments }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="border-t px-5 py-3 text-center space-y-1 bg-background">
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
    voteIcons() {
      const opt = this.voteStyleOptions.find((o) => o.value === this.form.voteStyle) || this.voteStyleOptions[0]
      return { up: opt.upIcon, down: opt.downIcon }
    },
    mockFeedbackItems() {
      return [
        {
          id: 1,
          title: 'Dark mode toggle improvements',
          body: 'Would be great to have a system-level auto toggle that follows OS preferences.',
          votes: 42,
          voted: true,
          status: 'Open',
          comments: 8,
          category: { name: 'Feature', color: '#3b82f6' },
        },
        {
          id: 2,
          title: 'Better notification system',
          body: 'Support for email and Slack notifications when feedback status changes.',
          votes: 28,
          voted: false,
          status: 'In Progress',
          comments: 4,
          category: { name: 'Enhancement', color: '#8b5cf6' },
        },
        {
          id: 3,
          title: 'Export feedback to CSV',
          body: 'Need to download all feedback items as a spreadsheet for reporting.',
          votes: 15,
          voted: false,
          status: 'Planned',
          comments: 2,
          category: null,
        },
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
