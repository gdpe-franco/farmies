import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import test from 'node:test'

import postgres from 'postgres'

import { manageAvatar } from '../src/avatars.ts'
import { joinParty } from '../src/memberships.ts'
import { leaveParty } from '../src/memberships.ts'
import { findScene } from '../src/scene.ts'
import { webp } from './fixtures/webp.mjs'

if (existsSync(new URL('../.env', import.meta.url))) process.loadEnvFile(new URL('../.env', import.meta.url))

const adminUrl = process.env.FARMIES_TEST_ADMIN_DATABASE_URL
const runtimeUrl = process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE
const authIds = [9101, 9102, 9103, 9104].map((id) =>
  `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`)
const inviteHash = 'f'.repeat(64)

test('Party leaving transaction and cleanup', { skip: !adminUrl || !runtimeUrl }, async (suite) => {
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
    await sql`delete from farmies.invites where token_hash = ${inviteHash}`
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
      const [party] = await sql`
        insert into farmies.parties (owner_user_id, display_name, species_id, environment_id)
        values (${users[0].id}, 'Leaving Party', ${catalog.species_id}, ${catalog.environment_id})
        returning id
      `
      const memberships = []
      for (const user of users.slice(0, 3)) {
        const [membership] = await sql`
          insert into farmies.memberships (party_id, user_id, nickname)
          values (${party.id}, ${user.id}, 'Friend') returning id
        `
        memberships.push(BigInt(membership.id))
      }
      const [destination] = await sql`
        insert into farmies.parties (owner_user_id, display_name, species_id, environment_id)
        values (${users[3].id}, 'Next Party', ${catalog.species_id}, ${catalog.environment_id})
        returning id
      `
      await sql`insert into farmies.memberships (party_id, user_id, nickname)
        values (${destination.id}, ${users[3].id}, 'Next owner')`
      await sql`insert into farmies.invites (party_id, token_hash, expires_at)
        values (${destination.id}, ${inviteHash}, now() + interval '1 hour')`
      return { memberships }
    })

    for (const [index, membershipId] of fixture.memberships.slice(1).entries()) {
      assert.equal((await manageAvatar(bindings, authIds[index + 1], {
        membershipId, action: 'save', bytes: webp(),
      })).status, 'saved')
    }

    await suite.test('owner and cleanup failure paths', async () => {
      assert.deepEqual(await leaveParty(bindings, authIds[0]), { status: 'owner_required' })
      failDelete = true
      assert.deepEqual(await leaveParty(bindings, authIds[1]), { status: 'cleanup_pending' })
      assert.equal(await findScene(bindings, authIds[1]), undefined, 'access ends before object cleanup')
      assert.equal((await manageAvatar(bindings, authIds[0], {
        membershipId: fixture.memberships[1], action: 'read',
      })).status, 'not_found')
      const [rows] = await admin`
        select m.deleted_at as membership_deleted_at, a.deleted_at as avatar_deleted_at
        from farmies.memberships m join farmies.member_avatars a on a.membership_id = m.id
        where m.id = ${fixture.memberships[1].toString()}
      `
      assert.ok(rows.membership_deleted_at)
      assert.ok(rows.avatar_deleted_at)

      failDelete = false
      assert.deepEqual(await leaveParty(bindings, authIds[1]), { status: 'already_left' })
      assert.equal(objects.has(`avatars/${fixture.memberships[1]}/current.webp`), false)
      assert.equal((await joinParty(bindings, authIds[1], {
        inviteTokenHash: inviteHash, nickname: 'New friend',
      })).status, 'joined', 'a former member can join another Party')
    })

    await suite.test('concurrent retries deactivate one membership safely', async () => {
      const results = await Promise.all([
        leaveParty(bindings, authIds[2]),
        leaveParty(bindings, authIds[2]),
      ])
      assert.deepEqual(results.map(({ status }) => status).sort(), ['already_left', 'left'])
      const [{ active }] = await admin`
        select count(*) filter (where deleted_at is null)::integer as active
        from farmies.memberships where id = ${fixture.memberships[2].toString()}
      `
      assert.equal(active, 0)
      assert.equal(objects.has(`avatars/${fixture.memberships[2]}/current.webp`), false)
    })
  } finally {
    await clean()
    await admin.end()
  }
})
