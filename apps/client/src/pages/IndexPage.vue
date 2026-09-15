<template>
  <div class="farmies-page column items-center q-pa-md q-pa-sm-xl">
    <app-header />
    <main class="column items-center full-width">
      <invite-continuation
        v-if="inviteToken"
        class="q-mt-lg"
        :token="inviteToken"
      />
      <party-creation-form
        v-else-if="session.user"
        class="q-mt-lg"
      />
      <email-code-form
        v-else
        class="q-mt-lg"
      />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import EmailCodeForm from '../components/EmailCodeForm.vue'
import InviteContinuation from '../components/InviteContinuation.vue'
import PartyCreationForm from '../components/PartyCreationForm.vue'
import AppHeader from '../components/AppHeader.vue'
import { useSessionStore } from '../stores/session'

const session = useSessionStore()
const route = useRoute()
const inviteToken = computed(() => typeof route.params.token === 'string' ? route.params.token : '')

</script>
