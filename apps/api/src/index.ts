import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { authenticate } from './auth.ts'
import type { Bindings, Variables } from './http.ts'
import { operations as defaultOperations, type Operations } from './operations.ts'
import { registerAvatarRoutes } from './routes/avatars.ts'
import { registerInviteRoutes } from './routes/invites.ts'
import { registerMembershipRoutes } from './routes/memberships.ts'
import { registerPartyRoutes } from './routes/parties.ts'
import { registerUserRoutes } from './routes/users.ts'

export const createApp = (overrides: Partial<Operations> = {}) => {
  const operations = { ...defaultOperations, ...overrides }
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

  app.get('/health', (context) => context.json({ status: 'ok' }))

  app.use('/users/*', async (context, next) =>
    cors({
      origin: context.env.CLIENT_ORIGIN,
      allowHeaders: ['Authorization', 'Content-Type'],
      allowMethods: ['PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      maxAge: 600,
    })(context, next),
  )
  app.use('/parties', async (context, next) =>
    cors({
      origin: context.env.CLIENT_ORIGIN,
      allowHeaders: ['Authorization', 'Content-Type'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      maxAge: 600,
    })(context, next),
  )
  app.use('/parties/*', async (context, next) =>
    cors({
      origin: context.env.CLIENT_ORIGIN,
      allowHeaders: ['Authorization', 'Content-Type'],
      allowMethods: ['GET', 'PUT', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      exposeHeaders: ['Date'],
      maxAge: 600,
    })(context, next),
  )
  app.use('/invites/*', async (context, next) =>
    cors({
      origin: context.env.CLIENT_ORIGIN,
      allowHeaders: ['Authorization'],
      allowMethods: ['GET', 'OPTIONS'],
      maxAge: 600,
    })(context, next),
  )
  app.use('/memberships', async (context, next) =>
    cors({
      origin: context.env.CLIENT_ORIGIN,
      allowHeaders: ['Authorization', 'Content-Type'],
      allowMethods: ['POST', 'OPTIONS'],
      maxAge: 600,
    })(context, next),
  )

  app.use('/users/me', authenticate)
  app.use('/parties', authenticate)
  app.use('/parties/*', authenticate)
  app.use('/invites/*', authenticate)
  app.use('/memberships', authenticate)

  registerAvatarRoutes(app, operations)
  registerPartyRoutes(app, operations)
  registerUserRoutes(app, operations)
  registerInviteRoutes(app, operations)
  registerMembershipRoutes(app, operations)

  return app
}

export default createApp()
