import { defineConfig } from '@quasar/app-vite'

export default defineConfig(() => ({
  boot: ['theme', 'auth', 'i18n'],
  css: ['app.css'],
  build: { vueRouterMode: 'history' },
  devServer: { host: '0.0.0.0', port: 9000 },
  framework: {
    config: {
      dark: false,
      lang: { noHtmlAttrs: true },
      brand: {
        // Dark companions to the named pastel swatches in app.css.
        primary: '#405d4b', // Muted Teal: actions and wordmark.
        secondary: '#55595d', // Grey: supporting text.
        accent: '#775564', // Thistle: keyboard focus.
        dark: '#303735',
        positive: '#405d4b',
        negative: '#b42318',
        info: '#505f78',
        warning: '#87592a',
      },
    },
    plugins: [],
  },
}))
