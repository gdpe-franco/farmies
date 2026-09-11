import { createClient } from '@supabase/supabase-js'
import { defineBoot } from '@quasar/app-vite'
import { z } from 'zod'

import { useSessionStore } from '../stores/session'

const config = z.object({
  QCLI_API_URL: z.url(),
  QCLI_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  QCLI_SUPABASE_URL: z.url(),
}).parse(import.meta.env)

export const supabase = createClient(
  config.QCLI_SUPABASE_URL,
  config.QCLI_SUPABASE_PUBLISHABLE_KEY,
)

export default defineBoot(async ({ store }) => {
  await useSessionStore(store).initialize(supabase.auth, config.QCLI_API_URL)
})
