// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from '@tailwindcss/vite'
export default defineNuxtConfig({
  compatibilityDate: '2025-05-15',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
  },
  modules: ['@nuxt/fonts', '@nuxt/icon', '@nuxt/test-utils', 'shadcn-nuxt', '@nuxtjs/color-mode', 'nuxt-nodemailer', '@scalar/nuxt'],
  runtimeConfig: {
    nodemailer: {
      from: process.env.MAIL_FROM,
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    },
    public: {
      appDomain: process.env.APP_DOMAIN || 'localhost',
      cnameTarget: process.env.CNAME_TARGET || 'cname.veerify.com',
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
  scalar: {
    spec: {
      url: '/api/openapi.json',
    },
    proxy: {
      path: '/api-docs',
    },
  } as any,
})
