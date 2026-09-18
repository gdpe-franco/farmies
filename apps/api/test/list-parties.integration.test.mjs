import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import test from 'node:test'

import postgres from 'postgres'

import { findParties, findPartyById } from '../src/parties.ts'

if (existsSync(new URL('../.env', import.meta.url))) process.loadEnvFile(new URL('../.env', import.meta.url))

const adminUrl = process.env.FARMIES_TEST_ADMIN_DATABASE_URL
const runtimeUrl = process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE
const authIds = [9261, 9262, 9263, 9264].map((id) =>
  `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`)

test('authorized Party reads', { skip: !adminUrl || !runtimeUrl }, async (suite) => {
  const admin = postgres(adminUrl, { max: 1 })
  const bindings = { HYPERDRIVE: { connectionString: runtimeUrl } }
  const clean = async () => admin.begin(async (sql) => {
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
      const parties = []
      for (const [index, owner] of users.entries()) {
        const [party] = await sql`
          insert into farmies.parties (owner_user_id, display_name, species_id, environment_id)
          values (${owner.id}, ${`Read Party ${index + 1}`}, ${catalog.species_id}, ${catalog.environment_id})
          returning id
        `
        await sql`
          insert into farmies.memberships (party_id, user_id, nickname)
          values (${party.id}, ${owner.id}, ${`Owner ${index + 1}`})
        `
        parties.push(BigInt(party.id))
      }

      const memberships = []
      for (const [partyIndex, joinedAt] of [[1, '2026-09-15T08:00:00Z'], [2, '2026-09-16T08:00:00Z']]) {
        const [membership] = await sql`
          insert into farmies.memberships (party_id, user_id, nickname, joined_at)
          values (${parties[partyIndex].toString()}, ${users[0].id}, 'Fern', ${joinedAt})
          returning id
        `
        memberships.push(BigInt(membership.id))
      }
      await sql`
        insert into farmies.memberships (party_id, user_id, nickname, deleted_at)
        values (${parties[3].toString()}, ${users[0].id}, 'Former member', now())
      `
      const [ownedMembership] = await sql`
        update farmies.memberships set joined_at = '2026-09-14T08:00:00Z'
        where party_id = ${parties[0].toString()} and user_id = ${users[0].id}
        returning id
      `

      return { memberships, ownedMembership: BigInt(ownedMembership.id), parties }
    })

    await suite.test('returns only active memberships in stable order', async () => {
      const results = await findParties(bindings, authIds[0])
      assert.deepEqual(results.map(({ id }) => id), [
        fixture.parties[0],
        fixture.parties[2],
        fixture.parties[1],
      ])
      assert.deepEqual(results.map(({ role }) => role), ['owner', 'member', 'member'])
      assert.deepEqual(results.map(({ occupancy }) => occupancy), [1, 2, 2])
      assert.deepEqual(results.map(({ membershipId }) => membershipId), [
        fixture.ownedMembership,
        fixture.memberships[1],
        fixture.memberships[0],
      ])
      assert.ok(results.every(({ species, environment }) => species === 'COW' && environment === 'PASTURE'))
    })

    await suite.test('does not disclose inactive or cross-Party resources', async () => {
      assert.equal((await findPartyById(bindings, authIds[0], fixture.parties[1]))?.nickname, 'Fern')
      assert.equal(await findPartyById(bindings, authIds[0], fixture.parties[3]), undefined)
      assert.equal(await findPartyById(bindings, authIds[0], 9_223_372_036_854_775_807n), undefined)
    })
  } finally {
    await clean()
    await admin.end()
  }
})
