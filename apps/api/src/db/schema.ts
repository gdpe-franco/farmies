import { sql } from 'drizzle-orm'
import { bigint, check, foreignKey, pgSchema, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

const auth = pgSchema('auth')
const authUsers = auth.table('users', {
  id: uuid('id').primaryKey(),
})

export const farmies = pgSchema('farmies')

export const users = farmies.table(
  'users',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    authUserId: uuid('auth_user_id').unique('users_auth_user_id_key'),
    preferredLocale: varchar('preferred_locale', { length: 2 }).notNull().default('en'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: 'users_auth_user_id_fkey',
      columns: [table.authUserId],
      foreignColumns: [authUsers.id],
    }).onDelete('set null'),
    check('users_preferred_locale_check', sql`${table.preferredLocale} in ('en', 'es')`),
    check('users_deleted_at_check', sql`${table.deletedAt} is null or ${table.deletedAt} >= ${table.createdAt}`),
    check('users_active_auth_user_check', sql`${table.deletedAt} is not null or ${table.authUserId} is not null`),
  ],
)
