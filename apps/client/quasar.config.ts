import { defineConfig } from '@quasar/app-vite'

export default defineConfig(() => ({
  boot: ['auth', 'i18n'],
  css: ['app.css'],
  build: { vueRouterMode: 'history' },
  devServer: { host: '0.0.0.0', port: 9000 },
  framework: { plugins: [] },
}))
