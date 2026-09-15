import { defineBoot } from '@quasar/app-vite'
import type { QVueGlobals, QuasarLanguage } from 'quasar'
import english from 'quasar/lang/en-US'
import spanish from 'quasar/lang/es'
import { watch } from 'vue'

import { i18n } from '../i18n'
import type { Locale } from '../i18n/messages'
import { useLocaleStore } from '../stores/locale'
import { useSessionStore } from '../stores/session'

const componentLanguages = { en: english, es: spanish } satisfies Record<Locale, QuasarLanguage>

export default defineBoot(async ({ app, store }) => {
  app.use(i18n)
  const locale = useLocaleStore(store)
  const quasar: QVueGlobals = app.config.globalProperties.$q
  watch(() => locale.locale, (value) => quasar.lang.set(componentLanguages[value]), { immediate: true })
  await locale.initialize(useSessionStore(store))
})
