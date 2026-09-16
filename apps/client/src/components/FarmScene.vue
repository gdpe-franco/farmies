<template>
  <section
    class="farmies-panel q-mt-lg"
    aria-labelledby="scene-title"
  >
    <h3
      id="scene-title"
      class="text-h6 q-mb-sm"
    >
      {{ t('scene.title') }}
    </h3>
    <p>{{ t('scene.description') }}</p>
    <q-btn
      outline
      color="primary"
      :label="t('scene.refresh')"
      :loading="loading"
      @click="refresh"
    />
    <p
      v-if="loading"
      role="status"
    >
      {{ t('scene.loading') }}
    </p>
    <q-banner
      v-if="failed"
      class="bg-negative text-white q-mt-md"
      role="alert"
    >
      {{ t('scene.error') }}
    </q-banner>
    <p
      v-if="avatarFailed"
      role="status"
    >
      {{ t('scene.avatarError') }}
    </p>
    <div
      ref="host"
      class="scene-canvas q-mt-md"
    />
    <q-list
      v-if="data"
      :aria-label="t('scene.members')"
      class="q-mt-sm"
    >
      <q-item
        v-for="member in data.members"
        :key="member.membershipId"
      >
        <q-item-section>
          <q-item-label>{{ member.nickname }}</q-item-label>
          <q-item-label caption>
            {{ t(`scene.${activityAt(data.party.id, member, currentTime)}`) }}
            <span v-if="!faces.has(member.membershipId)"> · {{ t('scene.placeholder') }}</span>
          </q-item-label>
        </q-item-section>
      </q-item>
    </q-list>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useQuasar } from 'quasar'
import { useI18n } from 'vue-i18n'
import { loadAvatar } from '../avatar-api'
import { activityAt, sceneSchema, type SceneData } from '../farm-scene'
import { useSessionStore } from '../stores/session'

const props = defineProps<{ revision: number }>()
const { t } = useI18n()
const quasar = useQuasar()
const session = useSessionStore()
const host = ref<HTMLElement>()
const data = shallowRef<SceneData | null>(null)
const faces = shallowRef(new Map<string, ImageBitmap>())
const loading = ref(false)
const failed = ref(false)
const avatarFailed = ref(false)
const currentTime = ref(Date.now())
let timeOffset = 0
let generation = 0
let disposed = false
let destroy: (() => void) | undefined
let timer: ReturnType<typeof setInterval> | undefined
const clear = () => {
  destroy?.()
  destroy = undefined
  faces.value.forEach(face => face.close())
  faces.value = new Map()
  data.value = null
}

const refresh = async () => {
  const requestGeneration = ++generation
  clear()
  loading.value = true
  failed.value = avatarFailed.value = false
  const loadedFaces = new Map<string, ImageBitmap>()
  try {
    const response = await session.request('/parties/current/scene')
    if (!response.ok) throw new Error('SCENE_LOAD_FAILED')
    const serverDate = Date.parse(response.headers.get('Date') ?? '')
    timeOffset = Number.isFinite(serverDate) ? serverDate - Date.now() : 0
    const scene = sceneSchema.parse(await response.json())
    let missing = false
    await Promise.all(scene.members.map(async member => {
      if (!member.avatarVersion) return
      try {
        const blob = await loadAvatar(session.request, member.membershipId)
        if (!blob) { missing = true; return }
        const bitmap = await createImageBitmap(blob, { resizeWidth: 256, resizeHeight: 256 })
        loadedFaces.set(member.membershipId, bitmap)
      } catch { missing = true }
    }))
    if (disposed || requestGeneration !== generation || !host.value) return
    const { createFarmRenderer } = await import('../farm-renderer')
    if (disposed || requestGeneration !== generation || !host.value) return
    const style = getComputedStyle(host.value)
    const color = (name: string) => style.getPropertyValue(`--farmies-${name}`).trim()
    data.value = scene
    const cleanup = await createFarmRenderer(host.value, scene, loadedFaces, {
      pasture: color('muted-teal'), sky: color('surface'), ink: color('text'),
      coat: color('almond-silk'), blush: color('powder-blush'),
    }, () => Date.now() + timeOffset)
    if (disposed || requestGeneration !== generation) { cleanup(); return }
    destroy = cleanup
    faces.value = loadedFaces
    data.value = scene
    avatarFailed.value = missing
    currentTime.value = Date.now() + timeOffset
  } catch {
    if (!disposed && requestGeneration === generation) failed.value = true
  } finally {
    if (faces.value !== loadedFaces) loadedFaces.forEach(face => face.close())
    if (!disposed && requestGeneration === generation) loading.value = false
  }
}
watch(() => props.revision, refresh)
watch(() => quasar.dark.isActive, refresh)
onMounted(() => {
  void refresh()
  timer = setInterval(() => { currentTime.value = Date.now() + timeOffset }, 1000)
})
onBeforeUnmount(() => {
  disposed = true
  generation++
  clearInterval(timer)
  clear()
})
</script>

<style scoped>
.scene-canvas { width: 100%; overflow: hidden; border-radius: 1rem; }
.scene-canvas :deep(canvas) { display: block; max-width: 100%; }
</style>
