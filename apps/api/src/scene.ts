import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { openDatabase } from './db/index.ts'
import { PARTY_LIMITS } from './party-limits.ts'

export const environmentDefinitionSchema = z.object({
  version: z.literal(1), scene: z.literal('PASTURE'),
  zones: z.array(z.never()), props: z.array(z.never()), capabilities: z.array(z.never()),
}).strict()

export type SceneData = {
  party: { id: string; species: string; environment: { code: string; definition: unknown } }
  members: { membershipId: string; nickname: string; joinedAt: string; avatarVersion: number | null }[]
}

export const findScene = async (bindings: Parameters<typeof openDatabase>[0], authUserId: string): Promise<SceneData | undefined> => {
  const { client, database } = openDatabase(bindings)
  try {
    // A single statement gives authorization and roster the same database snapshot.
    const rows = await database.execute(sql`
      select p.id::text as party_id, s.code as species, e.code as environment, e.definition,
        m.id::text as membership_id, m.nickname, m.joined_at, a.version as avatar_version
      from farmies.users requester
      join farmies.memberships own on own.user_id = requester.id and own.deleted_at is null
      join farmies.parties p on p.id = own.party_id and p.deleted_at is null
      join farmies.species s on s.id = p.species_id
      join farmies.environments e on e.id = p.environment_id
      join farmies.memberships m on m.party_id = p.id and m.deleted_at is null
      join farmies.users member on member.id = m.user_id and member.deleted_at is null
      left join farmies.member_avatars a on a.membership_id = m.id and a.deleted_at is null
      where requester.auth_user_id = ${authUserId} and requester.deleted_at is null
      order by m.joined_at, m.id
      limit ${PARTY_LIMITS.activeMembersPerParty}
    `)
    if (!rows.length) return undefined
    const first = rows[0]!
    return {
      party: { id: String(first.party_id), species: String(first.species), environment: {
        code: String(first.environment), definition: environmentDefinitionSchema.parse(first.definition),
      } },
      members: rows.map(row => ({ membershipId: String(row.membership_id), nickname: String(row.nickname),
        joinedAt: new Date(row.joined_at as string).toISOString(),
        avatarVersion: row.avatar_version === null ? null : Number(row.avatar_version),
      })),
    }
  } finally { await client.end() }
}
