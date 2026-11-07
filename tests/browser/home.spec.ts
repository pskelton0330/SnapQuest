import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'

let participantRuntimeState: 'waiting' | 'active' | 'review' | 'completed' = 'waiting'
let photoFaultMode: 'committed-rpc-response-lost' | 'storage-denied' | 'rpc-rejected' | null = null
let uploadedPhotoPath = ''
let photoSubmissionRpcCalls = 0
let selfieSubmissionRpcCalls = 0
let rollbackDeleteRequests = 0
let organizerReviewMode = false
let organizerTieMode = false
let organizerLobbyMode = false
let organizerReviewStatus: 'review' | 'completed' = 'review'
let organizerReviewDecision: 'pending' | 'approved' | 'rejected' = 'pending'
let organizerLobbyStatus: 'scheduled' | 'active' | 'review' = 'scheduled'
let organizerStartCalls = 0
let organizerMessages: { id: string; sender_name: string; sender_role: 'organizer' | 'participant'; body: string; created_at: string }[] = []
let chatLoadFailures = 0
let chatSendFailures = 0
let signedPreviewMode = false
let signedPreviewRequests = 0
let participantReviewPhotoStatus: 'pending' | 'approved' | 'rejected' | null = null
let participantReviewVotingMode = false
let participantReviewVotes: { item_id: string; voting_team_id: string; selected_team_id: string }[] = []
let participantTieMode = false
let participantZeroScoreMode = false

test.beforeEach(async ({ page }) => {
  participantRuntimeState = 'waiting'
  photoFaultMode = null
  uploadedPhotoPath = ''
  photoSubmissionRpcCalls = 0
  selfieSubmissionRpcCalls = 0
  rollbackDeleteRequests = 0
  organizerReviewMode = false
  organizerTieMode = false
  organizerLobbyMode = false
  organizerReviewStatus = 'review'
  organizerReviewDecision = 'pending'
  organizerLobbyStatus = 'scheduled'
  organizerStartCalls = 0
  organizerMessages = []
  chatLoadFailures = 0
  chatSendFailures = 0
  signedPreviewMode = false
  signedPreviewRequests = 0
  participantReviewPhotoStatus = null
  participantReviewVotingMode = false
  participantReviewVotes = []
  participantTieMode = false
  participantZeroScoreMode = false
  await page.route('https://test-project.supabase.co/**', async route => {
    const request = route.request()
    if (request.url().includes('/storage/v1/object/sign/hunt-photos/')) {
      if (signedPreviewMode) {
        signedPreviewRequests++
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signedURL: `/storage/v1/object/sign/hunt-photos/test/photo.jpg?token=preview-${signedPreviewRequests}` }) })
        return
      }
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'simulated signed-preview failure' }) })
      return
    }
    if (request.url().includes('/storage/v1/object/sign/hunt-photos/test/photo.jpg')) {
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nXcAAAAASUVORK5CYII=', 'base64')
      await route.fulfill({ status: 200, contentType: 'image/png', body: png })
      return
    }
    if (request.url().includes('/storage/v1/object/hunt-photos/') && request.method() === 'POST') {
      if (photoFaultMode === 'storage-denied') {
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }) })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: request.url().split('/storage/v1/object/')[1] }) })
      return
    }
    if (request.url().includes('/storage/v1/object/hunt-photos') && request.method() === 'DELETE') {
      rollbackDeleteRequests++
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'Deleted' }) })
      return
    }
    if (request.url().includes('/rest/v1/rpc/submit_hunt_photo')) {
      photoSubmissionRpcCalls++
      uploadedPhotoPath = JSON.parse(request.postData() ?? '{}').p_storage_path ?? ''
      if (photoFaultMode === 'rpc-rejected') {
        await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message: 'simulated submission rejection before commit' }) })
      } else if (photoFaultMode === 'committed-rpc-response-lost') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'simulated lost response after commit' }) })
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: true, submitted_at: new Date().toISOString(), previous_storage_path: null }) })
      }
      return
    }
    if (request.url().includes('/rest/v1/rpc/submit_team_selfie')) {
      selfieSubmissionRpcCalls++
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ submitted_at: new Date().toISOString(), previous_storage_path: null, submitted_by: '55555555-5555-4555-8555-555555555555' }) })
      return
    }
    if (request.url().includes('/rest/v1/submissions')) {
      const requestedPath = new URL(request.url()).searchParams.get('storage_path')?.replace(/^eq\./, '')
      const row = photoFaultMode === 'committed-rpc-response-lost' && requestedPath === uploadedPhotoPath
        ? [{ id: '99999999-9999-4999-8999-999999999999', hunt_item_id: '77777777-7777-4777-8777-777777777777', team_id: '44444444-4444-4444-8444-444444444444', participant_id: '55555555-5555-4555-8555-555555555555', storage_path: uploadedPhotoPath, submitted_at: new Date().toISOString(), approval_status: 'pending' }]
        : []
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(row) })
      return
    }
    if (request.url().includes('/rest/v1/organizers')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: '11111111-1111-4111-8111-111111111111' }]) })
      return
    }
    if ((organizerReviewMode || organizerLobbyMode) && request.url().includes('/rest/v1/hunts') && request.url().includes('organizer_id=')) {
      const startAt = organizerLobbyMode ? new Date(Date.now() + (organizerLobbyStatus === 'scheduled' ? 60 * 60_000 : -60_000)).toISOString() : '2026-11-01T17:00:00Z'
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: '33333333-3333-4333-8333-333333333333', title: 'Spring Photo Hunt', venue: 'Town Park', status: organizerLobbyMode ? organizerLobbyStatus : organizerReviewStatus, created_at: '2026-11-01T12:00:00Z', start_at: startAt, duration_minutes: 60, team_assignment_mode: 'organizer', voting_enabled: false, voting_bonus_points: 0 }]) })
      return
    }
    if (organizerLobbyMode && request.url().includes('/rest/v1/hunts') && request.url().includes('id=eq.')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: '33333333-3333-4333-8333-333333333333', title: 'Spring Photo Hunt', venue: 'Town Park', status: organizerLobbyStatus, created_at: '2026-11-01T12:00:00Z', start_at: new Date(Date.now() + (organizerLobbyStatus === 'scheduled' ? 60 * 60_000 : -60_000)).toISOString(), duration_minutes: 60, team_assignment_mode: 'organizer', voting_enabled: false, voting_bonus_points: 0 }) })
      return
    }
    if (organizerLobbyMode && request.url().includes('/rest/v1/teams') && request.url().includes('select=id%2Chunt_id%2Cname')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: '44444444-4444-4444-8444-444444444444', hunt_id: '33333333-3333-4333-8333-333333333333', name: 'Team Cedar', display_color: '#15967a', display_order: 0 }, { id: '55555555-5555-4555-8555-555555555555', hunt_id: '33333333-3333-4333-8333-333333333333', name: 'Team Maple', display_color: '#b68bca', display_order: 1 }]) })
      return
    }
    if (organizerLobbyMode && request.url().includes('/rest/v1/participants') && request.url().includes('select=id%2Chunt_id%2Cteam_id')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: '66666666-6666-4666-8666-666666666666', hunt_id: '33333333-3333-4333-8333-333333333333', team_id: '44444444-4444-4444-8444-444444444444', display_name: 'Taylor', joined_at: '2026-11-01T17:00:00Z' }]) })
      return
    }
    if (organizerLobbyMode && request.url().includes('/rest/v1/team_selfies')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
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
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ participant_id: '55555555-5555-4555-8555-555555555555', hunt_id: '33333333-3333-4333-8333-333333333333', title: 'Spring Photo Hunt', venue: 'Town Park', rules: ['Stay together'], status: participantRuntimeState === 'waiting' ? 'scheduled' : participantRuntimeState, runtime_state: participantRuntimeState, start_at: participantRuntimeState === 'waiting' ? null : new Date(now - 60_000).toISOString(), ends_at: participantRuntimeState === 'active' ? new Date(now + 3_540_000).toISOString() : new Date(now - 1_000).toISOString(), duration_minutes: 60, server_now: new Date(now).toISOString(), team: { id: '44444444-4444-4444-8444-444444444444', name: 'Team Cedar', display_color: '#15967a', selfie: null }, participant: { id: '55555555-5555-4555-8555-555555555555', display_name: 'Taylor' }, teammates: [{ id: '55555555-5555-4555-8555-555555555555', display_name: 'Taylor' }] }) })
      return
    }
    if (request.url().includes('/rest/v1/rpc/get_hunt_progress')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: participantRuntimeState === 'active' ? JSON.stringify([{ team_id: '44444444-4444-4444-8444-444444444444', team_name: 'Team Cedar', display_color: '#15967a', accepted_count: 1, total_items: 2 }]) : '[]' })
      return
    }
    if (request.url().includes('/rest/v1/rpc/get_hunt_review_gallery')) {
      if (organizerReviewMode) {
        const final = organizerReviewStatus === 'completed'
        const tieScore = { base_points: 10, voting_bonus: 0, total: 10, rank: 1 }
        const finalScores = final ? [
          { team_id: '44444444-4444-4444-8444-444444444444', team_name: 'Team Cedar', ...tieScore },
          ...(organizerTieMode ? [{ team_id: '55555555-5555-4555-8555-555555555555', team_name: 'Team Maple', ...tieScore }] : []),
        ] : null
        const teams = [
          { id: '44444444-4444-4444-8444-444444444444', name: 'Team Cedar', display_color: '#15967a' },
          ...(organizerTieMode ? [{ id: '55555555-5555-4555-8555-555555555555', name: 'Team Maple', display_color: '#5379b7' }] : []),
        ]
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ voting_enabled: false, voting_bonus_points: 0, status: organizerReviewStatus, can_begin_review: false, final_scores: finalScores, teams, items: [{ id: '77777777-7777-4777-8777-777777777777', title: 'A red leaf', points: 10, display_order: 0 }], submissions: [{ id: '99999999-9999-4999-8999-999999999999', item_id: '77777777-7777-4777-8777-777777777777', team_id: '44444444-4444-4444-8444-444444444444', participant_id: '55555555-5555-4555-8555-555555555555', storage_path: 'test/photo.jpg', status: organizerReviewDecision, submitted_at: '2026-11-01T17:10:00Z' }], votes: [], team_selfies: [] }) })
      } else {
        const reviewPhotoStatus = participantReviewPhotoStatus ?? (signedPreviewMode ? 'approved' : null)
        const submissions = participantReviewVotingMode
          ? [{ id: '99999999-9999-4999-8999-999999999999', item_id: '77777777-7777-4777-8777-777777777777', team_id: '55555555-5555-4555-8555-555555555555', storage_path: 'test/maple.jpg', status: 'approved' }]
          : reviewPhotoStatus ? [{ id: '99999999-9999-4999-8999-999999999999', item_id: '77777777-7777-4777-8777-777777777777', team_id: '44444444-4444-4444-8444-444444444444', storage_path: 'test/photo.jpg', status: reviewPhotoStatus }] : []
        const teams = [{ id: '44444444-4444-4444-8444-444444444444', name: 'Team Cedar', display_color: '#15967a' }, ...(participantReviewVotingMode ? [{ id: '55555555-5555-4555-8555-555555555555', name: 'Team Maple', display_color: '#5379b7' }] : [])]
        const finalScores = [{ team_id: '44444444-4444-4444-8444-444444444444', team_name: 'Team Cedar', base_points: participantZeroScoreMode ? 0 : 10, voting_bonus: 0, total: participantZeroScoreMode ? 0 : 10, rank: 1 }, ...(participantTieMode ? [{ team_id: '55555555-5555-4555-8555-555555555555', team_name: 'Team Maple', base_points: 10, voting_bonus: 0, total: 10, rank: 1 }] : [])]
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ voting_enabled: participantReviewVotingMode, voting_bonus_points: 3, status: participantRuntimeState, final_scores: finalScores, teams: participantTieMode ? [...teams, { id: '55555555-5555-4555-8555-555555555555', name: 'Team Maple', display_color: '#5379b7' }] : teams, items: [{ id: '77777777-7777-4777-8777-777777777777', title: 'A red leaf', points: 10, display_order: 1 }], submissions, votes: participantReviewVotes }) })
      }
      return
    }
    if (organizerLobbyMode && request.url().includes('/rest/v1/rpc/get_hunt_invites')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ has_active_invites: true, recoverable: true, invite_codes: [{ team_id: '44444444-4444-4444-8444-444444444444', team_name: 'Team Cedar', invite_token: 'a'.repeat(64) }, { team_id: '55555555-5555-4555-8555-555555555555', team_name: 'Team Maple', invite_token: 'b'.repeat(64) }] }) })
      return
    }
    if (organizerLobbyMode && request.url().includes('/rest/v1/rpc/get_hunt_messages')) {
      if (chatLoadFailures > 0) {
        chatLoadFailures--
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'simulated chat connection failure' }) })
        return
      }
      const { p_limit = 101, p_before = null, p_before_id = null } = request.postDataJSON() as { p_limit?: number; p_before?: string | null; p_before_id?: string | null }
      const eligible = organizerMessages.filter(message => !p_before || message.created_at < p_before || (message.created_at === p_before && message.id < p_before_id!))
      const page = eligible.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)).slice(0, p_limit).reverse()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(page) })
      return
    }
    if (organizerLobbyMode && request.url().includes('/rest/v1/rpc/send_hunt_message')) {
      if (chatSendFailures > 0) {
        chatSendFailures--
        await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'simulated chat send failure' }) })
      } else {
        const { p_body } = request.postDataJSON() as { p_body: string }
        organizerMessages.push({ id: `sent-${organizerMessages.length}`, sender_name: 'Organizer', sender_role: 'organizer', body: p_body, created_at: new Date().toISOString() })
        await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
      }
      return
    }
    if (organizerLobbyMode && request.url().includes('/rest/v1/rpc/start_game_now')) {
      organizerStartCalls++
      organizerLobbyStatus = 'active'
      await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
      return
    }
    if (organizerLobbyMode && request.url().includes('/rest/v1/rpc/end_hunt_early')) {
      organizerLobbyStatus = 'review'
      organizerReviewStatus = 'review'
      await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
      return
    }
    if (organizerReviewMode && request.url().includes('/rest/v1/rpc/review_submission')) {
      organizerReviewDecision = JSON.parse(request.postData() ?? '{}').p_decision
      await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
      return
    }
    if (organizerReviewMode && request.url().includes('/rest/v1/rpc/finalize_hunt')) {
      organizerReviewStatus = 'completed'
      await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
      return
    }
    if (organizerReviewMode && request.url().includes('/rest/v1/rpc/get_hunt_invites')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ has_active_invites: false, recoverable: true, invite_codes: [] }) })
      return
    }
    if (request.url().includes('/rest/v1/hunt_items')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: '77777777-7777-4777-8777-777777777777', title_snapshot: 'A red leaf', description_snapshot: 'Find one on the trail.', point_value: 10, display_order: 1 }, { id: '88888888-8888-4888-8888-888888888888', title_snapshot: 'A park sign', description_snapshot: null, point_value: 5, display_order: 2 }]) })
      return
    }
    if (request.url().includes('/rest/v1/rpc/is_hunt_organizer')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: organizerLobbyMode ? 'true' : 'false' })
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

test('saved team selfie stays saved when signing its preview fails', async ({ page }) => {
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.getByText('GET READY, TEAM CEDAR')).toBeVisible()

  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nXcAAAAASUVORK5CYII=', 'base64')
  await page.locator('.team-identity-panel input[type="file"]').setInputFiles({ name: 'team.png', mimeType: 'image/png', buffer: image })
  await expect(page.getByRole('alert')).toContainText('Team selfie saved. Its preview is temporarily unavailable')
  expect(selfieSubmissionRpcCalls).toBe(1)
  expect(rollbackDeleteRequests).toBe(0)
})

test('participant can return through the original invite after reloading the browser', async ({ page }) => {
  const inviteUrl = `/#/join/${'a'.repeat(64)}`
  await page.goto(inviteUrl)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.getByRole('status')).toContainText('Waiting for the organizer', { timeout: 10_000 })
  await page.goto(inviteUrl)
  await expect(page).toHaveURL(/#\/play\/33333333-3333-4333-8333-333333333333$/)
  await expect(page.getByText('GET READY, TEAM CEDAR')).toBeVisible()
})

test('browser Back from a resumed participant session returns to the previous screen', async ({ page }) => {
  await page.goto('/#/')
  await page.getByRole('button', { name: /I.?m a Player/ }).click()
  await page.getByRole('textbox', { name: 'Team invitation' }).fill('a'.repeat(64))
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.getByRole('status')).toContainText('Waiting for the organizer', { timeout: 10_000 })

  await page.goBack()
  await expect(page.getByRole('textbox', { name: 'Team invitation' })).toBeVisible()
  await page.goForward()
  await expect(page.getByText('GET READY, TEAM CEDAR')).toBeVisible()
})

test('active participant game exposes the timer, team progress, and photo list', async ({ page }) => {
  participantRuntimeState = 'active'
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

test('participant gameplay follows server time when the device clock is years behind', async ({ page }) => {
  participantRuntimeState = 'active'
  await page.clock.install({ time: new Date('2000-01-01T00:00:00Z') })
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.getByText('Your photo list')).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Time remaining' })).toBeVisible()
  await expect(page.getByText('A red leaf')).toBeVisible()
  await expect(page.getByText('Time’s up!')).toHaveCount(0)
})

test('photo upload reconciles a committed submission after its RPC response is lost', async ({ page }) => {
  participantRuntimeState = 'active'
  photoFaultMode = 'committed-rpc-response-lost'
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nXcAAAAASUVORK5CYII=', 'base64')
  await page.getByRole('article').filter({ hasText: 'A red leaf' }).locator('input[type="file"]').setInputFiles({ name: 'leaf.png', mimeType: 'image/png', buffer: image })
  await expect(page.getByText('Photo submitted · awaiting review')).toBeVisible({ timeout: 10_000 })
  expect(photoSubmissionRpcCalls).toBe(1)
  await expect(page.getByText(/Submitted successfully, but the preview could not load yet/)).toBeVisible()
})

test('photo upload reports a Storage policy denial without calling the submission RPC', async ({ page }) => {
  participantRuntimeState = 'active'
  photoFaultMode = 'storage-denied'
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nXcAAAAASUVORK5CYII=', 'base64')
  const item = page.getByRole('article').filter({ hasText: 'A red leaf' })
  await item.locator('input[type="file"]').setInputFiles({ name: 'leaf.png', mimeType: 'image/png', buffer: image })
  await expect(item.getByRole('status')).toContainText('new row violates row-level security policy', { timeout: 10_000 })
  expect(photoSubmissionRpcCalls).toBe(0)
})

test('photo upload rolls back the unreferenced Storage object after the submission RPC rejects', async ({ page }) => {
  participantRuntimeState = 'active'
  photoFaultMode = 'rpc-rejected'
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nXcAAAAASUVORK5CYII=', 'base64')
  const item = page.getByRole('article').filter({ hasText: 'A red leaf' })
  await item.locator('input[type="file"]').setInputFiles({ name: 'leaf.png', mimeType: 'image/png', buffer: image })
  await expect(item.getByRole('status')).toContainText('simulated submission rejection before commit', { timeout: 10_000 })
  expect(photoSubmissionRpcCalls).toBe(1)
  expect(rollbackDeleteRequests).toBe(1)
})

test('participant can see the post-hunt review gallery while the organizer reviews', async ({ page }) => {
  participantRuntimeState = 'review'
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.getByText('Photo review time!')).toBeVisible()
  await expect(page.getByText('Team photo gallery')).toBeVisible()
  await expect(page.getByText('The organizer is reviewing all team photos.')).toBeVisible()
  await expect(page.getByText('No photo submitted')).toBeVisible()
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 })
    const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    expect(dimensions.content, `review gallery horizontal overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport)
  }
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(results.violations, JSON.stringify(results.violations.map(({ id, impact, help, targets }) => ({ id, impact, help, targets })), null, 2)).toEqual([])
})

test('participant gallery explains pending approval and an unavailable approved photo preview', async ({ page }) => {
  participantRuntimeState = 'review'
  participantReviewPhotoStatus = 'pending'
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.getByText('Awaiting organizer approval')).toBeVisible()

  participantReviewPhotoStatus = 'rejected'
  await page.reload()
  await expect(page.getByText('Not approved')).toBeVisible()

  participantReviewPhotoStatus = 'approved'
  await page.reload()
  await expect(page.getByText('Photo preview unavailable')).toBeVisible()
})

test('participant gallery picks up an organizer approval through its refresh fallback', async ({ page }) => {
  participantRuntimeState = 'review'
  participantReviewPhotoStatus = 'pending'
  await page.clock.install()
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.getByText('Awaiting organizer approval')).toBeVisible()

  participantReviewPhotoStatus = 'approved'
  signedPreviewMode = true
  await page.clock.fastForward(20_000)
  await expect(page.getByRole('img', { name: 'Team Cedar photo for A red leaf' })).toBeVisible()
})

test('participant gallery picks up a teammate vote through its refresh fallback', async ({ page }) => {
  participantRuntimeState = 'review'
  participantReviewVotingMode = true
  signedPreviewMode = true
  await page.clock.install()
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  const voteButton = page.getByRole('button', { name: 'Vote for this photo' })
  await expect(voteButton).toBeVisible()

  participantReviewVotes = [{ item_id: '77777777-7777-4777-8777-777777777777', voting_team_id: '44444444-4444-4444-8444-444444444444', selected_team_id: '55555555-5555-4555-8555-555555555555' }]
  await page.clock.fastForward(20_000)
  await expect(page.getByRole('button', { name: 'Your vote' })).toBeVisible()
})

test('participant sees final standings and winner celebration after results publish', async ({ page }) => {
  participantRuntimeState = 'completed'
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.getByText('The results are in!')).toBeVisible()
  await expect(page.getByText('Final results')).toBeVisible()
  await expect(page.getByText('#1 Team Cedar')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Share team card' })).toBeVisible()
  await page.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }))
  const cardDownloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Share team card' }).click()
  const cardDownload = await cardDownloadPromise
  expect(cardDownload.suggestedFilename()).toBe('snapquest-team-cedar-winner.png')
  const cardPath = await cardDownload.path()
  expect(cardPath).toBeTruthy()
  if (cardPath) {
    const cardBytes = await readFile(cardPath)
    expect(cardBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true)
    expect(cardBytes.byteLength).toBeGreaterThan(1000)
  }
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { throw new DOMException('User canceled share.', 'AbortError') } })
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
  })
  await page.getByRole('button', { name: 'Share team card' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 })
    const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    expect(dimensions.content, `published results horizontal overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport)
  }
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(results.violations, JSON.stringify(results.violations.map(({ id, impact, help, targets }) => ({ id, impact, help, targets })), null, 2)).toEqual([])
})

test('participant celebration identifies tied winners and suppresses a zero-score winner card', async ({ page }) => {
  participantRuntimeState = 'completed'
  participantTieMode = true
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.getByText('TIED WINNER')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Share team card' })).toBeVisible()

  participantTieMode = false
  participantZeroScoreMode = true
  await page.reload()
  await expect(page.getByText('No team scored points this hunt.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Share team card' })).toHaveCount(0)
})

test('participant renews signed review-photo previews before their URLs expire', async ({ page }) => {
  participantRuntimeState = 'completed'
  signedPreviewMode = true
  await page.clock.install()
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.getByText('Final results')).toBeVisible()
  const galleryImage = page.getByRole('img', { name: 'Team Cedar photo for A red leaf' })
  await expect(galleryImage).toBeVisible()
  await expect.poll(() => signedPreviewRequests).toBeGreaterThan(0)
  const initialSigningRequests = signedPreviewRequests
  await page.clock.fastForward(260_000)
  await expect.poll(() => signedPreviewRequests, { timeout: 10_000 }).toBeGreaterThan(initialSigningRequests)
  await expect(galleryImage).toBeVisible()
})

test('organizer reviews a photo, changes its decision, and finalizes results', async ({ page }) => {
  organizerReviewMode = true
  await restoreOrganizerSession(page)
  await page.goto('/#/')
  await expect(page.getByRole('heading', { name: /Welcome in/ })).toBeVisible()
  await page.getByRole('button', { name: 'My hunts' }).click()
  const hunt = page.getByRole('article').filter({ hasText: 'Spring Photo Hunt' })
  await expect(hunt.getByRole('button', { name: 'Review photos' })).toBeVisible()
  await hunt.getByRole('button', { name: 'Review photos' }).click()
  await expect(page.getByRole('heading', { name: 'Spring Photo Hunt' })).toBeVisible()
  await expect(page.getByText('Preview unavailable')).toBeVisible()
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByRole('button', { name: 'Change decision to rejected' })).toBeVisible()
  await page.getByRole('button', { name: 'Change decision to rejected' }).click()
  await expect(page.getByRole('button', { name: 'Change decision to approved' })).toBeVisible()
  await page.getByRole('button', { name: 'Change decision to approved' }).click()
  await expect(page.getByRole('button', { name: 'Change decision to rejected' })).toBeVisible()
  await page.getByRole('button', { name: 'Finalize results' }).click()
  await page.getByRole('button', { name: 'Confirm final results' }).click()
  await expect(page.getByRole('heading', { name: 'Hunt complete' })).toBeVisible()
  await expect(page.getByText('#1 Team Cedar')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Share winner card' })).toBeVisible()
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 })
    const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    expect(dimensions.content, `organizer review/results horizontal overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport)
  }
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(results.violations, JSON.stringify(results.violations.map(({ id, impact, help, targets }) => ({ id, impact, help, targets })), null, 2)).toEqual([])
})

test('organizer login confirms that the email link was requested', async ({ page }) => {
  await page.goto('/#/')
  await page.getByRole('button', { name: /Organizer Login/ }).click()
  await page.getByLabel('Email address').fill('organizer@example.test')
  await page.getByRole('button', { name: /Send me a sign-in link/ }).click()
  await expect(page.getByRole('status')).toContainText('Check your email')
})

test('organizer email callback restores the session at the site root', async ({ page }) => {
  await page.goto('/#/')
  await page.getByRole('button', { name: /Organizer Login/ }).click()
  await page.getByLabel('Email address').fill('organizer@example.test')
  await page.getByRole('button', { name: /Send me a sign-in link/ }).click()
  await expect(page.getByRole('status')).toContainText('Check your email')
  await page.goto('/?email-callback=1#access_token=callback-access-token&refresh_token=callback-refresh-token&expires_in=3600&token_type=bearer&type=magiclink')
  await expect(page.getByRole('heading', { name: /Welcome in/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Create your first hunt' })).toBeVisible()
})

test('restored organizer session opens the production organizer workspace', async ({ page }) => {
  await restoreOrganizerSession(page)
  await page.goto('/#/')
  await expect(page.getByRole('heading', { name: /Welcome in/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Create your first hunt' })).toBeVisible()
  const returnToTeam = page.getByRole('link', { name: /Return to Team Cedar/ })
  await expect(returnToTeam).toHaveAttribute('href', '#/play/33333333-3333-4333-8333-333333333333')
})

test('organizer lobby shows the team roster and unread chat count without moving the scroll', async ({ page }) => {
  organizerLobbyMode = true
  const baseTime = Date.now()
  organizerMessages = Array.from({ length: 15 }, (_, index) => ({ id: `message-${index}`, sender_name: index % 2 ? 'Taylor' : 'Organizer', sender_role: index % 2 ? 'participant' as const : 'organizer' as const, body: `Chat message ${index}`, created_at: new Date(baseTime + index * 1000).toISOString() }))
  await page.clock.install()
  await restoreOrganizerSession(page)
  await page.goto('/#/manage/33333333-3333-4333-8333-333333333333')
  await expect(page.getByRole('heading', { name: 'Team lobby' })).toBeVisible()
  await expect(page.locator('.participant-roster').getByText('Taylor')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Keep everyone in the loop' })).toBeVisible()
  const chatMessages = page.locator('.hunt-chat-messages')
  await expect(chatMessages.getByText('Chat message 14')).toBeVisible()
  await page.clock.runFor(1_000)
  await expect.poll(() => chatMessages.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(48)
  await chatMessages.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')) })
  await expect.poll(() => chatMessages.evaluate(element => element.scrollTop)).toBe(0)
  await expect(page.getByRole('button', { name: 'Jump to latest' })).toBeVisible()
  organizerMessages.push({ id: 'message-new', sender_name: 'Taylor', sender_role: 'participant', body: 'One more update', created_at: new Date(baseTime + 20_000).toISOString() })
  await page.clock.runFor(15_000)
  const jumpButton = page.getByRole('button', { name: /Jump to latest.*1 new/ })
  await expect(jumpButton).toBeVisible()
  expect(await chatMessages.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeGreaterThan(48)
  await jumpButton.click()
  await expect(page.getByText('One more update')).toBeVisible()
})

test('hunt chat offers retry after read failure and keeps a message after send failure', async ({ page }) => {
  organizerLobbyMode = true
  chatLoadFailures = 1
  chatSendFailures = 1
  await restoreOrganizerSession(page)
  await page.goto('/#/manage/33333333-3333-4333-8333-333333333333')
  await expect(page.getByRole('heading', { name: 'Team lobby' })).toBeVisible()
  const chatError = page.locator('.hunt-chat-error')
  await expect(chatError).toContainText('Messages could not be refreshed')
  await chatError.getByRole('button', { name: 'Retry' }).click()
  await expect(chatError).toHaveCount(0)

  const message = page.getByRole('textbox', { name: 'Message' })
  await message.fill('Please meet by the fountain')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(chatError).toContainText('simulated chat send failure')
  await expect(message).toHaveValue('Please meet by the fountain')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(message).toHaveValue('')
  await expect(page.locator('.hunt-chat-messages').getByText('Please meet by the fountain')).toBeVisible()
})

test('hunt chat shows offline and reconnecting status', async ({ page }) => {
  organizerLobbyMode = true
  await restoreOrganizerSession(page)
  await page.goto('/#/manage/33333333-3333-4333-8333-333333333333')
  const status = page.locator('.hunt-chat-heading > span[aria-live="polite"]')
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }); window.dispatchEvent(new Event('offline')) })
  await expect(status).toHaveText('Offline')
  await expect(page.locator('.hunt-chat')).toContainText('New messages will refresh when you reconnect')
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: true }); window.dispatchEvent(new Event('online')) })
  await expect(status).not.toHaveText('Offline')
})

test('organizer can start a scheduled hunt immediately, end it, and open photo review', async ({ page }) => {
  organizerLobbyMode = true
  organizerReviewMode = true
  page.on('dialog', dialog => dialog.accept())
  await restoreOrganizerSession(page)
  await page.goto('/#/')
  await page.getByRole('button', { name: 'My hunts' }).click()
  await page.getByRole('button', { name: 'Open lobby' }).click()
  await expect(page.getByRole('heading', { name: 'Ready to start?' })).toBeVisible()
  await page.getByRole('button', { name: 'Start hunt now' }).click()
  await expect.poll(() => organizerStartCalls).toBe(1)
  await expect(page.getByRole('button', { name: 'End hunt now and review' })).toBeVisible()
  await page.getByRole('button', { name: 'End hunt now and review' }).click()
  await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Finalize results' })).toBeDisabled()
})

test('organizer can reschedule a hunt from its lobby', async ({ page }) => {
  organizerLobbyMode = true
  await restoreOrganizerSession(page)
  await page.goto('/#/manage/33333333-3333-4333-8333-333333333333')
  const { localStart, expectedStart } = await page.evaluate(() => {
    const date = new Date(Date.now() + 2 * 60 * 60_000)
    date.setSeconds(0, 0)
    const pad = (value: number) => String(value).padStart(2, '0')
    return {
      localStart: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`,
      expectedStart: date.toISOString(),
    }
  })
  const requestPromise = page.waitForRequest(request => request.url().includes('/rest/v1/rpc/reschedule_game'))
  await page.getByLabel('New start time').fill(localStart)
  await page.getByRole('button', { name: 'Save new time' }).click()
  const request = await requestPromise
  const body = request.postDataJSON() as { p_game_id: string; p_start_at: string }
  expect(body.p_game_id).toBe('33333333-3333-4333-8333-333333333333')
  expect(new Date(body.p_start_at).toISOString()).toBe(expectedStart)
})

test('organizer can copy a team invitation from the QR code card', async ({ page }) => {
  organizerLobbyMode = true
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await restoreOrganizerSession(page)
  await page.goto('/#/')
  await page.getByRole('button', { name: 'My hunts' }).click()
  await page.getByRole('button', { name: 'Open lobby' }).click()
  const inviteCard = page.locator('.invite-card').first()
  const invitationLink = inviteCard.locator('input')
  await expect(invitationLink).toBeVisible()
  const expectedUrl = await invitationLink.inputValue()
  await inviteCard.getByRole('button', { name: 'Copy invite link' }).click()
  await expect(inviteCard.getByRole('button', { name: 'Copied!' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expectedUrl)
})

test('organizer can join an assigned team and return to hunt management', async ({ page }) => {
  organizerLobbyMode = true
  await restoreOrganizerSession(page)
  await page.goto('/#/')
  await page.getByRole('button', { name: 'My hunts' }).click()
  await page.getByRole('button', { name: 'Open lobby' }).click()
  await page.locator('.invite-card').first().getByRole('button', { name: 'Join this team' }).click()
  await expect(page.getByText('GET READY, TEAM CEDAR')).toBeVisible()
  const organizerMenu = page.getByRole('link', { name: 'Organizer menu' })
  await expect(organizerMenu).toBeVisible()
  await organizerMenu.click()
  await expect(page.getByRole('heading', { name: 'Team lobby' })).toBeVisible()
})

test('organizer winner card picker offers each team tied for first', async ({ page }) => {
  organizerReviewMode = true
  organizerReviewStatus = 'completed'
  organizerTieMode = true
  await restoreOrganizerSession(page)
  await page.goto('/#/')
  await page.getByRole('button', { name: 'My hunts' }).click()
  await page.getByRole('button', { name: 'View results' }).click()
  await expect(page.getByRole('heading', { name: '2 teams share first place' })).toBeVisible()
  const chooser = page.getByLabel('Choose a team card')
  await expect(chooser.locator('option')).toHaveText(['Team Cedar', 'Team Maple'])
  await chooser.selectOption('55555555-5555-4555-8555-555555555555')
  await expect(page.getByRole('img', { name: 'Winner celebration card for Team Maple' })).toBeVisible()
})

test('organizer chat pages more than 200 messages with identical timestamps without gaps', async ({ page }) => {
  organizerLobbyMode = true
  const sameTime = '2026-11-06T18:00:00.000Z'
  organizerMessages = Array.from({ length: 205 }, (_, index) => ({ id: `message-${String(index).padStart(3, '0')}`, sender_name: 'Taylor', sender_role: 'participant' as const, body: `Page message ${index}`, created_at: sameTime }))
  await page.clock.install()
  await restoreOrganizerSession(page)
  await page.goto('/#/manage/33333333-3333-4333-8333-333333333333')
  const chat = page.locator('.hunt-chat-messages')
  const messages = chat.locator('.hunt-chat-message')
  await expect(messages).toHaveCount(100)
  await expect(messages.last()).toContainText('Page message 204')
  await page.getByRole('button', { name: 'Load older messages' }).click()
  await expect(messages).toHaveCount(200)
  await page.getByRole('button', { name: 'Load older messages' }).click()
  await expect(messages).toHaveCount(205)
  await expect(messages.first()).toContainText('Page message 0')
  const bodies = await messages.locator('p').allTextContents()
  expect(new Set(bodies).size).toBe(205)
  await expect(page.getByRole('button', { name: 'Load older messages' })).toHaveCount(0)
  organizerMessages.push({ id: 'message-205', sender_name: 'Taylor', sender_role: 'participant', body: 'A new chat update', created_at: sameTime })
  await page.clock.runFor(15_000)
  await expect(messages).toHaveCount(206)
  await expect(messages.first()).toContainText('Page message 0')
  await expect(messages.last()).toContainText('A new chat update')
  await expect(page.getByRole('button', { name: 'Load older messages' })).toHaveCount(0)
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
