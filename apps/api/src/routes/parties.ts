import { z } from 'zod'

import { ApiErrorCode } from '../error-codes.ts'
import type { FarmiesApp } from '../http.ts'
import { unauthorized } from '../http.ts'
import type { Operations } from '../operations.ts'
import type { PartyMembership, PartySummary } from '../parties.ts'
import { bigintIdSchema } from './validation.ts'

const partyRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(60),
  nickname: z.string().trim().min(1).max(40),
}).strict()

const transferRequestSchema = z.object({
  successorMembershipId: bigintIdSchema,
}).strict()

export const serializePartyMembership = ({
  party,
  membership,
  isOwner,
  inviteActive,
}: PartyMembership) => ({
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
  isOwner,
  inviteActive,
})

const serializePartySummary = (party: PartySummary) => ({
  id: party.id.toString(),
  displayName: party.displayName,
  membershipId: party.membershipId.toString(),
  nickname: party.nickname,
  role: party.role,
  occupancy: party.occupancy,
  species: party.species,
  environment: party.environment,
  joinedAt: party.joinedAt.toISOString(),
})

export const registerPartyRoutes = (app: FarmiesApp, operations: Operations) => {
  app.get('/parties/current/scene', async (context) => {
    context.header('Cache-Control', 'private, no-store')
    context.header('Date', new Date().toUTCString())
    try {
      const scene = await operations.findScene(context.env, context.get('authUserId'))
      if (!scene) return context.json({ error: ApiErrorCode.PARTY_NOT_FOUND }, 404)
      return context.json(scene)
    } catch {
      return context.json({ error: ApiErrorCode.SCENE_LOAD_FAILED }, 500)
    }
  })

  app.get('/parties/:partyId/scene', async (context) => {
    const parsedPartyId = bigintIdSchema.safeParse(context.req.param('partyId'))
    if (!parsedPartyId.success) return context.json({ error: ApiErrorCode.INVALID_REQUEST }, 400)

    context.header('Cache-Control', 'private, no-store')
    context.header('Date', new Date().toUTCString())
    try {
      const scene = await operations.findScene(
        context.env,
        context.get('authUserId'),
        BigInt(parsedPartyId.data),
      )
      if (!scene) return context.json({ error: ApiErrorCode.PARTY_NOT_FOUND }, 404)
      return context.json(scene)
    } catch {
      return context.json({ error: ApiErrorCode.SCENE_LOAD_FAILED }, 500)
    }
  })

  app.post('/parties', async (context) => {
    const body = await context.req.json().catch(() => undefined)
    const input = partyRequestSchema.safeParse(body)
    if (!input.success) return context.json({ error: ApiErrorCode.INVALID_REQUEST }, 400)

    try {
      const result = await operations.createParty(context.env, context.get('authUserId'), input.data)
      if (result.status === 'user_not_found') return unauthorized()
      if (result.status === 'membership_limit') {
        return context.json({ error: ApiErrorCode.PARTY_MEMBERSHIP_LIMIT }, 409)
      }
      if (result.status === 'ownership_limit') {
        return context.json({ error: ApiErrorCode.PARTY_OWNERSHIP_LIMIT }, 409)
      }
      if (result.status !== 'created') throw new Error('Unexpected Party creation result')
      return context.json(serializePartyMembership(result.value), 201)
    } catch {
      return context.json({ error: ApiErrorCode.PARTY_CREATION_FAILED }, 500)
    }
  })

  app.get('/parties', async (context) => {
    try {
      const results = await operations.findParties(context.env, context.get('authUserId'))
      return context.json({ parties: results.map(serializePartySummary) })
    } catch {
      return context.json({ error: ApiErrorCode.PARTY_LOAD_FAILED }, 500)
    }
  })

  app.get('/parties/current', async (context) => {
    try {
      const party = await operations.findCurrentParty(context.env, context.get('authUserId'))
      if (!party) return context.json({ error: ApiErrorCode.PARTY_NOT_FOUND }, 404)
      return context.json(serializePartyMembership(party))
    } catch {
      return context.json({ error: ApiErrorCode.PARTY_LOAD_FAILED }, 500)
    }
  })

  app.delete('/parties/current', async (context) => {
    try {
      const result = await operations.deleteParty(context.env, context.get('authUserId'))
      if (result.status === 'owner_required') {
        return context.json({ error: ApiErrorCode.PARTY_OWNER_REQUIRED }, 403)
      }
      if (result.status === 'transfer_required') {
        return context.json({ error: ApiErrorCode.PARTY_TRANSFER_REQUIRED }, 409)
      }
      if (result.status === 'cleanup_pending') {
        return context.json({ error: ApiErrorCode.PARTY_DELETE_RETRY }, 503)
      }
      return context.body(null, 204)
    } catch {
      return context.json({ error: ApiErrorCode.PARTY_DELETE_FAILED }, 500)
    }
  })

  app.post('/parties/current/invite', async (context) => {
    try {
      const result = await operations.manageInvite(context.env, context.get('authUserId'), 'replace')
      if (result.status === 'owner_required') {
        return context.json({ error: ApiErrorCode.PARTY_OWNER_REQUIRED }, 403)
      }
      if (result.status !== 'created') throw new Error('Unexpected invite result')

      const inviteUrl = new URL(`/invite/${result.token}`, context.env.CLIENT_ORIGIN).toString()
      return context.json({ inviteUrl, expiresAt: result.expiresAt.toISOString() }, 201)
    } catch {
      return context.json({ error: ApiErrorCode.INVITE_UPDATE_FAILED }, 500)
    }
  })

  app.delete('/parties/current/invite', async (context) => {
    try {
      const result = await operations.manageInvite(context.env, context.get('authUserId'), 'revoke')
      if (result.status === 'owner_required') {
        return context.json({ error: ApiErrorCode.PARTY_OWNER_REQUIRED }, 403)
      }
      if (result.status !== 'revoked') throw new Error('Unexpected invite result')
      return context.body(null, 204)
    } catch {
      return context.json({ error: ApiErrorCode.INVITE_UPDATE_FAILED }, 500)
    }
  })

  app.delete('/parties/current/membership', async (context) => {
    try {
      const result = await operations.leaveParty(context.env, context.get('authUserId'))
      if (result.status === 'owner_required') {
        return context.json({ error: ApiErrorCode.PARTY_OWNER_REQUIRED }, 403)
      }
      if (result.status === 'cleanup_pending') {
        return context.json({ error: ApiErrorCode.MEMBERSHIP_DELETE_RETRY }, 503)
      }
      return context.body(null, 204)
    } catch {
      return context.json({ error: ApiErrorCode.MEMBERSHIP_DELETE_FAILED }, 500)
    }
  })

  app.get('/parties/current/transfer-candidates', async (context) => {
    try {
      const result = await operations.findTransferCandidates(context.env, context.get('authUserId'))
      if (result.status === 'owner_required') {
        return context.json({ error: ApiErrorCode.PARTY_OWNER_REQUIRED }, 403)
      }
      return context.json({
        members: result.members.map((member) => ({
          membershipId: member.membershipId.toString(),
          nickname: member.nickname,
        })),
      })
    } catch {
      return context.json({ error: ApiErrorCode.PARTY_LOAD_FAILED }, 500)
    }
  })

  app.patch('/parties/current/owner', async (context) => {
    const body = await context.req.json().catch(() => undefined)
    const input = transferRequestSchema.safeParse(body)
    if (!input.success) return context.json({ error: ApiErrorCode.INVALID_REQUEST }, 400)

    try {
      const result = await operations.transferParty(
        context.env,
        context.get('authUserId'),
        BigInt(input.data.successorMembershipId),
      )
      if (result.status === 'owner_required') {
        return context.json({ error: ApiErrorCode.PARTY_OWNER_REQUIRED }, 403)
      }
      if (result.status === 'successor_not_available') {
        return context.json({ error: ApiErrorCode.PARTY_SUCCESSOR_NOT_AVAILABLE }, 404)
      }
      if (result.status === 'successor_ownership_limit') {
        return context.json({ error: ApiErrorCode.PARTY_SUCCESSOR_OWNERSHIP_LIMIT }, 409)
      }
      return context.body(null, 204)
    } catch {
      return context.json({ error: ApiErrorCode.PARTY_TRANSFER_FAILED }, 500)
    }
  })

  app.get('/parties/:partyId', async (context) => {
    const parsedPartyId = bigintIdSchema.safeParse(context.req.param('partyId'))
    if (!parsedPartyId.success) return context.json({ error: ApiErrorCode.INVALID_REQUEST }, 400)

    try {
      const party = await operations.findPartyById(
        context.env,
        context.get('authUserId'),
        BigInt(parsedPartyId.data),
      )
      if (!party) return context.json({ error: ApiErrorCode.PARTY_NOT_FOUND }, 404)
      return context.json({ party: serializePartySummary(party) })
    } catch {
      return context.json({ error: ApiErrorCode.PARTY_LOAD_FAILED }, 500)
    }
  })
}
