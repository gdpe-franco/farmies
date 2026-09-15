import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const facePhoto = await readFile(new URL('../fixtures/face.jpg', import.meta.url))

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
  await page.route('**/test-face.jpg', (route) => route.fulfill({ contentType: 'image/jpeg', body: facePhoto }))
  await page.route('**/auth/v1/otp', (route) => route.fulfill({ json: {} }))
  await page.route('**/auth/v1/verify', (route) => route.fulfill({ json: authResponse }))
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

  await page.goto('/')
  if (locale === 'es') await page.locator('#locale').selectOption('es')
  await page.getByLabel(locale === 'es' ? 'Correo electrónico' : 'Email').fill('friend@example.com')
  await page.getByRole('button', { name: locale === 'es' ? 'Enviar código' : 'Send code' }).click()
  await page.getByLabel(locale === 'es' ? 'Código de seis dígitos' : 'Six-digit code').fill('123456')
  await page.getByRole('button', { name: locale === 'es' ? 'Verificar código' : 'Verify code' }).click()
  await expect(page.getByRole('heading', {
    name: locale === 'es' ? 'Avatar de vaca' : 'Cow avatar',
  })).toBeVisible()
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

test('happy path automatically prepares camera and gallery faces in English', async ({ page }) => {
  await useCameraPhoto(page)
  await openAvatarSetup(page, 'en')
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
  expect(overlay).toMatchObject({ fill: 'rgb(39, 103, 73)', stroke: 'rgb(244, 201, 93)' })
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
  }
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
  await openAvatarSetup(page, 'es')
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
})
