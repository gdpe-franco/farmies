import { expect, test } from '@playwright/test'

const selectTheme = async (page, mode) => {
  await page.getByRole('button', { name: /^(Theme|Tema)$/ }).click()
  const names = { light: /^(Light|Claro)$/, dark: /^(Dark|Oscuro)$/, system: /^(Follow system|Seguir al sistema)$/ }
  await page.getByRole('menuitemradio', { name: names[mode] }).click()
}

const contrast = (foreground, background) => {
  const luminance = (color) => {
    const [r, g, b] = color.match(/[\d.]+/g).slice(0, 3).map(Number)
      .map((channel) => channel / 255)
      .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

test('happy path: named palette, readable controls, focus, and responsive layouts', async ({ page }) => {
  for (const row of [
    { locale: 'en', width: 360, email: 'Email', dark: false },
    { locale: 'es', width: 1280, email: 'Correo electrónico', dark: false },
    { locale: 'en', width: 360, email: 'Email', dark: true },
    { locale: 'es', width: 1280, email: 'Correo electrónico', dark: true },
  ]) {
    await page.setViewportSize({ width: row.width, height: 800 })
    await page.goto('/')
    await page.getByRole('button', { name: /^(Language|Idioma)$/ }).click()
    await page.getByRole('menuitemradio', { name: row.locale === 'es' ? /^(Spanish|Español)$/ : /^(English|Inglés)$/ }).click()
    await selectTheme(page, row.dark ? 'dark' : 'light')
    await page.reload()
    await expect(page.locator('body')).toHaveClass(row.dark ? /body--dark/ : /body--light/)
    await expect(page.getByLabel(row.email, { exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', row.locale)
    await expect(page.getByRole('banner')).toBeVisible()
    await expect(page.getByRole('main')).toBeVisible()
    await expect(page.getByRole('button', { name: /^(Theme|Tema)$/ })).toHaveAccessibleDescription(
      row.locale === 'es' ? (row.dark ? 'Oscuro' : 'Claro') : (row.dark ? 'Dark' : 'Light'),
    )
    const palette = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement)
      return ['muted-teal', 'almond-silk', 'grey', 'thistle', 'powder-blush']
        .map((name) => root.getPropertyValue(`--farmies-${name}`).trim())
    })
    expect(palette).toEqual(['#94a89a', '#c9b7ad', '#797d81', '#cab1bd', '#efb0a1'])
    const colors = await page.locator('button[type="submit"]').evaluate((button) => {
      const style = getComputedStyle(button)
      const card = getComputedStyle(document.querySelector('.farmies-card'))
      const body = getComputedStyle(document.body)
      const header = getComputedStyle(document.querySelector('.farmies-header'))
      const label = getComputedStyle(document.querySelector('.farmies-card .q-field__label'))
      return {
        button: style.color, action: style.backgroundColor, text: card.color, surface: card.backgroundColor,
        header: header.backgroundColor, headerText: header.color, background: body.backgroundColor, label: label.color,
      }
    })
    expect(contrast(colors.button, colors.action)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(colors.text, colors.surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(colors.headerText, colors.header)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(colors.label, colors.surface)).toBeGreaterThanOrEqual(4.5)
    expect(colors.action).toBe('rgb(148, 168, 154)')
    expect(colors.header).toBe(row.dark ? 'rgb(64, 93, 75)' : 'rgb(148, 168, 154)')
    expect(colors.background).toBe(row.dark ? 'rgb(30, 37, 34)' : 'rgb(237, 226, 219)')
    const toggleColors = await page.getByRole('button', { name: /^(Theme|Tema)$/ }).evaluate((element) => {
      const style = getComputedStyle(element)
      return { text: style.color, background: style.backgroundColor }
    })
    expect(contrast(toggleColors.text, colors.header)).toBeGreaterThanOrEqual(4.5)
    for (const arrow of await page.locator('.q-btn-dropdown__arrow').all()) await expect(arrow).toBeHidden()
    const size = await page.getByRole('button', { name: /^(Theme|Tema)$/ }).boundingBox()
    expect(size.height).toBeGreaterThanOrEqual(48)
    await page.getByRole('button', { name: /^(Language|Idioma)$/ }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menu')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toBeHidden()
    await page.getByRole('button', { name: /^(Language|Idioma)$/ }).focus()
    await page.keyboard.press('Tab')
    await expect(page.getByLabel(row.email, { exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    const button = page.locator('button[type="submit"]')
    await expect(button).toBeFocused()
    await expect(button).toHaveCSS('outline-color', row.dark ? 'rgb(202, 177, 189)' : 'rgb(119, 85, 100)')
    await expect(button).toHaveCSS('outline-style', 'solid')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.emulateMedia({ colorScheme: 'dark' })
  await selectTheme(page, 'system')
  await expect(page.locator('body')).toHaveClass(/body--dark/)
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('body')).toHaveClass(/body--light/)
  await page.reload()
  await expect(page.getByRole('button', { name: /^(Theme|Tema)$/ })).toContainText('Seguir al sistema')
  await selectTheme(page, 'dark')
  await expect(page.locator('body')).toHaveClass(/body--dark/)
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('body')).toHaveClass(/body--dark/)
})

test('failure path: errors stay readable and distinct from decorative Powder Blush', async ({ page }) => {
  await page.route('**/auth/v1/otp', (route) => route.fulfill({ status: 500, json: { message: 'Unavailable' } }))
  for (const row of [
    { locale: 'en', email: 'Email', dark: false },
    { locale: 'es', email: 'Correo electrónico', dark: true },
  ]) {
    await page.goto('/')
    await page.getByRole('button', { name: /^(Language|Idioma)$/ }).click()
    await page.getByRole('menuitemradio', { name: row.locale === 'es' ? /^(Spanish|Español)$/ : /^(English|Inglés)$/ }).click()
    await selectTheme(page, row.dark ? 'dark' : 'light')
    await page.getByLabel(row.email, { exact: true }).fill('friend@example.com')
    await page.locator('button[type="submit"]').click()
    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible()
    const colors = await alert.evaluate((element) => {
      const style = getComputedStyle(element)
      return { text: style.color, background: style.backgroundColor }
    })
    expect(contrast(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5)
    expect(colors.background).not.toBe('rgb(239, 176, 161)')
  }
})
