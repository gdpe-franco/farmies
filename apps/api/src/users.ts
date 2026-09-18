import type { Hyperdrive } from '@cloudflare/workers-types'
import { and, eq, isNull, sql } from 'drizzle-orm'

import { openDatabase } from './db/index.ts'
import { users } from './db/schema.ts'

export type ApplicationUser = {
  id: bigint
  preferredLocale: string
  createdAt: Date
  updatedAt: Date
}

const userFields = {
  id: users.id,
  preferredLocale: users.preferredLocale,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
}

const postgresErrorCode = (error: unknown) => {
  const databaseError = error as { code?: string; cause?: { code?: string } }
  return databaseError.code ?? databaseError.cause?.code
}

export const findOrCreateUser = async (
  bindings: { HYPERDRIVE: Hyperdrive },
  authUserId: string,
): Promise<ApplicationUser | undefined> => {
  const { client, database } = openDatabase(bindings)

  try {
    await database.execute(sql`
      insert into ${users} (auth_user_id)
      values (${authUserId})
      on conflict (auth_user_id) do nothing
    `)

    const [existing] = await database
      .select(userFields)
      .from(users)
      .where(and(eq(users.authUserId, authUserId), isNull(users.deletedAt)))
      .limit(1)

    return existing
  } catch (error) {
    if (postgresErrorCode(error) === '23503') return undefined
    throw error
  } finally {
    await client.end()
  }
}

export const updateUserLocale = async (
  bindings: { HYPERDRIVE: Hyperdrive },
  authUserId: string,
  preferredLocale: 'en' | 'es',
): Promise<ApplicationUser | undefined> => {
  const { client, database } = openDatabase(bindings)

  try {
    const [user] = await database
      .update(users)
      .set({ preferredLocale, updatedAt: sql`now()` })
      .where(and(eq(users.authUserId, authUserId), isNull(users.deletedAt)))
      .returning(userFields)

    return user
  } finally {
    await client.end()
  }
}
