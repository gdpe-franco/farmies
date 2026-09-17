<template>
  <q-card class="party-card farmies-card">
    <q-card-section>
      <div
        v-if="loadingParty"
        class="row items-center q-gutter-sm"
        aria-live="polite"
        aria-busy="true"
      >
        <q-spinner
          color="primary"
          size="2em"
        />
        <span>{{ t('party.loading') }}</span>
      </div>

      <template v-else-if="session.party">
        <h2 class="text-h5 q-my-sm">
          {{ t('party.welcome', { name: session.party.party.displayName }) }}
        </h2>
        <p>
          {{ t('party.membership', { nickname: session.party.membership.nickname }) }}
        </p>

        <farm-scene
          :key="session.party.membership.id"
          :revision="sceneRevision"
        />
        <avatar-setup
          :key="session.party.membership.id"
          @changed="sceneRevision++"
        />

        <q-dialog v-model="leaveDialog">
          <q-card class="farmies-card">
            <q-card-section>
              <h3 class="text-h6 q-my-sm">
                {{ t('confirmation.leave') }}
              </h3>
              <p>{{ t('party.leaveDescription') }}</p>
            </q-card-section>
            <q-card-actions align="right">
              <q-btn
                v-close-popup
                flat
                :label="t('party.keepMembership')"
              />
              <q-btn
                color="negative"
                :label="t('party.leave')"
                :loading="loading"
                @click="leaveParty"
              />
            </q-card-actions>
          </q-card>
        </q-dialog>

        <section
          v-if="session.party.isOwner"
          class="farmies-panel q-mt-md"
        >
          <h3 class="text-h6 q-mb-sm">
            {{ t('invite.title') }}
          </h3>
          <p>{{ t('invite.introduction') }}</p>
          <q-input
            v-if="session.invite"
            outlined
            readonly
            :model-value="session.invite.inviteUrl"
            :label="t('invite.link')"
          />
          <p
            v-if="session.invite"
            class="text-caption"
          >
            {{ t('invite.expires', { date: formattedExpiry }) }}
          </p>
          <p v-else-if="session.party.inviteActive">
            {{ t('invite.activeHidden') }}
          </p>
          <q-banner
            v-if="inviteMessage"
            :class="inviteMessage.error ? 'bg-negative text-white' : 'bg-positive text-white'"
            :role="inviteMessage.error ? 'alert' : 'status'"
          >
            {{ t(inviteMessage.key) }}
          </q-banner>
          <div class="row q-gutter-sm q-mt-md">
            <q-btn
              color="primary"
              :label="session.party.inviteActive ? t('invite.replace') : t('invite.create')"
              :loading="loading"
              @click="replaceInvite"
            />
            <q-btn
              v-if="session.invite"
              outline
              color="primary"
              :label="t('invite.copy')"
              :disable="loading"
              @click="copyInvite"
            />
            <q-btn
              v-if="session.party.inviteActive"
              flat
              color="negative"
              :label="t('invite.revoke')"
              :disable="loading"
              @click="revokeInvite"
            />
          </div>
        </section>

        <section
          v-if="session.party.isOwner"
          class="farmies-panel q-mt-md"
        >
          <h3 class="text-h6 q-mb-sm">
            {{ t('ownership.title') }}
          </h3>
          <p>{{ t('ownership.introduction') }}</p>
          <q-banner
            v-if="ownershipError"
            class="bg-negative text-white q-mb-md"
            role="alert"
          >
            {{ t(ownershipError) }}
          </q-banner>
          <template v-if="session.transferCandidates.length">
            <q-select
              v-model="successorMembershipId"
              outlined
              emit-value
              map-options
              :options="session.transferCandidates"
              option-label="nickname"
              option-value="membershipId"
              dropdown-icon="M7 10l5 5 5-5z"
              :label="t('ownership.successor')"
            />
            <q-btn
              class="q-mt-md"
              color="primary"
              :label="t('ownership.transfer')"
              :disable="!successorMembershipId || loading"
              @click="ownershipDialog = true"
            />
          </template>
          <p v-else-if="!ownershipError">
            {{ t('ownership.empty') }}
          </p>
        </section>

        <q-dialog v-model="ownershipDialog">
          <q-card class="farmies-card">
            <q-card-section>
              <h3 class="text-h6 q-my-sm">
                {{ t('confirmation.transfer') }}
              </h3>
              <p>{{ t('ownership.confirm', { nickname: selectedSuccessor?.nickname }) }}</p>
            </q-card-section>
            <q-card-actions align="right">
              <q-btn
                v-close-popup
                flat
                :label="t('ownership.cancel')"
              />
              <q-btn
                color="primary"
                :label="t('ownership.transfer')"
                :loading="loading"
                @click="transferOwnership"
              />
            </q-card-actions>
          </q-card>
        </q-dialog>

        <div class="row items-center q-gutter-sm q-mt-md">
          <q-btn
            v-if="!session.party.isOwner"
            flat
            color="negative"
            :label="t('party.leave')"
            :disable="loading"
            @click="leaveDialog = true"
          />
          <q-btn
            flat
            no-caps
            :label="t('authentication.signOut')"
            :disable="loading"
            @click="signOut"
          />
        </div>
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
          v-if="actionError === 'party.leaveCleanupError'"
          outline
          color="negative"
          :label="t('party.retryLeaveCleanup')"
          :loading="loading"
          @click="leaveParty"
        />
        <q-btn
          class="full-width"
          color="primary"
          type="submit"
          :label="t('party.create')"
          :loading="loading"
        />
      </q-form>

      <q-btn
        v-if="!session.party"
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
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AvatarSetup from './AvatarSetup.vue'
import FarmScene from './FarmScene.vue'
import { AppErrorCode } from '../error-codes.ts'
import { nicknameSchema, partyNameSchema, useSessionStore } from '../stores/session'

const { locale, t } = useI18n()
const session = useSessionStore()
const sceneRevision = ref(0)
const displayName = ref('')
const nickname = ref('')
const loading = ref(false)
const loadingParty = ref(true)
const leaveDialog = ref(false)
const ownershipDialog = ref(false)
const successorMembershipId = ref<string | null>(null)
const ownershipError = ref<'ownership.loadError' | 'ownership.staleError' | 'ownership.transferError' | null>(null)
const actionError = ref<
  'party.alreadyMember' | 'party.createError' | 'party.loadError' | 'party.leaveError' | 'party.leaveCleanupError' | null
>(null)
const inviteMessage = ref<{
  error: boolean
  key: 'invite.copied' | 'invite.copyError' | 'invite.updateError'
} | null>(null)

const nameRules = computed(() => [
  (value: string) => partyNameSchema.safeParse(value).success || t('party.nameInvalid'),
])
const nicknameRules = computed(() => [
  (value: string) => nicknameSchema.safeParse(value).success || t('party.nicknameInvalid'),
])
const formattedExpiry = computed(() => session.invite
  ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' })
      .format(new Date(session.invite.expiresAt))
  : '',
)
const selectedSuccessor = computed(() => session.transferCandidates.find(
  ({ membershipId }) => membershipId === successorMembershipId.value,
))

const createParty = async () => {
  loading.value = true
  actionError.value = null
  try {
    await session.createParty(displayName.value, nickname.value)
  } catch (error) {
    actionError.value = error instanceof Error && error.message === AppErrorCode.ALREADY_IN_PARTY
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

const replaceInvite = async () => {
  loading.value = true
  inviteMessage.value = null
  try {
    await session.replaceInvite()
  } catch {
    inviteMessage.value = { error: true, key: 'invite.updateError' }
  } finally {
    loading.value = false
  }
}

const revokeInvite = async () => {
  loading.value = true
  inviteMessage.value = null
  try {
    await session.revokeInvite()
  } catch {
    inviteMessage.value = { error: true, key: 'invite.updateError' }
  } finally {
    loading.value = false
  }
}

const leaveParty = async () => {
  loading.value = true
  actionError.value = null
  try {
    await session.leaveParty()
    leaveDialog.value = false
  } catch (error) {
    actionError.value = error instanceof Error && error.message === AppErrorCode.PARTY_LEAVE_CLEANUP_PENDING
      ? 'party.leaveCleanupError'
      : 'party.leaveError'
    if (!session.party) leaveDialog.value = false
  } finally {
    loading.value = false
  }
}

const transferOwnership = async () => {
  if (!successorMembershipId.value) return
  loading.value = true
  ownershipError.value = null
  try {
    await session.transferOwnership(successorMembershipId.value)
    ownershipDialog.value = false
  } catch (error) {
    if (error instanceof Error && error.message === AppErrorCode.PARTY_SUCCESSOR_NOT_AVAILABLE) {
      ownershipError.value = 'ownership.staleError'
      successorMembershipId.value = null
      await session.loadTransferCandidates().catch(() => {
        ownershipError.value = 'ownership.loadError'
      })
    } else ownershipError.value = 'ownership.transferError'
  } finally {
    loading.value = false
  }
}

const copyInvite = async () => {
  if (!session.invite) return
  try {
    await navigator.clipboard.writeText(session.invite.inviteUrl)
    inviteMessage.value = { error: false, key: 'invite.copied' }
  } catch {
    inviteMessage.value = { error: true, key: 'invite.copyError' }
  }
}

onMounted(async () => {
  try {
    await session.loadParty()
    if (session.party?.isOwner) await session.loadTransferCandidates()
  } catch {
    if (session.party?.isOwner) ownershipError.value = 'ownership.loadError'
    else actionError.value = 'party.loadError'
  } finally {
    loadingParty.value = false
  }
})
</script>

<style scoped>
.party-card {
  width: min(100%, 56rem);
}
</style>
