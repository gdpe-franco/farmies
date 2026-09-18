import type { Hyperdrive, R2Bucket } from '@cloudflare/workers-types'
import type { Hono } from 'hono'

export type Bindings = {
  CLIENT_ORIGIN: string
  HYPERDRIVE: Hyperdrive
  AVATARS: R2Bucket
  SUPABASE_JWKS_URL?: string
  SUPABASE_SERVICE_ROLE_KEY: string
  SUPABASE_URL: string
}

export type Variables = {
  authenticatedAt: number
  authUserId: string
}

export type AppEnv = { Bindings: Bindings; Variables: Variables }
export type FarmiesApp = Hono<AppEnv>

export const unauthorized = () => new Response('Unauthorized', { status: 401 })
