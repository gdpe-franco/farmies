import { and, eq, isNull, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'
import { verifyWithJwks } from 'hono/jwt'
import postgres from 'postgres'
import { z } from 'zod'

import {
  environments,
  memberships,
  parties,
  species,
  speciesEnvironments,
  users,
} from './db/schema.ts'

type Bindings = {
  CLIENT_ORIGIN: string
  HYPERDRIVE: Hyperdrive
  SUPABASE_JWKS_URL?: string
  SUPABASE_URL: string
}

type Variables = {
  authUserId: string
}

type ApplicationUser = {
  id: bigint
  preferredLocale: string
  createdAt: Date
  updatedAt: Date
}

type CreatedParty = {
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
}

type CreatePartyResult =
  | { status: 'created'; value: CreatedParty }
  | { status: 'already_member' }
  | { status: 'user_not_found' }

type FindOrCreateUser = (bindings: Bindings, authUserId: string) => Promise<ApplicationUser | undefined>
type UpdateUserLocale = (
  bindings: Bindings,
  authUserId: string,
  preferredLocale: 'en' | 'es',
) => Promise<ApplicationUser | undefined>
type CreateParty = (
  bindings: Bindings,
  authUserId: string,
  input: { displayName: string; nickname: string },
) => Promise<CreatePartyResult>

type Dependencies = {
  createParty: CreateParty
  findOrCreateUser: FindOrCreateUser
  updateUserLocale: UpdateUserLocale
}

const claimsSchema = z.object({
  sub: z.uuid(),
  exp: z.number().int(),
  role: z.literal('authenticated'),
})

const localeRequestSchema = z.object({
  preferredLocale: z.enum(['en', 'es']),
}).strict()

const partyRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(60),
  nickname: z.string().trim().min(1).max(40),
}).strict()

const userFields = {
  id: users.id,
  preferredLocale: users.preferredLocale,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
}

const unauthorized = () => new Response('Unauthorized', { status: 401 })

const findOrCreateUser: FindOrCreateUser = async (bindings, authUserId) => {
  const client = postgres(bindings.HYPERDRIVE.connectionString, {
    max: 1,
    fetch_types: false,
    prepare: true,
  })
  const database = drizzle(client)

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
  } finally {
    await client.end()
  }
}

const updateUserLocale: UpdateUserLocale = async (bindings, authUserId, preferredLocale) => {
  const client = postgres(bindings.HYPERDRIVE.connectionString, {
    max: 1,
    fetch_types: false,
    prepare: true,
  })
  const database = drizzle(client)

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

const createParty: CreateParty = async (bindings, authUserId, input) => {
  const client = postgres(bindings.HYPERDRIVE.connectionString, {
    max: 1,
    fetch_types: false,
    prepare: true,
  })
  const database = drizzle(client)

  try {
    return await database.transaction(async (transaction) => {
      const [user] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.authUserId, authUserId), isNull(users.deletedAt)))
        .limit(1)
      if (!user) return { status: 'user_not_found' }

      const [activeMembership] = await transaction
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.userId, user.id), isNull(memberships.deletedAt)))
        .limit(1)
      if (activeMembership) return { status: 'already_member' }

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
        .limit(1)
      if (!party) throw new Error('Party creation returned no row')

      await transaction.execute(sql`
        insert into ${memberships} (party_id, user_id, nickname)
        values (${party.id}, ${user.id}, ${input.nickname})
      `)
      const [membership] = await transaction
        .select({ id: memberships.id, nickname: memberships.nickname, joinedAt: memberships.joinedAt })
        .from(memberships)
        .where(and(eq(memberships.userId, user.id), isNull(memberships.deletedAt)))
        .limit(1)
      if (!membership) throw new Error('Membership creation returned no row')

      return {
        status: 'created',
        value: {
          party: {
            ...party,
            species: catalog.species,
            environment: catalog.environment,
          },
          membership,
        },
      }
    })
  } catch (error) {
    if ((error as { code?: string }).code === '23505') return { status: 'already_member' }
    throw error
  } finally {
    await client.end()
  }
}

const serializeUser = (user: ApplicationUser) => ({
  user: {
    id: user.id.toString(),
    preferredLocale: user.preferredLocale,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  },
})

const serializeParty = ({ party, membership }: CreatedParty) => ({
  party: {
    id: party.id.toString(),
    displayName: party.displayName,
    species: party.species,
    environment: party.environment,
    createdAt: party.createdAt.toISOString(),
  },
  membership: {
    id: membership.id.toString(),
    nickname: membership.nickname,
    joinedAt: membership.joinedAt.toISOString(),
  },
})

export const createApp = (dependencies: Partial<Dependencies> = {}) => {
  const addParty = dependencies.createParty ?? createParty
  const getUser = dependencies.findOrCreateUser ?? findOrCreateUser
  const setUserLocale = dependencies.updateUserLocale ?? updateUserLocale
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

  const authenticate: MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> = async (
    context,
    next,
  ) => {
    const authorization = context.req.header('Authorization')
    const match = authorization?.match(/^Bearer\s+(\S+)$/i)
    if (!match) return unauthorized()

    const supabaseUrl = z.url().parse(context.env.SUPABASE_URL).replace(/\/$/, '')
    const jwksUrl = z.url().parse(
      context.env.SUPABASE_JWKS_URL ?? `${supabaseUrl}/auth/v1/.well-known/jwks.json`,
    )

    try {
      const claims = await verifyWithJwks(match[1], {
        jwks_uri: jwksUrl,
        allowedAlgorithms: ['ES256', 'RS256'],
        verification: {
          iss: `${supabaseUrl}/auth/v1`,
          aud: 'authenticated',
          exp: true,
        },
      }, { cf: { cacheEverything: true, cacheTtl: 600 } })

      context.set('authUserId', claimsSchema.parse(claims).sub)
    } catch {
      return unauthorized()
    }

    await next()
  }

  app.get('/health', (context) => context.json({ status: 'ok' }))

  app.use('/users/*', async (context, next) =>
    cors({
      origin: context.env.CLIENT_ORIGIN,
      allowHeaders: ['Authorization', 'Content-Type'],
      allowMethods: ['PUT', 'PATCH', 'OPTIONS'],
      maxAge: 600,
    })(context, next),
  )

  app.use('/parties', async (context, next) =>
    cors({
      origin: context.env.CLIENT_ORIGIN,
      allowHeaders: ['Authorization', 'Content-Type'],
      allowMethods: ['POST', 'OPTIONS'],
      maxAge: 600,
    })(context, next),
  )

  app.use('/users/me', authenticate)
  app.use('/parties', authenticate)

  app.put('/users/me', async (context) => {
    const user = await getUser(context.env, context.get('authUserId'))
    if (!user) return unauthorized()

    return context.json(serializeUser(user))
  })

  app.patch('/users/me', async (context) => {
    const body = await context.req.json().catch(() => undefined)
    const result = localeRequestSchema.safeParse(body)
    if (!result.success) return context.json({ error: 'INVALID_REQUEST' }, 400)

    const user = await setUserLocale(
      context.env,
      context.get('authUserId'),
      result.data.preferredLocale,
    )
    if (!user) return unauthorized()

    return context.json(serializeUser(user))
  })

  app.post('/parties', async (context) => {
    const body = await context.req.json().catch(() => undefined)
    const input = partyRequestSchema.safeParse(body)
    if (!input.success) return context.json({ error: 'INVALID_REQUEST' }, 400)

    try {
      const result = await addParty(context.env, context.get('authUserId'), input.data)
      if (result.status === 'user_not_found') return unauthorized()
      if (result.status === 'already_member') {
        return context.json({ error: 'ALREADY_IN_PARTY' }, 409)
      }

      return context.json(serializeParty(result.value), 201)
    } catch {
      return context.json({ error: 'PARTY_CREATION_FAILED' }, 500)
    }
  })

  return app
}

export default createApp()
