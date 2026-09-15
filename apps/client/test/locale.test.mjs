import assert from 'node:assert/strict'
import test from 'node:test'

import { createPinia, setActivePinia } from 'pinia'

import { i18n } from '../src/i18n/index.ts'
import { isLocale, locales, messages } from '../src/i18n/messages.ts'
import { useLocaleStore } from '../src/stores/locale.ts'

const createStorage = (initialValue = null) => {
  const values = new Map(initialValue === null ? [] : [['farmies.locale', initialValue]])
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

const createSession = ({ preferredLocale = null, authenticated = false, rejectUpdate = false } = {}) => {
  const updates = []
  return {
    session: {
      isAuthenticated: authenticated,
      user: preferredLocale ? { preferredLocale } : null,
      updateLocale: async (locale) => {
        updates.push(locale)
        if (rejectUpdate) throw new Error('update failed')
      },
    },
    updates,
  }
}

test('locale store', async (suite) => {
  const happyCases = [
    {
      name: 'defaults to English before authentication',
      savedLocale: null,
      preferredLocale: null,
      authenticated: false,
      selectedLocale: null,
      expectedLocale: 'en',
      expectedStoredLocale: null,
      expectedUpdates: [],
    },
    {
      name: 'retains a local Spanish selection before authentication',
      savedLocale: null,
      preferredLocale: null,
      authenticated: false,
      selectedLocale: 'es',
      expectedLocale: 'es',
      expectedStoredLocale: 'es',
      expectedUpdates: [],
    },
    {
      name: 'adopts the authenticated user preference without a local choice',
      savedLocale: null,
      preferredLocale: 'es',
      authenticated: true,
      selectedLocale: null,
      expectedLocale: 'es',
      expectedStoredLocale: 'es',
      expectedUpdates: [],
    },
    {
      name: 'stores a prior local choice on the authenticated user',
      savedLocale: 'es',
      preferredLocale: 'en',
      authenticated: true,
      selectedLocale: null,
      expectedLocale: 'es',
      expectedStoredLocale: 'es',
      expectedUpdates: ['es'],
    },
  ]

  await suite.test('happy path', async (happyPath) => {
    for (const testCase of happyCases) {
      await happyPath.test(testCase.name, async () => {
        setActivePinia(createPinia())
        i18n.global.locale.value = 'en'
        const storage = createStorage(testCase.savedLocale)
        const auth = createSession(testCase)
        const store = useLocaleStore()

        await store.initialize(auth.session, storage)
        if (testCase.selectedLocale) await store.select(testCase.selectedLocale)

        assert.equal(store.locale, testCase.expectedLocale)
        assert.equal(i18n.global.locale.value, testCase.expectedLocale)
        assert.equal(storage.getItem('farmies.locale'), testCase.expectedStoredLocale)
        assert.deepEqual(auth.updates, testCase.expectedUpdates)
      })
    }
    // A slow earlier request must not overwrite the final language choice.
    setActivePinia(createPinia())
    let release
    let active = 0
    const updates = []
    const session = {
      isAuthenticated: true,
      user: { preferredLocale: 'en' },
      updateLocale: async (value) => {
        active += 1
        assert.equal(active, 1)
        updates.push(value)
        if (value === 'es') await new Promise((resolve) => { release = resolve })
        session.user = { preferredLocale: value }
        active -= 1
      },
    }
    const store = useLocaleStore()
    await store.initialize(session, createStorage())
    const first = store.select('es')
    await Promise.resolve()
    const second = store.select('en')
    release()
    await Promise.all([first, second])
    assert.deepEqual(updates, ['es', 'en'])
    assert.equal(session.user.preferredLocale, store.locale)
  })

  const failureCases = [
    {
      name: 'ignores an unsupported stored locale',
      savedLocale: 'fr',
      rejectUpdate: false,
      expectedLocale: 'en',
    },
    {
      name: 'keeps the local choice when server persistence fails',
      savedLocale: null,
      rejectUpdate: true,
      authenticated: true,
      selectedLocale: 'es',
      expectedLocale: 'es',
    },
    {
      name: 'applies a choice even when device storage is blocked',
      blockedStorage: true,
      selectedLocale: 'es',
      expectedLocale: 'es',
    },
    {
      name: 'rejects an unsupported selection without changing the current locale',
      selectedLocale: 'fr',
      rejects: true,
      expectedLocale: 'en',
    },
  ]

  await suite.test('failure path', async (failurePath) => {
    for (const testCase of failureCases) {
      await failurePath.test(testCase.name, async () => {
        setActivePinia(createPinia())
        i18n.global.locale.value = 'en'
        const storage = testCase.blockedStorage
          ? { getItem: () => { throw new Error('Blocked') }, setItem: () => { throw new Error('Blocked') } }
          : createStorage(testCase.savedLocale)
        const auth = createSession(testCase)
        const store = useLocaleStore()

        await store.initialize(auth.session, storage)
        if (testCase.rejects) await assert.rejects(store.select(testCase.selectedLocale), /Unsupported locale/)
        else if (testCase.selectedLocale) await store.select(testCase.selectedLocale)

        assert.equal(store.locale, testCase.expectedLocale)
        assert.equal(store.syncFailed, Boolean(testCase.rejectUpdate))
      })
    }
  })
})

test('translation messages', async (suite) => {
  const flattenKeys = (value, prefix = '') => Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof child === 'string' ? [path] : flattenKeys(child, path)
  })

  await suite.test('happy path', () => {
    assert.deepEqual(Object.keys(messages), [...locales])
    for (const locale of locales) assert.deepEqual(flattenKeys(messages[locale]), flattenKeys(messages.en))

    const values = { name: 'Los Compas', nickname: 'Niña 🐮' }
    for (const locale of locales) {
      i18n.global.locale.value = locale
      assert.match(i18n.global.t('party.welcome', values), /Los Compas/)
      assert.match(i18n.global.t('party.member', values), /Niña 🐮/)
    }
  })

  const invalidLocales = [undefined, null, '', 'fr', 'EN']

  await suite.test('failure path', async (failurePath) => {
    for (const locale of invalidLocales) {
      await failurePath.test(`rejects ${String(locale)}`, () => {
        assert.equal(isLocale(locale), false)
      })
    }
  })
})
