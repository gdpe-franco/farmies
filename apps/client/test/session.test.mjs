import assert from 'node:assert/strict'
import test from 'node:test'

import { createPinia, setActivePinia } from 'pinia'

import { useSessionStore } from '../src/stores/session.ts'

const applicationUser = {
  id: '42',
  preferredLocale: 'en',
  createdAt: '2026-09-10T12:00:00.000Z',
  updatedAt: '2026-09-10T12:30:00.000Z',
}

const createAuth = ({ session = null, sessionError = null, signOutError = null } = {}) => {
  let listener = () => {}
  const signOutCalls = []

  return {
    client: {
      getSession: async () => ({ data: { session }, error: sessionError }),
      onAuthStateChange: (callback) => {
        listener = callback
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      signOut: async (options) => {
        signOutCalls.push(options)
        if (!signOutError) listener('SIGNED_OUT', null)
        return { error: signOutError }
      },
    },
    emit: (event, nextSession) => listener(event, nextSession),
    signOutCalls,
  }
}

const createFetcher = (status = 200) => {
  const requests = []
  const fetcher = async (input, init) => {
    requests.push({ url: String(input), init })
    return Response.json({ user: applicationUser }, { status })
  }

  return { fetcher, requests }
}

test('session store', async (suite) => {
  const happyCases = [
    {
      name: 'restores a session and authorizes Worker requests',
      signOut: false,
      refreshedToken: null,
      expectedToken: 'valid-token',
      expectedUser: applicationUser,
      expectedRequestTokens: ['Bearer valid-token'],
    },
    {
      name: 'follows a refreshed Supabase session',
      signOut: false,
      refreshedToken: 'refreshed-token',
      expectedToken: 'refreshed-token',
      expectedUser: applicationUser,
      expectedRequestTokens: ['Bearer valid-token', 'Bearer refreshed-token'],
    },
    {
      name: 'signs out locally and clears protected state',
      signOut: true,
      refreshedToken: null,
      expectedToken: null,
      expectedUser: null,
      expectedRequestTokens: ['Bearer valid-token'],
    },
  ]

  await suite.test('happy path', async (happyPath) => {
    for (const testCase of happyCases) {
      await happyPath.test(testCase.name, async () => {
        setActivePinia(createPinia())
        const auth = createAuth({ session: { access_token: 'valid-token' } })
        const api = createFetcher()
        const store = useSessionStore()

        await store.initialize(auth.client, 'https://api.farmies.test', api.fetcher)
        if (testCase.refreshedToken) {
          auth.emit('TOKEN_REFRESHED', { access_token: testCase.refreshedToken })
          await new Promise(setImmediate)
        }
        if (testCase.signOut) await store.signOut()

        assert.equal(store.initialized, true)
        assert.equal(store.accessToken, testCase.expectedToken)
        assert.deepEqual(store.user, testCase.expectedUser)
        assert.deepEqual(
          api.requests.map(({ url }) => url),
          testCase.expectedRequestTokens.map(() => 'https://api.farmies.test/users/me'),
        )
        assert.deepEqual(
          api.requests.map(({ init }) => new Headers(init.headers).get('Authorization')),
          testCase.expectedRequestTokens,
        )
        assert.deepEqual(auth.signOutCalls, testCase.signOut ? [{ scope: 'local' }] : [])
      })
    }
  })

  const failureCases = [
    {
      name: 'starts signed out when no persisted session exists',
      session: null,
      sessionError: null,
      workerStatus: 200,
      expectedError: null,
      expectedRequests: 0,
    },
    {
      name: 'does not trust a rejected Worker user response',
      session: { access_token: 'rejected-token' },
      sessionError: null,
      workerStatus: 401,
      expectedError: 'USER_LOAD_FAILED',
      expectedRequests: 1,
    },
    {
      name: 'reports a persisted-session restore failure',
      session: null,
      sessionError: new Error('restore failed'),
      workerStatus: 200,
      expectedError: 'SESSION_RESTORE_FAILED',
      expectedRequests: 0,
    },
  ]

  await suite.test('failure path', async (failurePath) => {
    for (const testCase of failureCases) {
      await failurePath.test(testCase.name, async () => {
        setActivePinia(createPinia())
        const auth = createAuth(testCase)
        const api = createFetcher(testCase.workerStatus)
        const store = useSessionStore()

        await store.initialize(auth.client, 'https://api.farmies.test', api.fetcher)

        assert.equal(store.initialized, true)
        assert.equal(store.user, null)
        assert.equal(store.error, testCase.expectedError)
        assert.equal(api.requests.length, testCase.expectedRequests)
        if (!testCase.session) await assert.rejects(store.request('/users/me'), /Authentication required/)
      })
    }
  })
})
