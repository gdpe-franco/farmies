import assert from 'node:assert/strict'
import test from 'node:test'

import { createApp } from '../src/index.ts'
import { createInviteSecret, hashInviteToken } from '../src/invites.ts'

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
    amr: [{ method: 'otp', timestamp: Math.floor(Date.now() / 1000) }],
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
  const partyListRequests = []
  const partyByIdRequests = []
  const accountDeleteRequests = []
  const deletePartyRequests = []
  const inviteRequests = []
  const invitePreviewRequests = []
  const joinRequests = []
  const leaveRequests = []
  const transferCandidateRequests = []
  const transferRequests = []
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
  const partySummaries = [{
    id: 84n,
    displayName: 'Green Friends',
    membershipId: 85n,
    nickname: 'Fern',
    role: 'owner',
    occupancy: 4,
    species: 'COW',
    environment: 'PASTURE',
    joinedAt: new Date('2026-09-11T08:00:00.000Z'),
  }]
  let currentPartyResult = currentParty
  let inviteResult = {
    status: 'created',
    token: 'private-invite-token',
    expiresAt: new Date('2026-09-12T08:00:00.000Z'),
  }
  let joinResult = {
    status: 'joined',
    value: { ...currentParty, isOwner: false, inviteActive: true },
  }
  let leaveResult = { status: 'left' }
  let deletePartyResult = { status: 'deleted' }
  let deleteAccountResult = { status: 'deleted' }
  let transferCandidatesResult = {
    status: 'found',
    members: [{ membershipId: 86n, nickname: 'Moss' }],
  }
  let transferResult = { status: 'transferred' }
  const user = {
    id: 42n,
    preferredLocale: 'en',
    createdAt: new Date('2026-09-10T12:00:00.000Z'),
    updatedAt: new Date('2026-09-10T12:30:00.000Z'),
  }
  const app = createApp({
    createParty: async (_bindings, id, input) => {
      partyRequests.push({ id, input })
      if (input.displayName === 'Membership Limit') return { status: 'membership_limit' }
      if (input.displayName === 'Ownership Limit') return { status: 'ownership_limit' }
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
    deleteParty: async (_bindings, id) => {
      deletePartyRequests.push(id)
      if (deletePartyResult instanceof Error) throw deletePartyResult
      return deletePartyResult
    },
    deleteAccount: async (_bindings, id, authenticatedAt) => {
      accountDeleteRequests.push({ id, authenticatedAt })
      if (deleteAccountResult instanceof Error) throw deleteAccountResult
      return deleteAccountResult
    },
    findCurrentParty: async () => {
      if (currentPartyResult instanceof Error) throw currentPartyResult
      return currentPartyResult
    },
    findParties: async (_bindings, id) => {
      partyListRequests.push(id)
      return partySummaries
    },
    findPartyById: async (_bindings, id, partyId) => {
      partyByIdRequests.push({ id, partyId })
      if (partyId === 98n) throw new Error('database unavailable')
      return partySummaries.find((party) => party.id === partyId)
    },
    findOrCreateUser: async (_bindings, id) => {
      requestedIds.push(id)
      return user
    },
    findInvitePreview: async (_bindings, tokenHash) => {
      invitePreviewRequests.push(tokenHash)
      if (tokenHash === await hashInviteToken('b'.repeat(43))) return undefined
      if (tokenHash === await hashInviteToken('c'.repeat(43))) throw new Error('database unavailable')
      return { displayName: 'Green Friends', occupancy: 4 }
    },
    findTransferCandidates: async (_bindings, id) => {
      transferCandidateRequests.push(id)
      if (transferCandidatesResult instanceof Error) throw transferCandidatesResult
      return transferCandidatesResult
    },
    joinParty: async (_bindings, id, input) => {
      joinRequests.push({ id, input })
      if (joinResult instanceof Error) throw joinResult
      return joinResult
    },
    leaveParty: async (_bindings, id) => {
      leaveRequests.push(id)
      if (leaveResult instanceof Error) throw leaveResult
      return leaveResult
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
    transferParty: async (_bindings, id, membershipId) => {
      transferRequests.push({ id, membershipId })
      if (transferResult instanceof Error) throw transferResult
      return transferResult
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
    { name: 'rejects a missing issued-at time', authorization: `Bearer ${await createToken(keys.privateKey, { iat: undefined })}`, method: 'PUT', status: 401 },
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
      name: 'rejects a client-supplied identity',
      authorization: `Bearer ${validToken}`,
      requestBody: { displayName: 'Green Friends', nickname: 'Fern', userId: '99' },
      status: 400,
      body: { error: 'INVALID_REQUEST' },
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
      name: 'rejects a fourth active membership',
      authorization: `Bearer ${validToken}`,
      requestBody: { displayName: 'Membership Limit', nickname: 'Fern' },
      status: 409,
      body: { error: 'PARTY_MEMBERSHIP_LIMIT' },
    },
    {
      name: 'rejects a second active ownership',
      authorization: `Bearer ${validToken}`,
      requestBody: { displayName: 'Ownership Limit', nickname: 'Fern' },
      status: 409,
      body: { error: 'PARTY_OWNERSHIP_LIMIT' },
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

  await suite.test('listing and selecting Parties', async (partyReadTests) => {
    const summary = {
      id: '84',
      displayName: 'Green Friends',
      membershipId: '85',
      nickname: 'Fern',
      role: 'owner',
      occupancy: 4,
      species: 'COW',
      environment: 'PASTURE',
      joinedAt: '2026-09-11T08:00:00.000Z',
    }

    const listResponse = await app.request('/parties', {
      headers: { Authorization: `Bearer ${validToken}`, Origin: bindings.CLIENT_ORIGIN },
    }, bindings)
    assert.equal(listResponse.status, 200)
    assert.equal(listResponse.headers.get('Access-Control-Allow-Origin'), bindings.CLIENT_ORIGIN)
    assert.deepEqual(await listResponse.json(), { parties: [summary] })
    assert.deepEqual(partyListRequests, [authUserId])

    const detailResponse = await app.request('/parties/84', {
      headers: { Authorization: `Bearer ${validToken}` },
    }, bindings)
    assert.equal(detailResponse.status, 200)
    assert.deepEqual(await detailResponse.json(), { party: summary })

    for (const testCase of [
      { path: '/parties/0', status: 400, error: 'INVALID_REQUEST' },
      { path: '/parties/9223372036854775808', status: 400, error: 'INVALID_REQUEST' },
      { path: '/parties/99', status: 404, error: 'PARTY_NOT_FOUND' },
      { path: '/parties/98', status: 500, error: 'PARTY_LOAD_FAILED' },
    ]) {
      await partyReadTests.test(testCase.path, async () => {
        const response = await app.request(testCase.path, {
          headers: { Authorization: `Bearer ${validToken}` },
        }, bindings)
        assert.equal(response.status, testCase.status)
        assert.deepEqual(await response.json(), { error: testCase.error })
      })
    }

    assert.deepEqual(partyByIdRequests, [84n, 99n, 98n].map((partyId) => ({
      id: authUserId,
      partyId,
    })))
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

  const previewHappyCases = [
    {
      name: 'shows only Party name and occupancy for a valid invite',
      token: 'a'.repeat(43),
      status: 200,
      body: { party: { displayName: 'Green Friends', occupancy: 4, capacity: 10 } },
    },
  ]

  await suite.test('invite preview happy path', async (happyPath) => {
    for (const testCase of previewHappyCases) {
      await happyPath.test(testCase.name, async () => {
        const response = await app.request(`/invites/${testCase.token}`, {
          headers: { Authorization: `Bearer ${validToken}`, Origin: bindings.CLIENT_ORIGIN },
        }, bindings)

        assert.equal(response.status, testCase.status)
        assert.equal(response.headers.get('Access-Control-Allow-Origin'), bindings.CLIENT_ORIGIN)
        assert.deepEqual(await response.json(), testCase.body)
        assert.equal(invitePreviewRequests.at(-1), await hashInviteToken(testCase.token))
      })
    }
  })

  const previewFailureCases = [
    {
      name: 'requires authentication before resolving an invite',
      token: 'a'.repeat(43),
      authorization: undefined,
      status: 401,
      body: null,
    },
    {
      name: 'hides malformed invite details',
      token: 'invalid',
      authorization: `Bearer ${validToken}`,
      status: 404,
      body: { error: 'INVITE_NOT_AVAILABLE' },
    },
    {
      name: 'hides unavailable invite details',
      token: 'b'.repeat(43),
      authorization: `Bearer ${validToken}`,
      status: 404,
      body: { error: 'INVITE_NOT_AVAILABLE' },
    },
    {
      name: 'returns a stable preview failure',
      token: 'c'.repeat(43),
      authorization: `Bearer ${validToken}`,
      status: 500,
      body: { error: 'INVITE_LOAD_FAILED' },
    },
  ]

  await suite.test('invite preview failure path', async (failurePath) => {
    for (const testCase of previewFailureCases) {
      await failurePath.test(testCase.name, async () => {
        const response = await app.request(`/invites/${testCase.token}`, {
          headers: testCase.authorization ? { Authorization: testCase.authorization } : undefined,
        }, bindings)

        assert.equal(response.status, testCase.status)
        if (testCase.body) assert.deepEqual(await response.json(), testCase.body)
      })
    }
  })

  const membershipHappyCases = [
    {
      name: 'creates a membership from a valid invite',
      resultStatus: 'joined',
      status: 201,
    },
    {
      name: 'returns the existing membership when the same join is retried',
      resultStatus: 'already_joined',
      status: 200,
    },
  ]

  await suite.test('membership happy path', async (happyPath) => {
    for (const testCase of membershipHappyCases) {
      await happyPath.test(testCase.name, async () => {
        joinResult = {
          status: testCase.resultStatus,
          value: { ...currentParty, isOwner: false, inviteActive: true },
        }
        const response = await app.request('/memberships', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${validToken}`,
            'Content-Type': 'application/json',
            Origin: bindings.CLIENT_ORIGIN,
          },
          body: JSON.stringify({ inviteToken: 'a'.repeat(43), nickname: '  Fern  ' }),
        }, bindings)

        assert.equal(response.status, testCase.status)
        assert.equal(response.headers.get('Access-Control-Allow-Origin'), bindings.CLIENT_ORIGIN)
        assert.equal((await response.json()).membership.nickname, 'Fern')
        assert.deepEqual(joinRequests.at(-1), {
          id: authUserId,
          input: { inviteTokenHash: await hashInviteToken('a'.repeat(43)), nickname: 'Fern' },
        })
      })
    }
  })

  const membershipFailureCases = [
    { name: 'requires authentication', authorization: undefined, body: { inviteToken: 'a'.repeat(43), nickname: 'Fern' }, result: { status: 'joined' }, status: 401, error: null },
    { name: 'rejects a client-supplied identity', authorization: `Bearer ${validToken}`, body: { inviteToken: 'a'.repeat(43), nickname: 'Fern', userId: '99' }, result: { status: 'joined' }, status: 400, error: 'INVALID_REQUEST' },
    { name: 'rejects a malformed invite token', authorization: `Bearer ${validToken}`, body: { inviteToken: 'invalid', nickname: 'Fern' }, result: { status: 'joined' }, status: 400, error: 'INVALID_REQUEST' },
    { name: 'rejects an empty nickname', authorization: `Bearer ${validToken}`, body: { inviteToken: 'a'.repeat(43), nickname: '   ' }, result: { status: 'joined' }, status: 400, error: 'INVALID_REQUEST' },
    { name: 'hides invalid, expired, revoked, or full invites', authorization: `Bearer ${validToken}`, body: { inviteToken: 'a'.repeat(43), nickname: 'Fern' }, result: { status: 'invite_not_available' }, status: 404, error: 'INVITE_NOT_AVAILABLE' },
    { name: 'rejects a fourth active membership', authorization: `Bearer ${validToken}`, body: { inviteToken: 'a'.repeat(43), nickname: 'Fern' }, result: { status: 'membership_limit' }, status: 409, error: 'PARTY_MEMBERSHIP_LIMIT' },
  ]

  await suite.test('membership failure path', async (failurePath) => {
    for (const testCase of membershipFailureCases) {
      await failurePath.test(testCase.name, async () => {
        joinResult = testCase.result
        const response = await app.request('/memberships', {
          method: 'POST',
          headers: testCase.authorization
            ? { Authorization: testCase.authorization, 'Content-Type': 'application/json' }
            : { 'Content-Type': 'application/json' },
          body: JSON.stringify(testCase.body),
        }, bindings)

        assert.equal(response.status, testCase.status)
        if (testCase.error) assert.deepEqual(await response.json(), { error: testCase.error })
      })
    }
  })

  await suite.test('leaving a Party', async (leaveTests) => {
    for (const testCase of [
      { name: 'leaves the current Party', result: { status: 'left' }, status: 204, error: null },
      { name: 'accepts an idempotent retry', result: { status: 'already_left' }, status: 204, error: null },
      { name: 'requires ownership transfer first', result: { status: 'owner_required' }, status: 403, error: 'PARTY_OWNER_REQUIRED' },
      { name: 'makes object cleanup retryable', result: { status: 'cleanup_pending' }, status: 503, error: 'MEMBERSHIP_DELETE_RETRY' },
      { name: 'returns a stable failure', result: new Error('database unavailable'), status: 500, error: 'MEMBERSHIP_DELETE_FAILED' },
    ]) {
      await leaveTests.test(testCase.name, async () => {
        leaveResult = testCase.result
        const response = await app.request('/parties/current/membership', {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${validToken}`, Origin: bindings.CLIENT_ORIGIN },
        }, bindings)
        assert.equal(response.status, testCase.status)
        assert.equal(response.headers.get('Access-Control-Allow-Origin'), bindings.CLIENT_ORIGIN)
        if (testCase.error) assert.deepEqual(await response.json(), { error: testCase.error })
      })
    }
    assert.equal(leaveRequests.length, 5)
  })

  await suite.test('transferring Party ownership', async (transferTests) => {
    transferCandidatesResult = {
      status: 'found',
      members: [{ membershipId: 86n, nickname: 'Moss' }],
    }
    const candidates = await app.request('/parties/current/transfer-candidates', {
      headers: { Authorization: `Bearer ${validToken}`, Origin: bindings.CLIENT_ORIGIN },
    }, bindings)
    assert.equal(candidates.status, 200)
    assert.deepEqual(await candidates.json(), {
      members: [{ membershipId: '86', nickname: 'Moss' }],
    })
    transferCandidatesResult = { status: 'owner_required' }
    const forbiddenCandidates = await app.request('/parties/current/transfer-candidates', {
      headers: { Authorization: `Bearer ${validToken}` },
    }, bindings)
    assert.equal(forbiddenCandidates.status, 403)
    assert.deepEqual(await forbiddenCandidates.json(), { error: 'PARTY_OWNER_REQUIRED' })

    for (const testCase of [
      { name: 'transfers to an active member', body: { successorMembershipId: '86' }, result: { status: 'transferred' }, status: 204, error: null },
      { name: 'rejects a client-supplied identity', body: { successorMembershipId: '86', userId: '99' }, result: { status: 'transferred' }, status: 400, error: 'INVALID_REQUEST' },
      { name: 'rejects malformed membership IDs', body: { successorMembershipId: '0' }, result: { status: 'transferred' }, status: 400, error: 'INVALID_REQUEST' },
      { name: 'requires the current owner', body: { successorMembershipId: '86' }, result: { status: 'owner_required' }, status: 403, error: 'PARTY_OWNER_REQUIRED' },
      { name: 'rejects a stale or cross-Party successor', body: { successorMembershipId: '86' }, result: { status: 'successor_not_available' }, status: 404, error: 'PARTY_SUCCESSOR_NOT_AVAILABLE' },
      { name: 'rejects a successor who owns a Party', body: { successorMembershipId: '86' }, result: { status: 'successor_ownership_limit' }, status: 409, error: 'PARTY_SUCCESSOR_OWNERSHIP_LIMIT' },
      { name: 'returns a stable transfer failure', body: { successorMembershipId: '86' }, result: new Error('database unavailable'), status: 500, error: 'PARTY_TRANSFER_FAILED' },
    ]) {
      await transferTests.test(testCase.name, async () => {
        transferResult = testCase.result
        const response = await app.request('/parties/current/owner', {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${validToken}`,
            'Content-Type': 'application/json',
            Origin: bindings.CLIENT_ORIGIN,
          },
          body: JSON.stringify(testCase.body),
        }, bindings)
        assert.equal(response.status, testCase.status)
        if (testCase.error) assert.deepEqual(await response.json(), { error: testCase.error })
      })
    }
    assert.deepEqual(transferCandidateRequests, [authUserId, authUserId])
    assert.deepEqual(transferRequests.map(({ membershipId }) => membershipId), [86n, 86n, 86n, 86n, 86n])
  })

  await suite.test('deleting a sole-member Party', async (deleteTests) => {
    for (const testCase of [
      { name: 'deletes the Party', result: { status: 'deleted' }, status: 204, error: null },
      { name: 'accepts an idempotent retry', result: { status: 'already_deleted' }, status: 204, error: null },
      { name: 'requires the current owner', result: { status: 'owner_required' }, status: 403, error: 'PARTY_OWNER_REQUIRED' },
      { name: 'requires transfer while another member remains', result: { status: 'transfer_required' }, status: 409, error: 'PARTY_TRANSFER_REQUIRED' },
      { name: 'makes object cleanup retryable', result: { status: 'cleanup_pending' }, status: 503, error: 'PARTY_DELETE_RETRY' },
      { name: 'returns a stable deletion failure', result: new Error('database unavailable'), status: 500, error: 'PARTY_DELETE_FAILED' },
    ]) {
      await deleteTests.test(testCase.name, async () => {
        deletePartyResult = testCase.result
        const response = await app.request('/parties/current', {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${validToken}`, Origin: bindings.CLIENT_ORIGIN },
        }, bindings)
        assert.equal(response.status, testCase.status)
        if (testCase.error) assert.deepEqual(await response.json(), { error: testCase.error })
      })
    }
    assert.deepEqual(deletePartyRequests, Array(6).fill(authUserId))
  })

  await suite.test('deleting an account', async (deleteTests) => {
    const issuedAt = Math.floor(Date.now() / 1_000)
    const recentToken = await createToken(keys.privateKey, {
      iat: issuedAt,
      amr: [{ method: 'otp', timestamp: issuedAt }],
    })
    for (const testCase of [
      { name: 'deletes with recent authentication', result: { status: 'deleted' }, status: 204, error: null },
      { name: 'requires recent authentication', result: { status: 'recent_auth_required' }, status: 403, error: 'RECENT_AUTH_REQUIRED' },
      { name: 'requires ownership transfer', result: { status: 'transfer_required' }, status: 409, error: 'PARTY_TRANSFER_REQUIRED' },
      { name: 'makes external cleanup retryable', result: { status: 'cleanup_pending' }, status: 503, error: 'ACCOUNT_DELETE_RETRY' },
      { name: 'returns a stable deletion failure', result: new Error('database unavailable'), status: 500, error: 'ACCOUNT_DELETE_FAILED' },
    ]) {
      await deleteTests.test(testCase.name, async () => {
        deleteAccountResult = testCase.result
        const response = await app.request('/users/me', {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${recentToken}`, Origin: bindings.CLIENT_ORIGIN },
        }, bindings)
        assert.equal(response.status, testCase.status)
        assert.equal(response.headers.get('Access-Control-Allow-Origin'), bindings.CLIENT_ORIGIN)
        if (testCase.error) assert.deepEqual(await response.json(), { error: testCase.error })
      })
    }
    assert.deepEqual(accountDeleteRequests, Array(5).fill({ id: authUserId, authenticatedAt: issuedAt }))

    const deletedUserApp = createApp({ findOrCreateUser: async () => undefined })
    const reusedSession = await deletedUserApp.request('/users/me', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${recentToken}` },
    }, bindings)
    assert.equal(reusedSession.status, 401)
  })
})

test('every protected route requires verified identity', async () => {
  const app = createApp()
  const bindings = {
    CLIENT_ORIGIN: 'https://farmies.test',
    SUPABASE_JWKS_URL: 'https://jwks.internal/auth/v1/.well-known/jwks.json',
    SUPABASE_URL: 'https://example.supabase.co',
  }
  const routes = [
    ['PUT', '/users/me'],
    ['PATCH', '/users/me'],
    ['DELETE', '/users/me'],
    ['POST', '/parties'],
    ['GET', '/parties'],
    ['GET', '/parties/84'],
    ['GET', '/parties/current'],
    ['DELETE', '/parties/current'],
    ['GET', '/parties/current/scene'],
    ['POST', '/parties/current/invite'],
    ['DELETE', '/parties/current/invite'],
    ['DELETE', '/parties/current/membership'],
    ['GET', '/parties/current/transfer-candidates'],
    ['PATCH', '/parties/current/owner'],
    ['GET', `/invites/${'a'.repeat(43)}`],
    ['POST', '/memberships'],
    ['GET', '/parties/current/avatars/85'],
    ['PUT', '/parties/current/avatars/85'],
    ['DELETE', '/parties/current/avatars/85'],
  ]

  for (const [method, path] of routes) {
    const response = await app.request(path, { method }, bindings)
    assert.equal(response.status, 401, `${method} ${path}`)
  }
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

  await suite.test('hashes a received token identically', async () => {
    assert.equal(await hashInviteToken(first.token), first.hash)
  })
})
