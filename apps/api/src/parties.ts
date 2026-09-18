import type { Hyperdrive } from '@cloudflare/workers-types'
import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import { openDatabase } from './db/index.ts'
import {
  environments,
  invites,
  memberships,
  parties,
  species,
  speciesEnvironments,
  users,
} from './db/schema.ts'
import { PARTY_LIMITS } from './party-limits.ts'

export type PartyMembership = {
  party: {
    id: bigint
    displayName: string
    species: string
    environment: string
    createdAt: Date
  }
  membership: {
    id: bigint
    nickname: string
    joinedAt: Date
  }
  isOwner: boolean
  inviteActive: boolean
}

export type PartySummary = {
  id: bigint
  displayName: string
  membershipId: bigint
  nickname: string
  role: 'owner' | 'member'
  occupancy: number
  species: string
  environment: string
  joinedAt: Date
}

type CreatePartyResult =
  | { status: 'created'; value: PartyMembership }
  | { status: 'membership_limit' | 'ownership_limit' | 'user_not_found' }

export const createParty = async (
  bindings: { HYPERDRIVE: Hyperdrive },
  authUserId: string,
  input: { displayName: string; nickname: string },
): Promise<CreatePartyResult> => {
  const { client, database } = openDatabase(bindings)

  try {
    return await database.transaction(async (transaction) => {
      const [user] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.authUserId, authUserId), isNull(users.deletedAt)))
        .limit(1)
      if (!user) return { status: 'user_not_found' }

      const [lockedUser] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, user.id), isNull(users.deletedAt)))
        .for('update')
      if (!lockedUser) return { status: 'user_not_found' }

      const [{ activeMemberships }] = await transaction
        .select({ activeMemberships: sql<number>`count(*)` })
        .from(memberships)
        .where(and(eq(memberships.userId, user.id), isNull(memberships.deletedAt)))
      if (Number(activeMemberships) >= PARTY_LIMITS.activeMembershipsPerUser) {
        return { status: 'membership_limit' }
      }

      const [{ ownedParties }] = await transaction
        .select({ ownedParties: sql<number>`count(*)` })
        .from(parties)
        .where(and(eq(parties.ownerUserId, user.id), isNull(parties.deletedAt)))
      if (Number(ownedParties) >= PARTY_LIMITS.ownedPartiesPerUser) return { status: 'ownership_limit' }

      const [catalog] = await transaction
        .select({
          speciesId: species.id,
          species: species.code,
          environmentId: environments.id,
          environment: environments.code,
        })
        .from(speciesEnvironments)
        .innerJoin(species, eq(speciesEnvironments.speciesId, species.id))
        .innerJoin(environments, eq(speciesEnvironments.environmentId, environments.id))
        .where(and(eq(species.code, 'COW'), eq(environments.code, 'PASTURE')))
        .limit(1)
      if (!catalog) throw new Error('Supported Party catalog is unavailable')

      await transaction.execute(sql`
        insert into ${parties} (owner_user_id, display_name, species_id, environment_id)
        values (${user.id}, ${input.displayName}, ${catalog.speciesId}, ${catalog.environmentId})
      `)
      const [party] = await transaction
        .select({ id: parties.id, displayName: parties.displayName, createdAt: parties.createdAt })
        .from(parties)
        .where(and(eq(parties.ownerUserId, user.id), isNull(parties.deletedAt)))
        .orderBy(desc(parties.id))
        .limit(1)
      if (!party) throw new Error('Party creation returned no row')

      await transaction.execute(sql`
        insert into ${memberships} (party_id, user_id, nickname)
        values (${party.id}, ${user.id}, ${input.nickname})
      `)
      const [membership] = await transaction
        .select({ id: memberships.id, nickname: memberships.nickname, joinedAt: memberships.joinedAt })
        .from(memberships)
        .where(and(
          eq(memberships.partyId, party.id),
          eq(memberships.userId, user.id),
          isNull(memberships.deletedAt),
        ))
        .limit(1)
      if (!membership) throw new Error('Membership creation returned no row')

      return {
        status: 'created',
        value: {
          party: { ...party, species: catalog.species, environment: catalog.environment },
          membership,
          isOwner: true,
          inviteActive: false,
        },
      }
    })
  } finally {
    await client.end()
  }
}

export const findCurrentParty = async (
  bindings: { HYPERDRIVE: Hyperdrive },
  authUserId: string,
): Promise<PartyMembership | undefined> => {
  const { client, database } = openDatabase(bindings)

  try {
    const [result] = await database
      .select({
        partyId: parties.id,
        ownerUserId: parties.ownerUserId,
        displayName: parties.displayName,
        species: species.code,
        environment: environments.code,
        partyCreatedAt: parties.createdAt,
        membershipId: memberships.id,
        userId: users.id,
        nickname: memberships.nickname,
        joinedAt: memberships.joinedAt,
        invitePartyId: invites.partyId,
      })
      .from(users)
      .innerJoin(memberships, and(eq(memberships.userId, users.id), isNull(memberships.deletedAt)))
      .innerJoin(parties, and(eq(parties.id, memberships.partyId), isNull(parties.deletedAt)))
      .innerJoin(species, eq(species.id, parties.speciesId))
      .innerJoin(environments, eq(environments.id, parties.environmentId))
      .leftJoin(invites, and(
        eq(invites.partyId, parties.id),
        isNull(invites.revokedAt),
        isNull(invites.deletedAt),
        gt(invites.expiresAt, sql`now()`),
      ))
      .where(and(eq(users.authUserId, authUserId), isNull(users.deletedAt)))
      .limit(1)

    if (!result) return undefined
    return {
      party: {
        id: result.partyId,
        displayName: result.displayName,
        species: result.species,
        environment: result.environment,
        createdAt: result.partyCreatedAt,
      },
      membership: {
        id: result.membershipId,
        nickname: result.nickname,
        joinedAt: result.joinedAt,
      },
      isOwner: result.ownerUserId === result.userId,
      inviteActive: result.invitePartyId !== null,
    }
  } finally {
    await client.end()
  }
}

export const findParties = async (
  bindings: { HYPERDRIVE: Hyperdrive },
  authUserId: string,
): Promise<PartySummary[]> => {
  const { client, database } = openDatabase(bindings)
  const roster = alias(memberships, 'roster')

  try {
    const results = await database
      .select({
        id: parties.id,
        displayName: parties.displayName,
        membershipId: memberships.id,
        nickname: memberships.nickname,
        isOwner: sql<boolean>`${parties.ownerUserId} = ${users.id}`,
        occupancy: sql<number>`count(${roster.id})::integer`,
        species: species.code,
        environment: environments.code,
        joinedAt: memberships.joinedAt,
      })
      .from(users)
      .innerJoin(memberships, and(eq(memberships.userId, users.id), isNull(memberships.deletedAt)))
      .innerJoin(parties, and(eq(parties.id, memberships.partyId), isNull(parties.deletedAt)))
      .innerJoin(species, eq(species.id, parties.speciesId))
      .innerJoin(environments, eq(environments.id, parties.environmentId))
      .innerJoin(roster, and(eq(roster.partyId, parties.id), isNull(roster.deletedAt)))
      .where(and(eq(users.authUserId, authUserId), isNull(users.deletedAt)))
      .groupBy(users.id, parties.id, parties.ownerUserId, memberships.id, species.code, environments.code)
      .orderBy(
        desc(sql`${parties.ownerUserId} = ${users.id}`),
        desc(memberships.joinedAt),
        asc(parties.id),
      )

    return results.map(({ isOwner, occupancy, ...result }) => ({
      ...result,
      role: isOwner ? 'owner' : 'member',
      occupancy: Number(occupancy),
    }))
  } finally {
    await client.end()
  }
}

export const findPartyById = async (
  bindings: { HYPERDRIVE: Hyperdrive },
  authUserId: string,
  partyId: bigint,
) => (await findParties(bindings, authUserId)).find((party) => party.id === partyId)
