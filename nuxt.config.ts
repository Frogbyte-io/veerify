// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from '@tailwindcss/vite'

const appDomain = (process.env.APP_DOMAIN || 'localhost').trim()
const dashboardDomain = (
  process.env.APP_DASHBOARD_DOMAIN || (appDomain === 'localhost' ? 'localhost' : `app.${appDomain}`)
).trim()
const deploymentModeEnv = (process.env.APP_DEPLOYMENT_MODE || '').toLowerCase()
const deploymentMode =
  deploymentModeEnv === 'cloud' || deploymentModeEnv === 'self-hosted'
    ? deploymentModeEnv
    : process.env.VERCEL || process.env.VERCEL_ENV
      ? 'cloud'
      : 'self-hosted'

export default defineNuxtConfig({
  compatibilityDate: '2025-05-15',
  devtools: { enabled: true },
  devServer: {
    host: '::',
  },
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
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
    vercelApiToken: process.env.VERCEL_API_TOKEN || '',
    vercelProjectId: process.env.VERCEL_PROJECT_ID || '',
    vercelTeamId: process.env.VERCEL_TEAM_ID || '',
    vercelTeamSlug: process.env.VERCEL_TEAM_SLUG || '',
    storageDriver: process.env.STORAGE_DRIVER || 'local',
    storageBucket: process.env.STORAGE_BUCKET || '',
    storageRegion: process.env.STORAGE_REGION || 'auto',
    storageEndpoint: process.env.STORAGE_ENDPOINT || '',
    storageAccessKeyId: process.env.STORAGE_ACCESS_KEY_ID || '',
    storageSecretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY || '',
    storageForcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === 'true',
    storagePublicBaseUrl: process.env.STORAGE_PUBLIC_BASE_URL || '',
    storageLocalDir: process.env.STORAGE_LOCAL_DIR || '.data/storage',
    uploadTokenSecret: process.env.UPLOAD_TOKEN_SECRET || process.env.BETTER_AUTH_SECRET || '',
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
  },
  scalar: {
    url: '/api/openapi.json',
    pathRouting: {
      basePath: '/api-docs',
    },
  } as any,
})
