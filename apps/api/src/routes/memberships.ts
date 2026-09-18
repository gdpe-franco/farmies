import { z } from 'zod'

import { ApiErrorCode } from '../error-codes.ts'
import type { FarmiesApp } from '../http.ts'
import { unauthorized } from '../http.ts'
import { hashInviteToken } from '../invites.ts'
import type { Operations } from '../operations.ts'
import { serializePartyMembership } from './parties.ts'

const membershipRequestSchema = z.object({
  inviteToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  nickname: z.string().trim().min(1).max(40),
}).strict()

export const registerMembershipRoutes = (app: FarmiesApp, operations: Operations) => {
  app.post('/memberships', async (context) => {
    const body = await context.req.json().catch(() => undefined)
    const input = membershipRequestSchema.safeParse(body)
    if (!input.success) return context.json({ error: ApiErrorCode.INVALID_REQUEST }, 400)

    try {
      const result = await operations.joinParty(context.env, context.get('authUserId'), {
        inviteTokenHash: await hashInviteToken(input.data.inviteToken),
        nickname: input.data.nickname,
      })
      if (result.status === 'user_not_found') return unauthorized()
      if (result.status === 'invite_not_available') {
        return context.json({ error: ApiErrorCode.INVITE_NOT_AVAILABLE }, 404)
      }
      if (result.status === 'membership_limit') {
        return context.json({ error: ApiErrorCode.PARTY_MEMBERSHIP_LIMIT }, 409)
      }
      if (result.status !== 'joined' && result.status !== 'already_joined') {
        throw new Error('Unexpected Party join result')
      }

      return context.json(
        serializePartyMembership(result.value),
        result.status === 'joined' ? 201 : 200,
      )
    } catch {
      return context.json({ error: ApiErrorCode.PARTY_JOIN_FAILED }, 500)
    }
  })
}
