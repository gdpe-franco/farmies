import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import test from 'node:test'

import postgres from 'postgres'

import { joinParty } from '../src/index.ts'
import { leaveParty } from '../src/memberships.ts'

if (existsSync(new URL('../.env', import.meta.url))) process.loadEnvFile(new URL('../.env', import.meta.url))

const adminUrl = process.env.FARMIES_TEST_ADMIN_DATABASE_URL
const runtimeUrl = process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE
const authIds = Array.from(
  { length: 14 },
  (_, index) => `00000000-0000-4000-8000-${String(1000 + index).padStart(12, '0')}`,
)
const hashes = ['a', 'b', 'c', 'd', 'e', 'f', '0'].map((value) => value.repeat(64))

test('Party joining transaction', { skip: !adminUrl || !runtimeUrl }, async (suite) => {
  const admin = postgres(adminUrl, { max: 1 })
  const bindings = { HYPERDRIVE: { connectionString: runtimeUrl } }

  const clean = async () => admin.begin(async (sql) => {
    await sql`delete from farmies.invites where token_hash = any(${hashes}::varchar[])`
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
      const [{ species_id: speciesId, environment_id: environmentId }] = await sql`
        select species_id, environment_id from farmies.species_environments limit 1
      `
      const parties = []
      const owners = [users[0], users[11], users[12], users[11], users[12], users[11], users[12]]
      for (const [index, owner] of owners.entries()) {
        const [party] = await sql`
          insert into farmies.parties (owner_user_id, display_name, species_id, environment_id)
          values (${owner.id}, ${`Transactional Party ${index + 1}`}, ${speciesId}, ${environmentId})
          returning id
        `
        await sql`
          insert into farmies.memberships (party_id, user_id, nickname)
          values (${party.id}, ${owner.id}, ${`Owner ${index + 1}`})
        `
        await sql`
          insert into farmies.invites (party_id, token_hash, expires_at)
          values (${party.id}, ${hashes[index]}, now() + interval '1 hour')
        `
        parties.push(party.id)
      }
      return { parties, users }
    })

    await suite.test('happy path', async () => {
      const capacityResults = await Promise.all(authIds.slice(1, 11).map((authUserId, index) =>
        joinParty(bindings, authUserId, { inviteTokenHash: hashes[0], nickname: `Friend ${index + 1}` })))
      assert.equal(capacityResults.filter(({ status }) => status === 'joined').length, 9)
      assert.equal(capacityResults.filter(({ status }) => status === 'invite_not_available').length, 1)
      const [{ count: memberCount }] = await admin`
        select count(*)::integer from farmies.memberships
        where party_id = ${fixture.parties[0]} and deleted_at is null
      `
      assert.equal(memberCount, 10)

      const joinedUser = fixture.users.find(({ auth_user_id: id }) => id === authIds[1])
      const [existing] = await admin`
        select id from farmies.memberships where user_id = ${joinedUser.id} and deleted_at is null
      `
      const retry = await joinParty(bindings, authIds[1], {
        inviteTokenHash: hashes[0],
        nickname: 'Ignored retry nickname',
      })
      assert.equal(retry.status, 'already_joined')
      assert.equal(retry.value.membership.id, BigInt(existing.id))

      const raceResults = await Promise.all([
        joinParty(bindings, authIds[13], { inviteTokenHash: hashes[1], nickname: 'Racer' }),
        joinParty(bindings, authIds[13], { inviteTokenHash: hashes[2], nickname: 'Racer' }),
      ])
      assert.deepEqual(raceResults.map(({ status }) => status).sort(), ['joined', 'joined'])
      const [{ count: racerCount }] = await admin`
        select count(*)::integer from farmies.memberships
        where user_id = ${fixture.users[13].id} and deleted_at is null
      `
      assert.equal(racerCount, 2)

      for (const hash of hashes.slice(1, 2)) {
        assert.equal((await joinParty(bindings, authIds[1], {
          inviteTokenHash: hash,
          nickname: 'Multi Party Friend',
        })).status, 'joined')
      }
      const limitRace = await Promise.all([
        joinParty(bindings, authIds[1], { inviteTokenHash: hashes[2], nickname: 'Boundary A' }),
        joinParty(bindings, authIds[1], { inviteTokenHash: hashes[3], nickname: 'Boundary B' }),
      ])
      assert.deepEqual(limitRace.map(({ status }) => status).sort(), ['joined', 'membership_limit'])
      const [{ count: limitedCount }] = await admin`
        select count(*)::integer from farmies.memberships
        where user_id = ${fixture.users[1].id} and deleted_at is null
      `
      assert.equal(limitedCount, 3)

      assert.deepEqual(await leaveParty({ ...bindings, AVATARS: { delete: async () => undefined } }, authIds[1]), {
        status: 'left',
      })
      assert.equal((await joinParty(bindings, authIds[1], {
        inviteTokenHash: hashes[4],
        nickname: 'Freed Slot',
      })).status, 'joined')
    })

    await suite.test('failure path', async () => {
      const cases = [
        { name: 'hides an unknown invite', authUserId: authIds[10], hash: '9'.repeat(64), status: 'invite_not_available' },
      ]
      for (const testCase of cases) {
        const result = await joinParty(bindings, testCase.authUserId, {
          inviteTokenHash: testCase.hash,
          nickname: 'Friend',
        })
        assert.equal(result.status, testCase.status, testCase.name)
      }
    })
  } finally {
    await clean()
    await admin.end()
  }
})
