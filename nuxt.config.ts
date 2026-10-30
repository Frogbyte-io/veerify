// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from '@tailwindcss/vite'

const appDomain = (process.env.APP_DOMAIN || 'localhost').trim()
const dashboardDomain = (
  process.env.APP_DASHBOARD_DOMAIN || (appDomain === 'localhost' ? 'localhost' : `app.${appDomain}`)
).trim()
const devAllowedHosts = (process.env.NUXT_DEV_ALLOWED_HOSTS || '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean)
const deploymentModeEnv = (process.env.APP_DEPLOYMENT_MODE || '').toLowerCase()
const deploymentMode =
  deploymentModeEnv === 'cloud' || deploymentModeEnv === 'self-hosted' ? deploymentModeEnv : 'self-hosted'

// Dashboard pages get their layout from route meta, so the layout (sidebar, header) stays mounted
// across navigation instead of being re-created inside every page. Options API pages cannot call
// definePageMeta, hence this hook. Matched against the page file path relative to pages/.
const DASHBOARD_PAGE = /^(dashboard|feedback|reports|help|submissions|settings|workspace|project|marketing|inbox)\//
const NOT_DASHBOARD_PAGE = /^feedback\/\[id\]\/edit\.vue$/
const FLUSH_DASHBOARD_PAGE = /^inbox\/index\.vue$/

type ExtendablePage = { file?: string; meta?: Record<string, unknown>; children?: ExtendablePage[] }

function assignDashboardLayout(pages: ExtendablePage[]) {
  for (const page of pages) {
    const file = page.file?.replace(/\\/g, '/').split('/pages/').pop() || ''
    if (DASHBOARD_PAGE.test(file) && !NOT_DASHBOARD_PAGE.test(file)) {
      page.meta = { ...page.meta, layout: 'dashboard' }
    }
    // Full-bleed pages fill the space under the header, edge to edge (no gutters, no page scroll).
    if (FLUSH_DASHBOARD_PAGE.test(file)) {
      page.meta = { ...page.meta, flush: true }
    }
    // NuxtPage keys a page by its interpolated path, which would remount the public site (and
    // its persistent shell) on every tab change. One static key keeps it mounted across tabs.
    if (file === '[...slug].vue') {
      page.meta = { ...page.meta, key: 'public-site' }
    }
    if (page.children) assignDashboardLayout(page.children)
  }
}

export default defineNuxtConfig({
  hooks: {
    'pages:extend'(pages) {
      assignDashboardLayout(pages)
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
    },
  },
  compatibilityDate: '2025-05-15',
  buildDir: process.env.NUXT_BUILD_DIR || '.nuxt',
  devtools: { enabled: process.env.NUXT_DEVTOOLS_ENABLED !== 'false' },
  nitro: {
    output: { dir: process.env.NITRO_OUTPUT_DIR || '.output' },
    // The self-hosted runtime image already carries the installed dependency
    // tree. Nitro tracing can recreate nested Yarn dependency symlinks with
    // invalid relative targets and recurse until ELOOP during packaging. Cloud
    // builds retain Nitro's normal tracing behavior.
    ...(deploymentMode === 'self-hosted' ? { externals: { trace: false } } : {}),
    experimental: {
      websocket: true,
      // In-process scheduler backend — see server/services/scheduler/.
      // startScheduleRunner() is skipped in Nitro's dev/test env.
      tasks: true,
    },
    scheduledTasks: {
      // Trivial example proving the self-hosted backend wires up (Stage 00).
      // Outbound support delivery starts in Stage 04; later consumers include
      // Stage 06 (SLA sweeper), Stage 08 (CSAT dispatch), and Stage 09 rollups.
      '* * * * *': [
        'support:outbound-delivery',
        'marketing:audit-advance',
        'marketing:visibility-advance',
        'imports:advance',
      ],
      '*/5 * * * *': [
        'marketing:mentions-poll',
        'support:attachment-cleanup',
        'support:automation-rules',
        'support:csat-dispatch',
        'support:sending-domains-poll',
        'support:sla-breach',
        'marketing:review-requests',
      ],
      // Marketing Hub (docs/plans/2026-10-09-marketing-hub)
      '*/10 * * * *': ['marketing:competitors-check', 'domains:status-refresh'],
      '*/15 * * * *': ['example:ping', 'device-login:cleanup'],
      '0 * * * *': ['marketing:visibility-schedule'],
      '45 * * * *': ['support:trash-purge'],
      '15 * * * *': ['mail:forward-usage'],
      '5 * * * *': ['marketing:audit-schedule'],
      '20 * * * *': ['marketing:search-sync'],
      '0 7-11 * * *': ['marketing:mentions-digest'],
      '30 3 * * *': ['marketing:retention'],
    },
  },
  devServer: {
    host: '::',
  },
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
    server: {
      // Vite rejects dev requests whose Host header it does not recognise, which
      // blocks reaching the dev server through an HTTPS reverse proxy (for example
      // Tailscale Serve). Kept env-driven so the hostname stays per-machine rather
      // than checked in; empty in CI and production, where this block is unused.
      allowedHosts: devAllowedHosts,
    },
  },
  vue: {
    compilerOptions: {
      isCustomElement: (tag: string) => tag === 'hex-color-picker',
    },
  },
  modules: [
    '@nuxt/fonts',
    '@nuxt/icon',
    '@nuxt/test-utils',
    'shadcn-nuxt',
    '@nuxtjs/color-mode',
    'nuxt-nodemailer',
    '@scalar/nuxt',
  ],
  fonts: {
    families: [
      { name: 'Fraunces', provider: 'google' },
      { name: 'Figtree', provider: 'google' },
    ],
  },
  runtimeConfig: {
    domainProvider: process.env.DOMAIN_PROVIDER || 'static-cname',
    // Runtime override for prebuilt images: NUXT_CLOUDFLARE_API_TOKEN / NUXT_CLOUDFLARE_ZONE_ID.
    cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN || '',
    cloudflareZoneId: process.env.CLOUDFLARE_ZONE_ID || '',
    storageDriver: process.env.STORAGE_DRIVER || 'local',
    storageBucket: process.env.STORAGE_BUCKET || '',
    storageRegion: process.env.STORAGE_REGION || 'auto',
    storageEndpoint: process.env.STORAGE_ENDPOINT || '',
    storageAccessKeyId: process.env.STORAGE_ACCESS_KEY_ID || '',
    storageSecretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY || '',
    storageForcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === 'true',
    storagePublicBaseUrl: process.env.STORAGE_PUBLIC_BASE_URL || '',
    // Direct S3 uploads are opt-in and only safe when the target demonstrably
    // enforces the signed Content-Length. All other targets use the bounded
    // application proxy.
    storageDirectUploadConstraints: process.env.STORAGE_DIRECT_UPLOAD_CONSTRAINTS || 'proxy-required',
    storageLocalDir: process.env.STORAGE_LOCAL_DIR || '.data/storage',
    uploadTokenSecret: process.env.UPLOAD_TOKEN_SECRET || '',
    nodemailer: {
      from: process.env.MAIL_FROM,
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === 'true',
      ...(process.env.SMTP_USER && process.env.SMTP_PASS
        ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }
        : {}),
    },
    public: {
      appDomain,
      dashboardDomain,
      cnameTarget: process.env.CNAME_TARGET || 'cname.veerify.io',
      deploymentMode,
    },
  },
  colorMode: {
    preference: 'system',
    fallback: 'dark',
    hid: 'nuxt-color-mode-script',
    globalName: '__NUXT_COLOR_MODE__',
    componentName: 'ColorScheme',
    classPrefix: '',
    classSuffix: '',
    storage: 'localStorage',
    storageKey: 'nuxt-color-mode',
  },
  shadcn: {
    prefix: '',
    componentDir: './components/ui',
  },
  components: [
    {
      path: '~/components',
      pathPrefix: false,
    },
    {
      path: '~/scaffold-designer/components',
      prefix: 'ScaffoldDesigner',
      pathPrefix: false,
    },
  ],
  routeRules: {
    '/api-docs/**': { ssr: false },
    '/api-docs': { ssr: false },
    // The approval page must never be framed (clickjacking the Allow button).
    '/device': {
      headers: { 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" },
    },
  },
  scalar: {
    url: '/api/openapi.json',
    pathRouting: {
      basePath: '/api-docs',
    },
  } as any,
})
