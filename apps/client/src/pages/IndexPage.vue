<template>
  <main class="farmies-page column items-center q-pa-md q-pa-sm-xl window-height">
    <h1 class="farmies-wordmark text-h2 q-my-sm">
      Farmies
    </h1>
    <label
      for="locale"
      class="text-body2 q-mt-sm"
    >{{ t('language.label') }}</label>
    <select
      id="locale"
      class="farmies-select q-pa-sm q-mt-xs"
      :value="localeStore.locale"
      @change="changeLocale"
    >
      <option value="en">
        {{ t('language.english') }}
      </option>
      <option value="es">
        {{ t('language.spanish') }}
      </option>
    </select>
    <party-creation-form
      v-if="session.user"
      class="q-mt-lg"
    />
    <email-code-form
      v-else
      class="q-mt-lg"
    />
  </main>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import EmailCodeForm from '../components/EmailCodeForm.vue'
import PartyCreationForm from '../components/PartyCreationForm.vue'
import { isLocale } from '../i18n/messages'
import { useLocaleStore } from '../stores/locale'
import { useSessionStore } from '../stores/session'

const { t } = useI18n()
const localeStore = useLocaleStore()
const session = useSessionStore()

const changeLocale = (event: Event) => {
  const value = (event.target as HTMLSelectElement).value
  if (isLocale(value)) void localeStore.select(value)
}
</script>
