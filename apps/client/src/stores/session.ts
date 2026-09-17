import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { z } from 'zod'

import { AppErrorCode } from '../error-codes.ts'
import type { Locale } from '../i18n/messages'

type AuthClient = Pick<
  SupabaseClient['auth'],
  'getSession' | 'onAuthStateChange' | 'signInWithOtp' | 'signOut' | 'verifyOtp'
>
type SessionError = typeof AppErrorCode.SESSION_RESTORE_FAILED | typeof AppErrorCode.USER_LOAD_FAILED
type InvitePreviewError = typeof AppErrorCode.INVITE_NOT_AVAILABLE | typeof AppErrorCode.INVITE_LOAD_FAILED
type SessionStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>

export type PartyCreationError = typeof AppErrorCode.ALREADY_IN_PARTY | typeof AppErrorCode.PARTY_CREATION_FAILED
export type PartyJoinError = typeof AppErrorCode.ALREADY_IN_PARTY | typeof AppErrorCode.INVITE_NOT_AVAILABLE | typeof AppErrorCode.PARTY_JOIN_FAILED
export type PartyLeaveError = typeof AppErrorCode.PARTY_OWNER_REQUIRED | typeof AppErrorCode.PARTY_LEAVE_CLEANUP_PENDING | typeof AppErrorCode.PARTY_LEAVE_FAILED
export type PartyTransferError = typeof AppErrorCode.PARTY_OWNER_REQUIRED | typeof AppErrorCode.PARTY_SUCCESSOR_NOT_AVAILABLE | typeof AppErrorCode.PARTY_TRANSFER_FAILED

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

const invitePreviewResponseSchema = z.object({
  party: z.object({
    displayName: z.string(),
    occupancy: z.number().int().min(0).max(9),
    capacity: z.literal(10),
  }),
})

const transferCandidatesResponseSchema = z.object({
  members: z.array(z.object({
    membershipId: z.string().regex(/^\d+$/),
    nickname: z.string(),
  })),
})

export const partyNameSchema = z.string().trim().min(1).max(60)
export const nicknameSchema = z.string().trim().min(1).max(40)
export const inviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)

const pendingInviteKey = 'farmies.pendingInviteToken'

export const useSessionStore = defineStore('session', () => {
  const accessToken = ref<string | null>(null)
  const user = ref<z.infer<typeof userResponseSchema>['user'] | null>(null)
  const party = ref<z.infer<typeof partyResponseSchema> | null>(null)
  const invite = ref<z.infer<typeof inviteResponseSchema> | null>(null)
  const invitePreview = ref<z.infer<typeof invitePreviewResponseSchema>['party'] | null>(null)
  const pendingInviteToken = ref<string | null>(null)
  const transferCandidates = ref<z.infer<typeof transferCandidatesResponseSchema>['members']>([])
  const initialized = ref(false)
  const error = ref<SessionError | null>(null)
  const pendingEmail = ref<string | null>(null)
  const resendAvailableAt = ref(0)
  const isAuthenticated = computed(() => accessToken.value !== null)

  let auth: AuthClient | undefined
  let apiUrl = ''
  let fetcher: typeof fetch = fetch
  let storage: SessionStorage | undefined

  const clear = () => {
    accessToken.value = null
    user.value = null
    party.value = null
    invite.value = null
    invitePreview.value = null
    transferCandidates.value = []
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
        error.value = AppErrorCode.USER_LOAD_FAILED
      }
    }
  }

  const initialize = async (
    client: AuthClient,
    baseUrl: string,
    customFetch: typeof fetch = fetch,
    customStorage?: SessionStorage,
  ) => {
    if (auth) return

    auth = client
    apiUrl = baseUrl
    fetcher = customFetch
    storage = customStorage ?? (typeof sessionStorage === 'undefined' ? undefined : sessionStorage)
    const storedToken = storage?.getItem(pendingInviteKey)
    const parsedToken = inviteTokenSchema.safeParse(storedToken)
    pendingInviteToken.value = parsedToken.success ? parsedToken.data : null
    if (storedToken && !parsedToken.success) storage?.removeItem(pendingInviteKey)
    auth.onAuthStateChange((_event, session) => {
      void applySession(session)
    })

    const { data, error: sessionError } = await auth.getSession()
    if (sessionError) {
      initialized.value = true
      error.value = AppErrorCode.SESSION_RESTORE_FAILED
      return
    }

    await applySession(data.session)
  }

  const signOut = async () => {
    if (!auth) return

    const { error: signOutError } = await auth.signOut({ scope: 'local' })
    if (signOutError) throw signOutError
    clear()
    clearPendingInvite()
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
        ? AppErrorCode.ALREADY_IN_PARTY
        : AppErrorCode.PARTY_CREATION_FAILED
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
    if (!response.ok) throw new Error(AppErrorCode.PARTY_LOAD_FAILED)
    party.value = partyResponseSchema.parse(await response.json())
  }

  const replaceInvite = async () => {
    const response = await request('/parties/current/invite', { method: 'POST' })
    if (!response.ok) throw new Error(AppErrorCode.INVITE_UPDATE_FAILED)
    invite.value = inviteResponseSchema.parse(await response.json())
    if (party.value) party.value.inviteActive = true
  }

  const revokeInvite = async () => {
    const response = await request('/parties/current/invite', { method: 'DELETE' })
    if (!response.ok) throw new Error(AppErrorCode.INVITE_UPDATE_FAILED)
    invite.value = null
    if (party.value) party.value.inviteActive = false
  }

  const leaveParty = async () => {
    const response = await request('/parties/current/membership', { method: 'DELETE' })
    if (response.ok || response.status === 503) {
      party.value = null
      invite.value = null
    }
    if (!response.ok) {
      const code: PartyLeaveError = response.status === 403
        ? AppErrorCode.PARTY_OWNER_REQUIRED
        : response.status === 503
          ? AppErrorCode.PARTY_LEAVE_CLEANUP_PENDING
          : AppErrorCode.PARTY_LEAVE_FAILED
      throw new Error(code)
    }
  }

  const loadTransferCandidates = async () => {
    const response = await request('/parties/current/transfer-candidates')
    if (!response.ok) throw new Error(response.status === 403
      ? AppErrorCode.PARTY_OWNER_REQUIRED
      : AppErrorCode.PARTY_TRANSFER_FAILED)
    transferCandidates.value = transferCandidatesResponseSchema.parse(await response.json()).members
  }

  const transferOwnership = async (successorMembershipId: string) => {
    const response = await request('/parties/current/owner', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ successorMembershipId }),
    })
    if (!response.ok) {
      const code: PartyTransferError = response.status === 403
        ? AppErrorCode.PARTY_OWNER_REQUIRED
        : response.status === 404
          ? AppErrorCode.PARTY_SUCCESSOR_NOT_AVAILABLE
          : AppErrorCode.PARTY_TRANSFER_FAILED
      throw new Error(code)
    }
    if (party.value) party.value.isOwner = false
    invite.value = null
    transferCandidates.value = []
  }

  const retainInvite = (value: string) => {
    const token = inviteTokenSchema.parse(value)
    pendingInviteToken.value = token
    invitePreview.value = null
    storage?.setItem(pendingInviteKey, token)
  }

  const clearPendingInvite = () => {
    pendingInviteToken.value = null
    invitePreview.value = null
    storage?.removeItem(pendingInviteKey)
  }

  const loadInvitePreview = async () => {
    if (!pendingInviteToken.value) throw new Error(AppErrorCode.INVITE_NOT_AVAILABLE)
    const response = await request(`/invites/${pendingInviteToken.value}`)
    if (!response.ok) {
      const code: InvitePreviewError = response.status === 404
        ? AppErrorCode.INVITE_NOT_AVAILABLE
        : AppErrorCode.INVITE_LOAD_FAILED
      throw new Error(code)
    }
    invitePreview.value = invitePreviewResponseSchema.parse(await response.json()).party
  }

  const joinParty = async (nicknameValue: string) => {
    if (!pendingInviteToken.value) throw new Error(AppErrorCode.INVITE_NOT_AVAILABLE)
    const nickname = nicknameSchema.parse(nicknameValue)
    const response = await request('/memberships', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteToken: pendingInviteToken.value, nickname }),
    })
    if (!response.ok) {
      const code: PartyJoinError = response.status === 404
        ? AppErrorCode.INVITE_NOT_AVAILABLE
        : response.status === 409
          ? AppErrorCode.ALREADY_IN_PARTY
          : AppErrorCode.PARTY_JOIN_FAILED
      throw new Error(code)
    }

    party.value = partyResponseSchema.parse(await response.json())
    clearPendingInvite()
  }

  return {
    accessToken,
    user,
    party,
    invite,
    invitePreview,
    pendingInviteToken,
    transferCandidates,
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
    leaveParty,
    loadTransferCandidates,
    transferOwnership,
    retainInvite,
    clearPendingInvite,
    loadInvitePreview,
    joinParty,
  }
})
