import { z } from 'zod'

import { AppErrorCode } from './error-codes.ts'

type Request = (path: string, init?: RequestInit) => Promise<Response>
const path = (membershipId: string) => `/parties/current/avatars/${membershipId}`

export const loadAvatar = async (request: Request, membershipId: string) => {
  const response = await request(path(membershipId))
  if (response.status === 404) return null
  if (!response.ok || response.headers.get('Content-Type') !== 'image/webp') {
    throw new Error(AppErrorCode.AVATAR_LOAD_FAILED)
  }
  return response.blob()
}

export const saveAvatar = async (request: Request, membershipId: string, bytes: Blob) => {
  const response = await request(path(membershipId), {
    method: 'PUT', headers: { 'Content-Type': 'image/webp' }, body: bytes,
  })
  if (!response.ok) throw new Error(AppErrorCode.AVATAR_SAVE_FAILED)
  return z.object({ version: z.number().int().positive() }).parse(await response.json()).version
}

export const deleteAvatar = async (request: Request, membershipId: string) => {
  const response = await request(path(membershipId), { method: 'DELETE' })
  if (response.status === 503) throw new Error(AppErrorCode.AVATAR_DELETE_RETRY)
  if (!response.ok) throw new Error(AppErrorCode.AVATAR_DELETE_FAILED)
}
