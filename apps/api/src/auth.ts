import type { MiddlewareHandler } from 'hono'
import { verifyWithJwks } from 'hono/jwt'
import { z } from 'zod'

import type { Bindings, Variables } from './http.ts'
import { unauthorized } from './http.ts'

const claimsSchema = z.object({
  sub: z.uuid(),
  iat: z.number().int(),
  exp: z.number().int(),
  role: z.literal('authenticated'),
  amr: z.array(z.object({ method: z.string(), timestamp: z.number().int() })).optional().default([]),
})

export const authenticate: MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> = async (
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

    const verifiedClaims = claimsSchema.parse(claims)
    context.set('authUserId', verifiedClaims.sub)
    context.set('authenticatedAt', Math.max(0, ...verifiedClaims.amr.map(({ timestamp }) => timestamp)))
  } catch {
    return unauthorized()
  }

  await next()
}
