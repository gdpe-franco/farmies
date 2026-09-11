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

const createAuth = ({
  session = null,
  sessionError = null,
  signOutError = null,
  requestError = null,
  verificationError = null,
} = {}) => {
  let listener = () => {}
  const codeRequests = []
  const signOutCalls = []
  const verificationRequests = []

  return {
    client: {
      getSession: async () => ({ data: { session }, error: sessionError }),
      onAuthStateChange: (callback) => {
        listener = callback
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      signInWithOtp: async (credentials) => {
        codeRequests.push(credentials)
        return { data: {}, error: requestError }
      },
      signOut: async (options) => {
        signOutCalls.push(options)
        if (!signOutError) listener('SIGNED_OUT', null)
        return { error: signOutError }
      },
      verifyOtp: async (credentials) => {
        verificationRequests.push(credentials)
        if (!verificationError) listener('SIGNED_IN', { access_token: 'verified-token' })
        return { data: {}, error: verificationError }
      },
    },
    emit: (event, nextSession) => listener(event, nextSession),
    codeRequests,
    signOutCalls,
    verificationRequests,
  }
}

const createFetcher = (status = 200) => {
  const requests = []
  const fetcher = async (input, init) => {
    requests.push({ url: String(input), init })
    const preferredLocale = init.method === 'PATCH'
      ? JSON.parse(init.body).preferredLocale
      : applicationUser.preferredLocale
    return Response.json({ user: { ...applicationUser, preferredLocale } }, { status })
  }

  return { fetcher, requests }
}

test('session store', async (suite) => {
  const happyCases = [
    {
      name: 'restores a session and authorizes Worker requests',
      signOut: false,
      refreshedToken: null,
      selectedLocale: null,
      expectedToken: 'valid-token',
      expectedUser: applicationUser,
      expectedRequestTokens: ['Bearer valid-token'],
    },
    {
      name: 'follows a refreshed Supabase session',
      signOut: false,
      refreshedToken: 'refreshed-token',
      selectedLocale: null,
      expectedToken: 'refreshed-token',
      expectedUser: applicationUser,
      expectedRequestTokens: ['Bearer valid-token', 'Bearer refreshed-token'],
    },
    {
      name: 'signs out locally and clears protected state',
      signOut: true,
      refreshedToken: null,
      selectedLocale: null,
      expectedToken: null,
      expectedUser: null,
      expectedRequestTokens: ['Bearer valid-token'],
    },
    {
      name: 'stores a selected locale on the application user',
      signOut: false,
      refreshedToken: null,
      selectedLocale: 'es',
      expectedToken: 'valid-token',
      expectedUser: { ...applicationUser, preferredLocale: 'es' },
      expectedRequestTokens: ['Bearer valid-token', 'Bearer valid-token'],
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
        if (testCase.selectedLocale) await store.updateLocale(testCase.selectedLocale)
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
        assert.deepEqual(
          api.requests.map(({ init }) => init.method),
          testCase.selectedLocale ? ['PUT', 'PATCH'] : testCase.expectedRequestTokens.map(() => 'PUT'),
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

test('email code authentication', async (suite) => {
  const happyCases = [
    {
      name: 'requests a code for a normalized email and allows account creation',
      verify: false,
      expectedUser: null,
      expectedWorkerRequests: 0,
    },
    {
      name: 'verifies a code and establishes the Worker session',
      verify: true,
      expectedUser: applicationUser,
      expectedWorkerRequests: 1,
    },
  ]

  await suite.test('happy path', async (happyPath) => {
    for (const testCase of happyCases) {
      await happyPath.test(testCase.name, async () => {
        setActivePinia(createPinia())
        const auth = createAuth()
        const api = createFetcher()
        const store = useSessionStore()
        await store.initialize(auth.client, 'https://api.farmies.test', api.fetcher)

        await store.requestEmailCode('  Friend@Example.COM ')
        if (testCase.verify) {
          await store.verifyEmailCode('123456')
          await new Promise(setImmediate)
        }

        assert.deepEqual(auth.codeRequests, [{
          email: 'friend@example.com',
          options: { shouldCreateUser: true },
        }])
        assert.equal(store.pendingEmail, 'friend@example.com')
        assert.equal(store.resendAvailableAt > Date.now(), true)
        assert.deepEqual(auth.verificationRequests, testCase.verify
          ? [{ email: 'friend@example.com', token: '123456', type: 'email' }]
          : [])
        assert.deepEqual(store.user, testCase.expectedUser)
        assert.equal(api.requests.length, testCase.expectedWorkerRequests)
      })
    }
  })

  const failureCases = [
    {
      name: 'rejects an invalid email before requesting a code',
      email: 'not-an-email',
      requestError: null,
      code: null,
      verificationError: null,
      secondRequest: false,
      expectedCodeRequests: 0,
      expectedVerificationRequests: 0,
    },
    {
      name: 'keeps the email step when Supabase rejects the request',
      email: 'friend@example.com',
      requestError: new Error('request rejected'),
      code: null,
      verificationError: null,
      secondRequest: false,
      expectedCodeRequests: 1,
      expectedVerificationRequests: 0,
    },
    {
      name: 'blocks another request during the resend cooldown',
      email: 'friend@example.com',
      requestError: null,
      code: null,
      verificationError: null,
      secondRequest: true,
      expectedCodeRequests: 1,
      expectedVerificationRequests: 0,
    },
    {
      name: 'rejects a malformed verification code before verification',
      email: 'friend@example.com',
      requestError: null,
      code: '12345',
      verificationError: null,
      secondRequest: false,
      expectedCodeRequests: 1,
      expectedVerificationRequests: 0,
    },
    {
      name: 'keeps the verification step when Supabase rejects the code',
      email: 'friend@example.com',
      requestError: null,
      code: '123456',
      verificationError: new Error('code rejected'),
      secondRequest: false,
      expectedCodeRequests: 1,
      expectedVerificationRequests: 1,
    },
  ]

  await suite.test('failure path', async (failurePath) => {
    for (const testCase of failureCases) {
      await failurePath.test(testCase.name, async () => {
        setActivePinia(createPinia())
        const auth = createAuth(testCase)
        const store = useSessionStore()
        await store.initialize(auth.client, 'https://api.farmies.test', createFetcher().fetcher)

        if (testCase.expectedCodeRequests === 1 && !testCase.requestError) {
          await store.requestEmailCode(testCase.email)
        } else {
          await assert.rejects(store.requestEmailCode(testCase.email))
        }
        if (testCase.secondRequest) await assert.rejects(store.requestEmailCode(testCase.email))
        if (testCase.code) await assert.rejects(store.verifyEmailCode(testCase.code))

        assert.equal(auth.codeRequests.length, testCase.expectedCodeRequests)
        assert.equal(auth.verificationRequests.length, testCase.expectedVerificationRequests)
        assert.equal(store.user, null)
      })
    }
  })
})
