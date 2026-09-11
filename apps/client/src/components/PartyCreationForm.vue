<template>
  <q-card class="party-card farmies-card">
    <q-card-section>
      <template v-if="session.party">
        <h2 class="text-h5 q-my-sm">
          {{ t('party.welcome', { name: session.party.party.displayName }) }}
        </h2>
        <p role="status">
          {{ t('party.created', { nickname: session.party.membership.nickname }) }}
        </p>
      </template>

      <q-form
        v-else
        class="q-gutter-md"
        @submit="createParty"
      >
        <h2 class="text-h5 q-my-sm">
          {{ t('party.create') }}
        </h2>
        <p>{{ t('party.introduction') }}</p>
        <q-input
          v-model="displayName"
          outlined
          autofocus
          maxlength="60"
          :label="t('party.name')"
          :rules="nameRules"
          lazy-rules="ondemand"
        />
        <q-input
          v-model="nickname"
          outlined
          maxlength="40"
          autocomplete="nickname"
          :label="t('party.nickname')"
          :rules="nicknameRules"
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
          :label="t('party.create')"
          :loading="loading"
        />
      </q-form>

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
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { nicknameSchema, partyNameSchema, useSessionStore } from '../stores/session'

const { t } = useI18n()
const session = useSessionStore()
const displayName = ref('')
const nickname = ref('')
const loading = ref(false)
const actionError = ref<'party.alreadyMember' | 'party.createError' | null>(null)

const nameRules = computed(() => [
  (value: string) => partyNameSchema.safeParse(value).success || t('party.nameInvalid'),
])
const nicknameRules = computed(() => [
  (value: string) => nicknameSchema.safeParse(value).success || t('party.nicknameInvalid'),
])

const createParty = async () => {
  loading.value = true
  actionError.value = null
  try {
    await session.createParty(displayName.value, nickname.value)
  } catch (error) {
    actionError.value = error instanceof Error && error.message === 'ALREADY_IN_PARTY'
      ? 'party.alreadyMember'
      : 'party.createError'
  } finally {
    loading.value = false
  }
}

const signOut = async () => {
  loading.value = true
  try {
    await session.signOut()
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.party-card {
  width: min(100%, 28rem);
}
</style>
