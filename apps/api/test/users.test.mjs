import assert from 'node:assert/strict'
import test from 'node:test'

import { createApp } from '../src/index.ts'

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

test('PUT /users/me', async (suite) => {
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
  const app = createApp(async (_bindings, id) => {
    requestedIds.push(id)
    return {
      id: 42n,
      preferredLocale: 'en',
      createdAt: new Date('2026-09-10T12:00:00.000Z'),
      updatedAt: new Date('2026-09-10T12:30:00.000Z'),
    }
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
  ]

  await suite.test('happy path', async (happyPath) => {
    for (const testCase of happyCases) {
      await happyPath.test(testCase.name, async () => {
        const response = await app.request(
          '/users/me',
          {
            method: 'PUT',
            headers: { Authorization: testCase.authorization, Origin: bindings.CLIENT_ORIGIN },
          },
          bindings,
        )

        assert.equal(response.status, testCase.status)
        assert.equal(response.headers.get('Access-Control-Allow-Origin'), bindings.CLIENT_ORIGIN)
        assert.deepEqual(await response.json(), testCase.body)
        assert.equal(jwksRequests[0], bindings.SUPABASE_JWKS_URL)
        assert.deepEqual(requestedIds, [authUserId])
      })
    }
  })

  const failureCases = [
    { name: 'rejects missing authorization', authorization: undefined },
    { name: 'rejects malformed authorization', authorization: 'not-a-bearer-token' },
    {
      name: 'rejects the wrong issuer',
      authorization: `Bearer ${await createToken(keys.privateKey, { iss: 'https://attacker.invalid/auth/v1' })}`,
    },
    { name: 'rejects the wrong audience', authorization: `Bearer ${await createToken(keys.privateKey, { aud: 'anon' })}` },
    { name: 'rejects an expired token', authorization: `Bearer ${await createToken(keys.privateKey, { exp: 1 })}` },
    { name: 'rejects a missing expiry', authorization: `Bearer ${await createToken(keys.privateKey, { exp: undefined })}` },
    { name: 'rejects the wrong role', authorization: `Bearer ${await createToken(keys.privateKey, { role: 'anon' })}` },
    { name: 'rejects an invalid subject', authorization: `Bearer ${await createToken(keys.privateKey, { sub: 'not-a-uuid' })}` },
    { name: 'rejects an invalid signature', authorization: `Bearer ${tamperedToken}` },
  ]

  await suite.test('failure path', async (failurePath) => {
    for (const testCase of failureCases) {
      await failurePath.test(testCase.name, async () => {
        const headers = testCase.authorization ? { Authorization: testCase.authorization } : undefined
        const response = await app.request('/users/me', { method: 'PUT', headers }, bindings)

        assert.equal(response.status, 401)
        assert.deepEqual(requestedIds, [authUserId])
      })
    }
  })
})
