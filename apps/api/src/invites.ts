import type { Hyperdrive } from '@cloudflare/workers-types'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'

import { openDatabase } from './db/index.ts'
import { invites, memberships, parties, users } from './db/schema.ts'
import { PARTY_LIMITS } from './party-limits.ts'

export const createInviteSecret = async () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
  return { token, hash: await hashInviteToken(token) }
}

export const hashInviteToken = async (token: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export const manageInvite = async (
  bindings: { HYPERDRIVE: Hyperdrive },
  authUserId: string,
  action: 'replace' | 'revoke',
): Promise<
  | { status: 'created'; token: string; expiresAt: Date }
  | { status: 'revoked' | 'owner_required' }
> => {
  const { client, database } = openDatabase(bindings)

  try {
    return await database.transaction(async (transaction) => {
      const [party] = await transaction
        .select({ id: parties.id })
        .from(parties)
        .innerJoin(users, and(eq(users.id, parties.ownerUserId), isNull(users.deletedAt)))
        .where(and(eq(users.authUserId, authUserId), isNull(parties.deletedAt)))
        .limit(1)
      if (!party) return { status: 'owner_required' }

      await transaction.execute(sql`
        select id from ${parties}
        where id = ${party.id} and deleted_at is null
        for update
      `)

      if (action === 'revoke') {
        await transaction
          .update(invites)
          .set({ revokedAt: sql`now()` })
          .where(and(eq(invites.partyId, party.id), isNull(invites.deletedAt)))
        return { status: 'revoked' }
      }

      const { token, hash } = await createInviteSecret()
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000)
      await transaction.execute(sql`
        insert into ${invites} (party_id, token_hash, expires_at)
        values (${party.id}, ${hash}, ${expiresAt.toISOString()})
        on conflict (party_id) do update set
          token_hash = excluded.token_hash,
          expires_at = excluded.expires_at,
          revoked_at = null,
          created_at = now(),
          deleted_at = null
      `)

      return { status: 'created', token, expiresAt }
    })
  } finally {
    await client.end()
  }
}

export const findInvitePreview = async (
  bindings: { HYPERDRIVE: Hyperdrive },
  tokenHash: string,
): Promise<{ displayName: string; occupancy: number } | undefined> => {
  const { client, database } = openDatabase(bindings)

  try {
    const [result] = await database
      .select({
        displayName: parties.displayName,
        occupancy: sql<number>`count(${memberships.id})`,
      })
      .from(invites)
      .innerJoin(parties, and(eq(parties.id, invites.partyId), isNull(parties.deletedAt)))
      .leftJoin(memberships, and(eq(memberships.partyId, parties.id), isNull(memberships.deletedAt)))
      .where(and(
        eq(invites.tokenHash, tokenHash),
        isNull(invites.revokedAt),
        isNull(invites.deletedAt),
        gt(invites.expiresAt, sql`now()`),
      ))
      .groupBy(parties.id, parties.displayName)
      .limit(1)

    if (!result || Number(result.occupancy) >= PARTY_LIMITS.activeMembersPerParty) return undefined
    return { displayName: result.displayName, occupancy: Number(result.occupancy) }
  } finally {
    await client.end()
  }
}
