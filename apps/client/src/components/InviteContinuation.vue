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
        <q-form
          class="q-gutter-md"
          @submit="joinParty"
        >
          <q-input
            v-model="nickname"
            outlined
            autofocus
            maxlength="40"
            autocomplete="nickname"
            :label="t('party.nickname')"
            :rules="nicknameRules"
            lazy-rules="ondemand"
          />
          <q-banner
            v-if="joinError"
            class="bg-negative text-white"
            role="alert"
          >
            {{ t(joinError) }}
          </q-banner>
          <q-btn
            class="full-width"
            color="primary"
            type="submit"
            :label="t('party.join')"
            :loading="joining"
          />
        </q-form>
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
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { nicknameSchema, useSessionStore } from '../stores/session'
import EmailCodeForm from './EmailCodeForm.vue'

const props = defineProps<{ token: string }>()
const { t } = useI18n()
const router = useRouter()
const session = useSessionStore()
const loading = ref(false)
const joining = ref(false)
const nickname = ref('')
const tokenAvailable = ref(true)
const errorKey = ref<'invite.unavailable' | 'invite.loadError'>('invite.unavailable')
const joinError = ref<'invite.unavailable' | 'party.alreadyMember' | 'party.joinError' | null>(null)
const nicknameRules = computed(() => [
  (value: string) => nicknameSchema.safeParse(value).success || t('party.nicknameInvalid'),
])

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

const joinParty = async () => {
  joining.value = true
  joinError.value = null
  try {
    await session.joinParty(nickname.value)
    await router.replace('/')
  } catch (error) {
    joinError.value = error instanceof Error && error.message === 'INVITE_NOT_AVAILABLE'
      ? 'invite.unavailable'
      : error instanceof Error && error.message === 'ALREADY_IN_PARTY'
        ? 'party.alreadyMember'
        : 'party.joinError'
  } finally {
    joining.value = false
  }
}
</script>

<style scoped>
.invite-card {
  width: min(100%, 28rem);
}
</style>
