import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import test from 'node:test'
import postgres from 'postgres'
import { createTestHarness } from 'wrangler'

import { manageAvatar } from '../src/avatars.ts'
import { findScene } from '../src/scene.ts'
import { webp } from './fixtures/webp.mjs'

if (existsSync(new URL('../.env', import.meta.url))) process.loadEnvFile(new URL('../.env', import.meta.url))
const adminUrl = process.env.FARMIES_TEST_ADMIN_DATABASE_URL
const runtimeUrl = process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE
const authIds = [9001, 9002, 9003].map((id) => `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`)

test('private avatar persistence', { skip: !adminUrl || !runtimeUrl }, async (suite) => {
  const admin = postgres(adminUrl, { max: 1 })
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const publicKey = await crypto.subtle.exportKey('jwk', keys.publicKey)
  const jwks = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ keys: [{ ...publicKey, alg: 'ES256', kid: 'avatar-runtime' }] }))
  })
  await new Promise((resolve) => jwks.listen(0, '127.0.0.1', resolve))
  const harness = createTestHarness({ workers: [{
    configPath: new URL('../wrangler.jsonc', import.meta.url).pathname,
    secrets: {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_JWKS_URL: `http://127.0.0.1:${jwks.address().port}/jwks`,
    },
  }] })
  await harness.listen()
  const env = await harness.getWorker().getEnv()
  const objects = new Map()
  let failDelete = false
  let failPut = false
  const bindings = {
    HYPERDRIVE: { connectionString: runtimeUrl },
    AVATARS: {
      put: async (key, bytes) => {
        if (failPut) throw new Error('R2 unavailable')
        const object = await env.AVATARS.put(key, bytes, { httpMetadata: { contentType: 'image/webp' } })
        objects.set(key, bytes.slice(0)); return object
      },
      get: async (key) => env.AVATARS.get(key),
      delete: async (key) => {
        if (failDelete) throw new Error('R2 unavailable')
        await env.AVATARS.delete(key)
        objects.delete(key)
      },
    },
  }
  const clean = async () => admin.begin(async (sql) => {
    await sql`delete from farmies.member_avatars where membership_id in (
      select m.id from farmies.memberships m join farmies.users u on u.id = m.user_id where u.auth_user_id = any(${authIds}::uuid[])
    )`
    await sql`delete from farmies.memberships where user_id in (select id from farmies.users where auth_user_id = any(${authIds}::uuid[]))`
    await sql`delete from farmies.parties where owner_user_id in (select id from farmies.users where auth_user_id = any(${authIds}::uuid[]))`
    await sql`delete from farmies.users where auth_user_id = any(${authIds}::uuid[])`
    await sql`delete from auth.users where id = any(${authIds}::uuid[])`
  })
  await clean()
  try {
    const ids = await admin.begin(async (sql) => {
      await sql`insert into auth.users (id) select * from unnest(${authIds}::uuid[])`
      const users = await sql`insert into farmies.users (auth_user_id) select * from unnest(${authIds}::uuid[]) returning id, auth_user_id`
      users.sort((a, b) => a.auth_user_id.localeCompare(b.auth_user_id))
      const [catalog] = await sql`select species_id, environment_id from farmies.species_environments limit 1`
      const ids = []
      let sharedParty
      for (const [index, user] of users.entries()) {
        if (index !== 1) {
          const [party] = await sql`insert into farmies.parties (owner_user_id, display_name, species_id, environment_id)
            values (${user.id}, 'Avatar fixture', ${catalog.species_id}, ${catalog.environment_id}) returning id`
          sharedParty = party.id
        }
        const [member] = await sql`insert into farmies.memberships (party_id, user_id, nickname)
          values (${sharedParty}, ${user.id}, 'Friend') returning id`
        ids.push(BigInt(member.id))
      }
      return ids
    })
    const operation = (action, actor = 0, target = 0, bytes = webp()) => manageAvatar(bindings, authIds[actor], {
      action, membershipId: ids[target], bytes: action === 'save' ? bytes : undefined,
    })
    await suite.test('happy path', async () => {
      assert.deepEqual(await operation('save'), { status: 'saved', version: 1 })
      const scene = await findScene(bindings, authIds[1])
      assert.equal(scene.party.species, 'COW')
      assert.equal(scene.party.environment.definition.scene, 'PASTURE')
      assert.deepEqual(scene.members.map(member => member.membershipId), ids.slice(0, 2).map(String))
      assert.deepEqual(scene.members.map(member => member.avatarVersion), [1, null])
      assert.deepEqual((await findScene(bindings, authIds[2])).members.map(member => member.membershipId), [String(ids[2])])
      assert.equal(await findScene(bindings, '00000000-0000-4000-8000-000000009099'), undefined)
      assert.deepEqual((await operation('read', 1)).bytes, webp(), 'another current member may read')
      const replacements = await Promise.all([operation('save'), operation('save')])
      assert.deepEqual(replacements.map((value) => value.version).sort(), [2, 3])
      assert.equal(objects.size, 1, 'replacement never accumulates historical objects')
      assert.equal((await env.AVATARS.list()).objects.length, 1)
      const [row] = await admin`select * from farmies.member_avatars where membership_id = ${ids[0].toString()}`
      assert.equal(row.object_key, `avatars/${ids[0]}/current.webp`)
      assert.equal(row.byte_size, 32)
      assert.equal(row.width, 512)
      assert.equal(row.height, 512)
      assert.equal(row.media_type, 'image/webp')
      assert.equal(row.version, 3)
      assert.equal((await operation('delete')).status, 'deleted')
      assert.equal((await operation('delete')).status, 'deleted', 'deletion is idempotent')
      assert.equal(objects.size, 0)
      assert.equal((await operation('read')).status, 'not_found')
      assert.equal((await operation('save')).version, 4, 'upload reactivates the same row')
      const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
      const unsigned = `${encode({ alg: 'ES256', kid: 'avatar-runtime' })}.${encode({
        sub: authIds[0], role: 'authenticated', aud: 'authenticated',
        iss: 'https://example.supabase.co/auth/v1', exp: Math.floor(Date.now() / 1000) + 300,
      })}`
      const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, new TextEncoder().encode(unsigned))
      const headers = { Authorization: `Bearer ${unsigned}.${Buffer.from(signature).toString('base64url')}`, 'Content-Type': 'image/webp' }
      const url = `/parties/current/avatars/${ids[0]}`
      const saved = await harness.fetch(url, { method: 'PUT', headers, body: webp() })
      assert.equal(saved.status, 200, 'actual Worker request saves processed bytes')
      const image = await harness.fetch(url, { headers })
      assert.equal(image.status, 200)
      assert.deepEqual(await image.arrayBuffer(), webp())
      const roster = await harness.fetch('/parties/current/scene', { headers })
      assert.equal(roster.status, 200)
      assert.equal((await roster.json()).members.length, 2)
    })
    await suite.test('failure path', async () => {
      for (const row of [
        { action: 'read', actor: 2, target: 0, status: 'not_found' },
        { action: 'save', actor: 1, target: 0, status: 'forbidden' },
        { action: 'delete', actor: 1, target: 0, status: 'forbidden' },
        { action: 'read', actor: 0, target: 1, status: 'not_found' },
      ]) assert.equal((await operation(row.action, row.actor, row.target)).status, row.status)
      await assert.rejects(operation('save', 0, 0, new ArrayBuffer(0)), /Invalid processed avatar/)
      failPut = true
      await assert.rejects(operation('save'), /R2 unavailable/)
      failPut = false
      assert.equal((await operation('read')).status, 'read', 'failed upload preserves stored bytes')
      failDelete = true
      assert.equal((await operation('delete')).status, 'cleanup_pending')
      assert.equal(objects.size, 1)
      assert.equal((await operation('read', 1)).status, 'not_found', 'tombstone immediately denies Party access')
      failDelete = false
      assert.equal((await operation('delete')).status, 'deleted')
      assert.equal(objects.size, 0)
      await operation('save')
      await env.AVATARS.delete([...objects.keys()])
      objects.clear()
      assert.equal((await operation('read')).status, 'not_found', 'missing R2 object is an explicit empty state')
      await operation('save')
      for (const row of [
        { table: 'users', actor: 0 },
        { table: 'users', actor: 1 },
        { table: 'memberships', actor: 1 },
        { table: 'parties', actor: 0 },
      ]) {
        if (row.table === 'users') {
          await admin`update farmies.users set deleted_at = now() where auth_user_id = ${authIds[row.actor]}`
        } else if (row.table === 'memberships') {
          await admin`update farmies.memberships set deleted_at = now() where id = ${ids[row.actor].toString()}`
        } else {
          await admin`update farmies.parties set deleted_at = now() where id = (select party_id from farmies.memberships where id = ${ids[0].toString()})`
        }
        assert.equal((await operation('read', 1)).status, 'not_found', `inactive ${row.table} denies read`)
        const scene = await findScene(bindings, authIds[1])
        if (row.actor === 1 || row.table === 'parties') assert.equal(scene, undefined)
        else assert.deepEqual(scene.members.map(member => member.membershipId), [String(ids[1])])
        if (row.table === 'users') {
          await admin`update farmies.users set deleted_at = null where auth_user_id = ${authIds[row.actor]}`
        } else if (row.table === 'memberships') {
          await admin`update farmies.memberships set deleted_at = null where id = ${ids[row.actor].toString()}`
        } else {
          await admin`update farmies.parties set deleted_at = null where id = (select party_id from farmies.memberships where id = ${ids[0].toString()})`
        }
      }
      await admin`update farmies.memberships set deleted_at = now() where id = ${ids[0].toString()}`
      assert.equal((await operation('read', 1)).status, 'not_found')
      assert.equal((await operation('save')).status, 'not_found')
    })
  } finally {
    await clean()
    await admin.end()
    await harness.close()
    await new Promise((resolve) => jwks.close(resolve))
  }
})
