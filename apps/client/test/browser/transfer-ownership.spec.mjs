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
    locale: 'en', heading: 'Party ownership', select: 'New owner', transfer: 'Transfer ownership',
    confirmation: 'Transfer Party ownership?', prompt: 'Make Moss the new owner? You will remain a regular member.',
    cancel: 'Keep ownership', leave: 'Leave Party', signOut: 'Sign out',
  },
  {
    locale: 'es', heading: 'Propiedad del grupo', select: 'Nueva persona propietaria', transfer: 'Transferir propiedad',
    confirmation: '¿Transferir la propiedad del grupo?',
    prompt: '¿Hacer que Moss sea la nueva persona propietaria? Permanecerás como integrante.',
    cancel: 'Conservar propiedad', leave: 'Salir del grupo', signOut: 'Cerrar sesión',
  },
]) {
  test(`an owner transfers Party ownership in ${testCase.locale}`, async ({ page }) => {
    let transferBody
    await page.route('**/auth/v1/otp', (route) => route.fulfill({ json: {} }))
    await page.route('**/auth/v1/verify', (route) => route.fulfill({ json: authResponse }))
    await page.route('http://localhost:8787/users/me', (route) => route.fulfill({ json: {
      user: {
        id: '42', preferredLocale: testCase.locale,
        createdAt: '2026-09-11T08:00:00.000Z', updatedAt: '2026-09-11T08:00:00.000Z',
      },
    } }))
    await page.route('http://localhost:8787/parties/current', (route) => route.fulfill({ json: party }))
    await page.route('http://localhost:8787/parties/current/transfer-candidates', (route) => route.fulfill({
      json: { members: [{ membershipId: '86', nickname: 'Moss' }] },
    }))
    await page.route('http://localhost:8787/parties/current/owner', async (route) => {
      expect(route.request().headers().authorization).toBe(`Bearer ${accessToken}`)
      expect(route.request().method()).toBe('PATCH')
      transferBody = route.request().postDataJSON()
      await route.fulfill({ status: 204 })
    })
    await page.route('http://localhost:8787/parties/current/scene', (route) => route.fulfill({ json: {
      party: { id: '84', species: 'COW', environment: { code: 'PASTURE', definition: {
        version: 1, scene: 'PASTURE', zones: [], props: [], capabilities: [],
      } } },
      members: [
        { membershipId: '85', nickname: 'Fern', joinedAt: '2026-09-11T08:00:00.000Z', avatarVersion: null },
        { membershipId: '86', nickname: 'Moss', joinedAt: '2026-09-11T08:01:00.000Z', avatarVersion: null },
      ],
    } }))
    await page.route('http://localhost:8787/parties/current/avatars/*', (route) => route.fulfill({ status: 404 }))

    await page.goto('/')
    if (testCase.locale === 'es') {
      await page.getByRole('button', { name: 'Language', exact: true }).click()
      await page.getByRole('menuitemradio', { name: 'Español', exact: true }).click()
    }
    await page.getByLabel(testCase.locale === 'es' ? 'Correo electrónico' : 'Email').fill('friend@example.com')
    await page.getByRole('button', { name: testCase.locale === 'es' ? 'Enviar código' : 'Send code' }).click()
    await page.getByLabel(testCase.locale === 'es' ? 'Código de seis dígitos' : 'Six-digit code').fill('123456')
    await page.getByRole('button', { name: testCase.locale === 'es' ? 'Verificar código' : 'Verify code' }).click()

    const ownershipPanel = page.getByRole('heading', { name: testCase.heading }).locator('..')
    await expect(ownershipPanel).toBeVisible()
    await expect(ownershipPanel.locator('.q-select .q-icon svg')).toBeVisible()
    await page.getByLabel(testCase.select).click()
    await page.getByRole('option', { name: 'Moss' }).click()
    await page.getByRole('button', { name: testCase.transfer, exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: testCase.confirmation })).toBeVisible()
    await expect(dialog.getByText(testCase.prompt)).toBeVisible()
    await expect(dialog.getByRole('button', { name: testCase.cancel })).toBeVisible()
    await dialog.getByRole('button', { name: testCase.transfer, exact: true }).click()

    await expect(page.getByRole('heading', { name: testCase.heading, exact: true })).toBeHidden()
    const leaveButton = page.getByRole('button', { name: testCase.leave, exact: true })
    const signOutButton = page.getByRole('button', { name: testCase.signOut, exact: true })
    await expect(leaveButton).toBeVisible()
    await expect(signOutButton).toBeVisible()
    const [leaveBox, signOutBox] = await Promise.all([leaveButton.boundingBox(), signOutButton.boundingBox()])
    expect(leaveBox?.y).toBe(signOutBox?.y)
    expect(transferBody).toEqual({ successorMembershipId: '86' })
  })
}
