<template>
  <q-card
    v-if="!tokenAvailable"
    class="invite-card farmies-card"
  >
    <q-card-section>
      <q-banner
        class="bg-negative text-white"
        role="alert"
      >
        {{ t('invite.unavailable') }}
      </q-banner>
    </q-card-section>
  </q-card>

  <template v-else-if="!session.user">
    <q-card class="invite-card farmies-card q-mb-md">
      <q-card-section>
        <h2 class="text-h5 q-my-sm">
          {{ t('invite.received') }}
        </h2>
        <p>{{ t('invite.signInToContinue') }}</p>
      </q-card-section>
    </q-card>
    <email-code-form />
  </template>

  <q-card
    v-else
    class="invite-card farmies-card"
  >
    <q-card-section>
      <div
        v-if="loading"
        class="row items-center q-gutter-sm"
        aria-live="polite"
        aria-busy="true"
      >
        <q-spinner
          color="primary"
          size="2em"
        />
        <span>{{ t('invite.loading') }}</span>
      </div>

      <template v-else-if="session.invitePreview">
        <h2 class="text-h5 q-my-sm">
          {{ t('confirmation.join') }}
        </h2>
        <h3 class="text-h6 q-my-sm">
          {{ session.invitePreview.displayName }}
        </h3>
        <p>
          {{ t('invite.occupancy', {
            count: session.invitePreview.occupancy,
            capacity: session.invitePreview.capacity,
          }) }}
        </p>
      </template>

      <q-banner
        v-else
        class="bg-negative text-white"
        role="alert"
      >
        {{ t(errorKey) }}
      </q-banner>

      <q-btn
        flat
        no-caps
        class="q-mt-md"
        :label="t('authentication.signOut')"
        :disable="loading"
        @click="signOut"
      />
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useSessionStore } from '../stores/session'
import EmailCodeForm from './EmailCodeForm.vue'

const props = defineProps<{ token: string }>()
const { t } = useI18n()
const session = useSessionStore()
const loading = ref(false)
const tokenAvailable = ref(true)
const errorKey = ref<'invite.unavailable' | 'invite.loadError'>('invite.unavailable')

try {
  session.retainInvite(props.token)
} catch {
  tokenAvailable.value = false
  session.clearPendingInvite()
}

watch(() => session.user, async (user) => {
  if (!user || !session.pendingInviteToken) return
  loading.value = true
  try {
    await session.loadInvitePreview()
  } catch (error) {
    errorKey.value = error instanceof Error && error.message === 'INVITE_NOT_AVAILABLE'
      ? 'invite.unavailable'
      : 'invite.loadError'
  } finally {
    loading.value = false
  }
}, { immediate: true })

const signOut = async () => session.signOut()
</script>

<style scoped>
.invite-card {
  width: min(100%, 28rem);
}
</style>
