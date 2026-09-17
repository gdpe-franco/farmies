import { expect, test } from '@playwright/test'

const authUserId = '03d9d8e0-a088-4f4c-a97f-967675fb4e39'
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
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
    id: '84', displayName: 'Green Friends', species: 'COW', environment: 'PASTURE',
    createdAt: '2026-09-11T08:00:00.000Z',
  },
  membership: { id: '85', nickname: 'Fern', joinedAt: '2026-09-11T08:00:00.000Z' },
  isOwner: true,
  inviteActive: false,
}

for (const testCase of [
  {
    locale: 'en', delete: 'Delete Party', confirmation: 'Delete this Party?', cancel: 'Keep Party',
    warning: 'This permanently removes the Party, invite, membership, and saved cow photo.',
    retry: 'Retry photo removal', create: 'Create a Party',
  },
  {
    locale: 'es', delete: 'Eliminar grupo', confirmation: '¿Eliminar este grupo?', cancel: 'Conservar grupo',
    warning: 'Esto elimina permanentemente el grupo, la invitación, la membresía y la foto guardada de la vaca.',
    retry: 'Reintentar eliminar la foto', create: 'Crear un grupo',
  },
]) {
  test(`a sole owner confirms Party deletion and retries cleanup in ${testCase.locale}`, async ({ page }) => {
    let deleteRequests = 0
    await page.route('**/auth/v1/otp', (route) => route.fulfill({ json: {} }))
    await page.route('**/auth/v1/verify', (route) => route.fulfill({ json: authResponse }))
    await page.route('http://localhost:8787/users/me', (route) => route.fulfill({ json: {
      user: {
        id: '42', preferredLocale: testCase.locale,
        createdAt: '2026-09-11T08:00:00.000Z', updatedAt: '2026-09-11T08:00:00.000Z',
      },
    } }))
    await page.route('http://localhost:8787/parties/current', (route) => {
      if (route.request().method() === 'DELETE') {
        expect(route.request().headers().authorization).toBe(`Bearer ${accessToken}`)
        deleteRequests++
        return route.fulfill({ status: deleteRequests === 1 ? 503 : 204 })
      }
      return route.fulfill({ json: party })
    })
    await page.route('http://localhost:8787/parties/current/transfer-candidates', (route) => route.fulfill({
      json: { members: [] },
    }))
    await page.route('http://localhost:8787/parties/current/scene', (route) => route.fulfill({ json: {
      party: { id: '84', species: 'COW', environment: { code: 'PASTURE', definition: {
        version: 1, scene: 'PASTURE', zones: [], props: [], capabilities: [],
      } } },
      members: [{ membershipId: '85', nickname: 'Fern', joinedAt: '2026-09-11T08:00:00.000Z', avatarVersion: null }],
    } }))
    await page.route('http://localhost:8787/parties/current/avatars/85', (route) => route.fulfill({ status: 404 }))

    await page.goto('/')
    if (testCase.locale === 'es') {
      await page.getByRole('button', { name: 'Language', exact: true }).click()
      await page.getByRole('menuitemradio', { name: 'Español', exact: true }).click()
    }
    await page.getByLabel(testCase.locale === 'es' ? 'Correo electrónico' : 'Email').fill('friend@example.com')
    await page.getByRole('button', { name: testCase.locale === 'es' ? 'Enviar código' : 'Send code' }).click()
    await page.getByLabel(testCase.locale === 'es' ? 'Código de seis dígitos' : 'Six-digit code').fill('123456')
    await page.getByRole('button', { name: testCase.locale === 'es' ? 'Verificar código' : 'Verify code' }).click()

    await page.getByRole('button', { name: testCase.delete, exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: testCase.confirmation })).toBeVisible()
    await expect(dialog.getByText(testCase.warning)).toBeVisible()
    await expect(dialog.getByRole('button', { name: testCase.cancel })).toBeVisible()
    await dialog.getByRole('button', { name: testCase.delete, exact: true }).click()

    await expect(page.getByRole('heading', { name: testCase.create })).toBeVisible()
    await page.getByRole('button', { name: testCase.retry }).click()
    await expect(page.getByRole('button', { name: testCase.retry })).toBeHidden()
    expect(deleteRequests).toBe(2)
  })
}
