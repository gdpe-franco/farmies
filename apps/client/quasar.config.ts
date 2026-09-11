import { defineConfig } from '@quasar/app-vite'

export default defineConfig(() => ({
  boot: ['auth', 'i18n'],
  css: ['app.css'],
  build: { vueRouterMode: 'history' },
  devServer: { host: '0.0.0.0', port: 9000 },
  framework: {
    config: {
      brand: {
        primary: '#276749',
        secondary: '#477a40',
        accent: '#9a6700',
        dark: '#17351f',
        positive: '#2f855a',
        negative: '#b42318',
        info: '#2563eb',
        warning: '#9a6700',
      },
    },
    plugins: [],
  },
}))
