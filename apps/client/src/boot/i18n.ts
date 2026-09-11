import { defineBoot } from '@quasar/app-vite'

import { i18n } from '../i18n'
import { useLocaleStore } from '../stores/locale'
import { useSessionStore } from '../stores/session'

export default defineBoot(async ({ app, store }) => {
  app.use(i18n)
  await useLocaleStore(store).initialize(useSessionStore(store))
})
