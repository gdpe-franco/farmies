import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import test from 'node:test'

import postgres from 'postgres'

import { deleteAccount } from '../src/accounts.ts'
import { manageAvatar } from '../src/avatars.ts'
import { findScene } from '../src/scene.ts'
import { webp } from './fixtures/webp.mjs'

if (existsSync(new URL('../.env', import.meta.url))) process.loadEnvFile(new URL('../.env', import.meta.url))

const adminUrl = process.env.FARMIES_TEST_ADMIN_DATABASE_URL
const runtimeUrl = process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE
const authIds = [9501, 9502, 9503, 9504].map((id) =>
  `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`)
const inviteHash = '5'.repeat(64)

test('account deletion transaction and cleanup', { skip: !adminUrl || !runtimeUrl }, async (suite) => {
  const admin = postgres(adminUrl, { max: 1 })
  const objects = new Map()
  const authDeletes = []
  let failObjectDelete = false
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    authDeletes.push({ url: String(input), init })
    return new Response(null, { status: 204 })
  }
  const bindings = {
    HYPERDRIVE: { connectionString: runtimeUrl },
    AVATARS: {
      put: async (key, bytes) => { objects.set(key, bytes); return {} },
      get: async (key) => objects.has(key) ? { arrayBuffer: async () => objects.get(key) } : null,
      delete: async (key) => {
        if (failObjectDelete) throw new Error('R2 unavailable')
        objects.delete(key)
      },
    },
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
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
      const soleParty = await makeParty(0, 'Sole Party')
      const sharedParty = await makeParty(1, 'Shared Party')
      const [member] = await sql`
        insert into farmies.memberships (party_id, user_id, nickname)
        values (${sharedParty.partyId.toString()}, ${users[2].id}, 'Member') returning id
      `
      await sql`insert into farmies.invites (party_id, token_hash, expires_at)
        values (${soleParty.partyId.toString()}, ${inviteHash}, now() + interval '1 hour')`
      return { soleParty, sharedParty, memberId: BigInt(member.id), users }
    })
    await manageAvatar(bindings, authIds[0], {
      membershipId: fixture.soleParty.membershipId, action: 'save', bytes: webp(),
    })
    await manageAvatar(bindings, authIds[2], {
      membershipId: fixture.memberId, action: 'save', bytes: webp(),
    })
    const issuedAt = Math.floor(Date.now() / 1_000)

    await suite.test('requires recent authentication and ownership transfer before mutation', async () => {
      assert.deepEqual(await deleteAccount(bindings, authIds[3], issuedAt - 301), { status: 'recent_auth_required' })
      assert.deepEqual(await deleteAccount(bindings, authIds[1], issuedAt), { status: 'transfer_required' })
      const rows = await admin`select deleted_at from farmies.users where auth_user_id in (${authIds[1]}, ${authIds[3]})`
      assert.deepEqual(rows.map(({ deleted_at: deletedAt }) => deletedAt), [null, null])
    })

    await suite.test('atomically removes a regular member and retries external cleanup', async () => {
      failObjectDelete = true
      assert.deepEqual(await deleteAccount(bindings, authIds[2], issuedAt), { status: 'cleanup_pending' })
      assert.equal(await findScene(bindings, authIds[2]), undefined)
      const [row] = await admin`
        select u.deleted_at as user_deleted_at, m.deleted_at as membership_deleted_at,
          a.deleted_at as avatar_deleted_at, p.deleted_at as party_deleted_at
        from farmies.users u
        join farmies.memberships m on m.user_id = u.id
        join farmies.member_avatars a on a.membership_id = m.id
        join farmies.parties p on p.id = m.party_id
        where u.auth_user_id = ${authIds[2]}
      `
      assert.ok(row.user_deleted_at)
      assert.equal(row.membership_deleted_at.getTime(), row.user_deleted_at.getTime())
      assert.equal(row.avatar_deleted_at.getTime(), row.user_deleted_at.getTime())
      assert.equal(row.party_deleted_at, null)
      assert.equal(authDeletes.length, 0)

      failObjectDelete = false
      assert.deepEqual(await deleteAccount(bindings, authIds[2], issuedAt - 999), { status: 'deleted' })
      assert.equal(objects.has(`avatars/${fixture.memberId}/current.webp`), false)
      assert.equal(authDeletes.length, 1)
    })

    await suite.test('deletes a sole owner and Party with one timestamp', async () => {
      assert.deepEqual(await deleteAccount(bindings, authIds[0], issuedAt), { status: 'deleted' })
      const [row] = await admin`
        select u.deleted_at as user_deleted_at, p.deleted_at as party_deleted_at,
          m.deleted_at as membership_deleted_at, i.deleted_at as invite_deleted_at,
          a.deleted_at as avatar_deleted_at
        from farmies.users u
        join farmies.parties p on p.owner_user_id = u.id
        join farmies.memberships m on m.party_id = p.id and m.user_id = u.id
        join farmies.invites i on i.party_id = p.id
        join farmies.member_avatars a on a.membership_id = m.id
        where u.auth_user_id = ${authIds[0]}
      `
      for (const value of [row.party_deleted_at, row.membership_deleted_at, row.invite_deleted_at, row.avatar_deleted_at]) {
        assert.equal(value.getTime(), row.user_deleted_at.getTime())
      }
      assert.equal(await findScene(bindings, authIds[0]), undefined)
      assert.equal(authDeletes.length, 2)
      assert.match(authDeletes.at(-1).url, new RegExp(`/auth/v1/admin/users/${authIds[0]}$`))
      assert.equal(authDeletes.at(-1).init.headers.apikey, bindings.SUPABASE_SERVICE_ROLE_KEY)
    })
  } finally {
    globalThis.fetch = originalFetch
    await clean()
    await admin.end()
  }
})
