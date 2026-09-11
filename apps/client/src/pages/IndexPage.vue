<template>
  <q-page class="column flex-center q-pa-lg text-center">
    <h1 class="text-h2 q-my-sm">
      Farmies
    </h1>
    <p class="text-body1">
      {{ t('home.ready') }}
    </p>
    <label
      for="locale"
      class="text-body2 q-mt-md"
    >{{ t('language.label') }}</label>
    <select
      id="locale"
      class="q-pa-sm q-mt-xs"
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
  </q-page>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { isLocale } from '../i18n/messages'
import { useLocaleStore } from '../stores/locale'

const { t } = useI18n()
const localeStore = useLocaleStore()

const changeLocale = (event: Event) => {
  const value = (event.target as HTMLSelectElement).value
  if (isLocale(value)) void localeStore.select(value)
}
</script>
