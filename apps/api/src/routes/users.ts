import { z } from 'zod'

import { ApiErrorCode } from '../error-codes.ts'
import type { FarmiesApp } from '../http.ts'
import { unauthorized } from '../http.ts'
import type { Operations } from '../operations.ts'
import type { ApplicationUser } from '../users.ts'

const localeRequestSchema = z.object({
  preferredLocale: z.enum(['en', 'es']),
}).strict()

const serializeUser = (user: ApplicationUser) => ({
  user: {
    id: user.id.toString(),
    preferredLocale: user.preferredLocale,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  },
})

export const registerUserRoutes = (app: FarmiesApp, operations: Operations) => {
  app.put('/users/me', async (context) => {
    const user = await operations.findOrCreateUser(context.env, context.get('authUserId'))
    if (!user) return unauthorized()
    return context.json(serializeUser(user))
  })

  app.patch('/users/me', async (context) => {
    const body = await context.req.json().catch(() => undefined)
    const result = localeRequestSchema.safeParse(body)
    if (!result.success) return context.json({ error: ApiErrorCode.INVALID_REQUEST }, 400)

    const user = await operations.updateUserLocale(
      context.env,
      context.get('authUserId'),
      result.data.preferredLocale,
    )
    if (!user) return unauthorized()
    return context.json(serializeUser(user))
  })

  app.delete('/users/me', async (context) => {
    try {
      const result = await operations.deleteAccount(
        context.env,
        context.get('authUserId'),
        context.get('authenticatedAt'),
      )
      if (result.status === 'recent_auth_required') {
        return context.json({ error: ApiErrorCode.RECENT_AUTH_REQUIRED }, 403)
      }
      if (result.status === 'transfer_required') {
        return context.json({ error: ApiErrorCode.PARTY_TRANSFER_REQUIRED }, 409)
      }
      if (result.status === 'cleanup_pending') {
        return context.json({ error: ApiErrorCode.ACCOUNT_DELETE_RETRY }, 503)
      }
      return context.body(null, 204)
    } catch {
      return context.json({ error: ApiErrorCode.ACCOUNT_DELETE_FAILED }, 500)
    }
  })
}
