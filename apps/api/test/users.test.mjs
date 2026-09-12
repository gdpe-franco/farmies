import assert from 'node:assert/strict'
import test from 'node:test'

import { createApp, createInviteSecret } from '../src/index.ts'

const issuer = 'https://example.supabase.co/auth/v1'
const authUserId = '03d9d8e0-a088-4f4c-a97f-967675fb4e39'
const keyId = 'test-key'
const encoder = new TextEncoder()

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

const createToken = async (privateKey, overrides = {}) => {
  const header = encode({ alg: 'ES256', kid: keyId, typ: 'JWT' })
  const payload = encode({
    sub: authUserId,
    iss: issuer,
    aud: 'authenticated',
    role: 'authenticated',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60,
    ...overrides,
  })
  const unsigned = `${header}.${payload}`
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    encoder.encode(unsigned),
  )

  return `${unsigned}.${Buffer.from(signature).toString('base64url')}`
}

test('authorized API endpoints', async (suite) => {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const publicKey = await crypto.subtle.exportKey('jwk', keys.publicKey)
  const originalFetch = globalThis.fetch
  const jwksRequests = []
  globalThis.fetch = async (input) => {
    jwksRequests.push(String(input))
    return Response.json({ keys: [{ ...publicKey, alg: 'ES256', kid: keyId }] })
  }
  suite.after(() => {
    globalThis.fetch = originalFetch
  })

  const requestedIds = []
  const localeUpdates = []
  const partyRequests = []
  const inviteRequests = []
  const currentParty = {
    party: {
      id: 84n,
      displayName: 'Green Friends',
      species: 'COW',
      environment: 'PASTURE',
      createdAt: new Date('2026-09-11T08:00:00.000Z'),
    },
    membership: {
      id: 85n,
      nickname: 'Fern',
      joinedAt: new Date('2026-09-11T08:00:00.000Z'),
    },
    isOwner: true,
    inviteActive: false,
  }
  let currentPartyResult = currentParty
  let inviteResult = {
    status: 'created',
    token: 'private-invite-token',
    expiresAt: new Date('2026-09-12T08:00:00.000Z'),
  }
  const user = {
    id: 42n,
    preferredLocale: 'en',
    createdAt: new Date('2026-09-10T12:00:00.000Z'),
    updatedAt: new Date('2026-09-10T12:30:00.000Z'),
  }
  const app = createApp({
    createParty: async (_bindings, id, input) => {
      partyRequests.push({ id, input })
      if (input.displayName === 'Existing Party') return { status: 'already_member' }
      if (input.displayName === 'Missing User') return { status: 'user_not_found' }
      if (input.displayName === 'Broken Party') throw new Error('database unavailable')

      return {
        status: 'created',
        value: {
          party: { ...currentParty.party, displayName: input.displayName },
          membership: { ...currentParty.membership, nickname: input.nickname },
          isOwner: true,
          inviteActive: false,
        },
      }
    },
    findCurrentParty: async () => {
      if (currentPartyResult instanceof Error) throw currentPartyResult
      return currentPartyResult
    },
    findOrCreateUser: async (_bindings, id) => {
      requestedIds.push(id)
      return user
    },
    updateUserLocale: async (_bindings, id, preferredLocale) => {
      requestedIds.push(id)
      localeUpdates.push(preferredLocale)
      return { ...user, preferredLocale }
    },
    manageInvite: async (_bindings, id, action) => {
      inviteRequests.push({ id, action })
      if (inviteResult instanceof Error) throw inviteResult
      return inviteResult
    },
  })
  const bindings = {
    CLIENT_ORIGIN: 'https://farmies.test',
    SUPABASE_JWKS_URL: 'https://jwks.internal/auth/v1/.well-known/jwks.json',
    SUPABASE_URL: 'https://example.supabase.co',
  }
  const validToken = await createToken(keys.privateKey)
  const signatureStart = validToken.lastIndexOf('.') + 1
  const firstSignatureCharacter = validToken[signatureStart]
  const tamperedToken = `${validToken.slice(0, signatureStart)}${firstSignatureCharacter === 'A' ? 'B' : 'A'}${validToken.slice(signatureStart + 1)}`

  const happyCases = [
    {
      name: 'returns the application user for a valid token',
      method: 'PUT',
      authorization: `Bearer ${validToken}`,
      status: 200,
      body: {
        user: {
          id: '42',
          preferredLocale: 'en',
          createdAt: '2026-09-10T12:00:00.000Z',
          updatedAt: '2026-09-10T12:30:00.000Z',
        },
      },
    },
    {
      name: 'stores a supported locale for the verified user',
      method: 'PATCH',
      authorization: `Bearer ${validToken}`,
      requestBody: { preferredLocale: 'es' },
      status: 200,
      body: {
        user: {
          id: '42',
          preferredLocale: 'es',
          createdAt: '2026-09-10T12:00:00.000Z',
          updatedAt: '2026-09-10T12:30:00.000Z',
        },
      },
    },
  ]

  await suite.test('happy path', async (happyPath) => {
    for (const testCase of happyCases) {
      await happyPath.test(testCase.name, async () => {
        const response = await app.request(
          '/users/me',
          {
            method: testCase.method,
            headers: {
              Authorization: testCase.authorization,
              Origin: bindings.CLIENT_ORIGIN,
              ...(testCase.requestBody ? { 'Content-Type': 'application/json' } : {}),
            },
            body: testCase.requestBody ? JSON.stringify(testCase.requestBody) : undefined,
          },
          bindings,
        )

        assert.equal(response.status, testCase.status)
        assert.equal(response.headers.get('Access-Control-Allow-Origin'), bindings.CLIENT_ORIGIN)
        assert.deepEqual(await response.json(), testCase.body)
        assert.equal(jwksRequests[0], bindings.SUPABASE_JWKS_URL)
      })
    }
    assert.deepEqual(requestedIds, [authUserId, authUserId])
    assert.deepEqual(localeUpdates, ['es'])
  })

  const failureCases = [
    { name: 'rejects missing authorization', authorization: undefined, method: 'PUT', status: 401 },
    { name: 'rejects malformed authorization', authorization: 'not-a-bearer-token', method: 'PUT', status: 401 },
    {
      name: 'rejects the wrong issuer',
      authorization: `Bearer ${await createToken(keys.privateKey, { iss: 'https://attacker.invalid/auth/v1' })}`,
      method: 'PUT',
      status: 401,
    },
    { name: 'rejects the wrong audience', authorization: `Bearer ${await createToken(keys.privateKey, { aud: 'anon' })}`, method: 'PUT', status: 401 },
    { name: 'rejects an expired token', authorization: `Bearer ${await createToken(keys.privateKey, { exp: 1 })}`, method: 'PUT', status: 401 },
    { name: 'rejects a missing expiry', authorization: `Bearer ${await createToken(keys.privateKey, { exp: undefined })}`, method: 'PUT', status: 401 },
    { name: 'rejects the wrong role', authorization: `Bearer ${await createToken(keys.privateKey, { role: 'anon' })}`, method: 'PUT', status: 401 },
    { name: 'rejects an invalid subject', authorization: `Bearer ${await createToken(keys.privateKey, { sub: 'not-a-uuid' })}`, method: 'PUT', status: 401 },
    { name: 'rejects an invalid signature', authorization: `Bearer ${tamperedToken}`, method: 'PUT', status: 401 },
    {
      name: 'rejects an unsupported locale',
      authorization: `Bearer ${validToken}`,
      method: 'PATCH',
      requestBody: { preferredLocale: 'fr' },
      status: 400,
    },
  ]

  await suite.test('failure path', async (failurePath) => {
    for (const testCase of failureCases) {
      await failurePath.test(testCase.name, async () => {
        const headers = testCase.authorization
          ? {
              Authorization: testCase.authorization,
              ...(testCase.requestBody ? { 'Content-Type': 'application/json' } : {}),
            }
          : undefined
        const response = await app.request('/users/me', {
          method: testCase.method,
          headers,
          body: testCase.requestBody ? JSON.stringify(testCase.requestBody) : undefined,
        }, bindings)

        assert.equal(response.status, testCase.status)
        assert.deepEqual(requestedIds, [authUserId, authUserId])
      })
    }
  })

  const partyHappyCases = [
    {
      name: 'creates a Party and its owner membership for the verified user',
      requestBody: { displayName: '  Green Friends  ', nickname: '  Fern  ' },
      expectedInput: { displayName: 'Green Friends', nickname: 'Fern' },
      body: {
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
      },
    },
  ]

  await suite.test('Party happy path', async (happyPath) => {
    for (const testCase of partyHappyCases) {
      await happyPath.test(testCase.name, async () => {
        const response = await app.request('/parties', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${validToken}`,
            'Content-Type': 'application/json',
            Origin: bindings.CLIENT_ORIGIN,
          },
          body: JSON.stringify(testCase.requestBody),
        }, bindings)

        assert.equal(response.status, 201)
        assert.equal(response.headers.get('Access-Control-Allow-Origin'), bindings.CLIENT_ORIGIN)
        assert.deepEqual(await response.json(), testCase.body)
        assert.deepEqual(partyRequests.at(-1), { id: authUserId, input: testCase.expectedInput })
      })
    }
  })

  const partyFailureCases = [
    {
      name: 'rejects missing authorization',
      authorization: undefined,
      requestBody: { displayName: 'Green Friends', nickname: 'Fern' },
      status: 401,
      body: null,
    },
    {
      name: 'rejects an empty Party name',
      authorization: `Bearer ${validToken}`,
      requestBody: { displayName: '   ', nickname: 'Fern' },
      status: 400,
      body: { error: 'INVALID_REQUEST' },
    },
    {
      name: 'rejects a nickname longer than 40 characters',
      authorization: `Bearer ${validToken}`,
      requestBody: { displayName: 'Green Friends', nickname: 'x'.repeat(41) },
      status: 400,
      body: { error: 'INVALID_REQUEST' },
    },
    {
      name: 'rejects a second active membership',
      authorization: `Bearer ${validToken}`,
      requestBody: { displayName: 'Existing Party', nickname: 'Fern' },
      status: 409,
      body: { error: 'ALREADY_IN_PARTY' },
    },
    {
      name: 'rejects an authentication identity without an application user',
      authorization: `Bearer ${validToken}`,
      requestBody: { displayName: 'Missing User', nickname: 'Fern' },
      status: 401,
      body: null,
    },
    {
      name: 'returns a stable error when creation fails',
      authorization: `Bearer ${validToken}`,
      requestBody: { displayName: 'Broken Party', nickname: 'Fern' },
      status: 500,
      body: { error: 'PARTY_CREATION_FAILED' },
    },
  ]

  await suite.test('Party failure path', async (failurePath) => {
    for (const testCase of partyFailureCases) {
      await failurePath.test(testCase.name, async () => {
        const response = await app.request('/parties', {
          method: 'POST',
          headers: testCase.authorization
            ? { Authorization: testCase.authorization, 'Content-Type': 'application/json' }
            : { 'Content-Type': 'application/json' },
          body: JSON.stringify(testCase.requestBody),
        }, bindings)

        assert.equal(response.status, testCase.status)
        if (testCase.body) assert.deepEqual(await response.json(), testCase.body)
      })
    }
  })

  const inviteHappyCases = [
    {
      name: 'loads the current Party without revealing an invite token',
      method: 'GET',
      path: '/parties/current',
      status: 200,
      body: {
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
      },
    },
    {
      name: 'creates or replaces an invite for the current owner',
      method: 'POST',
      path: '/parties/current/invite',
      status: 201,
      body: {
        inviteUrl: 'https://farmies.test/invite/private-invite-token',
        expiresAt: '2026-09-12T08:00:00.000Z',
      },
    },
    {
      name: 'revokes the current invite idempotently',
      method: 'DELETE',
      path: '/parties/current/invite',
      status: 204,
      body: null,
    },
  ]

  await suite.test('invite happy path', async (happyPath) => {
    for (const testCase of inviteHappyCases) {
      await happyPath.test(testCase.name, async () => {
        inviteResult = testCase.method === 'DELETE'
          ? { status: 'revoked' }
          : {
              status: 'created',
              token: 'private-invite-token',
              expiresAt: new Date('2026-09-12T08:00:00.000Z'),
            }
        const response = await app.request(testCase.path, {
          method: testCase.method,
          headers: { Authorization: `Bearer ${validToken}`, Origin: bindings.CLIENT_ORIGIN },
        }, bindings)

        assert.equal(response.status, testCase.status)
        assert.equal(response.headers.get('Access-Control-Allow-Origin'), bindings.CLIENT_ORIGIN)
        if (testCase.body) assert.deepEqual(await response.json(), testCase.body)
      })
    }
    assert.deepEqual(inviteRequests, [
      { id: authUserId, action: 'replace' },
      { id: authUserId, action: 'revoke' },
    ])
  })

  const inviteFailureCases = [
    {
      name: 'requires authentication',
      path: '/parties/current/invite',
      method: 'POST',
      authorization: undefined,
      result: { status: 'created' },
      status: 401,
      body: null,
    },
    {
      name: 'does not expose a missing current Party',
      path: '/parties/current',
      method: 'GET',
      authorization: `Bearer ${validToken}`,
      current: undefined,
      result: { status: 'created' },
      status: 404,
      body: { error: 'PARTY_NOT_FOUND' },
    },
    {
      name: 'rejects invite creation by a non-owner',
      path: '/parties/current/invite',
      method: 'POST',
      authorization: `Bearer ${validToken}`,
      result: { status: 'owner_required' },
      status: 403,
      body: { error: 'PARTY_OWNER_REQUIRED' },
    },
    {
      name: 'rejects invite revocation by a non-owner',
      path: '/parties/current/invite',
      method: 'DELETE',
      authorization: `Bearer ${validToken}`,
      result: { status: 'owner_required' },
      status: 403,
      body: { error: 'PARTY_OWNER_REQUIRED' },
    },
    {
      name: 'returns a stable invite update failure',
      path: '/parties/current/invite',
      method: 'POST',
      authorization: `Bearer ${validToken}`,
      result: new Error('database unavailable'),
      status: 500,
      body: { error: 'INVITE_UPDATE_FAILED' },
    },
    {
      name: 'does not provide a Party-ID invite route',
      path: '/parties/84/invite',
      method: 'GET',
      authorization: `Bearer ${validToken}`,
      result: { status: 'created' },
      status: 404,
      body: null,
    },
  ]

  await suite.test('invite failure path', async (failurePath) => {
    for (const testCase of inviteFailureCases) {
      await failurePath.test(testCase.name, async () => {
        currentPartyResult = Object.hasOwn(testCase, 'current') ? testCase.current : currentParty
        inviteResult = testCase.result
        const response = await app.request(testCase.path, {
          method: testCase.method,
          headers: testCase.authorization ? { Authorization: testCase.authorization } : undefined,
        }, bindings)

        assert.equal(response.status, testCase.status)
        if (testCase.body) assert.deepEqual(await response.json(), testCase.body)
      })
    }
  })
})

test('invite secrets', async (suite) => {
  const happyCases = [
    { name: 'generates unique 256-bit base64url bearer tokens' },
    { name: 'stores the lowercase SHA-256 token hash' },
  ]
  const first = await createInviteSecret()
  const second = await createInviteSecret()

  await suite.test('happy path', async (happyPath) => {
    for (const testCase of happyCases) {
      await happyPath.test(testCase.name, async () => {
        if (testCase.name.includes('unique')) {
          assert.match(first.token, /^[A-Za-z0-9_-]{43}$/)
          assert.notEqual(first.token, second.token)
        } else {
          const digest = await crypto.subtle.digest('SHA-256', encoder.encode(first.token))
          assert.equal(first.hash, Buffer.from(digest).toString('hex'))
          assert.match(first.hash, /^[0-9a-f]{64}$/)
        }
      })
    }
  })
})
