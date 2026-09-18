import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import test from 'node:test'

import postgres from 'postgres'

import { createParty } from '../src/parties.ts'
import { deleteParty } from '../src/memberships.ts'

if (existsSync(new URL('../.env', import.meta.url))) process.loadEnvFile(new URL('../.env', import.meta.url))

const adminUrl = process.env.FARMIES_TEST_ADMIN_DATABASE_URL
const runtimeUrl = process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE
const authUserId = '00000000-0000-4000-8000-000000009250'

test('Party creation limits', { skip: !adminUrl || !runtimeUrl }, async () => {
  const admin = postgres(adminUrl, { max: 1 })
  const bindings = {
    HYPERDRIVE: { connectionString: runtimeUrl },
    AVATARS: { delete: async () => undefined },
  }
  const clean = async () => admin.begin(async (sql) => {
    await sql`delete from farmies.memberships where user_id in (
      select id from farmies.users where auth_user_id = ${authUserId}::uuid
    )`
    await sql`delete from farmies.parties where owner_user_id in (
      select id from farmies.users where auth_user_id = ${authUserId}::uuid
    )`
    await sql`delete from farmies.users where auth_user_id = ${authUserId}::uuid`
    await sql`delete from auth.users where id = ${authUserId}::uuid`
  })

  await clean()
  try {
    await admin`insert into auth.users (id) values (${authUserId}::uuid)`
    await admin`insert into farmies.users (auth_user_id) values (${authUserId}::uuid)`

    const results = await Promise.all(['A', 'B', 'C'].map((suffix) =>
      createParty(bindings, authUserId, {
        displayName: `Owned Party ${suffix}`,
        nickname: 'Owner',
      })))
    assert.deepEqual(results.map(({ status }) => status).sort(), [
      'created',
      'ownership_limit',
      'ownership_limit',
    ])

    const [counts] = await admin`
      select
        count(distinct parties.id) filter (where parties.deleted_at is null)::integer as parties,
        count(distinct memberships.id) filter (where memberships.deleted_at is null)::integer as memberships
      from farmies.users
      left join farmies.parties on parties.owner_user_id = users.id
      left join farmies.memberships on memberships.user_id = users.id
      where users.auth_user_id = ${authUserId}::uuid
    `
    assert.deepEqual({ parties: counts.parties, memberships: counts.memberships }, {
      parties: 1,
      memberships: 1,
    })

    assert.deepEqual(await deleteParty(bindings, authUserId), { status: 'deleted' })
    assert.equal((await createParty(bindings, authUserId, {
      displayName: 'Owned Party D',
      nickname: 'Owner',
    })).status, 'created')
  } finally {
    await clean()
    await admin.end()
  }
})
