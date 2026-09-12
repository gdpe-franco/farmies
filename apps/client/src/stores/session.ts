import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { z } from 'zod'

import type { Locale } from '../i18n/messages'

type AuthClient = Pick<
  SupabaseClient['auth'],
  'getSession' | 'onAuthStateChange' | 'signInWithOtp' | 'signOut' | 'verifyOtp'
>
type SessionError = 'SESSION_RESTORE_FAILED' | 'USER_LOAD_FAILED'

export type PartyCreationError = 'ALREADY_IN_PARTY' | 'PARTY_CREATION_FAILED'

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email())
export const emailCodeSchema = z.string().regex(/^\d{6}$/)

const userResponseSchema = z.object({
  user: z.object({
    id: z.string().regex(/^\d+$/),
    preferredLocale: z.enum(['en', 'es']),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
})

const partyResponseSchema = z.object({
  party: z.object({
    id: z.string().regex(/^\d+$/),
    displayName: z.string(),
    species: z.literal('COW'),
    environment: z.literal('PASTURE'),
    createdAt: z.iso.datetime(),
  }),
  membership: z.object({
    id: z.string().regex(/^\d+$/),
    nickname: z.string(),
    joinedAt: z.iso.datetime(),
  }),
  isOwner: z.boolean(),
  inviteActive: z.boolean(),
})

const inviteResponseSchema = z.object({
  inviteUrl: z.url(),
  expiresAt: z.iso.datetime(),
})

export const partyNameSchema = z.string().trim().min(1).max(60)
export const nicknameSchema = z.string().trim().min(1).max(40)

export const useSessionStore = defineStore('session', () => {
  const accessToken = ref<string | null>(null)
  const user = ref<z.infer<typeof userResponseSchema>['user'] | null>(null)
  const party = ref<z.infer<typeof partyResponseSchema> | null>(null)
  const invite = ref<z.infer<typeof inviteResponseSchema> | null>(null)
  const initialized = ref(false)
  const error = ref<SessionError | null>(null)
  const pendingEmail = ref<string | null>(null)
  const resendAvailableAt = ref(0)
  const isAuthenticated = computed(() => accessToken.value !== null)

  let auth: AuthClient | undefined
  let apiUrl = ''
  let fetcher: typeof fetch = fetch

  const clear = () => {
    accessToken.value = null
    user.value = null
    party.value = null
    invite.value = null
    error.value = null
  }

  const request = async (path: string, init: RequestInit = {}) => {
    if (!accessToken.value) throw new Error('Authentication required')

    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${accessToken.value}`)

    return fetcher(new URL(path, apiUrl), { ...init, headers })
  }

  const applySession = async (session: Session | null) => {
    const token = session?.access_token ?? null
    if (initialized.value && token === accessToken.value) return

    accessToken.value = token
    initialized.value = true
    error.value = null

    if (!token) {
      user.value = null
      return
    }

    try {
      const response = await request('/users/me', { method: 'PUT' })
      if (!response.ok) throw new Error('User request failed')
      const result = userResponseSchema.parse(await response.json())

      if (accessToken.value === token) user.value = result.user
    } catch {
      if (accessToken.value === token) {
        user.value = null
        error.value = 'USER_LOAD_FAILED'
      }
    }
  }

  const initialize = async (client: AuthClient, baseUrl: string, customFetch: typeof fetch = fetch) => {
    if (auth) return

    auth = client
    apiUrl = baseUrl
    fetcher = customFetch
    auth.onAuthStateChange((_event, session) => {
      void applySession(session)
    })

    const { data, error: sessionError } = await auth.getSession()
    if (sessionError) {
      initialized.value = true
      error.value = 'SESSION_RESTORE_FAILED'
      return
    }

    await applySession(data.session)
  }

  const signOut = async () => {
    if (!auth) return

    const { error: signOutError } = await auth.signOut({ scope: 'local' })
    if (signOutError) throw signOutError
    clear()
    pendingEmail.value = null
    resendAvailableAt.value = 0
  }

  const requestEmailCode = async (value: string) => {
    if (!auth) throw new Error('Authentication is not initialized')
    if (Date.now() < resendAvailableAt.value) throw new Error('Email code cooldown is active')

    const email = emailSchema.parse(value)
    const { error: requestError } = await auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    })
    if (requestError) throw requestError

    pendingEmail.value = email
    resendAvailableAt.value = Date.now() + 60_000
  }

  const verifyEmailCode = async (value: string) => {
    if (!auth || !pendingEmail.value) throw new Error('No email code is pending')

    const token = emailCodeSchema.parse(value)
    const { error: verificationError } = await auth.verifyOtp({
      email: pendingEmail.value,
      token,
      type: 'email',
    })
    if (verificationError) throw verificationError
  }

  const changeEmail = () => {
    pendingEmail.value = null
    resendAvailableAt.value = 0
  }

  const updateLocale = async (preferredLocale: Locale) => {
    const response = await request('/users/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferredLocale }),
    })
    if (!response.ok) throw new Error('Locale update failed')
    user.value = userResponseSchema.parse(await response.json()).user
  }

  const createParty = async (displayNameValue: string, nicknameValue: string) => {
    const displayName = partyNameSchema.parse(displayNameValue)
    const nickname = nicknameSchema.parse(nicknameValue)
    const response = await request('/parties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName, nickname }),
    })

    if (!response.ok) {
      const code: PartyCreationError = response.status === 409
        ? 'ALREADY_IN_PARTY'
        : 'PARTY_CREATION_FAILED'
      throw new Error(code)
    }

    party.value = partyResponseSchema.parse(await response.json())
  }

  const loadParty = async () => {
    const response = await request('/parties/current')
    if (response.status === 404) {
      party.value = null
      return
    }
    if (!response.ok) throw new Error('PARTY_LOAD_FAILED')
    party.value = partyResponseSchema.parse(await response.json())
  }

  const replaceInvite = async () => {
    const response = await request('/parties/current/invite', { method: 'POST' })
    if (!response.ok) throw new Error('INVITE_UPDATE_FAILED')
    invite.value = inviteResponseSchema.parse(await response.json())
    if (party.value) party.value.inviteActive = true
  }

  const revokeInvite = async () => {
    const response = await request('/parties/current/invite', { method: 'DELETE' })
    if (!response.ok) throw new Error('INVITE_UPDATE_FAILED')
    invite.value = null
    if (party.value) party.value.inviteActive = false
  }

  return {
    accessToken,
    user,
    party,
    invite,
    initialized,
    error,
    pendingEmail,
    resendAvailableAt,
    isAuthenticated,
    initialize,
    request,
    signOut,
    requestEmailCode,
    verifyEmailCode,
    changeEmail,
    updateLocale,
    createParty,
    loadParty,
    replaceInvite,
    revokeInvite,
  }
})
