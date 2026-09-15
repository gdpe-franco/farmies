import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Dark } from 'quasar'

import { readPreference, writePreference, type PreferenceStorage } from '../platform/preference-storage.ts'

export const themeModes = ['light', 'dark', 'system'] as const
export type ThemeMode = typeof themeModes[number]
const isThemeMode = (value: unknown): value is ThemeMode =>
  typeof value === 'string' && themeModes.includes(value as ThemeMode)

export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>('light')
  let controller: Pick<typeof Dark, 'set'> | undefined
  let storage: PreferenceStorage | undefined

  const apply = (value: ThemeMode) => {
    mode.value = value
    controller?.set(value === 'system' ? 'auto' : value === 'dark')
  }

  const initialize = (dark: Pick<typeof Dark, 'set'>, themeStorage?: PreferenceStorage) => {
    controller = dark
    storage = themeStorage
    const saved = readPreference('farmies.theme', storage)
    apply(isThemeMode(saved) ? saved : 'light')
  }

  const select = (value: unknown) => {
    if (!isThemeMode(value)) throw new TypeError('Unsupported theme')
    apply(value)
    writePreference('farmies.theme', value, storage)
  }

  return { mode, initialize, select }
})
