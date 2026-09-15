import assert from 'node:assert/strict'
import test from 'node:test'
import { webp } from '../../api/test/fixtures/webp.mjs'

import {
  avatarMediaType,
  calculateAvatarFaceCrop,
  decodeAvatarSource,
  encodeAvatar,
  maxAvatarBytes,
  maxAvatarSourceBytes,
  validateAvatarSource,
} from '../src/avatar-processing.ts'

test('avatar processing', async (suite) => {
  await suite.test('happy path', async () => {
    let decodeOptions
    const image = await decodeAvatarSource(
      new Blob(['photo'], { type: 'image/jpeg' }),
      async (_source, options) => {
        decodeOptions = options
        return { width: 1_200, height: 800 }
      },
    )
    assert.equal(decodeOptions.imageOrientation, 'from-image')
    const cases = [
      { face: { originX: 400, originY: 200, width: 200, height: 200 }, crop: { x: 350, y: 134, size: 300 } },
      { face: { originX: -10, originY: 0, width: 200, height: 200 }, crop: { x: -10, y: 0, size: 300 } },
      { face: { originX: 1_000, originY: 600, width: 200, height: 200 }, crop: { x: 900, y: 500, size: 300 } },
    ]
    for (const testCase of cases) {
      assert.deepEqual(calculateAvatarFaceCrop(image.width, image.height, [testCase.face]), testCase.crop)
    }
    const tallFace = { originX: 10, originY: 50, width: 100, height: 200 }
    for (const framing of [
      { scale: 1, x: 0, y: 0 },
      { scale: 0.75, x: -1, y: -1 },
      { scale: 2, x: 1, y: 1 },
    ]) {
      const crop = calculateAvatarFaceCrop(120, 400, [tallFace], framing)
      assert.ok(crop.x <= tallFace.originX && crop.x + crop.size >= tallFace.originX + tallFace.width)
      assert.ok(crop.y <= tallFace.originY && crop.y + crop.size >= tallFace.originY + tallFace.height)
      assert.ok(crop.size > 120, 'narrow photos must be padded instead of clipping a tall face')
    }

    const qualities = []
    const canvas = {
      toBlob: (callback, type, quality) => {
        qualities.push(quality)
        const bytes = qualities.length === 1 ? new Uint8Array(maxAvatarBytes + 1) : webp()
        callback(new Blob([bytes], { type }))
      },
    }
    const output = await encodeAvatar(canvas)
    assert.equal(output.type, avatarMediaType)
    assert.equal(output.size, 32)
    assert.deepEqual(qualities, [0.9, 0.75])
    const metadataImage = new Uint8Array(80)
    const metadataView = new DataView(metadataImage.buffer)
    const tag = (offset, value) => metadataImage.set(new TextEncoder().encode(value), offset)
    metadataImage.set(new Uint8Array(webp()).subarray(0, 12))
    metadataView.setUint32(4, 72, true)
    tag(12, 'VP8X'); metadataView.setUint32(16, 10, true)
    metadataImage[20] = 0x2c
    metadataImage.set([255, 1, 0, 255, 1, 0], 24)
    for (const [index, type] of ['ICCP', 'EXIF', 'XMP '].entries()) {
      tag(30 + index * 10, type)
      metadataView.setUint32(34 + index * 10, 2, true)
    }
    metadataImage.set(new Uint8Array(webp()).subarray(12), 60)
    const stripped = await encodeAvatar({ toBlob: (callback, type) => callback(new Blob([metadataImage], { type })) })
    assert.deepEqual(await stripped.arrayBuffer(), webp(), 'generated metadata and its flags are removed')
  })

  await suite.test('failure path', async () => {
    const cases = [
      { source: { size: 0, type: 'image/jpeg' }, error: /EMPTY_SOURCE/ },
      { source: { size: maxAvatarSourceBytes + 1, type: 'image/jpeg' }, error: /SOURCE_TOO_LARGE/ },
      { source: { size: 1, type: 'image/gif' }, error: /UNSUPPORTED_SOURCE/ },
    ]

    for (const testCase of cases) {
      assert.throws(() => validateAvatarSource(testCase.source), testCase.error)
    }
    const face = { originX: 100, originY: 100, width: 200, height: 200 }
    const faceCases = [
      { faces: [], error: /FACE_NOT_FOUND/ },
      { faces: [face, face], error: /MULTIPLE_FACES/ },
      { faces: [{ ...face, width: 0 }], error: /FACE_NOT_FOUND/ },
      { faces: [{ ...face, originX: Number.NaN }], error: /FACE_NOT_FOUND/ },
      { faces: [{ ...face, originX: 2_000 }], error: /FACE_NOT_FOUND/ },
    ]
    for (const testCase of faceCases) {
      assert.throws(() => calculateAvatarFaceCrop(1_200, 800, testCase.faces), testCase.error)
    }
    for (const framing of [{ scale: 0, x: 0, y: 0 }, { scale: 1, x: 2, y: 0 }]) {
      assert.throws(() => calculateAvatarFaceCrop(1_200, 800, [face], framing), /INVALID_CROP/)
    }
    await assert.rejects(decodeAvatarSource(new Blob(['broken'], { type: 'image/jpeg' }), async () => {
      throw new Error('Corrupt image')
    }), /DECODE_FAILED/)
    for (const type of ['image/png', null]) {
      await assert.rejects(encodeAvatar({ toBlob: (callback) => callback(type ? new Blob(['image'], { type }) : null) }), /ENCODE_FAILED/)
    }
    await assert.rejects(encodeAvatar({ toBlob: (callback, type) => callback(new Blob(['invalid-webp'], { type })) }), /ENCODE_FAILED/)
    await assert.rejects(encodeAvatar({ toBlob: (callback, type) => {
      callback(new Blob([new Uint8Array(maxAvatarBytes + 1)], { type }))
    } }), /OUTPUT_TOO_LARGE/)
  })
})
