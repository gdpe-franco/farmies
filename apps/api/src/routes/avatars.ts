import { bodyLimit } from 'hono/body-limit'

import { validateAvatar } from '../avatars.ts'
import { ApiErrorCode } from '../error-codes.ts'
import type { FarmiesApp } from '../http.ts'
import type { Operations } from '../operations.ts'
import { bigintIdSchema } from './validation.ts'

export const registerAvatarRoutes = (app: FarmiesApp, operations: Operations) => {
  app.use('/parties/current/avatars/*', bodyLimit({
    maxSize: 524_288,
    onError: (context) => context.json({ error: ApiErrorCode.AVATAR_TOO_LARGE }, 413),
  }))

  app.on(['GET', 'PUT', 'DELETE'], '/parties/current/avatars/:membershipId', async (context) => {
    const parsedMembershipId = bigintIdSchema.safeParse(context.req.param('membershipId'))
    if (!parsedMembershipId.success) {
      return context.json({ error: ApiErrorCode.INVALID_REQUEST }, 400)
    }

    let bytes: ArrayBuffer | undefined
    if (context.req.method === 'PUT') {
      if (context.req.header('Content-Type') !== 'image/webp') {
        return context.json({ error: ApiErrorCode.AVATAR_MEDIA_TYPE }, 415)
      }
      bytes = await context.req.arrayBuffer()
      if (!validateAvatar(bytes)) return context.json({ error: ApiErrorCode.INVALID_AVATAR }, 400)
    }

    context.header('Cache-Control', 'private, no-store')
    try {
      const result = await operations.manageAvatar(context.env, context.get('authUserId'), {
        membershipId: BigInt(parsedMembershipId.data),
        action: context.req.method === 'PUT'
          ? 'save'
          : context.req.method === 'DELETE' ? 'delete' : 'read',
        bytes,
      })
      if (result.status === 'not_found') {
        return context.json({ error: ApiErrorCode.AVATAR_NOT_FOUND }, 404)
      }
      if (result.status === 'forbidden') {
        return context.json({ error: ApiErrorCode.AVATAR_OWNER_REQUIRED }, 403)
      }
      if (result.status === 'cleanup_pending') {
        return context.json({ error: ApiErrorCode.AVATAR_DELETE_RETRY }, 503)
      }
      if (result.status === 'deleted') return context.body(null, 204)
      if (result.status === 'saved') return context.json({ version: result.version })
      if (result.status !== 'read') throw new Error('Unexpected avatar result')
      context.header('Content-Type', 'image/webp')
      context.header('X-Content-Type-Options', 'nosniff')
      return context.body(result.bytes)
    } catch {
      return context.json({ error: ApiErrorCode.AVATAR_OPERATION_FAILED }, 500)
    }
  })
}
