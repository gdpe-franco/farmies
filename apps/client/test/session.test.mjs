import assert from 'node:assert/strict'
import test from 'node:test'

import { createPinia, setActivePinia } from 'pinia'

import { messages } from '../src/i18n/messages.ts'
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

const createdParty = {
  party: {
    id: '84',
    displayName: 'Green Friends',
    species: 'COW',
    environment: 'PASTURE',
    createdAt: '2026-09-11T08:00:00.000Z',
  },
  membership: {
    id: '85',
    nickname: 'Fern',
    joinedAt: '2026-09-11T08:00:00.000Z',
  },
  isOwner: true,
  inviteActive: false,
}

const invite = {
  inviteUrl: 'https://farmies.test/invite/private-invite-token',
  expiresAt: '2026-09-12T08:00:00.000Z',
}

const inviteToken = 'a'.repeat(43)
const invitePreview = { displayName: 'Green Friends', occupancy: 4, capacity: 10 }
const joinedParty = {
  ...createdParty,
  membership: { ...createdParty.membership, nickname: 'Moss' },
  isOwner: false,
  inviteActive: true,
}

const createStorage = () => {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

const createFetcher = (
  status = 200,
  partyStatus = 201,
  currentPartyStatus = 200,
  inviteStatus = 201,
  invitePreviewStatus = 200,
  membershipStatus = 201,
  leaveStatus = 204,
  transferCandidatesStatus = 200,
  transferStatus = 204,
  deletePartyStatus = 204,
  deleteAccountStatus = 204,
) => {
  const requests = []
  const fetcher = async (input, init) => {
    const url = String(input)
    requests.push({ url, init })
    if (url.endsWith('/parties/current/membership')) {
      return leaveStatus === 204
        ? new Response(null, { status: 204 })
        : Response.json({ error: leaveStatus === 403 ? 'PARTY_OWNER_REQUIRED' : leaveStatus === 503 ? 'MEMBERSHIP_DELETE_RETRY' : 'MEMBERSHIP_DELETE_FAILED' }, { status: leaveStatus })
    }
    if (url.endsWith('/users/me') && init.method === 'DELETE') {
      return deleteAccountStatus === 204
        ? new Response(null, { status: 204 })
        : Response.json({
            error: deleteAccountStatus === 403
              ? 'RECENT_AUTH_REQUIRED'
              : deleteAccountStatus === 409
                ? 'PARTY_TRANSFER_REQUIRED'
                : deleteAccountStatus === 503
                  ? 'ACCOUNT_DELETE_RETRY'
                  : 'ACCOUNT_DELETE_FAILED',
          }, { status: deleteAccountStatus })
    }
    if (url.endsWith('/parties/current/transfer-candidates')) {
      return transferCandidatesStatus === 200
        ? Response.json({ members: [{ membershipId: '86', nickname: 'Moss' }] })
        : Response.json({ error: transferCandidatesStatus === 403 ? 'PARTY_OWNER_REQUIRED' : 'PARTY_LOAD_FAILED' }, { status: transferCandidatesStatus })
    }
    if (url.endsWith('/parties/current/owner')) {
      return transferStatus === 204
        ? new Response(null, { status: 204 })
        : Response.json({ error: transferStatus === 403 ? 'PARTY_OWNER_REQUIRED' : transferStatus === 404 ? 'PARTY_SUCCESSOR_NOT_AVAILABLE' : 'PARTY_TRANSFER_FAILED' }, { status: transferStatus })
    }
    if (url.endsWith('/memberships')) {
      return membershipStatus === 201 || membershipStatus === 200
        ? Response.json(joinedParty, { status: membershipStatus })
        : Response.json({ error: membershipStatus === 404 ? 'INVITE_NOT_AVAILABLE' : membershipStatus === 409 ? 'PARTY_MEMBERSHIP_LIMIT' : 'PARTY_JOIN_FAILED' }, { status: membershipStatus })
    }
    if (url.endsWith('/parties/current/invite')) {
      if (init.method === 'DELETE' && inviteStatus === 204) return new Response(null, { status: 204 })
      return inviteStatus === 201
        ? Response.json(invite, { status: 201 })
        : Response.json({ error: 'INVITE_UPDATE_FAILED' }, { status: inviteStatus })
    }
    if (url.includes('/invites/')) {
      return invitePreviewStatus === 200
        ? Response.json({ party: invitePreview })
        : Response.json(
            { error: invitePreviewStatus === 404 ? 'INVITE_NOT_AVAILABLE' : 'INVITE_LOAD_FAILED' },
            { status: invitePreviewStatus },
          )
    }
    if (url.endsWith('/parties/current')) {
      if (init?.method === 'DELETE') {
        return deletePartyStatus === 204
          ? new Response(null, { status: 204 })
          : Response.json({
              error: deletePartyStatus === 403
                ? 'PARTY_OWNER_REQUIRED'
                : deletePartyStatus === 409
                  ? 'PARTY_TRANSFER_REQUIRED'
                  : deletePartyStatus === 503
                    ? 'PARTY_DELETE_RETRY'
                    : 'PARTY_DELETE_FAILED',
            }, { status: deletePartyStatus })
      }
      return currentPartyStatus === 200
        ? Response.json(createdParty)
        : Response.json({ error: 'PARTY_NOT_FOUND' }, { status: currentPartyStatus })
    }
    if (url.endsWith('/parties')) {
      return partyStatus === 201
        ? Response.json(createdParty, { status: 201 })
        : Response.json(
            { error: partyStatus === 409 ? 'PARTY_MEMBERSHIP_LIMIT' : 'PARTY_CREATION_FAILED' },
            { status: partyStatus },
          )
    }
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

test('invite authentication continuation', async (suite) => {
  const happyCases = [
    { name: 'continues in English', locale: 'en', confirmation: 'Join this Party?' },
    { name: 'continues in Spanish', locale: 'es', confirmation: '¿Unirte a este grupo?' },
  ]

  await suite.test('happy path', async (happyPath) => {
    for (const testCase of happyCases) {
      await happyPath.test(testCase.name, async () => {
        const storage = createStorage()
        setActivePinia(createPinia())
        const firstStore = useSessionStore()
        await firstStore.initialize(
          createAuth().client,
          'https://api.farmies.test',
          createFetcher().fetcher,
          storage,
        )
        firstStore.retainInvite(inviteToken)

        setActivePinia(createPinia())
        const auth = createAuth()
        const api = createFetcher()
        const restoredStore = useSessionStore()
        await restoredStore.initialize(
          auth.client,
          'https://api.farmies.test',
          api.fetcher,
          storage,
        )
        await restoredStore.requestEmailCode('friend@example.com')
        await restoredStore.verifyEmailCode('123456')
        await new Promise(setImmediate)
        await restoredStore.loadInvitePreview()

        assert.equal(restoredStore.pendingInviteToken, inviteToken)
        assert.deepEqual(restoredStore.invitePreview, invitePreview)
        assert.equal(api.requests.at(-1).url, `https://api.farmies.test/invites/${inviteToken}`)
        assert.equal(messages[testCase.locale].confirmation.join, testCase.confirmation)

        restoredStore.clearPendingInvite()
        assert.equal(restoredStore.pendingInviteToken, null)
        assert.equal(storage.getItem('farmies.pendingInviteToken'), null)

        restoredStore.retainInvite(inviteToken)
        await restoredStore.signOut()
        assert.equal(restoredStore.pendingInviteToken, null)
        assert.equal(storage.getItem('farmies.pendingInviteToken'), null)
      })
    }
  })

  const failureCases = [
    {
      name: 'rejects a malformed token without retaining it',
      token: 'invalid',
      previewStatus: 200,
      expectedError: /invalid_format/,
    },
    {
      name: 'preserves the destination after an unavailable preview',
      token: inviteToken,
      previewStatus: 404,
      expectedError: /INVITE_NOT_AVAILABLE/,
    },
  ]

  await suite.test('failure path', async (failurePath) => {
    for (const testCase of failureCases) {
      await failurePath.test(testCase.name, async () => {
        setActivePinia(createPinia())
        const storage = createStorage()
        const store = useSessionStore()
        await store.initialize(
          createAuth({ session: { access_token: 'valid-token' } }).client,
          'https://api.farmies.test',
          createFetcher(200, 201, 200, 201, testCase.previewStatus).fetcher,
          storage,
        )

        if (testCase.token === 'invalid') {
          assert.throws(() => store.retainInvite(testCase.token), testCase.expectedError)
          assert.equal(store.pendingInviteToken, null)
        } else {
          store.retainInvite(testCase.token)
          await assert.rejects(store.loadInvitePreview(), testCase.expectedError)
          assert.equal(store.pendingInviteToken, testCase.token)
        }
      })
    }
  })
})

test('Party creation', async (suite) => {
  const happyCases = [
    {
      name: 'creates a Party with normalized input and stores the response',
      displayName: '  Green Friends  ',
      nickname: '  Fern  ',
      expectedBody: { displayName: 'Green Friends', nickname: 'Fern' },
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

        await store.createParty(testCase.displayName, testCase.nickname)

        assert.deepEqual(store.party, createdParty)
        const request = api.requests.at(-1)
        assert.equal(request.url, 'https://api.farmies.test/parties')
        assert.equal(request.init.method, 'POST')
        assert.equal(new Headers(request.init.headers).get('Authorization'), 'Bearer valid-token')
        assert.deepEqual(JSON.parse(request.init.body), testCase.expectedBody)

        await store.signOut()
        assert.equal(store.party, null)
      })
    }
  })

  const failureCases = [
    {
      name: 'rejects an empty Party name before calling the API',
      displayName: '   ',
      nickname: 'Fern',
      partyStatus: 201,
      error: /too_small/,
      expectedPartyRequests: 0,
    },
    {
      name: 'rejects an overlong nickname before calling the API',
      displayName: 'Green Friends',
      nickname: 'x'.repeat(41),
      partyStatus: 201,
      error: /too_big/,
      expectedPartyRequests: 0,
    },
    {
      name: 'reports the active membership limit',
      displayName: 'Green Friends',
      nickname: 'Fern',
      partyStatus: 409,
      error: /PARTY_MEMBERSHIP_LIMIT/,
      expectedPartyRequests: 1,
    },
    {
      name: 'reports a general creation failure',
      displayName: 'Green Friends',
      nickname: 'Fern',
      partyStatus: 500,
      error: /PARTY_CREATION_FAILED/,
      expectedPartyRequests: 1,
    },
  ]

  await suite.test('failure path', async (failurePath) => {
    for (const testCase of failureCases) {
      await failurePath.test(testCase.name, async () => {
        setActivePinia(createPinia())
        const auth = createAuth({ session: { access_token: 'valid-token' } })
        const api = createFetcher(200, testCase.partyStatus)
        const store = useSessionStore()
        await store.initialize(auth.client, 'https://api.farmies.test', api.fetcher)

        await assert.rejects(
          store.createParty(testCase.displayName, testCase.nickname),
          testCase.error,
        )

        assert.equal(store.party, null)
        assert.equal(
          api.requests.filter(({ url }) => url.endsWith('/parties')).length,
          testCase.expectedPartyRequests,
        )
      })
    }
  })
})

test('Party joining', async (suite) => {
  const happyCases = [
    { name: 'joins with normalized input', status: 201 },
    { name: 'accepts an idempotent retry response', status: 200 },
  ]

  await suite.test('happy path', async (happyPath) => {
    for (const testCase of happyCases) {
      await happyPath.test(testCase.name, async () => {
        setActivePinia(createPinia())
        const storage = createStorage()
        const api = createFetcher(200, 201, 200, 201, 200, testCase.status)
        const store = useSessionStore()
        await store.initialize(
          createAuth({ session: { access_token: 'valid-token' } }).client,
          'https://api.farmies.test',
          api.fetcher,
          storage,
        )
        store.retainInvite(inviteToken)

        await store.joinParty('  Moss  ')

        assert.deepEqual(store.party, joinedParty)
        assert.equal(store.pendingInviteToken, null)
        assert.equal(storage.getItem('farmies.pendingInviteToken'), null)
        const request = api.requests.at(-1)
        assert.equal(request.url, 'https://api.farmies.test/memberships')
        assert.deepEqual(JSON.parse(request.init.body), { inviteToken, nickname: 'Moss' })
      })
    }
  })

  const failureCases = [
    { name: 'rejects an empty nickname before calling the API', nickname: '   ', status: 201, error: /too_small/, requests: 0 },
    { name: 'preserves an unavailable invite for a retry', nickname: 'Moss', status: 404, error: /INVITE_NOT_AVAILABLE/, requests: 1 },
    { name: 'reports the active membership limit', nickname: 'Moss', status: 409, error: /PARTY_MEMBERSHIP_LIMIT/, requests: 1 },
  ]

  await suite.test('failure path', async (failurePath) => {
    for (const testCase of failureCases) {
      await failurePath.test(testCase.name, async () => {
        setActivePinia(createPinia())
        const storage = createStorage()
        const api = createFetcher(200, 201, 200, 201, 200, testCase.status)
        const store = useSessionStore()
        await store.initialize(
          createAuth({ session: { access_token: 'valid-token' } }).client,
          'https://api.farmies.test',
          api.fetcher,
          storage,
        )
        store.retainInvite(inviteToken)

        await assert.rejects(store.joinParty(testCase.nickname), testCase.error)

        assert.equal(store.party, null)
        assert.equal(store.pendingInviteToken, inviteToken)
        assert.equal(api.requests.filter(({ url }) => url.endsWith('/memberships')).length, testCase.requests)
      })
    }
  })
})

test('Party invite management', async (suite) => {
  const happyCases = [
    {
      name: 'restores the current Party after reload',
      action: 'load',
      inviteStatus: 201,
      expectedParty: createdParty,
      expectedInvite: null,
      expectedMethod: undefined,
    },
    {
      name: 'creates or replaces the private invite',
      action: 'replace',
      inviteStatus: 201,
      expectedParty: { ...createdParty, inviteActive: true },
      expectedInvite: invite,
      expectedMethod: 'POST',
    },
    {
      name: 'revokes the private invite',
      action: 'revoke',
      inviteStatus: 204,
      expectedParty: { ...createdParty, inviteActive: false },
      expectedInvite: null,
      expectedMethod: 'DELETE',
    },
  ]

  await suite.test('happy path', async (happyPath) => {
    for (const testCase of happyCases) {
      await happyPath.test(testCase.name, async () => {
        setActivePinia(createPinia())
        const auth = createAuth({ session: { access_token: 'valid-token' } })
        const api = createFetcher(200, 201, 200, testCase.inviteStatus)
        const store = useSessionStore()
        await store.initialize(auth.client, 'https://api.farmies.test', api.fetcher)
        await store.loadParty()

        if (testCase.action === 'replace') await store.replaceInvite()
        if (testCase.action === 'revoke') await store.revokeInvite()

        assert.deepEqual(store.party, testCase.expectedParty)
        assert.deepEqual(store.invite, testCase.expectedInvite)
        if (testCase.expectedMethod) {
          const request = api.requests.at(-1)
          assert.equal(request.url, 'https://api.farmies.test/parties/current/invite')
          assert.equal(request.init.method, testCase.expectedMethod)
          assert.equal(new Headers(request.init.headers).get('Authorization'), 'Bearer valid-token')
        }
      })
    }
  })

  const failureCases = [
    {
      name: 'treats a missing current Party as an empty state',
      action: 'load',
      currentStatus: 404,
      inviteStatus: 201,
      rejects: false,
    },
    {
      name: 'reports a current Party load failure',
      action: 'load',
      currentStatus: 500,
      inviteStatus: 201,
      rejects: true,
    },
    {
      name: 'reports an invite replacement failure',
      action: 'replace',
      currentStatus: 200,
      inviteStatus: 403,
      rejects: true,
    },
    {
      name: 'reports an invite revocation failure',
      action: 'revoke',
      currentStatus: 200,
      inviteStatus: 500,
      rejects: true,
    },
  ]

  await suite.test('failure path', async (failurePath) => {
    for (const testCase of failureCases) {
      await failurePath.test(testCase.name, async () => {
        setActivePinia(createPinia())
        const auth = createAuth({ session: { access_token: 'valid-token' } })
        const api = createFetcher(200, 201, testCase.currentStatus, testCase.inviteStatus)
        const store = useSessionStore()
        await store.initialize(auth.client, 'https://api.farmies.test', api.fetcher)

        const action = testCase.action === 'load'
          ? store.loadParty()
          : testCase.action === 'replace'
            ? store.replaceInvite()
            : store.revokeInvite()
        if (testCase.rejects) await assert.rejects(action)
        else await action

        assert.equal(store.invite, null)
      })
    }
  })
})

test('Party leaving', async (suite) => {
  for (const testCase of [
    { name: 'clears the current Party after leaving', status: 204, error: null, clears: true },
    { name: 'clears access while object cleanup is pending', status: 503, error: /PARTY_LEAVE_CLEANUP_PENDING/, clears: true },
    { name: 'keeps Party state when leaving fails', status: 500, error: /PARTY_LEAVE_FAILED/, clears: false },
    { name: 'keeps owner state when transfer is required', status: 403, error: /PARTY_OWNER_REQUIRED/, clears: false },
  ]) {
    await suite.test(testCase.name, async () => {
      setActivePinia(createPinia())
      const api = createFetcher(200, 201, 200, 201, 200, 201, testCase.status)
      const store = useSessionStore()
      await store.initialize(
        createAuth({ session: { access_token: 'valid-token' } }).client,
        'https://api.farmies.test',
        api.fetcher,
      )
      await store.loadParty()

      if (testCase.error) await assert.rejects(store.leaveParty(), testCase.error)
      else await store.leaveParty()

      assert.equal(store.party === null, testCase.clears)
      const request = api.requests.at(-1)
      assert.equal(request.url, 'https://api.farmies.test/parties/current/membership')
      assert.equal(request.init.method, 'DELETE')
      assert.equal(new Headers(request.init.headers).get('Authorization'), 'Bearer valid-token')
    })
  }
})

test('Party ownership transfer', async (suite) => {
  await suite.test('loads candidates and transfers to a confirmed member', async () => {
    setActivePinia(createPinia())
    const api = createFetcher()
    const store = useSessionStore()
    await store.initialize(
      createAuth({ session: { access_token: 'valid-token' } }).client,
      'https://api.farmies.test',
      api.fetcher,
    )
    await store.loadParty()
    await store.loadTransferCandidates()
    await store.transferOwnership('86')

    assert.deepEqual(store.transferCandidates, [])
    assert.equal(store.party.isOwner, false)
    assert.deepEqual(api.requests.slice(-2).map(({ url, init }) => ({ url, method: init.method })), [
      { url: 'https://api.farmies.test/parties/current/transfer-candidates', method: undefined },
      { url: 'https://api.farmies.test/parties/current/owner', method: 'PATCH' },
    ])
    assert.deepEqual(JSON.parse(api.requests.at(-1).init.body), { successorMembershipId: '86' })
  })

  for (const testCase of [
    { name: 'requires the current owner to load candidates', candidatesStatus: 403, transferStatus: 204, action: 'load', error: /PARTY_OWNER_REQUIRED/ },
    { name: 'rejects a stale successor', candidatesStatus: 200, transferStatus: 404, action: 'transfer', error: /PARTY_SUCCESSOR_NOT_AVAILABLE/ },
    { name: 'reports a transfer failure', candidatesStatus: 200, transferStatus: 500, action: 'transfer', error: /PARTY_TRANSFER_FAILED/ },
  ]) {
    await suite.test(testCase.name, async () => {
      setActivePinia(createPinia())
      const api = createFetcher(200, 201, 200, 201, 200, 201, 204, testCase.candidatesStatus, testCase.transferStatus)
      const store = useSessionStore()
      await store.initialize(
        createAuth({ session: { access_token: 'valid-token' } }).client,
        'https://api.farmies.test',
        api.fetcher,
      )
      await store.loadParty()
      const action = testCase.action === 'load'
        ? store.loadTransferCandidates()
        : store.transferOwnership('86')
      await assert.rejects(action, testCase.error)
      assert.equal(store.party.isOwner, true)
    })
  }
})

test('Party deletion', async (suite) => {
  for (const testCase of [
    { name: 'clears the sole-member Party after deletion', status: 204, error: null, clears: true },
    { name: 'clears access while photo cleanup is pending', status: 503, error: /PARTY_DELETE_RETRY/, clears: true },
    { name: 'keeps the Party when ownership changed', status: 403, error: /PARTY_OWNER_REQUIRED/, clears: false },
    { name: 'keeps the Party when transfer is required', status: 409, error: /PARTY_TRANSFER_REQUIRED/, clears: false },
    { name: 'keeps the Party on deletion failure', status: 500, error: /PARTY_DELETE_FAILED/, clears: false },
  ]) {
    await suite.test(testCase.name, async () => {
      setActivePinia(createPinia())
      const api = createFetcher(200, 201, 200, 201, 200, 201, 204, 200, 204, testCase.status)
      const store = useSessionStore()
      await store.initialize(
        createAuth({ session: { access_token: 'valid-token' } }).client,
        'https://api.farmies.test',
        api.fetcher,
      )
      await store.loadParty()

      if (testCase.error) await assert.rejects(store.deleteParty(), testCase.error)
      else await store.deleteParty()

      assert.equal(store.party === null, testCase.clears)
      const request = api.requests.at(-1)
      assert.equal(request.url, 'https://api.farmies.test/parties/current')
      assert.equal(request.init.method, 'DELETE')
    })
  }
})

test('account deletion', async (suite) => {
  for (const testCase of [
    { name: 'deletes and signs out locally', status: 204, error: null, pending: false, signedOut: true, keepsParty: false },
    { name: 'keeps only cleanup access for a retry', status: 503, error: /ACCOUNT_DELETE_RETRY/, pending: true, signedOut: false, keepsParty: false },
    { name: 'requires recent authentication', status: 403, error: /RECENT_AUTH_REQUIRED/, pending: false, signedOut: false, keepsParty: true },
    { name: 'requires ownership transfer', status: 409, error: /PARTY_TRANSFER_REQUIRED/, pending: false, signedOut: false, keepsParty: true },
    { name: 'keeps state on deletion failure', status: 500, error: /ACCOUNT_DELETE_FAILED/, pending: false, signedOut: false, keepsParty: true },
  ]) {
    await suite.test(testCase.name, async () => {
      setActivePinia(createPinia())
      const auth = createAuth({ session: { access_token: 'valid-token' } })
      const api = createFetcher(200, 201, 200, 201, 200, 201, 204, 200, 204, 204, testCase.status)
      const store = useSessionStore()
      await store.initialize(auth.client, 'https://api.farmies.test', api.fetcher)
      await store.loadParty()

      if (testCase.error) await assert.rejects(store.deleteAccount(), testCase.error)
      else await store.deleteAccount()

      assert.equal(store.accountDeletionPending, testCase.pending)
      assert.equal(store.party !== null, testCase.keepsParty)
      assert.equal(store.accessToken === null, testCase.signedOut)
      assert.equal(auth.signOutCalls.length, testCase.signedOut ? 1 : 0)
      const deletion = api.requests.find(({ url, init }) => url.endsWith('/users/me') && init.method === 'DELETE')
      assert.ok(deletion)
      assert.equal(new Headers(deletion.init.headers).get('Authorization'), 'Bearer valid-token')
    })
  }
})
