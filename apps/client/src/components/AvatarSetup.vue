<template>
  <section
    class="farmies-panel q-mt-lg"
    aria-labelledby="avatar-title"
  >
    <h3
      id="avatar-title"
      class="text-h6 q-mb-sm"
    >
      {{ t('avatar.title') }}
    </h3>
    <p>{{ t('avatar.instructions') }}</p>

    <input
      ref="fileInput"
      hidden
      type="file"
      :accept="avatarFileSource.accept"
      @change="selectSource"
    >
    <div class="row q-gutter-sm">
      <q-btn
        color="primary"
        :label="t('avatar.choose')"
        :disable="busy"
        @click="fileInput?.click()"
      />
      <q-btn
        outline
        color="primary"
        :label="t('avatar.takePhoto')"
        :disable="busy"
        @click="cameraOpen = true"
      />
    </div>

    <div
      v-if="busy"
      class="row items-center q-gutter-sm q-mt-md"
      role="status"
      aria-busy="true"
    >
      <q-spinner
        color="primary"
        size="2em"
      />
      <span>{{ t(processing ? 'avatar.processing' : 'avatar.saving') }}</span>
    </div>

    <q-banner
      v-if="errorKey && !editing"
      class="bg-negative text-white q-mt-md"
      role="alert"
    >
      {{ t(errorKey) }}
    </q-banner>

    <div
      v-if="preparedUrl || savedUrl"
      class="q-mt-md"
      role="status"
    >
      <q-avatar
        rounded
        size="128px"
      >
        <img
          :src="preparedUrl || savedUrl!"
          :alt="t(preparedUrl ? 'avatar.readyPreview' : 'avatar.savedPreview')"
        >
      </q-avatar>
      <p class="q-mt-sm">
        {{ preparedUrl ? t('avatar.ready', { size: preparedSize }) : t('avatar.saved') }}
      </p>
      <q-btn
        v-if="preparedUrl && sourceImage"
        outline
        color="primary"
        :label="t('avatar.adjust')"
        :disable="busy"
        @click="openEditor"
      />
      <q-btn
        v-if="preparedBlob"
        class="q-ml-sm"
        color="primary"
        :label="t('avatar.save')"
        :disable="busy"
        @click="persistAvatar"
      />
    </div>

    <p v-if="!preparedUrl && !savedUrl && !busy && !loadFailed && !deleteRetry">
      {{ t('avatar.empty') }}
    </p>
    <q-btn
      v-if="savedUrl || deleteRetry"
      class="q-mt-md"
      outline
      color="negative"
      :label="t(deleteRetry ? 'avatar.retryDelete' : 'avatar.remove')"
      :disable="busy"
      @click="deleteConfirm = true"
    />
    <q-btn
      v-if="loadFailed"
      class="q-mt-md"
      outline
      :label="t('avatar.retryLoad')"
      :disable="busy"
      @click="restoreAvatar"
    />
    <q-dialog
      v-model="deleteConfirm"
      :persistent="saving"
      :aria-label="t('avatar.remove')"
    >
      <q-card class="farmies-card camera-card">
        <q-card-section>{{ t('avatar.deleteConfirm') }}</q-card-section>
        <q-card-actions align="right">
          <q-btn
            flat
            :label="t('avatar.cancelCrop')"
            :disable="saving"
            @click="deleteConfirm = false"
          />
          <q-btn
            color="negative"
            :label="t('avatar.remove')"
            :loading="saving"
            @click="removeAvatar"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog
      v-model="cameraOpen"
      aria-labelledby="camera-title"
      @show="startCamera"
      @before-hide="closeCamera"
    >
      <q-card class="camera-card farmies-card">
        <q-card-section>
          <h4
            id="camera-title"
            class="text-h6 q-my-sm"
          >
            {{ t('avatar.takePhoto') }}
          </h4>
          <p role="status">
            {{ t(cameraReady ? cameraStatus : 'avatar.cameraStarting') }}
          </p>
          <div class="camera-frame">
            <video
              ref="video"
              class="camera-preview"
              autoplay
              muted
              playsinline
              :aria-label="t('avatar.cameraPreview')"
              @loadeddata="onCameraLoaded"
            />
            <svg
              class="face-overlay"
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <circle
                v-for="(point, index) in cameraPoints"
                :key="index"
                :cx="point.x"
                :cy="point.y"
                r="0.009"
              />
            </svg>
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn
            flat
            :label="t('avatar.closeCamera')"
            @click="closeCamera"
          />
          <q-btn
            color="primary"
            :label="t('avatar.capture')"
            :disable="!cameraReady"
            :loading="processing"
            @click="capturePhoto"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog
      v-model="editing"
      aria-labelledby="crop-title"
      :persistent="processing"
    >
      <q-card class="camera-card farmies-card">
        <q-card-section>
          <h4
            id="crop-title"
            class="text-h6 q-my-sm"
          >
            {{ t('avatar.adjust') }}
          </h4>
          <p>{{ t('avatar.adjustHint') }}</p>
          <q-banner
            v-if="errorKey"
            class="bg-negative text-white q-mb-md"
            role="alert"
          >
            {{ t(errorKey) }}
          </q-banner>
          <canvas
            ref="editorCanvas"
            class="crop-preview"
            role="img"
            :aria-label="t('avatar.cropPreview')"
          />
          <label>{{ t('avatar.framing') }}</label>
          <q-slider
            v-model="draft.scale"
            :min="0.75"
            :max="2"
            :step="0.05"
            :disable="processing"
            :aria-label="t('avatar.framing')"
          />
          <label>{{ t('avatar.horizontal') }}</label>
          <q-slider
            v-model="draft.x"
            :min="-1"
            :max="1"
            :step="0.05"
            :disable="processing"
            :aria-label="t('avatar.horizontal')"
          />
          <label>{{ t('avatar.vertical') }}</label>
          <q-slider
            v-model="draft.y"
            :min="-1"
            :max="1"
            :step="0.05"
            :disable="processing"
            :aria-label="t('avatar.vertical')"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn
            flat
            :label="t('avatar.resetCrop')"
            :disable="processing"
            @click="Object.assign(draft, { scale: 1, x: 0, y: 0 })"
          />
          <q-btn
            flat
            :label="t('avatar.cancelCrop')"
            :disable="processing"
            @click="editing = false"
          />
          <q-btn
            color="primary"
            :label="t('avatar.applyCrop')"
            :loading="processing"
            @click="applyCrop"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </section>
</template>

<script setup lang="ts">
import type { FaceDetector } from '@mediapipe/tasks-vision'
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  calculateAvatarFaceCrop,
  decodeAvatarSource,
  drawAvatarCrop,
  encodeAvatar,
  type AvatarFace,
} from '../avatar-processing'
import { avatarCameraSource, avatarFileSource } from '../platform/avatar-source'
import { deleteAvatar, loadAvatar, saveAvatar } from '../avatar-api'
import { useSessionStore } from '../stores/session'

const { t } = useI18n()
const session = useSessionStore()
const membershipId = session.party!.membership.id
const savedUrl = ref<string | null>(null)
const preparedBlob = shallowRef<Blob | null>(null)
const saving = ref(false)
const busy = computed(() => processing.value || saving.value)
const deleteConfirm = ref(false)
const deleteRetry = ref(false)
const loadFailed = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const video = ref<HTMLVideoElement | null>(null)
const cameraOpen = ref(false)
const cameraReady = ref(false)
const cameraStatus = ref('avatar.cameraLive')
const cameraPoints = ref<{ x: number; y: number }[]>([])
const editing = ref(false)
const editorCanvas = ref<HTMLCanvasElement | null>(null)
const sourceImage = shallowRef<ImageBitmap | null>(null)
let sourceFaces: AvatarFace[] = []
const draft = reactive({ scale: 1, x: 0, y: 0 })
let applied = { scale: 1, x: 0, y: 0 }
const processing = ref(false)
const preparedUrl = ref<string | null>(null)
const preparedBytes = ref(0)
const errorKeys = {
  EMPTY_SOURCE: 'avatar.emptyError',
  SOURCE_TOO_LARGE: 'avatar.sizeError',
  UNSUPPORTED_SOURCE: 'avatar.typeError',
  DECODE_FAILED: 'avatar.decodeError',
  FACE_NOT_FOUND: 'avatar.noFace',
  MULTIPLE_FACES: 'avatar.multipleFaces',
  FACE_DETECTION_UNAVAILABLE: 'avatar.detectorError',
} as const
const errorKey = ref<string | null>(null)
const preparedSize = computed(() => Math.ceil(preparedBytes.value / 1_024))
let cameraStream: MediaStream | null = null
let cameraRequest = 0
let detector: FaceDetector | null = null
let detectorPromise: Promise<FaceDetector> | null = null
let cameraTimer: ReturnType<typeof setTimeout> | null = null
let detection: typeof import('../avatar-face-detection') | null = null
let disposed = false

const clearPrepared = () => {
  if (preparedUrl.value) URL.revokeObjectURL(preparedUrl.value)
  preparedUrl.value = null
  preparedBytes.value = 0
  preparedBlob.value = null
}

const clearSaved = () => {
  if (savedUrl.value) URL.revokeObjectURL(savedUrl.value)
  savedUrl.value = null
}

const restoreAvatar = async () => {
  saving.value = true
  loadFailed.value = false
  errorKey.value = null
  try {
    const blob = await loadAvatar(session.request, membershipId)
    if (disposed) return
    clearSaved()
    if (blob) savedUrl.value = URL.createObjectURL(blob)
  } catch {
    if (!disposed) {
      loadFailed.value = true
      errorKey.value = 'avatar.loadError'
    }
  } finally {
    saving.value = false
  }
}

const persistAvatar = async () => {
  if (!preparedBlob.value || busy.value) return
  saving.value = true
  errorKey.value = null
  try {
    const blob = preparedBlob.value
    await saveAvatar(session.request, membershipId, blob)
    if (disposed) return
    clearSaved()
    savedUrl.value = URL.createObjectURL(blob)
    clearPrepared()
    sourceImage.value?.close()
    sourceImage.value = null
    sourceFaces = []
    deleteRetry.value = false
    loadFailed.value = false
  } catch {
    if (!disposed) errorKey.value = 'avatar.saveError'
  } finally {
    saving.value = false
  }
}

const removeAvatar = async () => {
  saving.value = true
  errorKey.value = null
  try {
    await deleteAvatar(session.request, membershipId)
    if (disposed) return
    clearSaved()
    clearPrepared()
    sourceImage.value?.close()
    sourceImage.value = null
    deleteRetry.value = false
    loadFailed.value = false
  } catch (error) {
    if (!disposed) {
      deleteRetry.value = true
      const pending = error instanceof Error && error.message === 'AVATAR_DELETE_RETRY'
      if (pending) clearSaved()
      errorKey.value = pending ? 'avatar.deleteRetryError' : 'avatar.deleteError'
    }
  } finally {
    saving.value = false
    deleteConfirm.value = false
  }
}

const getDetector = () => {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      try {
        detection = await import('../avatar-face-detection')
        const created = await detection.createAvatarFaceDetector()
        if (disposed) {
          created.close()
          throw new Error('FACE_DETECTION_UNAVAILABLE')
        }
        detector = created
        return created
      } catch {
        detectorPromise = null
        throw new Error('FACE_DETECTION_UNAVAILABLE')
      }
    })()
  }
  return detectorPromise
}

const detectFaces = (activeDetector: FaceDetector, image: ImageBitmap | HTMLVideoElement) => {
  try {
    return detection!.detectAvatarFaces(activeDetector, image)
  } catch {
    activeDetector.close()
    detector = null
    detectorPromise = null
    throw new Error('FACE_DETECTION_UNAVAILABLE')
  }
}

const showPrepared = (output: Blob) => {
  clearPrepared()
  preparedBytes.value = output.size
  preparedBlob.value = output
  preparedUrl.value = URL.createObjectURL(output)
}

const processSource = async (source: Blob) => {
  processing.value = true
  errorKey.value = null
  clearPrepared()
  sourceImage.value?.close()
  sourceImage.value = null
  sourceFaces = []
  editing.value = false
  let image: ImageBitmap | null = null
  try {
    image = await decodeAvatarSource(source)
    if (disposed) return
    const activeDetector = await getDetector()
    if (disposed) return
    const faces = detectFaces(activeDetector, image)
    const crop = calculateAvatarFaceCrop(image.width, image.height, faces)
    const canvas = document.createElement('canvas')
    drawAvatarCrop(canvas, image, crop)
    const output = await encodeAvatar(canvas)
    if (disposed) return
    sourceImage.value = image
    image = null
    sourceFaces = faces
    applied = { scale: 1, x: 0, y: 0 }
    showPrepared(output)
  } catch (error) {
    if (!disposed) {
      const code = error instanceof Error ? error.message : ''
      errorKey.value = errorKeys[code as keyof typeof errorKeys] ?? 'avatar.processError'
    }
  } finally {
    image?.close()
    processing.value = false
  }
}

const drawEditor = () => {
  if (!editorCanvas.value || !sourceImage.value) return
  const image = sourceImage.value
  drawAvatarCrop(editorCanvas.value, image, calculateAvatarFaceCrop(image.width, image.height, sourceFaces, draft))
}

const openEditor = () => {
  errorKey.value = null
  Object.assign(draft, applied)
  editing.value = true
}

const applyCrop = async () => {
  if (!editorCanvas.value || !sourceImage.value || processing.value) return
  processing.value = true
  errorKey.value = null
  try {
    drawEditor()
    const output = await encodeAvatar(editorCanvas.value)
    if (disposed) return
    showPrepared(output)
    applied = { ...draft }
    editing.value = false
  } catch {
    if (!disposed) errorKey.value = 'avatar.processError'
  } finally {
    processing.value = false
  }
}

watch([draft, editorCanvas], drawEditor, { deep: true, flush: 'post' })

const selectSource = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const source = avatarFileSource.read(event)
  input.value = ''
  if (source) await processSource(source)
}

const closeCamera = () => {
  cameraRequest += 1
  if (cameraTimer) clearTimeout(cameraTimer)
  cameraTimer = null
  cameraPoints.value = []
  cameraStatus.value = 'avatar.cameraLive'
  if (cameraStream) avatarCameraSource.stop(cameraStream)
  cameraStream = null
  if (video.value) video.value.srcObject = null
  cameraOpen.value = false
  cameraReady.value = false
}

const startCamera = async () => {
  const request = ++cameraRequest
  cameraReady.value = false
  errorKey.value = null
  try {
    const stream = await avatarCameraSource.open()
    if (request !== cameraRequest) {
      avatarCameraSource.stop(stream)
      return
    }
    cameraStream = stream
    if (!video.value) throw new Error('CAMERA_NOT_READY')
    video.value.srcObject = stream
    await video.value.play()
  } catch (error) {
    if (request !== cameraRequest) return
    closeCamera()
    errorKey.value = error instanceof Error && error.name === 'NotAllowedError'
      ? 'avatar.cameraDenied'
      : error instanceof Error && (error.name === 'NotFoundError' || error.message === 'CAMERA_UNAVAILABLE')
        ? 'avatar.cameraUnavailable'
        : 'avatar.cameraError'
  }
}

const onCameraLoaded = () => {
  cameraReady.value = !!cameraStream && video.value?.srcObject === cameraStream
  if (cameraReady.value && !cameraTimer) void trackCamera(cameraRequest)
}

const trackCamera = async (request: number) => {
  try {
    cameraStatus.value = 'avatar.cameraChecking'
    const activeDetector = await getDetector()
    if (request !== cameraRequest || !cameraReady.value || !video.value || disposed) return
    const update = () => {
      cameraTimer = null
      if (request !== cameraRequest || !cameraReady.value || !video.value || disposed) return
      try {
        const faces = detectFaces(activeDetector, video.value)
        cameraPoints.value = faces.length === 1 ? faces[0]!.keypoints ?? [] : []
        cameraStatus.value = faces.length === 1 ? 'avatar.cameraFaceReady' : faces.length > 1 ? 'avatar.multipleFaces' : 'avatar.noFace'
        cameraTimer = setTimeout(update, 200)
      } catch {
        cameraPoints.value = []
        cameraStatus.value = 'avatar.detectorError'
      }
    }
    update()
  } catch {
    if (request === cameraRequest && !disposed) cameraStatus.value = 'avatar.detectorError'
  }
}

const capturePhoto = async () => {
  if (!video.value || !cameraReady.value || processing.value) return
  const request = cameraRequest
  processing.value = true
  try {
    const photo = await avatarCameraSource.capture(video.value)
    if (request !== cameraRequest) return
    closeCamera()
    await processSource(photo)
  } catch {
    if (request === cameraRequest) {
      closeCamera()
      errorKey.value = 'avatar.cameraError'
    }
  } finally {
    processing.value = false
  }
}

onMounted(() => {
  window.addEventListener('pagehide', closeCamera)
  void restoreAvatar()
})
onBeforeUnmount(() => {
  disposed = true
  closeCamera()
  window.removeEventListener('pagehide', closeCamera)
  detector?.close()
  sourceImage.value?.close()
  clearPrepared()
  clearSaved()
})
</script>

<style scoped>
.camera-card {
  width: min(100%, 28rem);
}

.camera-preview {
  display: block;
  width: 100%;
  height: auto;
  background: #000;
  border-radius: 0.5rem;
}

.camera-frame {
  position: relative;
}

.face-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.face-overlay circle {
  fill: var(--farmies-muted-teal);
  stroke: var(--farmies-powder-blush);
  stroke-width: 0.004;
}

.crop-preview {
  display: block;
  width: 100%;
  border-radius: 0.5rem;
}
</style>
