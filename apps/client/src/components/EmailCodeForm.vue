<template>
  <q-card class="auth-card farmies-card">
    <q-card-section>
      <h2 class="text-h5 q-my-sm">
        {{ t('authentication.title') }}
      </h2>

      <div
        v-if="session.isAuthenticated && !session.error"
        class="row items-center q-gutter-sm"
        aria-live="polite"
        aria-busy="true"
      >
        <q-spinner
          color="primary"
          size="2em"
        />
        <span>{{ t('authentication.loadingAccount') }}</span>
      </div>

      <template v-else-if="session.isAuthenticated">
        <q-banner
          class="bg-negative text-white q-mb-md"
          role="alert"
        >
          {{ t('authentication.accountError') }}
        </q-banner>
        <q-btn
          color="primary"
          :label="t('authentication.startOver')"
          :loading="loading"
          @click="signOut"
        />
      </template>

      <q-form
        v-else-if="session.pendingEmail"
        class="q-gutter-md"
        @submit="verifyCode"
      >
        <p role="status">
          {{ t('authentication.codeSent', { email: session.pendingEmail }) }}
        </p>
        <q-input
          v-model="code"
          outlined
          autofocus
          autocomplete="one-time-code"
          inputmode="numeric"
          mask="######"
          unmasked-value
          :label="t('authentication.code')"
          :rules="codeRules"
          lazy-rules="ondemand"
        />
        <q-banner
          v-if="actionError"
          class="bg-negative text-white"
          role="alert"
        >
          {{ t(actionError) }}
        </q-banner>
        <q-btn
          class="full-width"
          color="primary"
          type="submit"
          :label="t('authentication.verifyCode')"
          :loading="loading"
        />
        <div class="row justify-between items-center">
          <q-btn
            flat
            no-caps
            :disable="loading || remainingSeconds > 0"
            :label="remainingSeconds > 0
              ? t('authentication.resendIn', { seconds: remainingSeconds })
              : t('authentication.resendCode')"
            @click="sendCode(session.pendingEmail)"
          />
          <q-btn
            flat
            no-caps
            :disable="loading"
            :label="t('authentication.changeEmail')"
            @click="changeEmail"
          />
        </div>
      </q-form>

      <q-form
        v-else
        class="q-gutter-md"
        @submit="sendCode(email)"
      >
        <p>{{ t('authentication.introduction') }}</p>
        <q-input
          v-model="email"
          outlined
          autofocus
          type="email"
          autocomplete="email"
          autocapitalize="none"
          spellcheck="false"
          :label="t('authentication.email')"
          :rules="emailRules"
          lazy-rules="ondemand"
        />
        <q-banner
          v-if="actionError"
          class="bg-negative text-white"
          role="alert"
        >
          {{ t(actionError) }}
        </q-banner>
        <q-btn
          class="full-width"
          color="primary"
          type="submit"
          :label="t('authentication.requestCode')"
          :loading="loading"
        />
      </q-form>
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { emailCodeSchema, emailSchema, useSessionStore } from '../stores/session'

const { t } = useI18n()
const session = useSessionStore()
const email = ref('')
const code = ref('')
const loading = ref(false)
const actionError = ref<'authentication.requestError' | 'authentication.verifyError' | null>(null)
const now = ref(Date.now())
const timer = setInterval(() => { now.value = Date.now() }, 1_000)

const remainingSeconds = computed(() =>
  Math.max(0, Math.ceil((session.resendAvailableAt - now.value) / 1_000)),
)
const emailRules = computed(() => [
  (value: string) => emailSchema.safeParse(value).success || t('authentication.emailInvalid'),
])
const codeRules = computed(() => [
  (value: string) => emailCodeSchema.safeParse(value).success || t('authentication.codeInvalid'),
])

const sendCode = async (value: string) => {
  loading.value = true
  actionError.value = null
  try {
    await session.requestEmailCode(value)
    now.value = Date.now()
  } catch {
    actionError.value = 'authentication.requestError'
  } finally {
    loading.value = false
  }
}

const verifyCode = async () => {
  loading.value = true
  actionError.value = null
  try {
    await session.verifyEmailCode(code.value)
  } catch {
    actionError.value = 'authentication.verifyError'
  } finally {
    loading.value = false
  }
}

const changeEmail = () => {
  code.value = ''
  actionError.value = null
  session.changeEmail()
}

const signOut = async () => {
  loading.value = true
  actionError.value = null
  try {
    await session.signOut()
  } finally {
    loading.value = false
  }
}

onBeforeUnmount(() => clearInterval(timer))
</script>

<style scoped>
.auth-card {
  width: min(100%, 28rem);
}
</style>
