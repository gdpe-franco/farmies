import assert from 'node:assert/strict'
import test from 'node:test'

import { deleteAvatar, loadAvatar, saveAvatar } from '../src/avatar-api.ts'

test('avatar API', async (suite) => {
  await suite.test('happy path', async () => {
    const bytes = new Blob(['processed'], { type: 'image/webp' })
    let response = new Response(bytes)
    const calls = []
    const request = async (path, init) => { calls.push({ path, init }); return response }
    assert.equal((await loadAvatar(request, '85')).type, 'image/webp')
    response = Response.json({ version: 2 })
    assert.equal(await saveAvatar(request, '85', bytes), 2)
    assert.equal(calls[1].init.body, bytes)
    assert.equal(calls[1].init.headers['Content-Type'], 'image/webp')
    assert.equal(calls[1].path, '/parties/current/avatars/85')
    response = new Response(null, { status: 204 })
    await deleteAvatar(request, '85')
    assert.equal(calls[2].init.method, 'DELETE')
    response = new Response(null, { status: 404 })
    assert.equal(await loadAvatar(request, '85'), null)
  })
  await suite.test('failure path', async () => {
    for (const row of [
      { operation: loadAvatar, response: new Response(null, { status: 403 }) },
      { operation: loadAvatar, response: new Response('not an image') },
      { operation: saveAvatar, response: new Response(null, { status: 500 }) },
      { operation: saveAvatar, response: Response.json({ version: 0 }) },
      { operation: deleteAvatar, response: new Response(null, { status: 503 }), error: /AVATAR_DELETE_RETRY/ },
      { operation: deleteAvatar, response: new Response(null, { status: 500 }) },
    ]) {
      await assert.rejects(row.operation(async () => row.response, '85', new Blob()), row.error)
    }
  })
})
