import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import test from 'node:test'

import postgres from 'postgres'

import { findTransferCandidates, leaveParty, transferParty } from '../src/memberships.ts'

if (existsSync(new URL('../.env', import.meta.url))) process.loadEnvFile(new URL('../.env', import.meta.url))

const adminUrl = process.env.FARMIES_TEST_ADMIN_DATABASE_URL
const runtimeUrl = process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE
const authIds = [9201, 9202, 9203, 9204].map((id) =>
  `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`)

test('Party ownership transfer transaction', { skip: !adminUrl || !runtimeUrl }, async (suite) => {
  const admin = postgres(adminUrl, { max: 1 })
  const bindings = {
    HYPERDRIVE: { connectionString: runtimeUrl },
    AVATARS: { delete: async () => undefined },
  }
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
      const [party] = await sql`
        insert into farmies.parties (owner_user_id, display_name, species_id, environment_id)
        values (${users[0].id}, 'Transfer Party', ${catalog.species_id}, ${catalog.environment_id})
        returning id
      `
      const memberships = []
      for (const [index, user] of users.slice(0, 3).entries()) {
        const [membership] = await sql`
          insert into farmies.memberships (party_id, user_id, nickname)
          values (${party.id}, ${user.id}, ${`Member ${index + 1}`}) returning id
        `
        memberships.push(BigInt(membership.id))
      }
      const [otherParty] = await sql`
        insert into farmies.parties (owner_user_id, display_name, species_id, environment_id)
        values (${users[3].id}, 'Other Party', ${catalog.species_id}, ${catalog.environment_id})
        returning id
      `
      const [outsiderMembership] = await sql`
        insert into farmies.memberships (party_id, user_id, nickname)
        values (${otherParty.id}, ${users[3].id}, 'Outsider') returning id
      `
      return {
        memberships,
        outsiderMembership: BigInt(outsiderMembership.id),
        partyId: BigInt(party.id),
        users,
      }
    })

    await suite.test('only exposes active successors to the current owner', async () => {
      assert.deepEqual(await findTransferCandidates(bindings, authIds[0]), {
        status: 'found',
        members: [
          { membershipId: fixture.memberships[1], nickname: 'Member 2' },
          { membershipId: fixture.memberships[2], nickname: 'Member 3' },
        ],
      })
      assert.deepEqual(await findTransferCandidates(bindings, authIds[1]), { status: 'owner_required' })
      assert.deepEqual(
        await transferParty(bindings, authIds[0], fixture.outsiderMembership),
        { status: 'successor_not_available' },
      )
    })

    await suite.test('serializes concurrent transfers and lets the former owner leave', async () => {
      const results = await Promise.all([
        transferParty(bindings, authIds[0], fixture.memberships[1]),
        transferParty(bindings, authIds[0], fixture.memberships[2]),
      ])
      assert.deepEqual(results.map(({ status }) => status).sort(), ['owner_required', 'transferred'])

      const [party] = await admin`
        select owner_user_id from farmies.parties where id = ${fixture.partyId.toString()}
      `
      const successorIndex = fixture.users.findIndex(({ id }) => BigInt(id) === BigInt(party.owner_user_id))
      assert.ok([1, 2].includes(successorIndex))
      assert.deepEqual(await findTransferCandidates(bindings, authIds[successorIndex]), {
        status: 'found',
        members: [
          { membershipId: fixture.memberships[0], nickname: 'Member 1' },
          { membershipId: fixture.memberships[successorIndex === 1 ? 2 : 1], nickname: `Member ${successorIndex === 1 ? 3 : 2}` },
        ],
      })

      assert.deepEqual(await leaveParty(bindings, authIds[0]), { status: 'left' })
      const [{ active }] = await admin`
        select count(*) filter (where deleted_at is null)::integer as active
        from farmies.memberships where id = ${fixture.memberships[0].toString()}
      `
      assert.equal(active, 0)
    })
  } finally {
    await clean()
    await admin.end()
  }
})
