import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import type { Hyperdrive, R2Bucket } from '@cloudflare/workers-types'

import { openDatabase } from './db/index.ts'
import { memberAvatars, memberships, parties, users } from './db/schema.ts'

type LeavePartyResult = { status: 'left' | 'already_left' | 'owner_required' | 'cleanup_pending' }
export type LeaveParty = (
  bindings: { HYPERDRIVE: Hyperdrive; AVATARS: R2Bucket },
  authUserId: string,
) => Promise<LeavePartyResult>

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
