export const avatarSize = 512
export const maxAvatarBytes = 512 * 1_024
export const maxAvatarSourceBytes = 10 * 1_024 * 1_024
export const avatarMediaType = 'image/webp'

const sourceTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
const qualities = [0.9, 0.75, 0.6, 0.45, 0.3]

export type AvatarProcessingError =
  | 'EMPTY_SOURCE'
  | 'SOURCE_TOO_LARGE'
  | 'UNSUPPORTED_SOURCE'
  | 'DECODE_FAILED'
  | 'ENCODE_FAILED'
  | 'OUTPUT_TOO_LARGE'
  | 'FACE_NOT_FOUND'
  | 'MULTIPLE_FACES'
  | 'FACE_DETECTION_UNAVAILABLE'
  | 'INVALID_CROP'

export type AvatarFace = {
  originX: number; originY: number; width: number; height: number
  keypoints?: { x: number; y: number }[]
}
export type AvatarCrop = { x: number; y: number; size: number }
export type AvatarFraming = { scale: number; x: number; y: number }

export const validateAvatarSource = (source: Pick<Blob, 'size' | 'type'>) => {
  if (source.size === 0) throw new Error('EMPTY_SOURCE' satisfies AvatarProcessingError)
  if (source.size > maxAvatarSourceBytes) {
    throw new Error('SOURCE_TOO_LARGE' satisfies AvatarProcessingError)
  }
  if (!sourceTypes.has(source.type)) {
    throw new Error('UNSUPPORTED_SOURCE' satisfies AvatarProcessingError)
  }
}

export const decodeAvatarSource = async (
  source: Blob,
  decoder: typeof createImageBitmap = createImageBitmap,
) => {
  validateAvatarSource(source)
  try {
    return await decoder(source, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('DECODE_FAILED' satisfies AvatarProcessingError)
  }
}

export const calculateAvatarFaceCrop = (
  width: number,
  height: number,
  faces: AvatarFace[],
  framing: AvatarFraming = { scale: 1, x: 0, y: 0 },
): AvatarCrop => {
  if (!faces.length) throw new Error('FACE_NOT_FOUND' satisfies AvatarProcessingError)
  if (faces.length !== 1) throw new Error('MULTIPLE_FACES' satisfies AvatarProcessingError)
  const face = faces[0]!
  if (
    ![width, height, face.originX, face.originY, face.width, face.height].every(Number.isFinite)
    || width <= 0 || height <= 0 || face.width <= 0 || face.height <= 0
    || face.originX + face.width <= 0 || face.originY + face.height <= 0
    || face.originX >= width || face.originY >= height
  ) throw new Error('FACE_NOT_FOUND' satisfies AvatarProcessingError)

  if (
    ![framing.scale, framing.x, framing.y].every(Number.isFinite)
    || framing.scale < 0.75 || framing.scale > 2
    || Math.abs(framing.x) > 1 || Math.abs(framing.y) > 1
  ) throw new Error('INVALID_CROP' satisfies AvatarProcessingError)

  // Leave room for forehead/chin. Oversized squares are padded, not shrunk to clip the face.
  const size = Math.max(face.width, face.height) * 1.5 * framing.scale
  const position = (desired: number, dimension: number, start: number, length: number) => {
    const inImage = Math.max(Math.min(0, dimension - size), Math.min(Math.max(0, dimension - size), desired))
    return Math.max(start + length - size, Math.min(start, inImage))
  }
  return {
    x: position(face.originX + face.width / 2 - size / 2 + framing.x * (size - face.width) / 2, width, face.originX, face.width),
    y: position(face.originY + face.height * 0.42 - size / 2 + framing.y * (size - face.height) / 2, height, face.originY, face.height),
    size,
  }
}

export const drawAvatarCrop = (
  canvas: HTMLCanvasElement,
  image: CanvasImageSource & { width: number; height: number },
  crop: AvatarCrop,
) => {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('ENCODE_FAILED' satisfies AvatarProcessingError)

  canvas.width = avatarSize
  canvas.height = avatarSize
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.fillStyle = '#fff'
  context.fillRect(0, 0, avatarSize, avatarSize)
  context.drawImage(image, crop.x, crop.y, crop.size, crop.size, 0, 0, avatarSize, avatarSize)
}

const canvasToBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, avatarMediaType, quality))

export const encodeAvatar = async (canvas: HTMLCanvasElement) => {
  for (const quality of qualities) {
    const output = await canvasToBlob(canvas, quality)
    if (!output || output.type !== avatarMediaType) {
      throw new Error('ENCODE_FAILED' satisfies AvatarProcessingError)
    }
    if (output.size <= maxAvatarBytes) return output
  }

  throw new Error('OUTPUT_TOO_LARGE' satisfies AvatarProcessingError)
}
