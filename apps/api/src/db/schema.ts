import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

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

export const species = farmies.table(
  'species',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    code: varchar('code', { length: 32 }).notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('species_code_check', sql`${table.code} ~ '^[A-Z][A-Z0-9_]*$'`)],
)

export const environments = farmies.table(
  'environments',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    code: varchar('code', { length: 32 }).notNull().unique(),
    definition: jsonb('definition').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('environments_code_check', sql`${table.code} ~ '^[A-Z][A-Z0-9_]*$'`),
    check('environments_definition_check', sql`jsonb_typeof(${table.definition}) = 'object'`),
  ],
)

export const speciesEnvironments = farmies.table(
  'species_environments',
  {
    speciesId: bigint('species_id', { mode: 'bigint' })
      .notNull()
      .references(() => species.id, { onDelete: 'restrict' }),
    environmentId: bigint('environment_id', { mode: 'bigint' })
      .notNull()
      .references(() => environments.id, { onDelete: 'restrict' }),
  },
  (table) => [primaryKey({ columns: [table.speciesId, table.environmentId] })],
)

export const parties = farmies.table(
  'parties',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    ownerUserId: bigint('owner_user_id', { mode: 'bigint' })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    displayName: varchar('display_name', { length: 60 }).notNull(),
    speciesId: bigint('species_id', { mode: 'bigint' }).notNull(),
    environmentId: bigint('environment_id', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.speciesId, table.environmentId],
      foreignColumns: [speciesEnvironments.speciesId, speciesEnvironments.environmentId],
    }).onDelete('restrict'),
    check(
      'parties_display_name_check',
      sql`${table.displayName} = btrim(${table.displayName}) and char_length(${table.displayName}) between 1 and 60`,
    ),
    check('parties_deleted_at_check', sql`${table.deletedAt} is null or ${table.deletedAt} >= ${table.createdAt}`),
    index('parties_active_owner_idx').on(table.ownerUserId).where(sql`${table.deletedAt} is null`),
  ],
)

export const memberships = farmies.table(
  'memberships',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    partyId: bigint('party_id', { mode: 'bigint' })
      .notNull()
      .references(() => parties.id, { onDelete: 'restrict' }),
    userId: bigint('user_id', { mode: 'bigint' })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    nickname: varchar('nickname', { length: 40 }).notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'memberships_nickname_check',
      sql`${table.nickname} = btrim(${table.nickname}) and char_length(${table.nickname}) between 1 and 40`,
    ),
    check('memberships_deleted_at_check', sql`${table.deletedAt} is null or ${table.deletedAt} >= ${table.joinedAt}`),
    index('memberships_active_user_idx').on(table.userId).where(sql`${table.deletedAt} is null`),
    uniqueIndex('memberships_active_party_user_uidx')
      .on(table.partyId, table.userId)
      .where(sql`${table.deletedAt} is null`),
    index('memberships_active_party_joined_idx')
      .on(table.partyId, table.joinedAt, table.id)
      .where(sql`${table.deletedAt} is null`),
  ],
)

export const invites = farmies.table(
  'invites',
  {
    partyId: bigint('party_id', { mode: 'bigint' })
      .primaryKey()
      .references(() => parties.id, { onDelete: 'restrict' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    check('invites_token_hash_check', sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check('invites_expires_at_check', sql`${table.expiresAt} > ${table.createdAt}`),
    check('invites_revoked_at_check', sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt}`),
    check('invites_deleted_at_check', sql`${table.deletedAt} is null or ${table.deletedAt} >= ${table.createdAt}`),
  ],
)

export const memberAvatars = farmies.table(
  'member_avatars',
  {
    membershipId: bigint('membership_id', { mode: 'bigint' })
      .primaryKey()
      .references(() => memberships.id, { onDelete: 'restrict' }),
    objectKey: text('object_key').notNull().unique(),
    mediaType: varchar('media_type', { length: 32 }).notNull(),
    byteSize: integer('byte_size').notNull(),
    width: smallint('width').notNull(),
    height: smallint('height').notNull(),
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    check('member_avatars_media_type_check', sql`${table.mediaType} = 'image/webp'`),
    check('member_avatars_byte_size_check', sql`${table.byteSize} between 1 and 524288`),
    check('member_avatars_width_check', sql`${table.width} = 512`),
    check('member_avatars_height_check', sql`${table.height} = 512`),
    check('member_avatars_version_check', sql`${table.version} > 0`),
    check(
      'member_avatars_deleted_at_check',
      sql`${table.deletedAt} is null or ${table.deletedAt} >= ${table.updatedAt}`,
    ),
  ],
)
