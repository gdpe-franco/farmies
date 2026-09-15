export type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>

export const readPreference = (key: string, storage?: PreferenceStorage): string | null => {
  try {
    return (storage ?? globalThis.localStorage).getItem(key)
  } catch {
    return null
  }
}

export const writePreference = (key: string, value: string, storage?: PreferenceStorage) => {
  try {
    (storage ?? globalThis.localStorage).setItem(key, value)
  } catch {
    // Blocked/full storage must not prevent an in-memory preference change.
  }
}
