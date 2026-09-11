import { and, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { Hono } from 'hono'
import { verifyWithJwks } from 'hono/jwt'
import postgres from 'postgres'
import { z } from 'zod'

import { users } from './db/schema.ts'

type Bindings = {
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

type FindOrCreateUser = (bindings: Bindings, authUserId: string) => Promise<ApplicationUser | undefined>

const claimsSchema = z.object({
  sub: z.uuid(),
  exp: z.number().int(),
  role: z.literal('authenticated'),
})

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

export const createApp = (getUser: FindOrCreateUser = findOrCreateUser) => {
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

  app.get('/health', (context) => context.json({ status: 'ok' }))

  app.use('/users/me', async (context, next) => {
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
  })

  app.put('/users/me', async (context) => {
    const user = await getUser(context.env, context.get('authUserId'))
    if (!user) return unauthorized()

    return context.json({
      user: {
        id: user.id.toString(),
        preferredLocale: user.preferredLocale,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
    })
  })

  return app
}

export default createApp()
