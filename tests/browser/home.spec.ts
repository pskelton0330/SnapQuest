import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

let showActiveParticipantGame = false

test.beforeEach(async ({ page }) => {
  showActiveParticipantGame = false
  await page.route('https://test-project.supabase.co/**', async route => {
    const request = route.request()
    if (request.url().includes('/rest/v1/organizers')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: '11111111-1111-4111-8111-111111111111' }]) })
      return
    }
    if (request.url().includes('/rest/v1/participants') && request.url().includes('select=hunt_id%2Cteam_id')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ hunt_id: '33333333-3333-4333-8333-333333333333', team_id: '44444444-4444-4444-8444-444444444444' }]) })
      return
    }
    if (request.url().includes('/rest/v1/hunts') && request.url().includes('select=id%2Ctitle')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: '33333333-3333-4333-8333-333333333333', title: 'Spring Photo Hunt' }]) })
      return
    }
    if (request.url().includes('/rest/v1/teams') && request.url().includes('select=id%2Cname')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: '44444444-4444-4444-8444-444444444444', name: 'Team Cedar' }]) })
      return
    }
    if (request.url().includes('/rest/v1/participants') || request.url().includes('/rest/v1/library_items') || request.url().includes('/rest/v1/hunts')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      return
    }
    if (request.url().includes('/rest/v1/rpc/preview_invitation')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Spring Photo Hunt', venue: 'Town Park', team_name: 'Team Cedar', start_at: '2026-12-01T17:00:00Z', duration_minutes: 60 }) })
      return
    }
    if (request.url().includes('/rest/v1/rpc/redeem_invitation')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hunt_id: '33333333-3333-4333-8333-333333333333', participant_id: '55555555-5555-4555-8555-555555555555', title: 'Spring Photo Hunt' }) })
      return
    }
    if (request.url().includes('/rest/v1/rpc/get_participant_context')) {
      const now = Date.now()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ participant_id: '55555555-5555-4555-8555-555555555555', hunt_id: '33333333-3333-4333-8333-333333333333', title: 'Spring Photo Hunt', venue: 'Town Park', rules: ['Stay together'], status: showActiveParticipantGame ? 'active' : 'scheduled', runtime_state: showActiveParticipantGame ? 'active' : 'waiting', start_at: showActiveParticipantGame ? new Date(now - 60_000).toISOString() : null, ends_at: showActiveParticipantGame ? new Date(now + 3_540_000).toISOString() : null, duration_minutes: 60, server_now: new Date(now).toISOString(), team: { id: '44444444-4444-4444-8444-444444444444', name: 'Team Cedar', display_color: '#15967a', selfie: null }, participant: { id: '55555555-5555-4555-8555-555555555555', display_name: 'Taylor' }, teammates: [{ id: '55555555-5555-4555-8555-555555555555', display_name: 'Taylor' }] }) })
      return
    }
    if (request.url().includes('/rest/v1/rpc/get_hunt_progress')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: showActiveParticipantGame ? JSON.stringify([{ team_id: '44444444-4444-4444-8444-444444444444', team_name: 'Team Cedar', display_color: '#15967a', accepted_count: 1, total_items: 2 }]) : '[]' })
      return
    }
    if (request.url().includes('/rest/v1/hunt_items')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: '77777777-7777-4777-8777-777777777777', title_snapshot: 'A red leaf', description_snapshot: 'Find one on the trail.', point_value: 10, display_order: 1 }, { id: '88888888-8888-4888-8888-888888888888', title_snapshot: 'A park sign', description_snapshot: null, point_value: 5, display_order: 2 }]) })
      return
    }
    if (request.url().includes('/rest/v1/rpc/is_hunt_organizer')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: 'false' })
      return
    }
    if (request.url().includes('/auth/v1/signup')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: 'anonymous-access-token', token_type: 'bearer', expires_in: 3600, refresh_token: 'anonymous-refresh-token', user: { id: '66666666-6666-4666-8666-666666666666', aud: 'authenticated', role: 'authenticated', email: '', app_metadata: { provider: 'anonymous', providers: ['anonymous'] }, user_metadata: {}, identities: [], created_at: new Date().toISOString(), is_anonymous: true } }) })
      return
    }
    if (request.url().includes('/auth/v1/otp')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      return
    }
    if (request.url().includes('/auth/v1/user')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: '22222222-2222-4222-8222-222222222222', aud: 'authenticated', role: 'authenticated', email: 'organizer@example.test', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [], created_at: new Date().toISOString(), is_anonymous: false }) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
})

async function restoreOrganizerSession(page: import('@playwright/test').Page) {
  const user = {
    id: '22222222-2222-4222-8222-222222222222',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'organizer@example.test',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
    created_at: new Date().toISOString(),
    is_anonymous: false,
  }
  await page.addInitScript(userData => {
    localStorage.setItem('sb-test-project-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: userData }))
  }, user)
}

test('public home exposes clear player and organizer entry points', async ({ page }) => {
  await page.goto('/#/')
  await expect(page.getByRole('button', { name: /I.?m a Player/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Organizer Login/ })).toBeVisible()
})

test('public home does not download organizer or gameplay routes', async ({ page }) => {
  const routeChunks: string[] = []
  page.on('request', request => {
    if (/\/assets\/(OrganizerWorkspace|ParticipantGame|JoinGame)-[^/]+\.js/.test(request.url())) routeChunks.push(request.url())
  })
  await page.goto('/#/', { waitUntil: 'networkidle' })
  expect(routeChunks).toEqual([])
})

test('player invite form explains an invalid team link', async ({ page }) => {
  await page.goto('/#/')
  await page.getByRole('button', { name: /I.?m a Player/ }).click()
  await page.getByRole('textbox', { name: 'Team invitation' }).fill('not-a-team-link')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.getByRole('alert')).toContainText('64-character team code')
})

test('valid team invite opens the correct join preview and name form', async ({ page }) => {
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await expect(page.getByRole('heading', { name: 'Spring Photo Hunt' })).toBeVisible()
  await expect(page.getByText('Town Park')).toBeVisible()
  await expect(page.getByLabel('What should your team call you?')).toBeVisible()
})

test('player can join an invited team and reach the waiting lobby', async ({ page }) => {
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await expect(page.getByRole('heading', { name: 'Spring Photo Hunt' })).toBeVisible()
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.getByRole('status')).toContainText('Waiting for the organizer', { timeout: 10_000 })
  await expect(page.getByText('GET READY, TEAM CEDAR')).toBeVisible()
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 })
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
      inputs: [...document.querySelectorAll<HTMLInputElement>('input')].map(element => ({ type: element.type, placeholder: element.placeholder, label: element.getAttribute('aria-label'), name: element.name, parent: element.parentElement?.className, rect: element.getBoundingClientRect().toJSON() })),
      bounding: [...document.querySelectorAll<HTMLElement>('*')]
        .map(element => ({ tag: element.tagName, className: typeof element.className === 'string' ? element.className : '', right: Math.round(element.getBoundingClientRect().right), left: Math.round(element.getBoundingClientRect().left) }))
        .filter(element => element.right > document.documentElement.clientWidth + 1 || element.left < -1)
        .slice(0, 8),
      offenders: [...document.querySelectorAll<HTMLElement>('*')]
        .filter(element => element.scrollWidth > element.clientWidth + 2)
        .map(element => ({ className: typeof element.className === 'string' ? element.className : '', scroll: element.scrollWidth, client: element.clientWidth, right: Math.round(element.getBoundingClientRect().right) }))
        .slice(0, 8),
    }))
    expect(dimensions.content, `player lobby horizontal overflow at ${width}px; inputs: ${JSON.stringify(dimensions.inputs)}; bounds: ${JSON.stringify(dimensions.bounding)}; offenders: ${JSON.stringify(dimensions.offenders)}`).toBeLessThanOrEqual(dimensions.viewport)
  }
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(results.violations, JSON.stringify(results.violations.map(({ id, impact, help, nodes }) => ({ id, impact, help, nodes: nodes.map(node => ({ target: node.target, ...node.any[0]?.data })) })), null, 2)).toEqual([])
})

test('active participant game exposes the timer, team progress, and photo list', async ({ page }) => {
  showActiveParticipantGame = true
  const progressResponses: string[] = []
  page.on('response', async response => {
    if (response.url().includes('/rpc/get_hunt_progress')) progressResponses.push(await response.text())
  })
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.getByText('Your photo list')).toBeVisible()
  await expect(page.getByText('A red leaf')).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Time remaining' })).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Team Cedar accepted photos' }), `progress RPC responses: ${progressResponses.join(', ')}`).toHaveAttribute('aria-valuenow', '1')
  await expect(page.getByRole('article').filter({ hasText: 'A red leaf' }).getByText('Take or choose photo')).toBeVisible()
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 })
    const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    expect(dimensions.content, `active game horizontal overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport)
  }
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(results.violations, JSON.stringify(results.violations.map(({ id, impact, help, nodes }) => ({ id, impact, help, targets: nodes.map(node => node.target) })), null, 2)).toEqual([])
})

test('organizer login confirms that the email link was requested', async ({ page }) => {
  await page.goto('/#/')
  await page.getByRole('button', { name: /Organizer Login/ }).click()
  await page.getByLabel('Email address').fill('organizer@example.test')
  await page.getByRole('button', { name: /Send me a sign-in link/ }).click()
  await expect(page.getByRole('status')).toContainText('Check your email')
})

test('restored organizer session opens the production organizer workspace', async ({ page }) => {
  await restoreOrganizerSession(page)
  await page.goto('/#/')
  await expect(page.getByRole('heading', { name: /Welcome in/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Create your first hunt' })).toBeVisible()
  const returnToTeam = page.getByRole('link', { name: /Return to Team Cedar/ })
  await expect(returnToTeam).toHaveAttribute('href', '#/play/33333333-3333-4333-8333-333333333333')
})

test('organizer workspace fits common phone widths without horizontal scrolling', async ({ page }) => {
  await restoreOrganizerSession(page)
  await page.goto('/#/')
  await expect(page.getByRole('heading', { name: /Welcome in/ })).toBeVisible()
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 })
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
      offenders: [...document.querySelectorAll<HTMLElement>('*')]
        .map(element => ({ selector: `${element.tagName.toLowerCase()}${element.className && typeof element.className === 'string' ? `.${element.className.trim().replace(/\s+/g, '.')}` : ''}`, right: Math.round(element.getBoundingClientRect().right) }))
        .filter(element => element.right > document.documentElement.clientWidth + 1)
        .sort((a, b) => b.right - a.right)
        .slice(0, 5),
    }))
    expect(dimensions.content, `organizer horizontal overflow at ${width}px; offenders: ${JSON.stringify(dimensions.offenders)}`).toBeLessThanOrEqual(dimensions.viewport)
  }
})

test('organizer workspace has no automated WCAG 2.1 A/AA violations', async ({ page }) => {
  await restoreOrganizerSession(page)
  await page.goto('/#/')
  await expect(page.getByRole('heading', { name: /Welcome in/ })).toBeVisible()
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(results.violations, JSON.stringify(results.violations.map(({ id, impact, help, nodes }) => ({ id, impact, help, nodes: nodes.map(node => ({ target: node.target, ...node.any[0]?.data })) })), null, 2)).toEqual([])
})

test('an unavailable saved player session gives a working return-home action', async ({ page }) => {
  await page.goto('/#/play/123e4567-e89b-12d3-a456-426614174000')
  await expect(page.getByRole('heading', { name: 'Your saved game session is unavailable' })).toBeVisible()
  await page.getByRole('link', { name: 'Return home' }).click()
  await expect(page.getByRole('button', { name: /I.?m a Player/ })).toBeVisible()
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

test('home supports keyboard-only entry to the player form', async ({ page }) => {
  await page.goto('/#/')
  const playerButton = page.getByRole('button', { name: /I.?m a Player/ })
  await page.keyboard.press('Tab')
  await expect(playerButton).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Team invitation' })).toBeFocused()
})

test('home stays usable at 200% text size on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto('/#/')
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  await expect(page.getByRole('button', { name: /I.?m a Player/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Organizer Login/ })).toBeVisible()
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
  expect(dimensions.content, 'horizontal overflow at 200% text size').toBeLessThanOrEqual(dimensions.viewport)
})

test('home has no automated WCAG 2.1 A/AA violations', async ({ page }) => {
  await page.goto('/#/')
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(results.violations, JSON.stringify(results.violations.map(({ id, impact, help }) => ({ id, impact, help })), null, 2)).toEqual([])
})
