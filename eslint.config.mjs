import withNuxt from '@nuxt/eslint-config'
import prettier from 'eslint-config-prettier'

export default (async () => {
  const nuxtConfigs = await withNuxt(prettier, {
    rules: {
      'vue/no-unused-vars': 'warn',
      'no-unused-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  })

  return [
    // shadcn-vue generated components — do not lint
    { ignores: ['components/ui/**'] },
    ...nuxtConfigs,
  ]
})()
