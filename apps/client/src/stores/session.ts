import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { z } from 'zod'

import type { Locale } from '../i18n/messages'

type AuthClient = Pick<SupabaseClient['auth'], 'getSession' | 'onAuthStateChange' | 'signOut'>
type SessionError = 'SESSION_RESTORE_FAILED' | 'USER_LOAD_FAILED'

const userResponseSchema = z.object({
  user: z.object({
    id: z.string().regex(/^\d+$/),
    preferredLocale: z.enum(['en', 'es']),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
})

export const useSessionStore = defineStore('session', () => {
  const accessToken = ref<string | null>(null)
  const user = ref<z.infer<typeof userResponseSchema>['user'] | null>(null)
  const initialized = ref(false)
  const error = ref<SessionError | null>(null)
  const isAuthenticated = computed(() => accessToken.value !== null)

  let auth: AuthClient | undefined
  let apiUrl = ''
  let fetcher: typeof fetch = fetch

  const clear = () => {
    accessToken.value = null
    user.value = null
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

  return {
    accessToken,
    user,
    initialized,
    error,
    isAuthenticated,
    initialize,
    request,
    signOut,
    updateLocale,
  }
})
