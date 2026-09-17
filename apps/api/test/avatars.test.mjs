import assert from 'node:assert/strict'
import test from 'node:test'

import { validateAvatar } from '../src/avatars.ts'
import { createApp } from '../src/index.ts'
import { webp } from './fixtures/webp.mjs'
import { environmentDefinitionSchema } from '../src/scene.ts'

test('processed avatar validation', async (suite) => {
  await suite.test('happy path', () => assert.equal(validateAvatar(webp()), true))
  await suite.test('failure path', () => {
    const cases = [
      { name: 'empty', bytes: new ArrayBuffer(0) },
      { name: 'too large', bytes: new ArrayBuffer(524_289) },
      { name: 'truncated', bytes: webp().slice(0, 25) },
      { name: 'invalid signature', offset: 0, value: 0 },
      { name: 'wrong dimensions', offset: 26, value: 1 },
      { name: 'non-keyframe', offset: 20, value: 1 },
      { name: 'unsupported metadata chunk', offset: 12, value: 69 },
      { name: 'malformed chunk length', offset: 16, value: 255 },
    ]
    for (const row of cases) {
      const bytes = row.bytes ?? webp()
      if (row.offset !== undefined) new Uint8Array(bytes)[row.offset] = row.value
      assert.equal(validateAvatar(bytes), false, row.name)
    }
  })
})

test('private avatar HTTP routes', async (suite) => {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => Response.json({ keys: [{ ...jwk, alg: 'ES256', kid: 'avatar-test' }] })
  suite.after(() => { globalThis.fetch = originalFetch })
  const authId = '00000000-0000-4000-8000-000000009001'
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const unsigned = `${encode({ alg: 'ES256', kid: 'avatar-test' })}.${encode({
    sub: authId, role: 'authenticated', aud: 'authenticated',
    iss: 'https://example.supabase.co/auth/v1', iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
  })}`
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, new TextEncoder().encode(unsigned))
  const authorization = `Bearer ${unsigned}.${Buffer.from(signature).toString('base64url')}`
  const bindings = { CLIENT_ORIGIN: 'https://farmies.test', SUPABASE_URL: 'https://example.supabase.co' }
  const calls = []
  let result = { status: 'saved', version: 1 }
  const app = createApp({ manageAvatar: async (_bindings, id, input) => {
    calls.push({ id, input })
    if (result instanceof Error) throw result
    return result
  } })
  await suite.test('scene happy path and unavailable membership failure path', async () => {
    let scene = { party: { id: '84', species: 'COW', environment: { code: 'PASTURE', definition: {
      version: 1, scene: 'PASTURE', zones: [], props: [], capabilities: [],
    } } }, members: [{ membershipId: '85', nickname: 'Fern', joinedAt: '2026-09-11T08:00:00.000Z', avatarVersion: null }] }
    const sceneApp = createApp({ findScene: async (_env, id) => { assert.equal(id, authId); return scene } })
    const get = (headers = { Authorization: authorization }) => sceneApp.request('/parties/current/scene', { headers }, bindings)
    const response = await get()
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
    assert.deepEqual(await response.json(), scene)
    assert.equal((await get({})).status, 401)
    scene = undefined
    assert.equal((await get()).status, 404)
    const failingApp = createApp({ findScene: async () => { throw new Error('Database unavailable') } })
    const failure = await failingApp.request('/parties/current/scene', { headers: { Authorization: authorization } }, bindings)
    assert.equal(failure.status, 500)
    assert.deepEqual(await failure.json(), { error: 'SCENE_LOAD_FAILED' })
    assert.equal(environmentDefinitionSchema.safeParse({ version: 2, scene: 'PASTURE', zones: [], props: [], capabilities: [] }).success, false)
  })
  const request = (method, id = '85', body, headers = {}) => app.request(`/parties/current/avatars/${id}`, {
    method, body, headers: { Authorization: authorization, 'Content-Type': 'image/webp', ...headers },
  }, bindings)

  await suite.test('happy path', async () => {
    const response = await request('PUT', '85', webp())
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { version: 1 })
    assert.equal(calls[0].id, authId)
    assert.equal(calls[0].input.membershipId, 85n)
    result = { status: 'read', bytes: webp() }
    const image = await request('GET')
    assert.equal(image.headers.get('Cache-Control'), 'private, no-store')
    assert.equal(image.headers.get('Content-Type'), 'image/webp')
    assert.equal(image.headers.get('X-Content-Type-Options'), 'nosniff')
    assert.deepEqual(await image.arrayBuffer(), webp())
    result = { status: 'deleted' }
    assert.equal((await request('DELETE')).status, 204)
    const preflight = await request('OPTIONS', '85', undefined, {
      Origin: bindings.CLIENT_ORIGIN, 'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'authorization,content-type',
    })
    assert.equal(preflight.status, 204)
    assert.match(preflight.headers.get('Access-Control-Allow-Methods'), /PUT/)
  })
  await suite.test('failure path', async () => {
    for (const row of [
      { method: 'GET', headers: { Authorization: '' }, status: 401 },
      { method: 'GET', id: '9223372036854775808', status: 400 },
      { method: 'GET', id: '0', status: 400 },
      { method: 'PUT', body: '{}', headers: { 'Content-Type': 'application/json' }, status: 415 },
      { method: 'PUT', body: new ArrayBuffer(524_289), status: 413 },
      { method: 'PUT', body: 'not-webp', status: 400 },
    ]) {
      const count = calls.length
      assert.equal((await request(row.method, row.id, row.body, row.headers)).status, row.status)
      assert.equal(calls.length, count, 'invalid requests never reach persistence')
    }
    for (const row of [
      { result: { status: 'not_found' }, status: 404 },
      { result: { status: 'forbidden' }, status: 403 },
      { result: { status: 'cleanup_pending' }, status: 503 },
      { result: new Error('private credentials must not leak'), status: 500 },
    ]) {
      result = row.result
      const response = await request('DELETE')
      assert.equal(response.status, row.status)
      assert.doesNotMatch(await response.text(), /private credentials/)
    }
  })
})
