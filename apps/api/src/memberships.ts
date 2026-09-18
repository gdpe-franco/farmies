import { and, asc, desc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import type { Hyperdrive, R2Bucket } from '@cloudflare/workers-types'
import { alias } from 'drizzle-orm/pg-core'

import { openDatabase } from './db/index.ts'
import { invites, memberAvatars, memberships, parties, users } from './db/schema.ts'
import { PARTY_LIMITS } from './party-limits.ts'

type LeavePartyResult = { status: 'left' | 'already_left' | 'owner_required' | 'cleanup_pending' }
export type LeaveParty = (
  bindings: { HYPERDRIVE: Hyperdrive; AVATARS: R2Bucket },
  authUserId: string,
) => Promise<LeavePartyResult>

type TransferCandidate = { membershipId: bigint; nickname: string }
type TransferCandidatesResult =
  | { status: 'found'; members: TransferCandidate[] }
  | { status: 'owner_required' }
type TransferPartyResult = {
  status: 'transferred' | 'owner_required' | 'successor_not_available' | 'successor_ownership_limit'
}
export type FindTransferCandidates = (
  bindings: { HYPERDRIVE: Hyperdrive },
  authUserId: string,
) => Promise<TransferCandidatesResult>
export type TransferParty = (
  bindings: { HYPERDRIVE: Hyperdrive },
  authUserId: string,
  successorMembershipId: bigint,
) => Promise<TransferPartyResult>

type DeletePartyResult = {
  status: 'deleted' | 'already_deleted' | 'owner_required' | 'transfer_required' | 'cleanup_pending'
}
export type DeleteParty = (
  bindings: { HYPERDRIVE: Hyperdrive; AVATARS: R2Bucket },
  authUserId: string,
) => Promise<DeletePartyResult>

export const findTransferCandidates: FindTransferCandidates = async (bindings, authUserId) => {
  const { client, database } = openDatabase(bindings)
  const successor = alias(memberships, 'successor')
  const successorUser = alias(users, 'successor_user')
  try {
    const rows = await database
      .select({ membershipId: successor.id, nickname: successor.nickname })
      .from(parties)
      .innerJoin(users, and(
        eq(users.id, parties.ownerUserId),
        eq(users.authUserId, authUserId),
        isNull(users.deletedAt),
      ))
      .innerJoin(successor, and(
        eq(successor.partyId, parties.id),
        ne(successor.userId, parties.ownerUserId),
        isNull(successor.deletedAt),
      ))
      .innerJoin(successorUser, and(eq(successorUser.id, successor.userId), isNull(successorUser.deletedAt)))
      .where(isNull(parties.deletedAt))
      .orderBy(asc(successor.joinedAt), asc(successor.id))

    if (!rows.length) {
      const [owner] = await database.select({ id: parties.id }).from(parties)
        .innerJoin(users, and(
          eq(users.id, parties.ownerUserId),
          eq(users.authUserId, authUserId),
          isNull(users.deletedAt),
        ))
        .where(isNull(parties.deletedAt))
        .limit(1)
      if (!owner) return { status: 'owner_required' }
    }
    return { status: 'found', members: rows }
  } finally {
    await client.end()
  }
}

export const transferParty: TransferParty = async (bindings, authUserId, successorMembershipId) => {
  const { client, database } = openDatabase(bindings)
  try {
    return await database.transaction(async (transaction): Promise<TransferPartyResult> => {
      const [candidate] = await transaction
        .select({ partyId: memberships.partyId, userId: users.id })
        .from(users)
        .innerJoin(memberships, and(eq(memberships.userId, users.id), isNull(memberships.deletedAt)))
        .innerJoin(parties, and(eq(parties.id, memberships.partyId), isNull(parties.deletedAt)))
        .where(and(eq(users.authUserId, authUserId), isNull(users.deletedAt)))
        .limit(1)
      if (!candidate) return { status: 'owner_required' }

      await transaction.execute(sql`
        select id from ${parties}
        where id = ${candidate.partyId} and deleted_at is null
        for update
      `)
      const [owner] = await transaction
        .select({ userId: users.id })
        .from(users)
        .innerJoin(memberships, and(eq(memberships.userId, users.id), isNull(memberships.deletedAt)))
        .innerJoin(parties, and(
          eq(parties.id, memberships.partyId),
          eq(parties.ownerUserId, users.id),
          isNull(parties.deletedAt),
        ))
        .where(and(
          eq(users.authUserId, authUserId),
          eq(parties.id, candidate.partyId),
          isNull(users.deletedAt),
        ))
        .limit(1)
      if (!owner) return { status: 'owner_required' }

      const [successor] = await transaction
        .select({ userId: memberships.userId })
        .from(memberships)
        .innerJoin(users, and(eq(users.id, memberships.userId), isNull(users.deletedAt)))
        .where(and(
          eq(memberships.id, successorMembershipId),
          eq(memberships.partyId, candidate.partyId),
          ne(memberships.userId, owner.userId),
          isNull(memberships.deletedAt),
        ))
        .limit(1)
      if (!successor) return { status: 'successor_not_available' }

      const [lockedSuccessor] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, successor.userId), isNull(users.deletedAt)))
        .for('update')
      if (!lockedSuccessor) return { status: 'successor_not_available' }
      const [{ ownedParties }] = await transaction
        .select({ ownedParties: sql<number>`count(*)` })
        .from(parties)
        .where(and(eq(parties.ownerUserId, successor.userId), isNull(parties.deletedAt)))
      if (Number(ownedParties) >= PARTY_LIMITS.ownedPartiesPerUser) {
        return { status: 'successor_ownership_limit' }
      }

      await transaction.update(parties)
        .set({ ownerUserId: successor.userId, updatedAt: sql`clock_timestamp()` })
        .where(and(eq(parties.id, candidate.partyId), isNull(parties.deletedAt)))
      return { status: 'transferred' }
    })
  } finally {
    await client.end()
  }
}

export const deleteParty: DeleteParty = async (bindings, authUserId) => {
  const { client, database } = openDatabase(bindings)
  try {
    const result = await database.transaction(async (transaction) => {
      const [user] = await transaction.select({ id: users.id }).from(users)
        .where(and(eq(users.authUserId, authUserId), isNull(users.deletedAt)))
        .limit(1)
      if (!user) return { status: 'already_deleted' as const }

      const [candidate] = await transaction
        .select({ partyId: memberships.partyId })
        .from(memberships)
        .innerJoin(parties, and(eq(parties.id, memberships.partyId), isNull(parties.deletedAt)))
        .where(and(eq(memberships.userId, user.id), isNull(memberships.deletedAt)))
        .limit(1)

      if (candidate) {
        await transaction.execute(sql`
          select id from ${parties}
          where id = ${candidate.partyId} and deleted_at is null
          for update
        `)
        const [active] = await transaction
          .select({ membershipId: memberships.id, ownerUserId: parties.ownerUserId })
          .from(memberships)
          .innerJoin(parties, and(eq(parties.id, memberships.partyId), isNull(parties.deletedAt)))
          .where(and(
            eq(memberships.partyId, candidate.partyId),
            eq(memberships.userId, user.id),
            isNull(memberships.deletedAt),
          ))
          .limit(1)
        if (active) {
          if (active.ownerUserId !== user.id) return { status: 'owner_required' as const }
          const activeMembers = await transaction.select({ id: memberships.id }).from(memberships)
            .where(and(eq(memberships.partyId, candidate.partyId), isNull(memberships.deletedAt)))
          if (activeMembers.length !== 1) return { status: 'transfer_required' as const }

          const [avatar] = await transaction.select({ objectKey: memberAvatars.objectKey })
            .from(memberAvatars)
            .where(eq(memberAvatars.membershipId, active.membershipId))
            .limit(1)
          const [{ deletedAt }] = await transaction.select({
            deletedAt: sql`clock_timestamp()`.mapWith(parties.deletedAt),
          })
            .from(parties)
            .where(eq(parties.id, candidate.partyId))
          await transaction.update(memberAvatars).set({ deletedAt })
            .where(and(eq(memberAvatars.membershipId, active.membershipId), isNull(memberAvatars.deletedAt)))
          await transaction.update(invites).set({ deletedAt })
            .where(and(eq(invites.partyId, candidate.partyId), isNull(invites.deletedAt)))
          await transaction.update(memberships).set({ deletedAt })
            .where(eq(memberships.id, active.membershipId))
          await transaction.update(parties).set({ deletedAt, updatedAt: deletedAt })
            .where(and(eq(parties.id, candidate.partyId), isNull(parties.deletedAt)))
          return { status: 'deleted' as const, objectKey: avatar?.objectKey }
        }
      }

      const [avatar] = await transaction
        .select({ objectKey: memberAvatars.objectKey })
        .from(parties)
        .innerJoin(memberships, and(
          eq(memberships.partyId, parties.id),
          eq(memberships.userId, user.id),
          isNotNull(memberships.deletedAt),
        ))
        .innerJoin(memberAvatars, and(
          eq(memberAvatars.membershipId, memberships.id),
          isNotNull(memberAvatars.deletedAt),
        ))
        .where(and(eq(parties.ownerUserId, user.id), isNotNull(parties.deletedAt)))
        .orderBy(desc(parties.deletedAt), desc(parties.id))
        .limit(1)
      return { status: 'already_deleted' as const, objectKey: avatar?.objectKey }
    })

    if ('objectKey' in result && result.objectKey) {
      try {
        await bindings.AVATARS.delete(result.objectKey)
      } catch {
        return { status: 'cleanup_pending' }
      }
    }
    return { status: result.status }
  } finally {
    await client.end()
  }
}

export const leaveParty: LeaveParty = async (bindings, authUserId) => {
  const { client, database } = openDatabase(bindings)
  try {
    const result = await database.transaction(async (transaction) => {
      const [user] = await transaction.select({ id: users.id }).from(users)
        .where(and(eq(users.authUserId, authUserId), isNull(users.deletedAt)))
        .limit(1)
      if (!user) return { status: 'already_left' as const }

      const [candidate] = await transaction
        .select({ partyId: memberships.partyId })
        .from(memberships)
        .innerJoin(parties, and(eq(parties.id, memberships.partyId), isNull(parties.deletedAt)))
        .where(and(eq(memberships.userId, user.id), isNull(memberships.deletedAt)))
        .limit(1)

      if (candidate) {
        await transaction.execute(sql`
          select id from ${parties}
          where id = ${candidate.partyId} and deleted_at is null
          for update
        `)
        const [active] = await transaction
          .select({ id: memberships.id, ownerUserId: parties.ownerUserId })
          .from(memberships)
          .innerJoin(parties, and(eq(parties.id, memberships.partyId), isNull(parties.deletedAt)))
          .where(and(
            eq(memberships.partyId, candidate.partyId),
            eq(memberships.userId, user.id),
            isNull(memberships.deletedAt),
          ))
          .limit(1)
        if (active) {
          if (active.ownerUserId === user.id) return { status: 'owner_required' as const }
          const [avatar] = await transaction.select({ objectKey: memberAvatars.objectKey })
            .from(memberAvatars)
            .where(eq(memberAvatars.membershipId, active.id))
            .limit(1)
          await transaction.update(memberAvatars).set({ deletedAt: sql`clock_timestamp()` })
            .where(eq(memberAvatars.membershipId, active.id))
          await transaction.update(memberships).set({ deletedAt: sql`clock_timestamp()` })
            .where(eq(memberships.id, active.id))
          return { status: 'left' as const, objectKey: avatar?.objectKey }
        }
      }

      const [avatar] = await transaction
        .select({ objectKey: memberAvatars.objectKey })
        .from(memberships)
        .innerJoin(memberAvatars, and(
          eq(memberAvatars.membershipId, memberships.id),
          isNotNull(memberAvatars.deletedAt),
        ))
        .where(and(eq(memberships.userId, user.id), isNotNull(memberships.deletedAt)))
        .orderBy(desc(memberships.deletedAt), desc(memberships.id))
        .limit(1)
      return { status: 'already_left' as const, objectKey: avatar?.objectKey }
    })

    if ('objectKey' in result && result.objectKey) {
      try {
        await bindings.AVATARS.delete(result.objectKey)
      } catch {
        return { status: 'cleanup_pending' }
      }
    }
    return { status: result.status }
  } finally {
    await client.end()
  }
}
