import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import test from 'node:test'

import postgres from 'postgres'

import { manageAvatar } from '../src/avatars.ts'
import { deleteParty } from '../src/memberships.ts'
import { findScene } from '../src/scene.ts'
import { webp } from './fixtures/webp.mjs'

if (existsSync(new URL('../.env', import.meta.url))) process.loadEnvFile(new URL('../.env', import.meta.url))

const adminUrl = process.env.FARMIES_TEST_ADMIN_DATABASE_URL
const runtimeUrl = process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE
const authIds = [9301, 9302, 9303, 9304].map((id) =>
  `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`)
const inviteHashes = ['1'.repeat(64), '2'.repeat(64)]

test('sole-member Party deletion transaction and cleanup', { skip: !adminUrl || !runtimeUrl }, async (suite) => {
  const admin = postgres(adminUrl, { max: 1 })
  const objects = new Map()
  let failDelete = false
  const bindings = {
    HYPERDRIVE: { connectionString: runtimeUrl },
    AVATARS: {
      put: async (key, bytes) => { objects.set(key, bytes); return {} },
      get: async (key) => objects.has(key) ? { arrayBuffer: async () => objects.get(key) } : null,
      delete: async (key) => {
        if (failDelete) throw new Error('R2 unavailable')
        objects.delete(key)
      },
    },
  }
  const clean = async () => admin.begin(async (sql) => {
    await sql`delete from farmies.invites where token_hash = any(${inviteHashes}::varchar[])`
    await sql`delete from farmies.member_avatars where membership_id in (
      select m.id from farmies.memberships m join farmies.users u on u.id = m.user_id
      where u.auth_user_id = any(${authIds}::uuid[])
    )`
    await sql`delete from farmies.memberships where user_id in (
      select id from farmies.users where auth_user_id = any(${authIds}::uuid[])
    )`
    await sql`delete from farmies.parties where owner_user_id in (
      select id from farmies.users where auth_user_id = any(${authIds}::uuid[])
    )`
    await sql`delete from farmies.users where auth_user_id = any(${authIds}::uuid[])`
    await sql`delete from auth.users where id = any(${authIds}::uuid[])`
  })

  await clean()
  try {
    const fixture = await admin.begin(async (sql) => {
      await sql`insert into auth.users (id) select * from unnest(${authIds}::uuid[])`
      const users = await sql`
        insert into farmies.users (auth_user_id)
        select * from unnest(${authIds}::uuid[])
        returning id, auth_user_id
      `
      users.sort((left, right) => left.auth_user_id.localeCompare(right.auth_user_id))
      const [catalog] = await sql`select species_id, environment_id from farmies.species_environments limit 1`
      const makeParty = async (ownerIndex, name) => {
        const [party] = await sql`
          insert into farmies.parties (owner_user_id, display_name, species_id, environment_id)
          values (${users[ownerIndex].id}, ${name}, ${catalog.species_id}, ${catalog.environment_id})
          returning id
        `
        const [membership] = await sql`
          insert into farmies.memberships (party_id, user_id, nickname)
          values (${party.id}, ${users[ownerIndex].id}, ${name}) returning id
        `
        return { partyId: BigInt(party.id), membershipId: BigInt(membership.id) }
      }
      const cleanupParty = await makeParty(0, 'Cleanup Party')
      const sharedParty = await makeParty(1, 'Shared Party')
      await sql`insert into farmies.memberships (party_id, user_id, nickname)
        values (${sharedParty.partyId.toString()}, ${users[2].id}, 'Member')`
      const concurrentParty = await makeParty(3, 'Concurrent Party')
      await sql`insert into farmies.invites (party_id, token_hash, expires_at)
        values (${cleanupParty.partyId.toString()}, ${inviteHashes[0]}, now() + interval '1 hour')`
      await sql`insert into farmies.invites (party_id, token_hash, expires_at)
        values (${concurrentParty.partyId.toString()}, ${inviteHashes[1]}, now() + interval '1 hour')`
      return { cleanupParty, concurrentParty }
    })

    assert.equal((await manageAvatar(bindings, authIds[0], {
      membershipId: fixture.cleanupParty.membershipId, action: 'save', bytes: webp(),
    })).status, 'saved')

    await suite.test('atomically denies access and retries object cleanup', async () => {
      failDelete = true
      assert.deepEqual(await deleteParty(bindings, authIds[0]), { status: 'cleanup_pending' })
      assert.equal(await findScene(bindings, authIds[0]), undefined)
      const [rows] = await admin`
        select p.deleted_at as party_deleted_at, m.deleted_at as membership_deleted_at,
          i.deleted_at as invite_deleted_at, a.deleted_at as avatar_deleted_at
        from farmies.parties p
        join farmies.memberships m on m.party_id = p.id
        join farmies.invites i on i.party_id = p.id
        join farmies.member_avatars a on a.membership_id = m.id
        where p.id = ${fixture.cleanupParty.partyId.toString()}
      `
      assert.ok(rows.party_deleted_at)
      assert.equal(rows.membership_deleted_at.getTime(), rows.party_deleted_at.getTime())
      assert.equal(rows.invite_deleted_at.getTime(), rows.party_deleted_at.getTime())
      assert.equal(rows.avatar_deleted_at.getTime(), rows.party_deleted_at.getTime())

      failDelete = false
      assert.deepEqual(await deleteParty(bindings, authIds[0]), { status: 'already_deleted' })
      assert.equal(objects.has(`avatars/${fixture.cleanupParty.membershipId}/current.webp`), false)
    })

    await suite.test('requires sole ownership and serializes retries', async () => {
      assert.deepEqual(await deleteParty(bindings, authIds[1]), { status: 'transfer_required' })
      assert.deepEqual(await deleteParty(bindings, authIds[2]), { status: 'owner_required' })
      const results = await Promise.all([
        deleteParty(bindings, authIds[3]),
        deleteParty(bindings, authIds[3]),
      ])
      assert.deepEqual(results.map(({ status }) => status).sort(), ['already_deleted', 'deleted'])
      assert.equal(await findScene(bindings, authIds[3]), undefined)
    })
  } finally {
    await clean()
    await admin.end()
  }
})
