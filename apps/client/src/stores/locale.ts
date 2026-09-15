import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { i18n } from '../i18n/index.ts'
import { defaultLocale, languageOptions, isLocale, type Locale } from '../i18n/messages.ts'
import { readPreference, writePreference, type PreferenceStorage } from '../platform/preference-storage.ts'
import type { useSessionStore } from './session.ts'

type SessionStore = ReturnType<typeof useSessionStore>

const storageKey = 'farmies.locale'

export const useLocaleStore = defineStore('locale', () => {
  const locale = ref<Locale>(defaultLocale)
  const syncFailed = ref(false)
  const currentLanguage = computed(() => languageOptions.find(({ value }) => value === locale.value) ?? languageOptions[0])
  let session: SessionStore | undefined
  let storage: PreferenceStorage | undefined
  let chosenLocale: Locale | undefined
  let pendingSync = Promise.resolve()

  const apply = (value: Locale) => {
    locale.value = value
    i18n.global.locale.value = value
    if (globalThis.document) document.documentElement.lang = value
  }

  const sync = (value: Locale) => {
    pendingSync = pendingSync.then(async () => {
      if (value !== locale.value) return
      syncFailed.value = false
      if (session?.isAuthenticated && session.user?.preferredLocale !== value) {
        await session.updateLocale(value).catch(() => {
          if (value === locale.value) syncFailed.value = true
        })
      }
    })
    return pendingSync
  }

  const select = async (value: unknown) => {
    if (!isLocale(value)) throw new TypeError('Unsupported locale')
    chosenLocale = value
    apply(value)
    writePreference(storageKey, value, storage)
    await sync(value)
  }

  const initialize = async (sessionStore: SessionStore, localeStorage?: PreferenceStorage) => {
    session = sessionStore
    storage = localeStorage

    const savedLocale = readPreference(storageKey, storage)
    if (isLocale(savedLocale)) {
      chosenLocale = savedLocale
      apply(savedLocale)
      if (session.isAuthenticated && session.user?.preferredLocale !== savedLocale) {
        await sync(savedLocale)
      }
    } else {
      const userLocale = session.user?.preferredLocale
      if (isLocale(userLocale)) {
        apply(userLocale)
        writePreference(storageKey, userLocale, storage)
      } else {
        apply(defaultLocale)
      }
    }

    watch(() => sessionStore.user, (user) => {
      if (!user) {
        syncFailed.value = false
        return
      }

      const localLocale = chosenLocale ?? readPreference(storageKey, storage)
      if (isLocale(localLocale)) {
        if (user.preferredLocale !== localLocale) {
          void sync(localLocale)
        }
      } else {
        if (isLocale(user.preferredLocale)) {
          apply(user.preferredLocale)
          writePreference(storageKey, user.preferredLocale, storage)
        }
      }
    })
  }

  return { locale, currentLanguage, syncFailed, initialize, select }
})
