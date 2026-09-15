import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Hyperdrive, R2Bucket } from '@cloudflare/workers-types'
import { alias } from 'drizzle-orm/pg-core'

import { openDatabase } from './db/index.ts'
import { memberAvatars, memberships, parties, users } from './db/schema.ts'

// Check the bounded, single-image WebP container; face detection is a client UX check.
export const validateAvatar = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 26 || bytes.length > 524_288) return false
  const view = new DataView(buffer)
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WEBP' || view.getUint32(4, true) !== bytes.length - 8) return false
  let imageSeen = false
  let extendedSeen = false
  let alphaSeen = false
  const uint24 = (offset: number) => bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) return false
    const type = tag(offset)
    const size = view.getUint32(offset + 4, true)
    const start = offset + 8
    const end = start + size
    if (end + (size % 2) > bytes.length || (size % 2 && bytes[end] !== 0)) return false
    if (type === 'VP8X') {
      // Only transparency is allowed: no animation, EXIF, XMP or color-profile metadata.
      if (offset !== 12 || size !== 10 || (bytes[start] & ~0x10) || uint24(start + 1)) return false
      if (uint24(start + 4) + 1 !== 512 || uint24(start + 7) + 1 !== 512) return false
      extendedSeen = true
    } else if (type === 'ALPH') {
      if (!extendedSeen || alphaSeen || imageSeen || size < 2) return false
      alphaSeen = true
    } else if (type === 'VP8 ') {
      if (imageSeen || size <= 10 || (bytes[start] & 1)) return false
      if (bytes[start + 3] !== 0x9d || bytes[start + 4] !== 0x01 || bytes[start + 5] !== 0x2a) return false
      if (view.getUint16(start + 6, true) !== 512 || view.getUint16(start + 8, true) !== 512) return false
      imageSeen = true
    } else if (type === 'VP8L') {
      if (imageSeen || alphaSeen || size <= 5 || bytes[start] !== 0x2f) return false
      const header = view.getUint32(start + 1, true)
      if ((header & 0x3fff) + 1 !== 512 || ((header >>> 14) & 0x3fff) + 1 !== 512 || header >>> 29) return false
      imageSeen = true
    } else {
      return false
    }
    offset = end + (size % 2)
  }
  return imageSeen
}

type AvatarInput = { membershipId: bigint; action: 'read' | 'save' | 'delete'; bytes?: ArrayBuffer }
type AvatarResult =
  | { status: 'not_found' | 'forbidden' | 'deleted' | 'cleanup_pending' }
  | { status: 'saved'; version: number }
  | { status: 'read'; bytes: ArrayBuffer }
export type ManageAvatar = (
  bindings: { HYPERDRIVE: Hyperdrive; AVATARS: R2Bucket },
  authUserId: string,
  input: AvatarInput,
) => Promise<AvatarResult>

export const manageAvatar: ManageAvatar = async (bindings, authUserId, input) => {
  const { client, database } = openDatabase(bindings)
  let stage = 'authorization'
  try {
    return await database.transaction(async (transaction): Promise<AvatarResult> => {
      const requester = alias(memberships, 'requester')
      const targetUser = alias(users, 'target_user')
      const party = alias(parties, 'avatar_party')
      const [target] = await transaction
        .select({ id: memberships.id, userId: memberships.userId, requesterId: requester.id })
        .from(memberships)
        .innerJoin(party, and(eq(party.id, memberships.partyId), isNull(party.deletedAt)))
        .innerJoin(targetUser, and(eq(targetUser.id, memberships.userId), isNull(targetUser.deletedAt)))
        .innerJoin(requester, and(eq(requester.partyId, party.id), isNull(requester.deletedAt)))
        .innerJoin(users, and(eq(users.id, requester.userId), eq(users.authUserId, authUserId), isNull(users.deletedAt)))
        .where(and(eq(memberships.id, input.membershipId), isNull(memberships.deletedAt)))
        // Serialize object I/O with replacement/deletion and future Party lifecycle operations.
        .for('update', { of: party })
      if (!target) return { status: 'not_found' }
      if (input.action !== 'read' && target.id !== target.requesterId) return { status: 'forbidden' }

      const key = `avatars/${target.id}/current.webp`
      if (input.action === 'read') {
        const [avatar] = await transaction.select().from(memberAvatars)
          .where(and(eq(memberAvatars.membershipId, target.id), isNull(memberAvatars.deletedAt)))
        if (!avatar) return { status: 'not_found' }
        const object = await bindings.AVATARS.get(key)
        if (!object) return { status: 'not_found' }
        return { status: 'read', bytes: await object.arrayBuffer() }
      }
      if (input.action === 'delete') {
        await transaction.update(memberAvatars).set({ deletedAt: sql`clock_timestamp()` })
          .where(eq(memberAvatars.membershipId, target.id))
        try {
          await bindings.AVATARS.delete(key)
          return { status: 'deleted' }
        } catch {
          // Commit the inaccessible tombstone; the same DELETE safely retries object cleanup.
          return { status: 'cleanup_pending' }
        }
      }
      if (!input.bytes || !validateAvatar(input.bytes)) throw new Error('Invalid processed avatar')
      stage = 'object_write'
      const stored = await bindings.AVATARS.put(key, input.bytes, { httpMetadata: { contentType: 'image/webp' } })
      if (!stored) throw new Error('Avatar storage failed')
      stage = 'metadata_write'
      await transaction.execute(sql`
        insert into ${memberAvatars} (membership_id, object_key, media_type, byte_size, width, height)
        values (${target.id}, ${key}, 'image/webp', ${input.bytes.byteLength}, 512, 512)
        on conflict (membership_id) do update set
          object_key = excluded.object_key, media_type = excluded.media_type,
          byte_size = excluded.byte_size, width = excluded.width, height = excluded.height,
          version = ${memberAvatars.version} + 1, updated_at = clock_timestamp(), deleted_at = null
      `)
      const [avatar] = await transaction.select({ version: memberAvatars.version }).from(memberAvatars)
        .where(eq(memberAvatars.membershipId, target.id))
      return { status: 'saved', version: avatar.version }
    })
  } catch (error) {
    const failure = error as { name?: string; code?: string; cause?: { code?: string } }
    console.error('Avatar operation failed', {
      stage,
      errorName: failure.name,
      databaseCode: failure.code ?? failure.cause?.code,
    })
    throw error
  } finally {
    await client.end()
  }
}
