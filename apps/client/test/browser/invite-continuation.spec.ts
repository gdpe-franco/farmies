import { expect, test } from '@playwright/test'

const inviteToken = 'a'.repeat(43)
const authUserId = '03d9d8e0-a088-4f4c-a97f-967675fb4e39'

const encode = (value: object) => btoa(JSON.stringify(value))
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

const cases = [
  {
    name: 'English',
    locale: 'en',
    received: 'You received a Party invite',
    verificationError: 'That code is invalid or expired. Check the code and try again.',
    confirmation: 'Join this Party?',
    occupancy: '4 of 10 members',
    signOut: 'Sign out',
  },
  {
    name: 'Spanish',
    locale: 'es',
    received: 'Recibiste una invitación a un grupo',
    verificationError: 'El código no es válido o venció. Revísalo e inténtalo de nuevo.',
    confirmation: '¿Unirte a este grupo?',
    occupancy: '4 de 10 integrantes',
    signOut: 'Cerrar sesión',
  },
]

for (const testCase of cases) {
  test(`${testCase.name} invite survives authentication, reload, and retry`, async ({ page }) => {
    let verificationAttempts = 0

    await page.route('**/auth/v1/otp', (route) => route.fulfill({ json: {} }))
    await page.route('**/auth/v1/verify', (route) => {
      verificationAttempts += 1
      return verificationAttempts === 1
        ? route.fulfill({ status: 400, json: { message: 'Invalid token' } })
        : route.fulfill({ json: authResponse })
    })
    await page.route('**/auth/v1/logout**', (route) => route.fulfill({ status: 204 }))
    await page.route('http://localhost:8787/users/me', (route) => route.fulfill({
      json: {
        user: {
          id: '42',
          preferredLocale: testCase.locale,
          createdAt: '2026-09-11T08:00:00.000Z',
          updatedAt: '2026-09-11T08:00:00.000Z',
        },
      },
    }))
    await page.route(`http://localhost:8787/invites/${inviteToken}`, (route) => route.fulfill({
      json: { party: { displayName: 'Green Friends', occupancy: 4, capacity: 10 } },
    }))

    await page.goto(`/invite/${inviteToken}`)
    if (testCase.locale === 'es') await page.locator('#locale').selectOption('es')
    await expect(page.getByText(testCase.received)).toBeVisible()
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('farmies.pendingInviteToken')))
      .toBe(inviteToken)

    const emailLabel = testCase.locale === 'es' ? 'Correo electrónico' : 'Email'
    const sendLabel = testCase.locale === 'es' ? 'Enviar código' : 'Send code'
    await page.getByLabel(emailLabel).fill('friend@example.com')
    await page.getByRole('button', { name: sendLabel }).click()
    await page.reload()
    await expect(page.getByText(testCase.received)).toBeVisible()

    await page.getByLabel(emailLabel).fill('friend@example.com')
    await page.getByRole('button', { name: sendLabel }).click()
    const codeLabel = testCase.locale === 'es' ? 'Código de seis dígitos' : 'Six-digit code'
    const verifyLabel = testCase.locale === 'es' ? 'Verificar código' : 'Verify code'
    await page.getByLabel(codeLabel).fill('123456')
    await page.getByRole('button', { name: verifyLabel }).click()
    await expect(page.getByText(testCase.verificationError)).toBeVisible()
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('farmies.pendingInviteToken')))
      .toBe(inviteToken)

    await page.getByRole('button', { name: verifyLabel }).click()
    await expect(page.getByRole('heading', { name: testCase.confirmation })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Green Friends' })).toBeVisible()
    await expect(page.getByText(testCase.occupancy)).toBeVisible()

    await page.getByRole('button', { name: testCase.signOut }).click()
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('farmies.pendingInviteToken')))
      .toBeNull()
  })
}
