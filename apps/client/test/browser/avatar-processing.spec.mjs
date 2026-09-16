import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { validateAvatar } from '../../../api/src/avatars.ts'

const facePhoto = await readFile(new URL('../fixtures/face.png', import.meta.url))

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } })

const authUserId = '03d9d8e0-a088-4f4c-a97f-967675fb4e39'
const encode = (value) => btoa(JSON.stringify(value))
  .replaceAll('+', '-')
  .replaceAll('/', '_')
  .replaceAll('=', '')
const accessToken = [
  encode({ alg: 'none', typ: 'JWT' }),
  encode({ sub: authUserId, exp: Math.floor(Date.now() / 1_000) + 3_600 }),
  'test-signature',
].join('.')
const authResponse = {
  access_token: accessToken,
  token_type: 'bearer',
  expires_in: 3_600,
  expires_at: Math.floor(Date.now() / 1_000) + 3_600,
  refresh_token: 'test-refresh-token',
  user: {
    id: authUserId,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'friend@example.com',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { email: 'friend@example.com' },
    identities: [],
    created_at: '2026-09-11T08:00:00.000Z',
    updated_at: '2026-09-11T08:00:00.000Z',
  },
}
const party = {
  party: {
    id: '84',
    displayName: 'Green Friends',
    species: 'COW',
    environment: 'PASTURE',
    createdAt: '2026-09-11T08:00:00.000Z',
  },
  membership: {
    id: '85',
    nickname: 'Fern',
    joinedAt: '2026-09-11T08:00:00.000Z',
  },
  isOwner: true,
  inviteActive: false,
}

const openAvatarSetup = async (page, locale) => {
  const storage = { bytes: null, saveFails: false, deleteFails: false, loadFails: false, uploads: 0 }
  await page.route('http://localhost:8787/parties/current/avatars/85', async (route) => {
    const request = route.request()
    expect(request.headers().authorization).toBe(`Bearer ${accessToken}`)
    if (request.method() === 'PUT') {
      expect(request.headers()['content-type']).toBe('image/webp')
      const bytes = request.postDataBuffer()
      expect(validateAvatar(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))).toBe(true)
      if (storage.saveFails) return route.fulfill({ status: 500, json: { error: 'AVATAR_OPERATION_FAILED' } })
      storage.bytes = bytes
      return route.fulfill({ json: { version: ++storage.uploads } })
    }
    if (request.method() === 'DELETE') {
      storage.bytes = null
      return route.fulfill({ status: storage.deleteFails ? 503 : 204 })
    }
    if (storage.loadFails) return route.fulfill({ status: 500 })
    return storage.bytes
      ? route.fulfill({ contentType: 'image/webp', body: storage.bytes })
      : route.fulfill({ status: 404 })
  })
  await page.route('**/test-face.jpg', (route) => route.fulfill({ contentType: 'image/png', body: facePhoto }))
  await page.route('**/auth/v1/otp', (route) => route.fulfill({ json: {} }))
  await page.route('**/auth/v1/verify', (route) => route.fulfill({ json: authResponse }))
  await page.route('**/auth/v1/logout*', (route) => route.fulfill({ json: {} }))
  await page.route('http://localhost:8787/users/me', (route) => route.fulfill({
    json: {
      user: {
        id: '42',
        preferredLocale: locale,
        createdAt: '2026-09-11T08:00:00.000Z',
        updatedAt: '2026-09-11T08:00:00.000Z',
      },
    },
  }))
  await page.route('http://localhost:8787/parties/current', (route) => route.fulfill({ json: party }))
  await page.route('http://localhost:8787/parties/current/scene', (route) => route.fulfill({ json: {
    party: { id: '84', species: 'COW', environment: { code: 'PASTURE', definition: {
      version: 1, scene: 'PASTURE', zones: [], props: [], capabilities: [],
    } } }, members: [{ membershipId: '85', nickname: 'Fern', joinedAt: '2026-09-11T08:00:00.000Z', avatarVersion: storage.uploads || null }],
  } }))

  await page.goto('/')
  if (locale === 'es') {
    await page.getByRole('button', { name: 'Language', exact: true }).click()
    await page.getByRole('menuitemradio', { name: 'Español', exact: true }).click()
  }
  await page.getByLabel(locale === 'es' ? 'Correo electrónico' : 'Email').fill('friend@example.com')
  await page.getByRole('button', { name: locale === 'es' ? 'Enviar código' : 'Send code' }).click()
  await page.getByLabel(locale === 'es' ? 'Código de seis dígitos' : 'Six-digit code').fill('123456')
  await page.getByRole('button', { name: locale === 'es' ? 'Verificar código' : 'Verify code' }).click()
  await expect(page.getByRole('heading', {
    name: locale === 'es' ? 'Avatar de vaca' : 'Cow avatar',
  })).toBeVisible()
  return storage
}

const useCameraPhoto = async (page) => {
  await page.addInitScript(() => {
    const open = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const device = await open(constraints)
      device.getTracks().forEach((track) => track.stop())
      const photo = await createImageBitmap(await fetch('/test-face.jpg').then((response) => response.blob()))
      const canvas = document.createElement('canvas')
      canvas.width = photo.width
      canvas.height = photo.height
      const context = canvas.getContext('2d')
      if (window.cameraTestBlank) {
        context.fillStyle = '#fff'
        context.fillRect(0, 0, canvas.width, canvas.height)
      } else context.drawImage(photo, 0, 0)
      photo.close()
      const stream = canvas.captureStream(5)
      window.cameraTestTracks = stream.getTracks()
      return stream
    }
  })
}

for (const locale of ['en', 'es']) {
  test(`pasture happy path: ten cows, private photos, phone resize and sign-out in ${locale}`, async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await openAvatarSetup(page, locale)
    await expect(page.locator('.scene-canvas canvas')).toBeVisible()
    const alpha = await page.evaluate(async () => {
      const { decodeCowAtlas, decodeCowHeads } = await import('/src/farm-assets.ts')
      const bitmap = await decodeCowAtlas(await fetch('/src/assets/farm/cow-atlas.png').then(response => response.blob()))
      const heads = await decodeCowHeads(bitmap)
      const bounds = heads.map(head => ({ width: head.width, height: head.height }))
      for (const [index, head] of heads.entries()) {
        const maskCanvas = document.createElement('canvas')
        maskCanvas.width = maskCanvas.height = 256
        const maskContext = maskCanvas.getContext('2d')
        maskContext.drawImage(head.bitmap, 0, 0)
        const mask = maskContext.getImageData(0, 0, 256, 256).data
        const bodyCanvas = document.createElement('canvas')
        bodyCanvas.width = bodyCanvas.height = 256
        const bodyContext = bodyCanvas.getContext('2d')
        bodyContext.drawImage(bitmap, index % 4 * 256, Math.floor(index / 4) * 256, 256, 256, 0, 0, 256, 256)
        const body = bodyContext.getImageData(0, 0, 256, 256).data
        const seen = new Uint8Array(256 * 256)
        const connected = []
        let opaque = 0
        for (let pixel = 0; pixel < seen.length; pixel++) {
          if (!body[pixel * 4 + 3]) continue
          opaque++
          if (!connected.length) { connected.push(pixel); seen[pixel] = 1 }
          const offset = pixel * 4
          if (body[offset + 1] > body[offset] + 8 && body[offset + 1] > body[offset + 2] + 8) throw new Error('Green cow marking')
        }
        for (let i = 0; i < connected.length; i++) {
          const pixel = connected[i], x = pixel % 256
          for (const neighbor of [x ? pixel - 1 : -1, x < 255 ? pixel + 1 : -1, pixel - 256, pixel + 256]) {
            if (neighbor < 0 || neighbor >= seen.length || seen[neighbor] || !body[neighbor * 4 + 3]) continue
            seen[neighbor] = 1
            connected.push(neighbor)
          }
        }
        if (connected.length !== opaque || opaque < 10_000) throw new Error('Stray pixels or damaged cow silhouette')
        let centerX = 0, centerY = 0, maskCount = 0
        for (let pixel = 0; pixel < mask.length; pixel += 4) {
          if (mask[pixel + 3] && !body[pixel + 3]) throw new Error('Detached head mask')
          if (mask[pixel + 3]) {
            const position = pixel / 4
            centerX += position % 256; centerY += Math.floor(position / 256); maskCount++
          }
        }
        if (Math.abs(centerX / maskCount - head.centerX) > 0.01 || Math.abs(centerY / maskCount - head.centerY) > 0.01) throw new Error('Off-center face')
        for (let y = head.y; y < head.y + head.height; y++) {
          const row = []
          for (let x = head.x; x < head.x + head.width; x++) if (mask[(y * 256 + x) * 4 + 3]) row.push(x)
          if (row.length && row.at(-1) - row[0] + 1 !== row.length) throw new Error('Avatar mask contains line gaps')
        }
        head.bitmap.close()
      }
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1024
      const context = canvas.getContext('2d')
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
      const pixel = (x, y) => context.getImageData(x, y, 1, 1).data[3]
      return { outside: [pixel(0, 0), pixel(256, 0), pixel(512, 0), pixel(1023, 1023)],
        faces: [pixel(80, 127), pixel(83, 381), pixel(80, 706), pixel(78, 913)], bounds }
    })
    expect(alpha.outside).toEqual([0, 0, 0, 0])
    expect(alpha.faces).toEqual([255, 255, 255, 255])
    expect(alpha.bounds).toHaveLength(16)
    for (const head of alpha.bounds) {
      expect(head.width).toBeGreaterThan(60)
      expect(head.height).toBeGreaterThan(60)
    }
    await page.evaluate(async () => {
      const { decodeCowHeads } = await import('/src/farm-assets.ts')
      const blank = await createImageBitmap(new ImageData(1024, 1024))
      try {
        await decodeCowHeads(blank)
        throw new Error('Invalid head accepted')
      } catch (error) {
        if (error.message !== 'COW_HEAD_MASK_INVALID') throw error
      } finally { blank.close() }
    })
    const photo = await page.evaluate(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 512
      const context = canvas.getContext('2d')
      context.fillStyle = '#efb0a1'
      context.fillRect(0, 0, 512, 512)
      context.fillStyle = '#24332a'
      context.beginPath()
      context.arc(160, 200, 24, 0, Math.PI * 2)
      context.arc(352, 200, 24, 0, Math.PI * 2)
      context.fill()
      context.fillRect(210, 330, 92, 16)
      return canvas.toDataURL('image/webp').split(',')[1]
    })
    await page.route('http://localhost:8787/parties/current/avatars/86', route => {
      expect(route.request().headers().authorization).toBe(`Bearer ${accessToken}`)
      return route.fulfill({ contentType: 'image/webp', body: Buffer.from(photo, 'base64') })
    })
    await page.route('http://localhost:8787/parties/current/scene', route => route.fulfill({ json: {
      party: { id: '84', species: 'COW', environment: { code: 'PASTURE', definition: {
        version: 1, scene: 'PASTURE', zones: [], props: [], capabilities: [],
      } } }, members: Array.from({ length: 10 }, (_, i) => ({ membershipId: String(85 + i), nickname: `Friend ${i + 1}`,
        joinedAt: '2026-09-11T08:00:00.000Z', avatarVersion: i === 1 ? 1 : null,
      })),
    } }))
    await page.getByRole('button', { name: locale === 'es' ? 'Actualizar prado' : 'Refresh pasture' }).click()
    const scene = page.locator('section').filter({ has: page.getByRole('heading', { name: locale === 'es' ? 'Nuestro prado' : 'Our pasture' }) })
    await expect(scene.locator('canvas')).toBeVisible()
    await expect(scene.locator('.q-item')).toHaveCount(10)
    await expect(scene.getByText(locale === 'es' ? 'Cara provisional' : 'Placeholder face', { exact: false })).toHaveCount(9)
    for (const width of [320, 390, 900]) {
      await page.setViewportSize({ width, height: 800 })
      await expect.poll(() => scene.locator('canvas').evaluate(canvas => canvas.width / window.devicePixelRatio <= window.innerWidth)).toBe(true)
    }
    await scene.screenshot({ path: `test-results/pasture-${locale}.png` })
    const canvas = scene.locator('canvas')
    const frame = await canvas.screenshot()
    await expect.poll(async () => Buffer.compare(frame, await canvas.screenshot())).not.toBe(0)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(canvas).toBeVisible()
    await page.getByRole('button', { name: locale === 'es' ? 'Tema' : 'Theme', exact: true }).click()
    await page.getByRole('menuitemradio', { name: locale === 'es' ? 'Oscuro' : 'Dark', exact: true }).click()
    await expect(canvas).toBeVisible()
    await expect(scene.locator('.q-item')).toHaveCount(10)
    await page.getByRole('button', { name: locale === 'es' ? 'Cerrar sesión' : 'Sign out' }).click()
    await expect(scene.locator('canvas')).toHaveCount(0)
    expect(errors).toEqual([])
  })
  test(`pasture failure path: private roster failure clears photos and refresh recovers in ${locale}`, async ({ page }) => {
    await openAvatarSetup(page, locale)
    await expect(page.locator('.scene-canvas canvas')).toBeVisible()
    await page.route('http://localhost:8787/parties/current/scene', route => route.fulfill({ status: 404 }))
    const refresh = page.getByRole('button', { name: locale === 'es' ? 'Actualizar prado' : 'Refresh pasture' })
    await refresh.click()
    await expect(page.getByRole('alert')).toContainText(locale === 'es' ? 'No pudimos cargar tu prado' : 'We could not load your pasture')
    await expect(page.locator('.scene-canvas canvas')).toHaveCount(0)
    await page.unroute('http://localhost:8787/parties/current/scene')
    await page.route('http://localhost:8787/parties/current/scene', route => route.fulfill({ json: {
      party: { id: '84', species: 'COW', environment: { code: 'PASTURE', definition: {
        version: 1, scene: 'PASTURE', zones: [], props: [], capabilities: [],
      } } }, members: [{ membershipId: '85', nickname: 'Fern', joinedAt: '2026-09-11T08:00:00.000Z', avatarVersion: 1 }],
    } }))
    await page.route('http://localhost:8787/parties/current/avatars/85', route => route.fulfill({ status: 500 }))
    await refresh.click()
    await expect(page.locator('.scene-canvas canvas')).toBeVisible()
    await expect(page.getByText(locale === 'es' ? 'No pudimos cargar algunas fotos.' : 'Some photos could not load.', { exact: false })).toBeVisible()
    await page.route('**/cow-atlas.png*', route => route.fulfill({ status: 500 }))
    await refresh.click()
    await expect(page.getByRole('alert')).toContainText(locale === 'es' ? 'No pudimos cargar tu prado' : 'We could not load your pasture')
    await expect(page.locator('.scene-canvas canvas')).toHaveCount(0)
    await expect(page.getByRole('list', { name: locale === 'es' ? 'Miembros del prado' : 'Pasture members' }).locator('.q-item')).toHaveCount(1)
  })
}

test('happy path automatically prepares camera and gallery faces in English', async ({ page }) => {
  await useCameraPhoto(page)
  const storage = await openAvatarSetup(page, 'en')
  await expect(page.locator('script[src*="vision_wasm"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Take a photo' }).click()
  await expect(page.getByRole('button', { name: 'Capture photo' })).toBeEnabled()
  await expect(page.locator('.face-overlay circle')).toHaveCount(6, { timeout: 20_000 })
  const overlay = await page.locator('.face-overlay circle').first().evaluate((dot) => ({
    fill: getComputedStyle(dot).fill,
    stroke: getComputedStyle(dot).stroke,
    x: Number(dot.getAttribute('cx')),
    y: Number(dot.getAttribute('cy')),
  }))
  expect(overlay).toMatchObject({ fill: 'rgb(148, 168, 154)', stroke: 'rgb(239, 176, 161)' })
  expect(overlay.x).toBeGreaterThan(0)
  expect(overlay.x).toBeLessThan(1)
  expect(overlay.y).toBeGreaterThan(0)
  expect(overlay.y).toBeLessThan(1)
  await page.getByRole('button', { name: 'Close camera' }).click()
  expect(await page.evaluate(() => window.cameraTestTracks.every((track) => track.readyState === 'ended'))).toBe(true)
  await expect(page.locator('video')).toHaveCount(0)
  await page.getByRole('button', { name: 'Take a photo' }).click()
  await expect(page.getByRole('button', { name: 'Capture photo' })).toBeEnabled()
  await page.getByRole('button', { name: 'Capture photo' }).click()
  await expect.poll(() => page.evaluate(() => window.cameraTestTracks.every((track) => track.readyState === 'ended'))).toBe(true)
  await expect(page.locator('video')).toHaveCount(0)

  const preparedAvatar = page.getByRole('img', { name: 'Prepared cow avatar' })
  for (const source of ['camera', 'gallery']) {
    if (source === 'gallery') {
      await page.locator('input[type="file"]').setInputFiles({ name: 'face.jpg', mimeType: 'image/jpeg', buffer: facePhoto })
    }
    await expect(page.getByText(/Your 512 × 512 WebP is ready/)).toBeVisible({ timeout: 20_000 })
    await expect(preparedAvatar).toBeVisible()
    await expect(page.getByRole('slider')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Prepare avatar' })).toHaveCount(0)
    const output = await preparedAvatar.evaluate(async (image) => {
      await image.decode()
      const blob = await fetch(image.src).then((response) => response.blob())
      return { width: image.naturalWidth, height: image.naturalHeight, type: blob.type, size: blob.size }
    })
    expect(output).toMatchObject({ width: 512, height: 512, type: 'image/webp' })
    expect(output.size).toBeLessThanOrEqual(512 * 1_024)
    const initialUrl = await preparedAvatar.getAttribute('src')
    await page.getByRole('button', { name: 'Adjust crop' }).click()
    await expect(page.getByRole('img', { name: 'Avatar crop preview' })).toBeVisible()
    await page.getByRole('slider', { name: 'Space around face' }).press('End')
    await page.getByRole('button', { name: 'Reset crop' }).click()
    await expect(page.getByRole('slider', { name: 'Space around face' })).toHaveAttribute('aria-valuenow', '1')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('slider')).toHaveCount(0)
    expect(await preparedAvatar.getAttribute('src')).toBe(initialUrl)
    await page.getByRole('button', { name: 'Adjust crop' }).click()
    await page.getByRole('slider', { name: 'Space around face' }).press('End')
    await page.getByRole('slider', { name: 'Move frame horizontally' }).press('Home')
    await page.getByRole('slider', { name: 'Move frame vertically' }).press('End')
    await page.getByRole('button', { name: 'Apply crop' }).click()
    await expect(page.getByRole('slider')).toHaveCount(0)
    await expect(preparedAvatar).not.toHaveAttribute('src', initialUrl)
    const edited = await preparedAvatar.evaluate(async (image) => {
      await image.decode()
      const blob = await fetch(image.src).then((response) => response.blob())
      return { width: image.naturalWidth, height: image.naturalHeight, type: blob.type, size: blob.size }
    })
    expect(edited).toMatchObject({ width: 512, height: 512, type: 'image/webp' })
    expect(edited.size).toBeLessThanOrEqual(512 * 1_024)
    await page.getByRole('button', { name: 'Save avatar', exact: true }).click()
    await expect(page.getByText('Your avatar is saved. Only your Party can see it.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save avatar', exact: true })).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('img', { name: 'Saved cow avatar', exact: true })).toBeVisible()
    expect(storage.uploads).toBe(source === 'camera' ? 1 : 2)
  }
  await page.getByRole('button', { name: 'Remove avatar', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('img', { name: 'Saved cow avatar', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Remove avatar', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove avatar', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('No saved avatar yet.')).toBeVisible()
  expect(storage.bytes).toBeNull()
  await page.getByRole('button', { name: 'Take a photo' }).click()
  await expect(page.getByRole('button', { name: 'Capture photo' })).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect.poll(() => page.evaluate(() => window.cameraTestTracks.every((track) => track.readyState === 'ended'))).toBe(true)
  // Sign-out remains accessible while camera permission is pending, and cancels late streams.
  await page.evaluate(() => {
    const open = navigator.mediaDevices.getUserMedia
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await open(constraints)
      return new Promise((resolve) => { window.releaseCamera = () => resolve(stream) })
    }
  })
  await page.getByRole('button', { name: 'Take a photo' }).click()
  await expect.poll(() => page.evaluate(() => typeof window.releaseCamera)).toBe('function')
  await page.getByRole('button', { name: 'Close camera' }).click()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.evaluate(() => window.releaseCamera())
  await expect.poll(() => page.evaluate(() => window.cameraTestTracks.every((track) => track.readyState === 'ended'))).toBe(true)
})

test('failure path handles camera failures and invalid files in Spanish', async ({ page }) => {
  await useCameraPhoto(page)
  const storage = await openAvatarSetup(page, 'es')
  await page.evaluate(() => { window.cameraTestBlank = true })
  await page.getByRole('button', { name: 'Tomar una foto' }).click()
  await expect(page.getByRole('button', { name: 'Capturar foto' })).toBeEnabled()
  await expect(page.getByText('No se detectó un rostro claro.', { exact: false })).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.face-overlay circle')).toHaveCount(0)
  await page.getByRole('button', { name: 'Capturar foto' }).click()
  await expect(page.getByRole('alert')).toContainText('No se detectó un rostro claro.', { timeout: 20_000 })
  await expect.poll(() => page.evaluate(() => window.cameraTestTracks.every((track) => track.readyState === 'ended'))).toBe(true)
  const photos = await page.evaluate(async () => {
    const photo = await createImageBitmap(await fetch('/test-face.jpg').then((response) => response.blob()))
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 400
    const context = canvas.getContext('2d')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    const noFace = canvas.toDataURL('image/png').split(',')[1]
    context.drawImage(photo, 245, 20, 320, 400, 0, 0, 320, 400)
    context.drawImage(photo, 245, 20, 320, 400, 320, 0, 320, 400)
    photo.close()
    return { noFace, multipleFaces: canvas.toDataURL('image/png').split(',')[1] }
  })
  for (const testCase of [
    { photo: photos.noFace, message: 'No se detectó un rostro claro.' },
    { photo: photos.multipleFaces, message: 'Se detectó más de un rostro.' },
  ]) {
    await page.locator('input[type="file"]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(testCase.photo, 'base64') })
    await expect(page.getByRole('alert')).toContainText(testCase.message)
    await expect(page.getByRole('img', { name: 'Avatar de vaca preparado' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Ajustar recorte' })).toHaveCount(0)
  }
  const cases = [
    { name: 'NotAllowedError', message: 'Se denegó el permiso de la cámara.' },
    { name: 'NotFoundError', message: 'La cámara no está disponible.' },
    { name: 'NotReadableError', message: 'No pudimos abrir la cámara o capturar una foto.' },
  ]
  for (const testCase of cases) {
    await page.evaluate((name) => {
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Camera test failure', name) }
    }, testCase.name)
    await page.getByRole('button', { name: 'Tomar una foto' }).click()
    await expect(page.getByRole('alert')).toContainText(testCase.message)
    await expect(page.locator('video')).toHaveCount(0)
  }
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Elegir una foto' }).click()
  const chooser = await chooserPromise
  expect(await chooser.element().getAttribute('capture')).toBeNull()
  await chooser.setFiles({
    name: 'grande.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.alloc(10 * 1_024 * 1_024 + 1),
  })

  await expect(page.getByRole('alert')).toContainText('Elige una foto de máximo 10 MB.')

  // A failed model download cannot bypass validation, and a later retry can recover.
  await page.route('**/*.tflite', (route) => route.abort())
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Avatar de vaca' })).toBeVisible()
  await page.locator('input[type="file"]').setInputFiles({ name: 'face.jpg', mimeType: 'image/jpeg', buffer: facePhoto })
  await expect(page.getByRole('alert')).toContainText('No se pudo cargar o ejecutar la detección de rostros.')
  await expect(page.getByRole('img', { name: 'Avatar de vaca preparado' })).toHaveCount(0)
  await page.unroute('**/*.tflite')
  await page.locator('input[type="file"]').setInputFiles({ name: 'face.jpg', mimeType: 'image/jpeg', buffer: facePhoto })
  await expect(page.getByRole('img', { name: 'Avatar de vaca preparado' })).toBeVisible()
  const originalPreview = await page.getByRole('img', { name: 'Avatar de vaca preparado' }).getAttribute('src')
  await page.getByRole('button', { name: 'Ajustar recorte' }).click()
  await expect(page.getByRole('slider', { name: 'Espacio alrededor del rostro' })).toBeVisible()
  await page.evaluate(() => {
    window.originalToBlob = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = (callback) => callback(null)
  })
  await page.getByRole('button', { name: 'Aplicar recorte' }).click()
  await expect(page.getByRole('alert')).toContainText('No pudimos preparar esta foto.')
  expect(await page.locator('.q-avatar img').getAttribute('src')).toBe(originalPreview)
  await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = window.originalToBlob })
  await page.getByRole('button', { name: 'Aplicar recorte' }).click()
  await expect(page.getByRole('slider')).toHaveCount(0)
  storage.saveFails = true
  await page.getByRole('button', { name: 'Guardar avatar', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('No pudimos guardar tu avatar.')
  await expect(page.getByRole('img', { name: 'Avatar de vaca preparado' })).toBeVisible()
  storage.saveFails = false
  await page.getByRole('button', { name: 'Guardar avatar', exact: true }).click()
  await expect(page.getByRole('img', { name: 'Avatar de vaca guardado' })).toBeVisible()
  storage.loadFails = true
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('No pudimos cargar tu avatar.')
  storage.loadFails = false
  await page.getByRole('button', { name: 'Reintentar carga del avatar' }).click()
  await expect(page.getByRole('img', { name: 'Avatar de vaca guardado' })).toBeVisible()
  storage.deleteFails = true
  await page.getByRole('button', { name: 'Eliminar avatar', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar avatar', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Tu avatar está oculto.')
  await expect(page.getByRole('img', { name: 'Avatar de vaca guardado' })).toHaveCount(0)
  storage.deleteFails = false
  await page.getByRole('button', { name: 'Reintentar eliminación' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar avatar', exact: true }).click()
  await expect(page.getByText('Aún no hay un avatar guardado.')).toBeVisible()
})
