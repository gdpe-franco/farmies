<template>
  <header class="farmies-header">
    <q-toolbar class="farmies-toolbar q-pa-md">
      <q-toolbar-title>
        <h1 class="farmies-wordmark text-h4 q-my-none">
          Farmies
        </h1>
      </q-toolbar-title>
      <div class="farmies-preferences">
        <preference-menu
          :label="t('theme.label')"
          :selected-label="t(`theme.${theme.mode}`)"
          :model-value="theme.mode"
          :options="themeOptions"
          @select="theme.select"
        />
        <preference-menu
          :label="t('language.label')"
          :selected-label="locale.currentLanguage.label"
          :model-value="locale.locale"
          :options="languages"
          @select="locale.select"
        />
      </div>
    </q-toolbar>
    <q-banner
      v-if="locale.syncFailed"
      class="bg-negative text-white q-ma-md"
      role="alert"
    >
      {{ t('preferences.syncError') }}
    </q-banner>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { languageOptions } from '../i18n/messages'
import { useLocaleStore } from '../stores/locale'
import { themeModes, useThemeStore } from '../stores/theme'
import PreferenceMenu from './PreferenceMenu.vue'

const { t } = useI18n()
const locale = useLocaleStore()
const theme = useThemeStore()
const languages = languageOptions.map((option) => ({ ...option, lang: option.value }))
const themeOptions = computed(() => themeModes.map((value) => ({ value, label: t(`theme.${value}`) })))
</script>
