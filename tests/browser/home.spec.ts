import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.beforeEach(async ({ page }) => {
  await page.route('https://test-project.supabase.co/**', async route => {
    const request = route.request()
    if (request.url().includes('/auth/v1/otp')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      return
    }
    if (request.url().includes('/auth/v1/user')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
})

test('public home exposes clear player and organizer entry points', async ({ page }) => {
  await page.goto('/#/')
  await expect(page.getByRole('button', { name: /I.?m a Player/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Organizer Login/ })).toBeVisible()
})

test('player invite form explains an invalid team link', async ({ page }) => {
  await page.goto('/#/')
  await page.getByRole('button', { name: /I.?m a Player/ }).click()
  await page.getByRole('textbox', { name: 'Team invitation' }).fill('not-a-team-link')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.getByRole('alert')).toContainText('64-character team code')
})

test('organizer login confirms that the email link was requested', async ({ page }) => {
  await page.goto('/#/')
  await page.getByRole('button', { name: /Organizer Login/ }).click()
  await page.getByLabel('Email address').fill('organizer@example.test')
  await page.getByRole('button', { name: /Send me a sign-in link/ }).click()
  await expect(page.getByRole('status')).toContainText('Check your email')
})

test('home fits common phone widths without horizontal page scrolling', async ({ page }) => {
  await page.goto('/#/')
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 })
    const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    expect(dimensions.content, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport)
    await expect(page.getByRole('button', { name: /I.?m a Player/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Organizer Login/ })).toBeVisible()
  }
})

test('home has no automated WCAG 2.1 A/AA violations', async ({ page }) => {
  await page.goto('/#/')
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(results.violations, JSON.stringify(results.violations.map(({ id, impact, help }) => ({ id, impact, help })), null, 2)).toEqual([])
})
