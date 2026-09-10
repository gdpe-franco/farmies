import eslint from '@eslint/js'
import vue from 'eslint-plugin-vue'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default [
  { ignores: ['**/dist/**', '**/.quasar/**', '**/.wrangler/**', '**/src-capacitor/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.{js,mjs,ts,vue}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { parser: tseslint.parser },
    },
    rules: { 'vue/multi-word-component-names': 'off' },
  },
]
