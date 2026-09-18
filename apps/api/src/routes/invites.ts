import { ApiErrorCode } from '../error-codes.ts'
import type { FarmiesApp } from '../http.ts'
import { hashInviteToken } from '../invites.ts'
import type { Operations } from '../operations.ts'
import { PARTY_LIMITS } from '../party-limits.ts'

export const registerInviteRoutes = (app: FarmiesApp, operations: Operations) => {
  app.get('/invites/:token', async (context) => {
    const token = context.req.param('token')
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      return context.json({ error: ApiErrorCode.INVITE_NOT_AVAILABLE }, 404)
    }

    try {
      const preview = await operations.findInvitePreview(context.env, await hashInviteToken(token))
      if (!preview) return context.json({ error: ApiErrorCode.INVITE_NOT_AVAILABLE }, 404)
      return context.json({ party: { ...preview, capacity: PARTY_LIMITS.activeMembersPerParty } })
    } catch {
      return context.json({ error: ApiErrorCode.INVITE_LOAD_FAILED }, 500)
    }
  })
}
