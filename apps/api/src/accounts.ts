import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Hyperdrive, R2Bucket } from '@cloudflare/workers-types'

import { openDatabase } from './db/index.ts'
import { invites, memberAvatars, memberships, parties, users } from './db/schema.ts'

const recentAuthenticationSeconds = 5 * 60

type AccountBindings = {
  HYPERDRIVE: Hyperdrive
  AVATARS: R2Bucket
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

type DeleteAccountResult = {
  status: 'deleted' | 'recent_auth_required' | 'transfer_required' | 'cleanup_pending'
}

export type DeleteAccount = (
  bindings: AccountBindings,
  authUserId: string,
  authenticatedAt: number,
) => Promise<DeleteAccountResult>

const deleteAuthUser = async (bindings: AccountBindings, authUserId: string) => {
  const baseUrl = bindings.SUPABASE_URL.replace(/\/$/, '')
  const response = await fetch(`${baseUrl}/auth/v1/admin/users/${authUserId}`, {
    method: 'DELETE',
    headers: {
      apikey: bindings.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${bindings.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  })
  if (!response.ok && response.status !== 404) throw new Error('Supabase Auth cleanup failed')
}

export const deleteAccount: DeleteAccount = async (bindings, authUserId, authenticatedAt) => {
  const { client, database } = openDatabase(bindings)
  try {
    const result = await database.transaction(async (transaction) => {
      await transaction.execute(sql`
        select id from ${users}
        where auth_user_id = ${authUserId}
        for update
      `)
      const [user] = await transaction.select({ id: users.id, deletedAt: users.deletedAt })
        .from(users)
        .where(eq(users.authUserId, authUserId))
        .limit(1)

      if (user && !user.deletedAt) {
        const tokenAge = Math.floor(Date.now() / 1_000) - authenticatedAt
        if (tokenAge < 0 || tokenAge > recentAuthenticationSeconds) {
          return { status: 'recent_auth_required' as const, objectKeys: [] as string[] }
        }

        const [candidate] = await transaction.select({ partyId: memberships.partyId })
          .from(memberships)
          .where(and(eq(memberships.userId, user.id), isNull(memberships.deletedAt)))
          .limit(1)

        let active: { membershipId: bigint; ownerUserId: bigint; partyId: bigint } | undefined
        if (candidate) {
          await transaction.execute(sql`
            select id from ${parties}
            where id = ${candidate.partyId} and deleted_at is null
            for update
          `)
          const [current] = await transaction
            .select({
              membershipId: memberships.id,
              ownerUserId: parties.ownerUserId,
              partyId: parties.id,
            })
            .from(memberships)
            .innerJoin(parties, and(eq(parties.id, memberships.partyId), isNull(parties.deletedAt)))
            .where(and(
              eq(memberships.partyId, candidate.partyId),
              eq(memberships.userId, user.id),
              isNull(memberships.deletedAt),
            ))
            .limit(1)
          active = current

          if (active?.ownerUserId === user.id) {
            const activeMembers = await transaction.select({ id: memberships.id }).from(memberships)
              .where(and(eq(memberships.partyId, active.partyId), isNull(memberships.deletedAt)))
            if (activeMembers.length > 1) {
              return { status: 'transfer_required' as const, objectKeys: [] as string[] }
            }
          }
        }

        const [{ deletedAt }] = await transaction.select({
          deletedAt: sql`clock_timestamp()`.mapWith(users.deletedAt),
        })
          .from(users)
          .where(eq(users.id, user.id))
        if (active) {
          await transaction.update(memberAvatars).set({ deletedAt })
            .where(and(eq(memberAvatars.membershipId, active.membershipId), isNull(memberAvatars.deletedAt)))
          await transaction.update(memberships).set({ deletedAt })
            .where(eq(memberships.id, active.membershipId))
          if (active.ownerUserId === user.id) {
            await transaction.update(invites).set({ deletedAt })
              .where(and(eq(invites.partyId, active.partyId), isNull(invites.deletedAt)))
            await transaction.update(parties).set({ deletedAt, updatedAt: deletedAt })
              .where(and(eq(parties.id, active.partyId), isNull(parties.deletedAt)))
          }
        }
        await transaction.update(users).set({ deletedAt, updatedAt: deletedAt })
          .where(and(eq(users.id, user.id), isNull(users.deletedAt)))
      }

      const objectKeys = user
        ? (await transaction.select({ objectKey: memberAvatars.objectKey })
            .from(memberships)
            .innerJoin(memberAvatars, eq(memberAvatars.membershipId, memberships.id))
            .where(eq(memberships.userId, user.id)))
            .map(({ objectKey }) => objectKey)
        : []
      return { status: 'deleted' as const, objectKeys }
    })

    if (result.status !== 'deleted') return { status: result.status }
    try {
      for (const objectKey of result.objectKeys) await bindings.AVATARS.delete(objectKey)
      await deleteAuthUser(bindings, authUserId)
      return { status: 'deleted' }
    } catch {
      return { status: 'cleanup_pending' }
    }
  } finally {
    await client.end()
  }
}
