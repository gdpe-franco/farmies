import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision'
import simdLoader from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import simdBinary from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'
import fallbackLoader from '@mediapipe/tasks-vision/vision_wasm_nosimd_internal.js?url'
import fallbackBinary from '@mediapipe/tasks-vision/vision_wasm_nosimd_internal.wasm?url'
import model from './assets/blaze-face-short-range.tflite?url'

import type { AvatarFace } from './avatar-processing'

export const createAvatarFaceDetector = async () => {
  const simd = await FilesetResolver.isSimdSupported()
  return FaceDetector.createFromOptions({
    wasmLoaderPath: simd ? simdLoader : fallbackLoader,
    wasmBinaryPath: simd ? simdBinary : fallbackBinary,
  }, {
    baseOptions: { modelAssetPath: model, delegate: 'CPU' },
    runningMode: 'IMAGE',
    minDetectionConfidence: 0.7,
  })
}

export const detectAvatarFaces = (detector: FaceDetector, image: ImageBitmap | HTMLVideoElement): AvatarFace[] => {
  const width = image instanceof HTMLVideoElement ? image.videoWidth : image.width
  const height = image instanceof HTMLVideoElement ? image.videoHeight : image.height
  const scale = Math.min(1, 640 / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('FACE_DETECTION_UNAVAILABLE')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return detector.detect(canvas).detections.map(({ boundingBox, keypoints }) => {
    if (!boundingBox) throw new Error('FACE_DETECTION_UNAVAILABLE')
    return {
      originX: boundingBox.originX * width / canvas.width,
      originY: boundingBox.originY * height / canvas.height,
      width: boundingBox.width * width / canvas.width,
      height: boundingBox.height * height / canvas.height,
      keypoints: keypoints.map(({ x, y }) => ({ x, y })),
    }
  })
}
