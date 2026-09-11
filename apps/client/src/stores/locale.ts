import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

import { i18n } from '../i18n/index.ts'
import { isLocale, type Locale } from '../i18n/messages.ts'
import type { useSessionStore } from './session.ts'

type SessionStore = ReturnType<typeof useSessionStore>
type LocaleStorage = Pick<Storage, 'getItem' | 'setItem'>

const storageKey = 'farmies.locale'

export const useLocaleStore = defineStore('locale', () => {
  const locale = ref<Locale>('en')
  let session: SessionStore | undefined
  let storage: LocaleStorage | undefined

  const apply = (value: Locale) => {
    locale.value = value
    i18n.global.locale.value = value
    if (globalThis.document) document.documentElement.lang = value
  }

  const select = async (value: Locale) => {
    apply(value)
    storage?.setItem(storageKey, value)
    if (session?.isAuthenticated) await session.updateLocale(value).catch(() => undefined)
  }

  const initialize = async (sessionStore: SessionStore, localeStorage: LocaleStorage = localStorage) => {
    session = sessionStore
    storage = localeStorage

    const savedLocale = storage.getItem(storageKey)
    if (isLocale(savedLocale)) {
      apply(savedLocale)
      if (session.isAuthenticated && session.user?.preferredLocale !== savedLocale) {
        await session.updateLocale(savedLocale).catch(() => undefined)
      }
    } else {
      const userLocale = session.user?.preferredLocale
      if (isLocale(userLocale)) {
        apply(userLocale)
        storage.setItem(storageKey, userLocale)
      }
    }

    watch(() => sessionStore.user, (user) => {
      if (!user) return

      const localLocale = storage?.getItem(storageKey)
      if (isLocale(localLocale)) {
        if (user.preferredLocale !== localLocale) {
          void sessionStore.updateLocale(localLocale).catch(() => undefined)
        }
      } else {
        apply(user.preferredLocale)
        storage?.setItem(storageKey, user.preferredLocale)
      }
    })
  }

  return { locale, initialize, select }
})
