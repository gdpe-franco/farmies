import assert from 'node:assert/strict'
import test from 'node:test'
import { activityAt, activities, bucketDuration, coverTransform, pasturePosition, sceneLayout, sceneSchema } from '../src/farm-scene.ts'

const member = { membershipId: '9223372036854775807', nickname: 'Fern', joinedAt: '2026-09-11T08:00:00.000Z', avatarVersion: null }
test('ambient activities happy path: stable buckets and all five compatible cow states', () => {
  const time = 100 * bucketDuration
  assert.equal(activityAt('84', member, time), activityAt('84', { ...member, nickname: 'New nickname' }, time + 29_999))
  assert.deepEqual(new Set(Array.from({ length: 5 }, (_, i) => activityAt('84', member, time + i * bucketDuration))), new Set(activities))
  for (const width of [160, 200, 240, 320, 480, 720, 900]) {
    const layout = sceneLayout(width, 10)
    assert.ok(layout.cellWidth >= 80)
    for (let index = 0; index < 10; index++) {
      const position = pasturePosition(width, 10, index, String(85 + index))
      assert.deepEqual(position, pasturePosition(width, 10, index, String(85 + index)))
      assert.ok(position.x - 115 * position.scale > 0)
      assert.ok(position.x + 115 * position.scale < width)
      assert.ok(position.y + 24 < layout.height)
      assert.ok(position.scale <= 0.38)
    }
  }
})
test('scene contract failure path: unsupported definitions and over-capacity rosters fail', () => {
  const scene = { party: { id: '84', species: 'COW', environment: { code: 'PASTURE', definition: {
    version: 1, scene: 'PASTURE', zones: [], props: [], capabilities: [],
  } } }, members: [member] }
  assert.equal(sceneSchema.safeParse(scene).success, true)
  assert.equal(sceneSchema.safeParse({ ...scene, members: Array(11).fill(member) }).success, false)
  scene.party.environment.definition.version = 2
  assert.equal(sceneSchema.safeParse(scene).success, false)
})

test('pasture background covers wide and tall scenes without changing its aspect ratio', () => {
  for (const [width, height] of [[744, 440], [320, 440]]) {
    const transform = coverTransform(768, 512, width, height)
    const renderedWidth = 768 * transform.scale
    const renderedHeight = 512 * transform.scale
    assert.ok(renderedWidth >= width)
    assert.ok(renderedHeight >= height)
    assert.equal(renderedWidth / renderedHeight, 1.5)
    assert.equal(transform.x * 2 + renderedWidth, width)
    assert.equal(transform.y * 2 + renderedHeight, height)
  }
})
