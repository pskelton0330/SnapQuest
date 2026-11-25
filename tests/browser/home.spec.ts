import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'

let participantRuntimeState: 'waiting' | 'active' | 'ended' | 'review' | 'completed' = 'waiting'
let invalidInvitePreview = false
let photoFaultMode: 'committed-rpc-response-lost' | 'storage-denied' | 'rpc-rejected' | null = null
let photoReplacementRaceMode = false
let raceCurrentPhotoPath = ''
let raceAcceptedPaths: string[] = []
let raceSignedPaths: string[] = []
let photoDeletedPaths: string[] = []
let uploadedPhotoPath = ''
let photoSubmissionRpcCalls = 0
let selfieSubmissionRpcCalls = 0
let selfieLostResponseMode = false
let selfieStoredPath = ''
let selfieReconciliationReads = 0
let rollbackDeleteRequests = 0
let organizerReviewMode = false
let organizerHuntLibraryMode = false
let organizerFinalizeLostResponse = false
let organizerTieMode = false
let organizerLobbyMode = false
let organizerDraftMode = false
let organizerDraft: { id: string; title: string; venue: string; rules: string[]; duration_minutes: number; status: 'draft'; created_at: string } | null = null
let organizerDraftItems: { id: string; title_snapshot: string; description_snapshot: string | null; point_value: number; display_order: number; library_item_id: string | null }[] = []
let savedDraftPayloads: Record<string, unknown>[] = []
let organizerReviewStatus: 'review' | 'completed' = 'review'
let organizerReviewDecision: 'pending' | 'approved' | 'rejected' = 'approved'
let organizerSavedWinnerCards: { hunt_id: string; team_id: string; storage_path: string }[] = []
let organizerLobbyStatus: 'scheduled' | 'active' | 'ended' | 'review' = 'scheduled'
let organizerLobbyParticipantName = 'Taylor'

async function expectKeyboardCanReach(page: import('@playwright/test').Page, target: import('@playwright/test').Locator) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  for (let index = 0; index < 100; index++) {
    await page.keyboard.press('Tab')
    if (await target.evaluate(element => element === document.activeElement)) return
  }
  throw new Error('Keyboard navigation did not reach the expected control within 100 Tab presses')
}

async function grantClipboardAccess(page: import('@playwright/test').Page) {
  const browserName = page.context().browser()?.browserType().name()
  if (browserName === 'webkit') {
    const installClipboard = () => {
      let clipboardText = ''
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => { clipboardText = text },
          readText: async () => clipboardText,
        },
      })
    }
    await page.addInitScript(installClipboard)
    if (page.url() !== 'about:blank') await page.evaluate(installClipboard)
    return
  }

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
}

async function expectNoHorizontalOverflowAt200Percent(page: import('@playwright/test').Page, route: string) {
  await page.setViewportSize({ width: 320, height: 844 })
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll<HTMLElement>('*')]
      .map(element => ({ tag: element.tagName, className: typeof element.className === 'string' ? element.className : '', text: element.innerText?.slice(0, 70) ?? '', left: Math.round(element.getBoundingClientRect().left), right: Math.round(element.getBoundingClientRect().right), scroll: element.scrollWidth, client: element.clientWidth }))
      .filter(element => element.right > document.documentElement.clientWidth + 1 || element.left < -1 || element.scroll > element.client + 2)
      .slice(0, 12),
  }))
  expect(dimensions.content, `${route} horizontal overflow at 200% text size: ${JSON.stringify(dimensions.offenders)}`).toBeLessThanOrEqual(dimensions.viewport)
}
let organizerStartCalls = 0
let organizerInviteRecoveryCalls = 0
let organizerInviteRotated = false
let organizerLegacyInvites = false
let organizerInviteRotationCalls = 0
let organizerTimingFailure: 'start' | 'end' | 'add' | 'reschedule' | null = null
let organizerMessages: { id: string; sender_name: string; sender_role: 'organizer' | 'participant'; body: string; created_at: string }[] = []
let chatLoadFailures = 0
let chatSendFailures = 0
let chatLegacyRpcMode = false
let chatStableCursorCalls = 0
let chatLegacyCursorCalls = 0
let auditReports: Record<string, unknown>[] = []
let signedPreviewMode = false
let signedPreviewFailure = false
let signedPreviewRequests = 0
let participantReviewPhotoStatus: 'pending' | 'approved' | 'rejected' | null = null
let participantReviewVotingMode = false
let participantReviewVotes: { item_id: string; voting_team_id: string; selected_team_id: string }[] = []
let participantReviewGalleryCalls = 0
let delayNextParticipantGalleryResponse = false
let releaseDelayedParticipantGalleryResponse: (() => void) | null = null
let participantTieMode = false
let participantZeroScoreMode = false
let participantMixedZeroMode = false
let participantTeamName = 'Team Cedar'
let celebrationSelfieMode = false
let celebrationSelfieSignedRequests = 0
let celebrationSelfieLoadFailure = false
let celebrationSelfieFormat: 'png' | 'jpeg' = 'png'
let celebrationJpegFixture: Buffer

test.beforeEach(async ({ page }) => {
  participantRuntimeState = 'waiting'
  invalidInvitePreview = false
  photoFaultMode = null
  photoReplacementRaceMode = false
  raceCurrentPhotoPath = ''
  raceAcceptedPaths = []
  raceSignedPaths = []
  photoDeletedPaths = []
  uploadedPhotoPath = ''
  photoSubmissionRpcCalls = 0
  selfieSubmissionRpcCalls = 0
  selfieLostResponseMode = false
  selfieStoredPath = ''
  selfieReconciliationReads = 0
  rollbackDeleteRequests = 0
  organizerReviewMode = false
  organizerHuntLibraryMode = false
  organizerFinalizeLostResponse = false
  organizerTieMode = false
  organizerLobbyMode = false
  organizerDraftMode = false
  organizerDraft = null
  organizerDraftItems = []
  savedDraftPayloads = []
  organizerReviewStatus = 'review'
  organizerReviewDecision = 'approved'
  organizerSavedWinnerCards = []
  organizerLobbyStatus = 'scheduled'
  organizerLobbyParticipantName = 'Taylor'
  organizerStartCalls = 0
  organizerInviteRecoveryCalls = 0
  organizerInviteRotated = false
  organizerLegacyInvites = false
  organizerInviteRotationCalls = 0
  organizerTimingFailure = null
  organizerMessages = []
  chatLoadFailures = 0
  chatSendFailures = 0
  chatLegacyRpcMode = false
  chatStableCursorCalls = 0
  chatLegacyCursorCalls = 0
  auditReports = []
  signedPreviewMode = false
  signedPreviewFailure = false
  signedPreviewRequests = 0
  participantReviewPhotoStatus = null
  participantReviewVotingMode = false
  participantReviewVotes = []
  participantReviewGalleryCalls = 0
  delayNextParticipantGalleryResponse = false
  releaseDelayedParticipantGalleryResponse = null
  participantTieMode = false
  participantZeroScoreMode = false
  participantMixedZeroMode = false
  participantTeamName = 'Team Cedar'
  celebrationSelfieMode = false
  celebrationSelfieSignedRequests = 0
  celebrationSelfieLoadFailure = false
  celebrationSelfieFormat = 'png'
  const jpegDataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 8
    const context = canvas.getContext('2d')
    if (!context) throw new Error('JPEG fixture canvas context is unavailable')
    context.fillStyle = '#e42b68'
    context.fillRect(0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.92).split(',')[1]
  })
  celebrationJpegFixture = Buffer.from(jpegDataUrl, 'base64')
  await page.context().route('https://test-project.supabase.co/**', async route => {
    const request = route.request()
    if (request.url().includes('/rest/v1/rpc/record_audit_event')) {
      auditReports.push(request.postDataJSON() as Record<string, unknown>)
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify('00000000-0000-4000-8000-000000000001') })
      return
    }
    if (organizerLobbyMode && request.url().includes('/rest/v1/rpc/list_hunt_audit_events')) {
      const clientEvents = auditReports.map((report, index) => ({ id: `client-event-${index}`, created_at: new Date(Date.now() + index).toISOString(), event_type: report.p_event_type, outcome: report.p_outcome, details: report.p_details }))
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
        ...clientEvents,
        { id: 'server-event', created_at: '2026-11-01T17:09:00Z', event_type: 'game_start_now', outcome: 'success', details: {}, source: 'server-authoritative' },
      ]) })
      return
    }
    if (request.method() === 'GET' && request.url().includes('/storage/v1/object/sign/hunt-photos/') && (signedPreviewMode || photoReplacementRaceMode || celebrationSelfieMode)) {
      if (celebrationSelfieLoadFailure && request.url().includes('team-selfie.')) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'simulated selfie download failure' }) })
        return
      }
      if (celebrationSelfieMode && celebrationSelfieFormat === 'jpeg' && request.url().includes('team-selfie.jpg')) {
        await route.fulfill({ status: 200, contentType: 'image/jpeg', body: celebrationJpegFixture })
        return
      }
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nXcAAAAASUVORK5CYII=', 'base64')
      await route.fulfill({ status: 200, contentType: 'image/png', body: png })
      return
    }
    if (request.url().includes('/storage/v1/object/sign/winner-cards/')) {
      if (request.method() === 'POST') {
        const path = decodeURIComponent(new URL(request.url()).pathname.split('/object/sign/winner-cards/')[1] ?? '')
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signedURL: `/object/sign/winner-cards/${path}?token=saved-card` }) })
      } else {
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nXcAAAAASUVORK5CYII=', 'base64')
        await route.fulfill({ status: 200, contentType: 'image/png', body: png })
      }
      return
    }
    if (request.url().includes('/storage/v1/object/sign/hunt-photos/')) {
      if (celebrationSelfieMode && request.method() === 'POST' && request.url().includes('team-selfie.png')) {
        celebrationSelfieSignedRequests++
        const filename = celebrationSelfieFormat === 'jpeg' ? 'team-selfie.jpg' : 'team-selfie.png'
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signedURL: `/object/sign/hunt-photos/test/${filename}?token=selfie` }) })
        return
      }
      if (photoReplacementRaceMode && request.method() === 'POST') {
        const path = decodeURIComponent(new URL(request.url()).pathname.split('/object/sign/hunt-photos/')[1] ?? '')
        raceSignedPaths.push(path)
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signedURL: `/object/sign/hunt-photos/${path}?token=race-${raceSignedPaths.length}` }) })
        return
      }
      if (signedPreviewMode) {
        if (signedPreviewFailure) {
          await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'simulated signed URL authorization failure' }) })
          return
        }
        signedPreviewRequests++
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signedURL: `/object/sign/hunt-photos/test/photo.jpg?token=preview-${signedPreviewRequests}` }) })
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
    if (request.url().includes('/storage/v1/object/winner-cards/') && ['POST', 'PUT'].includes(request.method())) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: request.url().split('/storage/v1/object/')[1] }) })
      return
    }
    if (request.url().includes('/storage/v1/object/hunt-photos') && request.method() === 'DELETE') {
      rollbackDeleteRequests++
      try { photoDeletedPaths.push(...((request.postDataJSON() as { prefixes?: string[] } | null)?.prefixes ?? [])) } catch { /* The cleanup counter still records unexpected request bodies. */ }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'Deleted' }) })
      return
    }
    if (request.url().includes('/rest/v1/rpc/submit_hunt_photo')) {
      photoSubmissionRpcCalls++
      uploadedPhotoPath = JSON.parse(request.postData() ?? '{}').p_storage_path ?? ''
      if (photoReplacementRaceMode) {
        const { p_expected_storage_path: expectedPath, p_storage_path: attemptedPath } = request.postDataJSON() as { p_expected_storage_path: string | null; p_storage_path: string }
        if (expectedPath !== raceCurrentPhotoPath) {
          await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message: 'A teammate changed this photo slot. Refresh before replacing it again' }) })
        } else {
          const previousPath = raceCurrentPhotoPath || null
          raceCurrentPhotoPath = attemptedPath
          raceAcceptedPaths.push(attemptedPath)
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: true, submitted_at: new Date().toISOString(), previous_storage_path: previousPath }) })
        }
      } else if (photoFaultMode === 'rpc-rejected') {
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
      selfieStoredPath = (request.postDataJSON() as { p_storage_path?: string }).p_storage_path ?? ''
      if (selfieLostResponseMode) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'simulated lost response after commit' }) })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ submitted_at: new Date().toISOString(), previous_storage_path: null, submitted_by: '55555555-5555-4555-8555-555555555555' }) })
      return
    }
    if (request.method() === 'GET' && request.url().includes('/rest/v1/team_selfies')) {
      selfieReconciliationReads++
      const requestedPath = new URL(request.url()).searchParams.get('storage_path')?.replace(/^eq\./, '')
      const row = selfieStoredPath && requestedPath === selfieStoredPath
        ? [{ storage_path: selfieStoredPath, submitted_by: '55555555-5555-4555-8555-555555555555', submitted_at: new Date().toISOString() }]
        : []
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(row) })
      return
    }
    if (request.url().includes('/rest/v1/submissions')) {
      const requestedPath = new URL(request.url()).searchParams.get('storage_path')?.replace(/^eq\./, '')
      if (photoReplacementRaceMode) {
        const row = raceCurrentPhotoPath && (!requestedPath || requestedPath === raceCurrentPhotoPath)
          ? [{ id: '99999999-9999-4999-8999-999999999999', hunt_item_id: '77777777-7777-4777-8777-777777777777', team_id: '44444444-4444-4444-8444-444444444444', participant_id: '55555555-5555-4555-8555-555555555555', storage_path: raceCurrentPhotoPath, submitted_at: new Date().toISOString(), approval_status: raceAcceptedPaths.length ? 'pending' : 'approved' }]
          : []
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(row) })
        return
      }
      const row = photoFaultMode === 'committed-rpc-response-lost' && requestedPath === uploadedPhotoPath
        ? [{ id: '99999999-9999-4999-8999-999999999999', hunt_item_id: '77777777-7777-4777-8777-777777777777', team_id: '44444444-4444-4444-8444-444444444444', participant_id: '55555555-5555-4555-8555-555555555555', storage_path: uploadedPhotoPath, submitted_at: new Date().toISOString(), approval_status: 'approved' }]
        : []
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(row) })
      return
    }
    if (request.url().includes('/rest/v1/organizers')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: '11111111-1111-4111-8111-111111111111' }]) })
      return
    }
    if (organizerHuntLibraryMode && request.url().includes('/rest/v1/rpc/list_hunt_templates')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Christmas Lights Hunt', description: 'A neighborhood walk to spot festive lights.', defaultDuration: 95, rules: ['Stay together', 'Do not enter private property'], createdAt: '2026-11-20T12:00:00Z', challenges: [
        { title: 'A house with blue lights', description: 'Find a home glowing blue.', points: 3, displayOrder: 0 },
        { title: 'A lit-up reindeer', description: 'Look for a reindeer display.', points: 7, displayOrder: 1 },
        { title: 'A team selfie by a wreath', description: 'Include every team member.', points: 2, displayOrder: 2 },
      ] }]) })
      return
    }
    if (organizerHuntLibraryMode && request.url().includes('/rest/v1/rpc/copy_hunt_library_to_draft')) {
      organizerDraftMode = true
      organizerDraft = { id: '88888888-8888-4888-8888-888888888888', title: 'Christmas Lights Hunt', venue: 'Choose a venue', rules: ['Stay together', 'Do not enter private property'], duration_minutes: 95, status: 'draft', created_at: '2026-11-20T12:00:00Z' }
      organizerDraftItems = [
        { id: '77777777-7777-4777-8777-777777777771', title_snapshot: 'A house with blue lights', description_snapshot: 'Find a home glowing blue.', point_value: 3, display_order: 0, library_item_id: null },
        { id: '77777777-7777-4777-8777-777777777772', title_snapshot: 'A lit-up reindeer', description_snapshot: 'Look for a reindeer display.', point_value: 7, display_order: 1, library_item_id: null },
        { id: '77777777-7777-4777-8777-777777777773', title_snapshot: 'A team selfie by a wreath', description_snapshot: 'Include every team member.', point_value: 2, display_order: 2, library_item_id: null },
      ]
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(organizerDraft.id) })
      return
    }
    if (organizerReviewMode && request.url().includes('/rest/v1/rpc/create_hunt_draft_from_game')) {
      organizerDraftMode = true
      organizerDraft = { id: '88888888-8888-4888-8888-888888888888', title: 'Spring Photo Hunt (Rematch)', venue: 'Town Park', rules: ['Stay together'], duration_minutes: 60, status: 'draft', created_at: '2026-11-20T12:00:00Z' }
      organizerDraftItems = [
        { id: '77777777-7777-4777-8777-777777777771', title_snapshot: 'A red leaf', description_snapshot: 'Find one on the trail.', point_value: 10, display_order: 0, library_item_id: null },
        { id: '77777777-7777-4777-8777-777777777772', title_snapshot: 'A park sign', description_snapshot: null, point_value: 5, display_order: 1, library_item_id: null },
      ]
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(organizerDraft.id) })
      return
    }
    if (organizerDraftMode && request.url().includes('/rest/v1/rpc/create_hunt_draft')) {
      const payload = request.postDataJSON() as Record<string, unknown>
      savedDraftPayloads.push(payload)
      organizerDraft = { id: '33333333-3333-4333-8333-333333333333', title: String(payload.p_title), venue: String(payload.p_venue), rules: payload.p_rules as string[], duration_minutes: Number(payload.p_duration_minutes), status: 'draft', created_at: '2026-11-06T12:00:00Z' }
      organizerDraftItems = (payload.p_items as { title: string; description: string | null; pointValue: number; libraryItemId?: string }[]).map((item, index) => ({ id: `77777777-7777-4777-8777-${String(index + 1).padStart(12, '0')}`, title_snapshot: item.title, description_snapshot: item.description, point_value: item.pointValue, display_order: index, library_item_id: item.libraryItemId ?? null }))
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(organizerDraft.id) })
      return
    }
    if (organizerDraftMode && request.url().includes('/rest/v1/rpc/update_hunt_draft')) {
      const payload = request.postDataJSON() as Record<string, unknown>
      savedDraftPayloads.push(payload)
      organizerDraft = { id: String(payload.p_hunt_id), title: String(payload.p_title), venue: String(payload.p_venue), rules: payload.p_rules as string[], duration_minutes: Number(payload.p_duration_minutes), status: 'draft', created_at: organizerDraft?.created_at ?? '2026-11-06T12:00:00Z' }
      organizerDraftItems = (payload.p_items as { title: string; description: string | null; pointValue: number; libraryItemId?: string }[]).map((item, index) => ({ id: `77777777-7777-4777-8777-${String(index + 1).padStart(12, '0')}`, title_snapshot: item.title, description_snapshot: item.description, point_value: item.pointValue, display_order: index, library_item_id: item.libraryItemId ?? null }))
      await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
      return
    }
    if (organizerDraftMode && request.url().includes('/rest/v1/hunts') && request.url().includes('organizer_id=')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(organizerDraft ? [organizerDraft] : []) })
      return
    }
    if (organizerDraftMode && request.url().includes('/rest/v1/hunts') && request.url().includes('id=eq.')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: organizerDraft ? JSON.stringify([organizerDraft]) : '[]' })
      return
    }
    if ((organizerReviewMode || organizerLobbyMode) && request.url().includes('/rest/v1/hunts') && request.url().includes('organizer_id=')) {
      const startAt = organizerLobbyMode ? new Date(Date.now() + (organizerLobbyStatus === 'scheduled' ? 60 * 60_000 : -60_000)).toISOString() : '2026-11-01T17:00:00Z'
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: '33333333-3333-4333-8333-333333333333', title: 'Spring Photo Hunt', venue: 'Town Park', status: organizerLobbyMode ? organizerLobbyStatus : organizerReviewStatus, created_at: '2026-11-01T12:00:00Z', start_at: startAt, duration_minutes: 60, team_assignment_mode: 'organizer', voting_enabled: false, voting_bonus_points: 0 }]) })
      return
    }
    if (organizerReviewMode && !organizerLobbyMode && request.url().includes('/rest/v1/hunts') && request.url().includes('id=eq.')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: '33333333-3333-4333-8333-333333333333', title: 'Spring Photo Hunt', venue: 'Town Park', rules: ['Stay together'], status: organizerReviewStatus, created_at: '2026-11-01T12:00:00Z', start_at: null, duration_minutes: 60, team_assignment_mode: 'organizer', voting_enabled: false, voting_bonus_points: 0 }) })
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
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: '66666666-6666-4666-8666-666666666666', hunt_id: '33333333-3333-4333-8333-333333333333', team_id: '44444444-4444-4444-8444-444444444444', display_name: organizerLobbyParticipantName, joined_at: '2026-11-01T17:00:00Z' }]) })
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
    if (request.url().includes('/rest/v1/hunts') && request.url().includes('organizer_id=')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
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
      await route.fulfill({ status: 200, contentType: 'application/json', body: invalidInvitePreview ? 'null' : JSON.stringify({ title: 'Spring Photo Hunt', venue: 'Town Park', team_name: 'Team Cedar', start_at: '2026-12-01T17:00:00Z', duration_minutes: 60 }) })
      return
    }
    if (request.url().includes('/rest/v1/rpc/redeem_invitation')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hunt_id: '33333333-3333-4333-8333-333333333333', participant_id: '55555555-5555-4555-8555-555555555555', title: 'Spring Photo Hunt' }) })
      return
    }
    if (request.url().includes('/rest/v1/rpc/get_participant_context')) {
      const now = Date.now()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ participant_id: '55555555-5555-4555-8555-555555555555', hunt_id: '33333333-3333-4333-8333-333333333333', title: 'Spring Photo Hunt', venue: 'Town Park', rules: ['Stay together'], status: participantRuntimeState === 'waiting' ? 'scheduled' : participantRuntimeState, runtime_state: participantRuntimeState, start_at: participantRuntimeState === 'waiting' ? null : new Date(now - 60_000).toISOString(), ends_at: participantRuntimeState === 'active' ? new Date(now + 3_540_000).toISOString() : new Date(now - 1_000).toISOString(), duration_minutes: 60, server_now: new Date(now).toISOString(), team: { id: '44444444-4444-4444-8444-444444444444', name: participantTeamName, display_color: '#15967a', selfie: celebrationSelfieMode ? { storage_path: 'test/team-selfie.png', submitted_by: '55555555-5555-4555-8555-555555555555', submitted_at: '2026-11-01T17:00:00Z' } : null }, participant: { id: '55555555-5555-4555-8555-555555555555', display_name: 'Taylor' }, teammates: [{ id: '55555555-5555-4555-8555-555555555555', display_name: 'Taylor' }] }) })
      return
    }
    if (request.url().includes('/rest/v1/rpc/get_hunt_progress')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: participantRuntimeState === 'active' ? JSON.stringify([{ team_id: '44444444-4444-4444-8444-444444444444', team_name: 'Team Cedar', display_color: '#15967a', accepted_count: 1, total_items: 2 }]) : '[]' })
      return
    }
    if (request.url().includes('/rest/v1/winner_celebration_cards')) {
      if (request.method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(organizerSavedWinnerCards) })
      } else {
        const payload = request.postDataJSON() as { hunt_id: string; team_id: string; storage_path: string } | { hunt_id: string; team_id: string; storage_path: string }[]
        const rows = Array.isArray(payload) ? payload : [payload]
        for (const row of rows) organizerSavedWinnerCards = [...organizerSavedWinnerCards.filter(saved => saved.team_id !== row.team_id), row]
        await route.fulfill({ status: 201, contentType: 'application/json', body: 'null' })
      }
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
        participantReviewGalleryCalls++
        const reviewPhotoStatus = participantReviewPhotoStatus ?? (signedPreviewMode ? 'approved' : null)
        const submissions = participantReviewVotingMode
          ? [{ id: '99999999-9999-4999-8999-999999999999', item_id: '77777777-7777-4777-8777-777777777777', team_id: '55555555-5555-4555-8555-555555555555', storage_path: 'test/maple.jpg', status: reviewPhotoStatus ?? 'approved' }]
          : reviewPhotoStatus ? [{ id: '99999999-9999-4999-8999-999999999999', item_id: '77777777-7777-4777-8777-777777777777', team_id: '44444444-4444-4444-8444-444444444444', storage_path: 'test/photo.jpg', status: reviewPhotoStatus }] : []
        const teams = [{ id: '44444444-4444-4444-8444-444444444444', name: 'Team Cedar', display_color: '#15967a' }, ...(participantReviewVotingMode ? [{ id: '55555555-5555-4555-8555-555555555555', name: 'Team Maple', display_color: '#5379b7' }] : [])]
        const finalScores = [{ team_id: '44444444-4444-4444-8444-444444444444', team_name: participantTeamName, base_points: participantZeroScoreMode ? 0 : 10, voting_bonus: participantZeroScoreMode ? 0 : 5, total: participantZeroScoreMode ? 0 : 15, rank: participantMixedZeroMode ? 2 : 1 }, ...(participantTieMode ? [{ team_id: '55555555-5555-4555-8555-555555555555', team_name: 'Team Maple', base_points: 10, voting_bonus: 5, total: 15, rank: 1 }] : participantMixedZeroMode ? [{ team_id: '55555555-5555-4555-8555-555555555555', team_name: 'Team Maple', base_points: 10, voting_bonus: 0, total: 10, rank: 1 }] : [{ team_id: '55555555-5555-4555-8555-555555555555', team_name: 'Team Maple', base_points: 0, voting_bonus: 0, total: 0, rank: participantZeroScoreMode ? 1 : 2 }])]
        const body = JSON.stringify({ voting_enabled: participantReviewVotingMode, voting_bonus_points: 5, status: participantRuntimeState, final_scores: finalScores, teams: participantTieMode ? [...teams, { id: '55555555-5555-4555-8555-555555555555', name: 'Team Maple', display_color: '#5379b7' }] : teams.map(team => ({ ...team, name: participantTeamName })), items: [{ id: '77777777-7777-4777-8777-777777777777', title: 'A red leaf', points: 10, display_order: 1 }], submissions, votes: participantReviewVotes })
        if (delayNextParticipantGalleryResponse) {
          delayNextParticipantGalleryResponse = false
          await new Promise<void>(resolve => { releaseDelayedParticipantGalleryResponse = resolve })
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body })
      }
      return
    }
    if (organizerLobbyMode && request.url().includes('/rest/v1/rpc/get_game_lobby')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ runtime_state: organizerLobbyStatus }) })
      return
    }
    if (organizerLobbyMode && request.url().includes('/rest/v1/rpc/get_hunt_invites')) {
      organizerInviteRecoveryCalls++
      if (organizerLegacyInvites) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ has_active_invites: true, recoverable: false, invite_codes: [] }) })
        return
      }
      const firstToken = organizerInviteRotated ? 'c'.repeat(64) : 'a'.repeat(64)
      const secondToken = organizerInviteRotated ? 'd'.repeat(64) : 'b'.repeat(64)
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ has_active_invites: true, recoverable: true, invite_codes: [{ team_id: '44444444-4444-4444-8444-444444444444', team_name: 'Team Cedar', invite_token: firstToken }, { team_id: '55555555-5555-4555-8555-555555555555', team_name: 'Team Maple', invite_token: secondToken }] }) })
      return
    }
    if (organizerLobbyMode && request.url().includes('/rest/v1/rpc/regenerate_hunt_invites')) {
      organizerInviteRotationCalls++
      organizerInviteRotated = true
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ team_id: '44444444-4444-4444-8444-444444444444', team_name: 'Team Cedar', invite_token: 'c'.repeat(64) }, { team_id: '55555555-5555-4555-8555-555555555555', team_name: 'Team Maple', invite_token: 'd'.repeat(64) }]) })
      return
    }
    if (organizerLobbyMode && request.url().includes('/rest/v1/rpc/get_hunt_messages')) {
      const body = request.postDataJSON() as { p_limit?: number; p_before?: string | null; p_before_id?: string | null }
      if (Object.hasOwn(body, 'p_before_id')) {
        chatStableCursorCalls++
        if (chatLegacyRpcMode) {
          await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST202', message: 'Could not find the function public.get_hunt_messages(p_before_id, p_before, p_hunt_id, p_limit) in the schema cache' }) })
          return
        }
      } else chatLegacyCursorCalls++
      if (chatLoadFailures > 0) {
        chatLoadFailures--
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'simulated chat connection failure' }) })
        return
      }
      const { p_limit = 101, p_before = null, p_before_id = null } = body
      const eligible = organizerMessages.filter(message => !p_before || (p_before_id ? message.created_at < p_before || (message.created_at === p_before && message.id < p_before_id) : message.created_at < p_before))
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
      if (organizerTimingFailure === 'start') {
        organizerTimingFailure = null
        await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'simulated start failure' }) })
        return
      }
      organizerStartCalls++
      organizerLobbyStatus = 'active'
      await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
      return
    }
    if (organizerLobbyMode && request.url().includes('/rest/v1/rpc/reschedule_game')) {
      if (organizerTimingFailure === 'reschedule') {
        organizerTimingFailure = null
        await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'simulated reschedule failure' }) })
      } else await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
      return
    }
    if (organizerLobbyMode && request.url().includes('/rest/v1/rpc/add_game_time')) {
      if (organizerTimingFailure === 'add') {
        organizerTimingFailure = null
        await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'simulated add-time failure' }) })
      } else await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
      return
    }
    if (organizerLobbyMode && request.url().includes('/rest/v1/rpc/end_hunt_early')) {
      if (organizerTimingFailure === 'end') {
        organizerTimingFailure = null
        await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'simulated end failure' }) })
      } else {
        organizerLobbyStatus = 'review'
        organizerReviewStatus = 'review'
        await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
      }
      return
    }
    if (organizerReviewMode && request.url().includes('/rest/v1/rpc/review_submission')) {
      organizerReviewDecision = JSON.parse(request.postData() ?? '{}').p_decision
      await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
      return
    }
    if (organizerReviewMode && request.url().includes('/rest/v1/rpc/finalize_hunt')) {
      organizerReviewStatus = 'completed'
      if (organizerFinalizeLostResponse) {
        organizerFinalizeLostResponse = false
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'simulated response lost after commit' }) })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
      return
    }
    if (organizerReviewMode && request.url().includes('/rest/v1/rpc/get_hunt_invites')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ has_active_invites: false, recoverable: true, invite_codes: [] }) })
      return
    }
    if (request.url().includes('/rest/v1/hunt_items')) {
      if (organizerDraftMode) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(organizerDraftItems) })
        return
      }
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
    localStorage.setItem('sb-test-project-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, token_type: 'bearer', user: userData }))
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

test('expired team invitations explain the next step and provide a home link', async ({ page }) => {
  invalidInvitePreview = true
  await page.goto(`/#/join/${'e'.repeat(64)}`)
  await expect(page.getByRole('heading', { name: 'This invitation is unavailable' })).toBeVisible()
  await expect(page.getByText(/expired or been replaced/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Join the hunt' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Return home' }).click()
  await expect(page.getByRole('button', { name: /I.?m a Player/ })).toBeVisible()
})

test('player can join an invited team and reach the waiting lobby', async ({ page }) => {
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await expect(page.getByRole('heading', { name: 'Spring Photo Hunt' })).toBeVisible()
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.getByRole('status')).toContainText('Your organizer will start the hunt.', { timeout: 10_000 })
  await expect(page.getByText('You are checked in with Team Cedar')).toBeVisible()
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
  await page.locator('.waiting-team-details summary').click()
  await expectKeyboardCanReach(page, page.getByLabel('Team name'))
  await expectNoHorizontalOverflowAt200Percent(page, 'participant lobby')
})

test('saved team selfie stays saved when signing its preview fails', async ({ page }) => {
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.getByText('You are checked in with Team Cedar')).toBeVisible()

  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nXcAAAAASUVORK5CYII=', 'base64')
  await page.locator('.team-identity-panel input[type="file"]').setInputFiles({ name: 'team.png', mimeType: 'image/png', buffer: image })
  const selfieNotice = page.locator('.participant-error[role="status"]')
  await expect(selfieNotice).toContainText('Team selfie saved, but its preview is unavailable')
  await expect(selfieNotice.getByRole('button', { name: 'Retry preview' })).toBeVisible()
  expect(selfieSubmissionRpcCalls).toBe(1)
  expect(rollbackDeleteRequests).toBe(0)
})

test('team selfie survives a lost save response when the server committed it', async ({ page }) => {
  selfieLostResponseMode = true
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.getByText('You are checked in with Team Cedar')).toBeVisible()

  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nXcAAAAASUVORK5CYII=', 'base64')
  await page.locator('.team-identity-panel input[type="file"]').setInputFiles({ name: 'team.png', mimeType: 'image/png', buffer: image })

  const selfieNotice = page.locator('.participant-error[role="status"]')
  await expect(selfieNotice).toContainText('Team selfie saved, but its preview is unavailable')
  await expect(selfieNotice.getByRole('button', { name: 'Retry preview' })).toBeVisible()
  expect(selfieSubmissionRpcCalls).toBe(1)
  expect(selfieReconciliationReads).toBe(1)
  expect(selfieStoredPath).toMatch(/\/selfie\/.+\.jpg$/)
  expect(rollbackDeleteRequests).toBe(0)
})

test('participant can return through the original invite after reloading the browser', async ({ page }) => {
  const inviteUrl = `/#/join/${'a'.repeat(64)}`
  await page.goto(inviteUrl)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.getByRole('status')).toContainText('Your organizer will start the hunt.', { timeout: 10_000 })
  await page.goto(inviteUrl)
  await expect(page).toHaveURL(/#\/play\/33333333-3333-4333-8333-333333333333$/)
  await expect(page.getByText('You are checked in with Team Cedar')).toBeVisible()
})

test('browser Back from a resumed participant session returns to the previous screen', async ({ page }) => {
  await page.goto('/#/')
  await page.getByRole('button', { name: /I.?m a Player/ }).click()
  await page.getByRole('textbox', { name: 'Team invitation' }).fill('a'.repeat(64))
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.getByRole('status')).toContainText('Your organizer will start the hunt.', { timeout: 10_000 })

  await page.goBack()
  await expect(page.getByRole('textbox', { name: 'Team invitation' })).toBeVisible()
  await page.goForward()
  await expect(page.getByText('You are checked in with Team Cedar')).toBeVisible()
})

test('team progress retains the last counts and recovers after a failed refresh', async ({ page }) => {
  participantRuntimeState = 'active'
  let failProgress = false
  let accepted = 1
  await page.route('**/rest/v1/rpc/get_hunt_progress', async route => {
    if (failProgress) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Unavailable' }) })
    else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ team_id: '44444444-4444-4444-8444-444444444444', team_name: 'Team Cedar', display_color: '#15967a', accepted_count: accepted, total_items: 2 }]) })
  })
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  const bar = page.getByRole('progressbar', { name: 'Team Cedar accepted photos' })
  await expect(bar).toHaveAttribute('aria-valuenow', '1')
  failProgress = true
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByText('Team progress may be out of date. Reconnecting...')).toBeVisible()
  await expect(bar).toHaveAttribute('aria-valuenow', '1')
  failProgress = false
  accepted = 2
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(bar).toHaveAttribute('aria-valuenow', '2')
  await expect(page.getByText('Team progress is up to date.')).toBeVisible()
})

test('a failed hunt refresh keeps play available and clears when the same data recovers', async ({ page }) => {
  participantRuntimeState = 'active'
  let failedRead: 'context' | 'submissions' | null = null
  const contextWrites: string[] = []
  const failedResponse = { status: 400, json: { message: 'TypeError: Load failed' } }
  await page.route('**/rest/v1/rpc/record_audit_event', route => {
    const details = route.request().postDataJSON().p_details
    if (details.stage === 'player_context_refresh_failed') {
      contextWrites.push(details.operation_id)
      if (contextWrites.length === 1) return route.fulfill(failedResponse)
    }
    return route.fallback()
  })
  await page.route('**/rest/v1/rpc/get_participant_context', route =>
    failedRead === 'context' ? route.fulfill(failedResponse) : route.fallback())
  await page.route('**/rest/v1/submissions?*', route => {
    if (failedRead === 'submissions') return route.fulfill(failedResponse)
    return route.fulfill({ json: [{
      id: '99999999-9999-4999-8999-999999999999',
      hunt_item_id: '77777777-7777-4777-8777-777777777777',
      team_id: '44444444-4444-4444-8444-444444444444',
      participant_id: '55555555-5555-4555-8555-555555555555',
      storage_path: 'saved-photo', submitted_at: new Date().toISOString(), approval_status: 'pending',
    }] })
  })
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  const challenge = page.getByRole('article').filter({ hasText: 'A red leaf' })
  await expect(challenge.getByText(/awaiting review/)).toBeVisible()
  const retry = page.getByRole('button', { name: 'Retry hunt refresh' })
  const reconnect = () => page.evaluate(() => window.dispatchEvent(new Event('online')))

  failedRead = 'context'
  await reconnect()
  await expect(page.getByText('Could not refresh the hunt. Check your connection and try again.')).toBeVisible()
  await expect(challenge.getByText(/awaiting review/)).toBeVisible()
  await expect(page.getByText('TypeError: Load failed')).toHaveCount(0)
  await expect.poll(() => contextWrites.length).toBe(1)
  failedRead = 'submissions'
  await retry.click()
  await expect(page.getByText(/Could not refresh your team photos/)).toBeVisible()
  await expect(challenge.getByText(/awaiting review/)).toBeVisible()
  await expect(page.getByText('Team progress is up to date.')).toBeVisible()

  failedRead = null
  await reconnect()
  await expect(retry).toHaveCount(0)
  await expect(challenge.getByText(/awaiting review/)).toBeVisible()
  for (const area of ['player_context', 'player_submissions']) {
    const byStage = (stage: string) => auditReports.filter(report =>
      (report.p_details as Record<string, unknown>)?.stage === stage)
    await expect.poll(() => byStage(area + '_refresh_recovered').length).toBe(1)
    const failure = byStage(area + '_refresh_failed')
    const [recovery] = byStage(area + '_refresh_recovered')
    expect(failure).toHaveLength(1)
    expect(recovery.p_outcome).toBe('success')
    const recoveryDetails = recovery.p_details as Record<string, unknown>
    expect(recoveryDetails).toMatchObject({
      operation_id: (failure[0].p_details as Record<string, unknown>).operation_id,
      app: 'participant_web', recovery_ms: expect.any(Number),
    })
    expect(recoveryDetails.recovery_ms).toBeGreaterThanOrEqual(0)
    expect(Object.keys(recoveryDetails).sort()).toEqual(['app', 'client_report', 'operation_id', 'recovery_ms', 'stage'])
  }
  expect(contextWrites).toEqual([contextWrites[0], contextWrites[0]])
})

test('an initial team progress failure does not imply zero photos', async ({ page }) => {
  participantRuntimeState = 'active'
  await page.route('**/rest/v1/rpc/get_hunt_progress', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Unavailable' }) }))
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.getByText('Team progress may be out of date. Reconnecting...')).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Team Cedar accepted photos' })).toHaveCount(0)
})

test('a late team progress response cannot replace newer counts', async ({ page }) => {
  participantRuntimeState = 'active'
  let mode: 'initial' | 'hold' | 'new' = 'initial'
  let held = false
  let releaseHeld: (() => void) | undefined
  const waitHeld = new Promise<void>(resolve => { releaseHeld = resolve })
  await page.route('**/rest/v1/rpc/get_hunt_progress', async route => {
    const responseMode = mode
    if (responseMode === 'hold') { held = true; await waitHeld }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ team_id: '44444444-4444-4444-8444-444444444444', team_name: 'Team Cedar', display_color: '#15967a', accepted_count: responseMode === 'new' ? 2 : 1, total_items: 2 }]) })
  })
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  const bar = page.getByRole('progressbar', { name: 'Team Cedar accepted photos' })
  await expect(bar).toHaveAttribute('aria-valuenow', '1')
  mode = 'hold'
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect.poll(() => held).toBe(true)
  mode = 'new'
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(bar).toHaveAttribute('aria-valuenow', '2')
  const olderResponse = page.waitForResponse(response => response.url().includes('/rpc/get_hunt_progress'))
  releaseHeld?.()
  await olderResponse
  await expect(bar).toHaveAttribute('aria-valuenow', '2')
})

test('participant context refresh pauses in the background and resumes on return', async ({ page }) => {
  participantRuntimeState = 'active'
  let contextReads = 0
  await page.clock.install()
  page.on('request', request => { if (request.url().includes('/rpc/get_participant_context')) contextReads++ })
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.getByText('Next challenge')).toBeVisible()
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }))
  const before = contextReads
  await page.clock.fastForward(45_000)
  expect(contextReads).toBe(before)
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')) })
  await expect.poll(() => contextReads).toBeGreaterThan(before)
})

test('active participant game exposes the timer, team progress, and photo list', async ({ page }) => {
  participantRuntimeState = 'active'
  const progressResponses: string[] = []
  let challengeListReads = 0
  let submissionListReads = 0
  await page.clock.install()
  page.on('request', request => {
    if (request.url().includes('/rest/v1/hunt_items')) challengeListReads++
    if (request.url().includes('/rest/v1/submissions')) submissionListReads++
  })
  page.on('response', async response => {
    if (response.url().includes('/rpc/get_hunt_progress')) progressResponses.push(await response.text())
  })
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.getByText('Next challenge')).toBeVisible()
  await expect(page.getByText('A red leaf')).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Time remaining' })).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Team Cedar accepted photos' }), `progress RPC responses: ${progressResponses.join(', ')}`).toHaveAttribute('aria-valuenow', '1')
  await expect(page.getByRole('article').filter({ hasText: 'A red leaf' }).getByText('Take or choose photo')).toBeVisible()
  await expect.poll(() => challengeListReads).toBe(1)
  await expect.poll(() => submissionListReads).toBeGreaterThan(0)
  const initialSubmissionReads = submissionListReads
  await page.clock.fastForward(45_000)
  await expect.poll(() => submissionListReads).toBeGreaterThan(initialSubmissionReads)
  expect(challengeListReads).toBe(1)
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 })
    const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    expect(dimensions.content, `active game horizontal overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport)
  }
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(results.violations, JSON.stringify(results.violations.map(({ id, impact, help, nodes }) => ({ id, impact, help, targets: nodes.map(node => node.target) })), null, 2)).toEqual([])
  await page.locator('.participant-chat-disclosure summary').click()
  await expectKeyboardCanReach(page, page.getByRole('textbox', { name: 'Message' }))
  await expectNoHorizontalOverflowAt200Percent(page, 'participant gameplay')
})

test('participant gameplay follows server time when the device clock is years behind', async ({ page }) => {
  participantRuntimeState = 'active'
  await page.clock.install({ time: new Date('2000-01-01T00:00:00Z') })
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.getByText('Next challenge')).toBeVisible()
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
  await expect(page.getByText('Photo by Taylor · Team Cedar · approved')).toBeVisible({ timeout: 10_000 })
  expect(photoSubmissionRpcCalls).toBe(1)
  await expect(page.getByText(/Submitted successfully, but the photo preview is unavailable right now/)).toHaveCount(0)
  await page.getByRole('checkbox', { name: /Show submitted photo previews/ }).check()
  await expect(page.getByText(/Submitted successfully, but the photo preview is unavailable right now/)).toBeVisible()
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
  await expect.poll(() => auditReports.some(report => {
    const details = report.p_details as Record<string, unknown> | undefined
    return details?.stage === 'photo_upload_failed' && details.app === 'participant_web'
  })).toBe(true)
  const denialReport = auditReports.find(report => (report.p_details as Record<string, unknown> | undefined)?.stage === 'photo_upload_failed')
  expect(denialReport?.p_outcome).toBe('failure')
  expect(Object.keys(denialReport?.p_details as Record<string, unknown>).sort()).toEqual(['app', 'client_report', 'operation_id', 'stage'])
  await expect.poll(() => auditReports.some(report => (report.p_details as Record<string, unknown> | undefined)?.stage === 'authorization_denied')).toBe(true)
  const authorizationReport = auditReports.find(report => (report.p_details as Record<string, unknown> | undefined)?.stage === 'authorization_denied')
  expect(authorizationReport?.p_outcome).toBe('failure')
  expect(authorizationReport?.p_details).toMatchObject({ client_report: true, app: 'participant_web', stage: 'authorization_denied' })
  expect(JSON.stringify(authorizationReport?.p_details)).not.toContain('row-level security')
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

test('stale device photo replacement reloads the winning photo and cleans only its rejected upload', async ({ page }) => {
  participantRuntimeState = 'active'
  photoReplacementRaceMode = true
  signedPreviewMode = true
  raceCurrentPhotoPath = '33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444/77777777-7777-4777-8777-777777777777/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg'
  const originalPath = raceCurrentPhotoPath
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nXcAAAAASUVORK5CYII=', 'base64')

  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  const firstSlot = page.locator('.participant-item-card').filter({ hasText: 'A red leaf' })
  await expect(firstSlot.locator('.photo-submission-status')).toContainText('Photo by Taylor · Team Cedar · approved')
  const previewToggle = page.getByRole('checkbox', { name: 'Show submitted photo previews' })
  await expect(firstSlot.locator('.submission-preview')).toHaveCount(0)
  expect(raceSignedPaths).toHaveLength(0)
  await previewToggle.check()
  await firstSlot.scrollIntoViewIfNeeded()
  await expect(firstSlot.locator('.submission-preview')).toBeVisible()
  await expect.poll(() => raceSignedPaths.length).toBe(1)
  await previewToggle.uncheck()
  await expect(firstSlot.locator('.submission-preview')).toHaveCount(0)
  await previewToggle.check()
  await firstSlot.scrollIntoViewIfNeeded()
  await expect(firstSlot.locator('.submission-preview')).toBeVisible()
  const staleDevice = await page.context().newPage()
  await staleDevice.goto('/#/play/33333333-3333-4333-8333-333333333333')
  const secondSlot = staleDevice.locator('.participant-item-card').filter({ hasText: 'A red leaf' })
  await expect(secondSlot.locator('.photo-submission-status')).toContainText('Photo by Taylor · Team Cedar · approved')
  const stalePreviewToggle = staleDevice.getByRole('checkbox', { name: 'Show submitted photo previews' })
  await expect(secondSlot.locator('.submission-preview')).toHaveCount(0)
  await stalePreviewToggle.check()
  await secondSlot.scrollIntoViewIfNeeded()
  await expect(secondSlot.locator('.submission-preview')).toBeVisible()

  await firstSlot.locator('input[type="file"]').setInputFiles({ name: 'first-replacement.png', mimeType: 'image/png', buffer: image })
  await expect.poll(() => raceAcceptedPaths.length).toBe(1)
  const winningPath = raceCurrentPhotoPath
  expect(winningPath).not.toBe(originalPath)
  await expect(firstSlot.locator('.photo-submission-status')).toContainText('Photo by Taylor · Team Cedar · awaiting review')

  await secondSlot.locator('input[type="file"]').setInputFiles({ name: 'stale-replacement.png', mimeType: 'image/png', buffer: image })
  await expect(secondSlot.getByRole('status')).toContainText('A teammate replaced this photo first. Their saved photo is still in place; your replacement was not saved.')
  await expect(secondSlot.locator('.photo-submission-status')).toContainText('Photo by Taylor · Team Cedar · awaiting review')
  const displayedSource = await secondSlot.locator('.submission-preview').getAttribute('src')
  expect(decodeURIComponent(displayedSource ?? '')).toContain(winningPath)
  expect(raceAcceptedPaths).toEqual([winningPath])
  expect(photoSubmissionRpcCalls).toBe(2)
  expect(photoDeletedPaths).toHaveLength(2)
  expect(photoDeletedPaths).not.toContain(winningPath)
  await staleDevice.close()
})

test('participant can see the post-hunt review gallery while the organizer reviews', async ({ page }) => {
  participantRuntimeState = 'review'
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.getByRole('heading', { name: 'Your organizer is reviewing the photos.' })).toBeVisible()
  await expect(page.getByText('Team photo gallery')).toBeVisible()
  await expect(page.getByText('The organizer is reviewing all team photos.')).toBeVisible()
  await expect(page.getByText('No photos were submitted in this hunt.')).toBeVisible()
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 })
    const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    expect(dimensions.content, `review gallery horizontal overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport)
  }
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(results.violations, JSON.stringify(results.violations.map(({ id, impact, help, targets }) => ({ id, impact, help, targets })), null, 2)).toEqual([])
  await expectNoHorizontalOverflowAt200Percent(page, 'participant review gallery')
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
  const retryPreview = page.getByRole('button', { name: 'Retry Team Cedar photo preview for A red leaf' })
  await expect(retryPreview).toBeVisible()
  await expectKeyboardCanReach(page, retryPreview)
  await expectNoHorizontalOverflowAt200Percent(page, 'participant review')
  signedPreviewMode = true
  await retryPreview.click()
  await expect(page.getByRole('img', { name: 'Team Cedar photo for A red leaf' })).toBeVisible()
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

test('a slow stale participant gallery response cannot replace newer approval state', async ({ page }) => {
  participantRuntimeState = 'review'
  participantReviewVotingMode = true
  participantReviewPhotoStatus = 'pending'
  signedPreviewMode = true
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  const voteButton = page.getByRole('button', { name: 'Vote for this photo' })
  await expect(page.getByText('Team photo gallery')).toBeVisible()
  await expect(voteButton).toHaveCount(0)

  const previousCalls = participantReviewGalleryCalls
  delayNextParticipantGalleryResponse = true
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect.poll(() => participantReviewGalleryCalls).toBeGreaterThan(previousCalls)
  await expect.poll(() => releaseDelayedParticipantGalleryResponse !== null).toBe(true)

  participantReviewPhotoStatus = 'approved'
  const freshResponse = page.waitForResponse(response => response.url().includes('/rest/v1/rpc/get_hunt_review_gallery'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await freshResponse
  await expect(voteButton).toBeVisible()

  const staleResponse = page.waitForResponse(response => response.url().includes('/rest/v1/rpc/get_hunt_review_gallery'))
  releaseDelayedParticipantGalleryResponse?.()
  releaseDelayedParticipantGalleryResponse = null
  await staleResponse
  await expect(voteButton).toBeVisible()
})

test('participant sees final standings and winner celebration after results publish', async ({ page }) => {
  participantRuntimeState = 'completed'
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.locator('.participant-result-summary')).toContainText('Final results - your team')
  await expect(page.getByText('Final results')).toBeVisible()
  await expect(page.locator('.participant-result-summary')).toContainText('#1')
  await expect(page.locator('.participant-scoreboard')).toContainText('Your team: Team Cedar')
  await expect(page.locator('.participant-scoreboard')).toContainText('10 points + 5 voting bonus')
  await expect(page.getByRole('button', { name: 'Share team card' })).toBeVisible()
  const caption = page.locator('.celebration-caption')
  await expect(caption).toBeVisible()
  await expect(caption).toContainText('Team Cedar won Spring Photo Hunt with 15 points')
  const captionText = (await caption.textContent())?.trim()
  await grantClipboardAccess(page)
  await page.getByRole('button', { name: 'Copy caption' }).click()
  await expect(page.getByRole('button', { name: 'Caption copied' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(captionText)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Clipboard permission denied') } } })
    document.execCommand = () => true
  })
  await page.getByRole('button', { name: 'Caption copied' }).click()
  await expect(page.getByRole('button', { name: 'Caption copied' })).toBeVisible()
  const shareButton = page.getByRole('button', { name: 'Share team card' })
  await expectKeyboardCanReach(page, shareButton)
  await expectNoHorizontalOverflowAt200Percent(page, 'participant results')
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
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 })
    const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    expect(dimensions.content, `published results horizontal overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport)
    await page.screenshot({ path: `test-results/snapquest-results-${width}-${test.info().project.name}.png`, fullPage: true })
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

test('a team with zero points is distinguished from a hunt-wide zero score', async ({ page }) => {
  participantRuntimeState = 'completed'
  participantZeroScoreMode = true
  participantMixedZeroMode = true
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.locator('.participant-result-summary')).toContainText('Your team scored 0 points this hunt.')
  await expect(page.locator('.participant-result-summary')).not.toContainText('No team scored points')
  await expect(page.locator('.participant-scoreboard')).toContainText('Team Maple')
})

test('winner card uses the team-color fallback and handles a long team name', async ({ page }) => {
  participantRuntimeState = 'completed'
  participantTeamName = 'The Unreasonably Long Name for the Autumn Adventure Team'
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.locator('.participant-scoreboard')).toContainText(`Your team: ${participantTeamName}`)
  const cardDownloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download card' }).click()
  const download = await cardDownloadPromise
  expect(download.suggestedFilename()).toContain('the-unreasonably-long-name-for-the-autumn-adventure-team')
  const cardPath = await download.path()
  expect(cardPath).toBeTruthy()
  if (!cardPath) throw new Error('Winner card download did not produce a file')
  const encodedCard = (await readFile(cardPath)).toString('base64')
  const sampledColor = await page.evaluate(async (encoded: string) => {
    const image = new Image()
    image.src = `data:image/png;base64,${encoded}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas context is unavailable')
    context.drawImage(image, 0, 0)
    return Array.from(context.getImageData(540, 600, 1, 1).data).slice(0, 3)
  }, encodedCard)
  expect(sampledColor).toEqual([21, 150, 122])
  await page.setViewportSize({ width: 320, height: 844 })
  await expect(page.getByRole('button', { name: 'Download card' })).toBeVisible()
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
  expect(dimensions.content, 'long-name winner card horizontal overflow at 320px').toBeLessThanOrEqual(dimensions.viewport)
})

test('winner card includes the team selfie when one is available', async ({ page }) => {
  participantRuntimeState = 'completed'
  celebrationSelfieMode = true
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.getByText('Final results')).toBeVisible()
  await expect.poll(() => celebrationSelfieSignedRequests).toBeGreaterThan(0)
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const cardDownloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download card' }).click()
  const cardPath = await (await cardDownloadPromise).path()
  expect(cardPath).toBeTruthy()
  if (!cardPath) throw new Error('Winner card download did not produce a file')
  const encodedCard = (await readFile(cardPath)).toString('base64')
  const sampledColor = await page.evaluate(async (encoded: string) => {
    const image = new Image()
    image.src = `data:image/png;base64,${encoded}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas context is unavailable')
    context.drawImage(image, 0, 0)
    return Array.from(context.getImageData(540, 600, 1, 1).data).slice(0, 3)
  }, encodedCard)
  expect(sampledColor).not.toEqual([21, 150, 122])
})

test('winner card includes a JPEG team selfie', async ({ page }) => {
  participantRuntimeState = 'completed'
  celebrationSelfieMode = true
  celebrationSelfieFormat = 'jpeg'
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.getByText('Final results')).toBeVisible()
  await expect.poll(() => celebrationSelfieSignedRequests).toBeGreaterThan(0)
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const cardDownloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download card' }).click()
  const cardPath = await (await cardDownloadPromise).path()
  expect(cardPath).toBeTruthy()
  if (!cardPath) throw new Error('JPEG winner card download did not produce a file')
  const encodedCard = (await readFile(cardPath)).toString('base64')
  const sampledColor = await page.evaluate(async (encoded: string) => {
    const image = new Image()
    image.src = `data:image/png;base64,${encoded}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas context is unavailable')
    context.drawImage(image, 0, 0)
    return Array.from(context.getImageData(540, 600, 1, 1).data).slice(0, 3)
  }, encodedCard)
  expect(sampledColor).not.toEqual([21, 150, 122])
  expect(sampledColor[0]).toBeGreaterThan(180)
  expect(sampledColor[2]).toBeGreaterThan(70)
})

test('winner card falls back to team color when the saved selfie cannot be loaded', async ({ page }) => {
  participantRuntimeState = 'completed'
  celebrationSelfieMode = true
  celebrationSelfieLoadFailure = true
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.getByText('Final results')).toBeVisible()
  await expect.poll(() => celebrationSelfieSignedRequests).toBeGreaterThan(0)
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const cardDownloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download card' }).click()
  const cardPath = await (await cardDownloadPromise).path()
  expect(cardPath).toBeTruthy()
  if (!cardPath) throw new Error('Fallback winner card download did not produce a file')
  const encodedCard = (await readFile(cardPath)).toString('base64')
  const sampledColor = await page.evaluate(async (encoded: string) => {
    const image = new Image()
    image.src = `data:image/png;base64,${encoded}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas context is unavailable')
    context.drawImage(image, 0, 0)
    return Array.from(context.getImageData(540, 600, 1, 1).data).slice(0, 3)
  }, encodedCard)
  expect(sampledColor).toEqual([21, 150, 122])
  await expect(page.getByRole('alert')).toHaveCount(0)
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

test('participant review gallery refreshes signed previews when the page returns to the foreground', async ({ page }) => {
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
  const initialRequests = signedPreviewRequests
  let previousRequests = initialRequests
  const recoveryEvents: Array<'visibilitychange' | 'online' | 'focus'> = ['visibilitychange', 'online', 'focus']
  for (const recoveryEvent of recoveryEvents) {
    const expiredAt = await page.evaluate(() => Date.now() + 300_000)
    await page.clock.setSystemTime(new Date(expiredAt))
    await page.evaluate(eventName => {
      if (eventName === 'visibilitychange') Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      const target = eventName === 'visibilitychange' ? document : window
      target.dispatchEvent(new Event(eventName))
    }, recoveryEvent)
    await expect.poll(() => signedPreviewRequests, { message: `signed URL should renew after ${recoveryEvent}` }).toBeGreaterThan(previousRequests)
    await expect(galleryImage).toBeVisible()
    previousRequests = signedPreviewRequests
  }
})

test('participant signed-preview failures create a privacy-safe diagnostic event', async ({ page }) => {
  participantRuntimeState = 'completed'
  signedPreviewMode = true
  signedPreviewFailure = true
  await page.goto(`/#/join/${'a'.repeat(64)}`)
  await page.getByLabel('What should your team call you?').fill('Taylor')
  await page.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(page.getByText('Final results')).toBeVisible()
  await expect(page.getByText('Photo preview unavailable')).toBeVisible()
  await expect.poll(() => auditReports.some(report => (report.p_details as Record<string, unknown> | undefined)?.stage === 'review_preview_unavailable')).toBe(true)
  const report = auditReports.find(entry => (entry.p_details as Record<string, unknown> | undefined)?.stage === 'review_preview_unavailable')
  expect(report?.p_outcome).toBe('failure')
  expect((report?.p_details as Record<string, unknown> | undefined)?.app).toBe('participant_web')
  expect(Object.keys(report?.p_details as Record<string, unknown>).sort()).toEqual(['app', 'client_report', 'operation_id', 'stage'])
})

test('My hunts prioritizes a live game and opens its lobby directly', async ({ page }) => {
  organizerLobbyMode = true
  organizerLobbyStatus = 'active'
  await restoreOrganizerSession(page)
  await page.goto('/#/')
  await expect(page.getByRole('heading', { name: 'My Hunts' })).toBeVisible()
  const hunt = page.getByRole('article').filter({ hasText: 'Spring Photo Hunt' })
  await expect(hunt.getByText('Live now')).toBeVisible()
  await expect(hunt.getByText('Town Park')).toBeVisible()
  await hunt.getByRole('button', { name: 'Manage live hunt' }).click()
  await expect(page.getByRole('heading', { name: 'Hunt in progress' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'End hunt now and review' })).toBeVisible()
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 })
    const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    expect(dimensions.content, `active hunt management horizontal overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport)
  }
})

test('My hunts keeps hunt creation easy to reach when no hunt is live', async ({ page }) => {
  organizerReviewMode = true
  organizerReviewStatus = 'review'
  await restoreOrganizerSession(page)
  await page.goto('/#/')
  await expect(page.getByRole('heading', { name: 'My Hunts' })).toBeVisible()
  await page.getByRole('button', { name: 'Create a Hunt' }).click()
  await expect(page.getByRole('heading', { name: 'Create a venue hunt' })).toBeVisible()
})

test('My Hunts requires confirmation and can resume a hunt deletion after reload', async ({ page }) => {
  await restoreOrganizerSession(page)
  const hunt = { id: '33333333-3333-4333-8333-333333333333', title: 'Garden photo hunt', venue: 'Garden',
    status: 'completed', start_at: null, created_at: new Date().toISOString(), duration_minutes: 60 }
  const job = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', subject_id: hunt.id, hunt_title: hunt.title }
  let stage: 'available' | 'pending' | 'complete' = 'available'
  let requests = 0
  await page.route('**/rest/v1/hunts?*', route => route.request().url().includes('organizer_id=')
    ? route.fulfill({ json: stage === 'available' ? [hunt] : [] }) : route.fallback())
  await page.route('**/functions/v1/system-admin', route => {
    const action = route.request().postDataJSON()
    if (action.action === 'list-my-hunt-deletions') return route.fulfill({ json: { jobs: stage === 'pending' ? [job] : [] } })
    if (action.action === 'delete-my-hunt') {
      requests++
      expect(action).toMatchObject({ huntId: hunt.id, confirmation: hunt.title })
      stage = 'pending'
      return route.fulfill({ json: { deleted: false, pending: true, jobId: job.id } })
    }
    if (action.action === 'resume-my-hunt-deletion') {
      expect(action.jobId).toBe(job.id)
      stage = 'complete'
      return route.fulfill({ json: { deleted: true, jobId: job.id } })
    }
    return route.fulfill({ json: { isAdmin: false } })
  })
  await page.goto('/#/')
  const deleteHunt = page.getByRole('article').filter({ hasText: hunt.title }).getByRole('button', { name: 'Delete hunt' })
  await deleteHunt.click()
  const dialog = page.getByRole('dialog')
  const confirm = dialog.getByRole('button', { name: 'Delete hunt' })
  await expect(confirm).toBeDisabled()
  await expect(dialog).toContainText('Any published Hunt Library entry stays available.')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  expect(requests).toBe(0)

  await deleteHunt.click()
  await dialog.getByLabel('Type the hunt name to confirm').fill(hunt.title)
  await confirm.click()
  await expect(page.getByRole('button', { name: 'View results' })).toHaveCount(0)
  await expect(page.getByText('Media cleanup pending')).toBeVisible()
  expect(requests).toBe(1)

  await page.reload()
  const cleanup = page.getByRole('region', { name: 'Pending hunt cleanup' })
  await cleanup.getByRole('button', { name: 'Resume cleanup' }).click()
  await expect(cleanup).toHaveCount(0)
  await expect(page.getByText('Hunt deleted.')).toBeVisible()
})

test('Hunt Library previews a complete hunt and copies an editable draft at desktop and phone widths', async ({ page }) => {
  organizerHuntLibraryMode = true
  organizerReviewMode = true
  organizerReviewStatus = 'completed'
  await restoreOrganizerSession(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/')
  await page.getByRole('button', { name: 'Browse Hunt Library' }).click()
  await expect(page.getByRole('heading', { name: 'Hunt Library' })).toBeVisible()
  await page.getByLabel('Search Hunt Library').fill('Christmas lights')
  const result = page.getByRole('article').filter({ hasText: 'Christmas Lights Hunt' })
  await expect(result).toBeVisible()
  await result.getByRole('button', { name: 'Preview complete hunt' }).click()
  await expect(page.getByRole('heading', { name: 'Christmas Lights Hunt' })).toBeVisible()
  for (const challenge of ['A house with blue lights', 'A lit-up reindeer', 'A team selfie by a wreath']) await expect(page.getByText(challenge, { exact: true })).toBeVisible()
  await expect(page.getByText('Find a home glowing blue.')).toBeVisible()
  await expect(page.getByText('Look for a reindeer display.')).toBeVisible()
  await expect(page.getByText('Include every team member.')).toBeVisible()
  await expect(page.getByText('Do not enter private property')).toBeVisible()
  await expect(page.getByText(/95 minute time limit/)).toBeVisible()
  await expect(page.locator('.hunt-library-content').getByText('Team Cedar')).toHaveCount(0)
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 })
    const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    expect(dimensions.content, `Hunt Library preview horizontal overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport)
  }

  await page.getByRole('button', { name: 'Copy to My Hunts' }).click()
  await expect(page.getByRole('heading', { name: 'Edit your draft hunt' })).toBeVisible()
  await expect(page.getByLabel('Hunt title')).toHaveValue('Christmas Lights Hunt')
  await expect(page.getByLabel('Time limit (minutes)')).toHaveValue('95')
  await expect(page.getByLabel('What should they find?').nth(1)).toHaveValue('A lit-up reindeer')
  await page.setViewportSize({ width: 375, height: 844 })
  const editorDimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
  expect(editorDimensions.content, 'copied hunt editor horizontal overflow at 375px').toBeLessThanOrEqual(editorDimensions.viewport)

  await page.getByLabel('Venue name').fill('Christmas Lights Plaza')
  await page.getByLabel('Hunt title').fill('Christmas Lights (B Copy)')
  await page.getByLabel('Time limit (minutes)').fill('120')
  await page.getByRole('button', { name: 'Remove item 2' }).click()
  await page.getByRole('button', { name: 'Add item' }).click()
  await page.getByLabel('What should they find?').nth(2).fill('A decorated mailbox')
  await page.getByLabel('Instructions').nth(2).fill('Look for a festive mailbox.')
  await page.getByLabel('Points').nth(2).fill('5')
  await page.getByRole('button', { name: 'Save draft changes' }).click()
  await expect(page.getByRole('heading', { name: 'Christmas Lights (B Copy)' })).toBeVisible()
  const saved = savedDraftPayloads[savedDraftPayloads.length - 1]
  expect(saved.p_title).toBe('Christmas Lights (B Copy)')
  expect(saved.p_duration_minutes).toBe(120)
  expect(saved.p_items).toMatchObject([
    { title: 'A house with blue lights', pointValue: 3 },
    { title: 'A team selfie by a wreath', pointValue: 2 },
    { title: 'A decorated mailbox', description: 'Look for a festive mailbox.', pointValue: 5 },
  ])
})

test('Hunt Library labels Christmas Tree as a starter and Hobby Lobby as completed', async ({ page }) => {
  await restoreOrganizerSession(page)
  await page.route('**/rest/v1/rpc/list_hunt_templates', route => route.fulfill({ json: [
    { id: 'christmas', kind: 'starter', title: 'Christmas Tree Hunt', description: 'Follow a Christmas lights trail.',
      defaultDuration: 60, rules: ['Walk together'],
      challenges: [{ title: 'Santa takes flight', description: 'Find a Santa and an airplane.', points: 3, displayOrder: 0 }] },
    { id: 'hobby', title: 'Hobby Lobby Scavenger Hunt', defaultDuration: 60, rules: ['Ask the store for permission'],
      challenges: [{ title: 'An item with a leaf on it', description: null, points: 1, displayOrder: 0 }] },
  ] }))
  await page.goto('/#/')
  await page.getByRole('button', { name: 'Browse Hunt Library' }).click()
  await page.getByLabel('Search Hunt Library').fill('Christmas lights')
  const christmas = page.getByRole('article').filter({ hasText: 'Christmas Tree Hunt' })
  await expect(christmas.getByText(/STARTER HUNT/)).toBeVisible()
  await christmas.getByRole('button', { name: 'Preview complete hunt' }).click()
  await expect(page.getByText('STARTER HUNT', { exact: true })).toBeVisible()
  await expect(page.getByText('Santa takes flight', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy to My Hunts' })).toBeVisible()

  await page.getByRole('button', { name: 'Back to Hunt Library' }).click()
  await page.getByLabel('Search Hunt Library').fill('Hobby Lobby')
  await page.getByRole('article').filter({ hasText: 'Hobby Lobby Scavenger Hunt' }).getByRole('button', { name: 'Preview complete hunt' }).click()
  await expect(page.getByText('COMPLETED HUNT', { exact: true })).toBeVisible()
  await expect(page.getByText('An item with a leaf on it')).toBeVisible()
})

test('organizer can start a rematch from a completed hunt without changing its results', async ({ page }) => {
  organizerReviewMode = true
  organizerReviewStatus = 'completed'
  await restoreOrganizerSession(page)
  await page.goto('/#/')
  await page.getByRole('button', { name: 'My hunts' }).click()
  const completedHunt = page.getByRole('article').filter({ hasText: 'Spring Photo Hunt' })
  await completedHunt.getByRole('button', { name: 'Use again' }).click()

  await expect(page.getByRole('heading', { name: 'Edit your draft hunt' })).toBeVisible()
  await expect(page.getByText(/Based on “Spring Photo Hunt”/)).toBeVisible()
  await expect(page.getByLabel('Venue name')).toHaveValue('Town Park')
  await expect(page.getByLabel('Hunt title')).toHaveValue('Spring Photo Hunt (Rematch)')
  await expect(page.getByLabel('What should they find?').nth(0)).toHaveValue('A red leaf')
  await expect(page.getByLabel('What should they find?').nth(1)).toHaveValue('A park sign')
  await expect(page.getByRole('button', { name: 'Save draft changes' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save draft changes' })).toBeEnabled()
})

test('Hunt Library retries with the same request ID after a lost response', async ({ page }) => {
  organizerHuntLibraryMode = true
  organizerReviewMode = true
  organizerReviewStatus = 'completed'
  await restoreOrganizerSession(page)
  const requests: string[] = []
  await page.route('**/rest/v1/rpc/copy_hunt_library_to_draft', async route => {
    requests.push(route.request().postDataJSON().p_request_id)
    if (requests.length === 1) {
      await route.fulfill({ status: 400, json: { message: 'Response unavailable' } })
    } else {
      await route.fallback()
    }
  })
  await page.goto('/#/')
  await page.getByRole('button', { name: 'Browse Hunt Library' }).click()
  await page.getByRole('article').filter({ hasText: 'Christmas Lights Hunt' }).getByRole('button', { name: 'Preview complete hunt' }).click()
  const copy = page.getByRole('button', { name: 'Copy to My Hunts' })
  await copy.click()
  await expect(page.getByText('Response unavailable')).toBeVisible()
  await copy.click()
  await expect(page.getByRole('heading', { name: 'Edit your draft hunt' })).toBeVisible()
  expect(requests).toHaveLength(2)
  expect(requests[0]).toMatch(/^[\da-f-]{36}$/i)
  expect(requests[1]).toBe(requests[0])
})

test('My Hunts follows the server clock when the device is a day behind', async ({ page }) => {
  await restoreOrganizerSession(page)
  const serverNow = Date.now() + 24 * 60 * 60 * 1000
  await page.route('**/rest/v1/rpc/get_organizer_hunt_clock', route => route.fulfill({ json: new Date(serverNow).toISOString() }))
  await page.route('**/rest/v1/hunts?*', route => {
    if (!route.request().url().includes('organizer_id=')) return route.fallback()
    return route.fulfill({ json: [
      { id: 'clock-hunt', title: 'Start by server time', venue: 'Park', status: 'scheduled',
        start_at: new Date(serverNow - 20_000).toISOString(), duration_minutes: 60, created_at: new Date(serverNow - 100_000).toISOString() },
      { id: 'expired-hunt', title: 'End by server time', venue: 'Park', status: 'active',
        start_at: new Date(serverNow - 120_000).toISOString(), duration_minutes: 1, created_at: new Date(serverNow - 200_000).toISOString() },
    ] })
  })
  await page.goto('/#/')
  await expect(page.getByRole('article').filter({ hasText: 'Start by server time' }).getByRole('button', { name: 'Manage live hunt' })).toBeVisible()
  await expect(page.getByRole('article').filter({ hasText: 'End by server time' }).getByRole('button', { name: 'Review photos' })).toBeVisible()
})

test('organizer reviews a photo, changes its decision, and finalizes results', async ({ page }) => {
  organizerReviewMode = true
  organizerReviewDecision = 'pending'
  await restoreOrganizerSession(page)
  await page.goto('/#/')
  await expect(page.getByRole('heading', { name: 'My Hunts' })).toBeVisible()
  await page.getByRole('button', { name: 'My hunts' }).click()
  const hunt = page.getByRole('article').filter({ hasText: 'Spring Photo Hunt' })
  await expect(hunt.getByRole('button', { name: 'Review photos' })).toBeVisible()
  await hunt.getByRole('button', { name: 'Review photos' }).click()
  await expect(page.getByRole('heading', { name: 'Spring Photo Hunt' })).toBeVisible()
  await expect(page.getByText('Preview unavailable')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible()
  await expect(page.getByText('1 photo still needs a decision')).toBeVisible()
  await expect(page.getByText('Review each photo and approve the ones that follow your hunt rules. Approved photos earn points.')).toBeVisible()
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  const approvalToggle = page.getByRole('checkbox', { name: 'Photo meets hunt rules: Team Cedar photo for A red leaf' })
  await expect(approvalToggle).toBeChecked()
  await expect(page.getByText('All submitted photos have a decision')).toBeVisible()
  await expectKeyboardCanReach(page, approvalToggle)
  await approvalToggle.click()
  await expect(approvalToggle).not.toBeChecked()
  await expect(page.getByText('rejected', { exact: true })).toBeVisible()
  await expect(page.getByText('0 approved / 1 rejected / 1 submitted')).toBeVisible()
  await page.getByLabel('Show photos').selectOption('approved')
  await expect(page.getByText('No photos match this filter.')).toBeVisible()
  await page.getByLabel('Show photos').selectOption('rejected')
  await expect(approvalToggle).toBeVisible()
  await expect.poll(() => auditReports.some(report => {
    const details = report.p_details as Record<string, unknown> | undefined
    return details?.app === 'organizer_web' && details?.stage === 'review_rejected_confirmed'
  })).toBe(true)
  await page.getByLabel('Show photos').selectOption('all')
  await approvalToggle.click()
  await expect(approvalToggle).toBeChecked()
  await expect(page.getByText('1 approved / 0 rejected / 1 submitted')).toBeVisible()
  await page.getByLabel('Show photos').selectOption('pending')
  await expect(page.getByText('Finishing this game adds its rules and challenge list to the Hunt Library. Player photos and results stay with this game.')).toBeVisible()
  await page.getByRole('button', { name: 'Finalize results' }).click()
  await page.evaluate(() => { document.body.style.minHeight = '200vh' })
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Confirm final results' }).click()
  await expect(page.getByRole('heading', { name: 'Hunt complete' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  await expect(page.locator('.celebration-card-panel').first()).toBeVisible()
  await expect(page.getByLabel('Show photos')).toHaveCount(0)
  await expect(page.locator('.review-photo-card')).toHaveCount(1)
  await expect(page.getByText('#1 Team Cedar')).toBeVisible()
  const shareWinnerButton = page.getByRole('button', { name: 'Share winner card' })
  await expect(shareWinnerButton).toBeVisible()
  await expectKeyboardCanReach(page, shareWinnerButton)
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 })
    const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    expect(dimensions.content, `organizer review/results horizontal overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport)
  }
  await expectNoHorizontalOverflowAt200Percent(page, 'organizer review and results')
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(results.violations, JSON.stringify(results.violations.map(({ id, impact, help, targets }) => ({ id, impact, help, targets })), null, 2)).toEqual([])
  await expect.poll(() => organizerSavedWinnerCards.length).toBe(1)
  await expect(page.getByText('Saved to this hunt. Reopen it from My hunts → View results to see the card.')).toBeVisible()
  await page.getByRole('button', { name: 'Back to hunt' }).click()
  const completedHunt = page.getByRole('article').filter({ hasText: 'Spring Photo Hunt' })
  await completedHunt.getByRole('button', { name: 'View results' }).click()
  await expect(page.getByRole('img', { name: 'Winner celebration card for Team Cedar' })).toBeVisible()
  await expect(page.getByText('Saved to this hunt. Reopen it from My hunts → View results to see the card.')).toBeVisible()
})

test('finalization retry after a lost response is traced to the original operation', async ({ page }) => {
  organizerReviewMode = true
  organizerFinalizeLostResponse = true
  await restoreOrganizerSession(page)
  await page.goto('/#/')
  await page.getByRole('button', { name: 'My hunts' }).click()
  const hunt = page.getByRole('article').filter({ hasText: 'Spring Photo Hunt' })
  await hunt.getByRole('button', { name: 'Review photos' }).click()
  await expect(page.getByRole('checkbox', { name: 'Photo meets hunt rules: Team Cedar photo for A red leaf' })).toBeChecked()

  await page.getByRole('button', { name: 'Finalize results' }).click()
  await page.getByRole('button', { name: 'Confirm final results' }).click()
  await expect(page.getByRole('alert')).toContainText('simulated response lost after commit')
  await expect.poll(() => auditReports.some(report => (report.p_details as Record<string, unknown> | undefined)?.stage === 'finalization_failed')).toBe(true)

  await page.getByRole('button', { name: 'Confirm final results' }).click()
  await expect(page.getByRole('heading', { name: 'Hunt complete' })).toBeVisible()
  await expect.poll(() => auditReports.some(report => (report.p_details as Record<string, unknown> | undefined)?.stage === 'finalization_retry_confirmed')).toBe(true)
  const firstAttempt = auditReports.find(report => (report.p_details as Record<string, unknown> | undefined)?.stage === 'finalization_failed')
  const retry = auditReports.find(report => (report.p_details as Record<string, unknown> | undefined)?.stage === 'finalization_retry_confirmed')
  expect((firstAttempt?.p_details as Record<string, unknown> | undefined)?.operation_id).toBe((retry?.p_details as Record<string, unknown> | undefined)?.operation_id)
})

test('organizer review refreshes signed previews when the page returns to the foreground', async ({ page }) => {
  organizerReviewMode = true
  signedPreviewMode = true
  await page.clock.install()
  await restoreOrganizerSession(page)
  await page.goto('/#/')
  await page.getByRole('button', { name: 'My hunts' }).click()
  const hunt = page.getByRole('article').filter({ hasText: 'Spring Photo Hunt' })
  await hunt.getByRole('button', { name: 'Review photos' }).click()
  const galleryImage = page.getByRole('img', { name: 'Team Cedar photo for A red leaf' })
  await expect(galleryImage).toBeVisible()
  await expect.poll(() => signedPreviewRequests).toBeGreaterThan(0)
  const initialRequests = signedPreviewRequests
  let previousRequests = initialRequests
  const recoveryEvents: Array<'visibilitychange' | 'online' | 'focus'> = ['visibilitychange', 'online', 'focus']
  for (const recoveryEvent of recoveryEvents) {
    const expiredAt = await page.evaluate(() => Date.now() + 3_500_000)
    await page.clock.setSystemTime(new Date(expiredAt))
    await page.evaluate(eventName => {
      if (eventName === 'visibilitychange') Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      const target = eventName === 'visibilitychange' ? document : window
      target.dispatchEvent(new Event(eventName))
    }, recoveryEvent)
    await expect.poll(() => signedPreviewRequests, { message: `signed URL should renew after ${recoveryEvent}` }).toBeGreaterThan(previousRequests)
    await expect(galleryImage).toBeVisible()
    previousRequests = signedPreviewRequests
  }
})

test('organizer signed-preview failures create a privacy-safe diagnostic event', async ({ page }) => {
  organizerReviewMode = true
  signedPreviewMode = true
  signedPreviewFailure = true
  await restoreOrganizerSession(page)
  await page.goto('/#/')
  await page.getByRole('button', { name: 'My hunts' }).click()
  const hunt = page.getByRole('article').filter({ hasText: 'Spring Photo Hunt' })
  await hunt.getByRole('button', { name: 'Review photos' }).click()
  await expect(page.getByText('Preview unavailable')).toBeVisible()
  await expect.poll(() => auditReports.some(report => (report.p_details as Record<string, unknown> | undefined)?.stage === 'review_preview_unavailable')).toBe(true)
  const report = auditReports.find(entry => (entry.p_details as Record<string, unknown> | undefined)?.stage === 'review_preview_unavailable')
  expect(report?.p_outcome).toBe('failure')
  expect((report?.p_details as Record<string, unknown> | undefined)?.app).toBe('organizer_web')
  expect(Object.keys(report?.p_details as Record<string, unknown>).sort()).toEqual(['app', 'client_report', 'operation_id', 'stage'])
})

test('organizer can retry a photo whose signed preview failed', async ({ page }) => {
  organizerReviewMode = true
  await restoreOrganizerSession(page)
  await page.goto('/#/')
  await page.getByRole('button', { name: 'My hunts' }).click()
  const hunt = page.getByRole('article').filter({ hasText: 'Spring Photo Hunt' })
  await hunt.getByRole('button', { name: 'Review photos' }).click()
  await expect(page.getByText('Preview unavailable')).toBeVisible()
  const retryPreview = page.getByRole('button', { name: 'Retry preview' })
  await expect(retryPreview).toBeVisible()
  signedPreviewMode = true
  await retryPreview.click()
  await expect(page.getByRole('img', { name: 'Team Cedar photo for A red leaf' })).toBeVisible()
})

test('organizer login confirms that the email link was requested', async ({ page }) => {
  await page.goto('/#/')
  await page.getByRole('button', { name: /Organizer Login/ }).click()
  await page.getByLabel('Email address').fill('organizer@example.test')
  await page.getByRole('button', { name: /Email me a sign-in link/ }).click()
  await expect(page.getByRole('status')).toContainText('Check your email')
})

test('unconfirmed organizers can resend confirmation or change the address', async ({ page }) => {
  await page.route('**/auth/v1/signup**', route => route.fulfill({ json: { user: { id: 'organizer' }, session: null } }))
  await page.route('**/auth/v1/resend**', route => route.fulfill({ json: {} }))
  await page.goto('/#/')
  await page.getByRole('button', { name: 'Organizer Login' }).click()
  await page.getByRole('button', { name: 'Create an organizer account' }).click()
  await page.getByLabel('Email address').fill('host@example.test')
  await page.getByLabel('Password', { exact: true }).fill('example-hunt-123')
  await page.getByRole('button', { name: 'Create organizer account' }).click()
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  const resent = page.waitForRequest(request => request.url().includes('/auth/v1/resend'))
  await page.getByRole('button', { name: 'Resend confirmation email' }).click()
  expect((await resent).postDataJSON()).toMatchObject({ email: 'host@example.test', type: 'signup' })
  await expect(page.getByText('If this address is awaiting confirmation')).toBeVisible()
  await page.getByRole('button', { name: 'Change email address' }).click()
  await expect(page.getByLabel('Email address')).toBeEditable()
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('')

  await page.goto('/?callback=confirmation#error_code=otp_expired')
  await expect(page.getByText('This email link has expired.')).toBeVisible()
  await page.getByLabel('Email address').fill('host@example.test')
  await page.getByRole('button', { name: 'Resend account confirmation' }).click()
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
})

test('organizer email callback restores the session at the site root', async ({ page }) => {
  await page.goto('/#/')
  await page.getByRole('button', { name: /Organizer Login/ }).click()
  await page.getByLabel('Email address').fill('organizer@example.test')
  await page.getByRole('button', { name: /Email me a sign-in link/ }).click()
  await expect(page.getByRole('status')).toContainText('Check your email')
  await page.goto('/?email-callback=1#access_token=callback-access-token&refresh_token=callback-refresh-token&expires_in=3600&token_type=bearer&type=magiclink')
  await expect(page.getByRole('heading', { name: 'My Hunts' })).toBeVisible()
  await expect(page.getByText('No hunts yet')).toBeVisible()
})

test('restored organizer session opens the production organizer workspace', async ({ page }) => {
  await restoreOrganizerSession(page)
  await page.goto('/#/')
  await expect(page.getByRole('heading', { name: 'My Hunts' })).toBeVisible()
  await expect(page.getByText('No hunts yet')).toBeVisible()
  const returnToTeam = page.getByRole('link', { name: /Player view.*Team Cedar/ })
  await expect(returnToTeam).toHaveAttribute('href', '#/play/33333333-3333-4333-8333-333333333333')
})

test('organizer account settings show a public display name and private sign-in email', async ({ page }) => {
  await restoreOrganizerSession(page)
  await page.goto('/#/')
  await page.locator('.account-menu summary').click()
  await page.getByRole('button', { name: 'Account settings' }).click()
  await expect(page.getByRole('heading', { name: 'Account settings' })).toBeVisible()
  await expect(page.getByLabel('Name other players see')).toBeVisible()
  await expect(page.getByText('This address is used to sign in. Only you can see it in Account settings.')).toBeVisible()
  await expect(page.getByText('organizer@example.test', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'New password', exact: true })).toBeVisible()
})

test('organizer hunt editor fits phone widths, passes axe, and reorders challenges', async ({ page }) => {
  await restoreOrganizerSession(page)
  await page.goto('/#/')
  await page.getByRole('button', { name: 'Create a Hunt' }).click()
  await expect(page.getByRole('heading', { name: 'Create a venue hunt' })).toBeVisible()
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  }
  expect((await new AxeBuilder({ page }).analyze()).violations.map(violation => violation.id)).toEqual([])
  await page.getByLabel('Venue name').fill('Town Park')
  await page.getByText('Paste a challenge list', { exact: true }).click()
  await page.getByLabel('Challenge list').fill('1. First challenge\n- Second challenge')
  await page.getByLabel('Remove leading list bullets and numbering').check()
  await page.getByRole('button', { name: 'Import and edit challenges' }).click()
  const titles = page.getByLabel('What should they find?')
  await expect(titles.nth(0)).toHaveValue('First challenge')
  await expect(titles.nth(1)).toHaveValue('Second challenge')
  const saveButton = page.getByRole('button', { name: /Save draft hunt/ })
  await expect(saveButton).toBeEnabled()
  await expect.poll(() => saveButton.evaluate(element => getComputedStyle(element).opacity)).toBe('1')
  const editorAudit = await new AxeBuilder({ page }).analyze(); expect(editorAudit.violations.map(violation => violation.id), JSON.stringify(editorAudit.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => ({ target: node.target, html: node.html, contrast: node.any.find(check => check.id === 'color-contrast')?.data })) })), null, 2)).toEqual([])
  await page.getByRole('button', { name: 'Move item 1 down' }).click()
  await expect(titles.nth(0)).toHaveValue('Second challenge')
  await expect(titles.nth(1)).toHaveValue('First challenge')
})

test('dirty new-hunt forms offer to keep editing or discard changes', async ({ page }) => {
  await restoreOrganizerSession(page)
  await page.goto('/#/')
  await page.getByRole('button', { name: 'Create a Hunt' }).click()
  await page.getByLabel('Venue name').fill('Town Park')
  await page.getByRole('button', { name: 'My hunts' }).click()
  const discardDialog = page.getByRole('dialog', { name: 'Discard this hunt draft?' })
  await expect(discardDialog).toBeVisible()
  await discardDialog.getByRole('button', { name: 'Keep editing' }).click()
  await expect(page.getByLabel('Venue name')).toHaveValue('Town Park')
  await page.getByRole('button', { name: 'My hunts' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Discard changes' }).click()
  await expect(page.getByRole('heading', { name: 'My Hunts' })).toBeVisible()
  await page.getByRole('button', { name: 'Create a Hunt' }).click()
  await expect(page.getByLabel('Venue name')).toHaveValue('')
})

test('organizer can save, reopen, edit, and save a production draft', async ({ page }) => {
  organizerDraftMode = true
  await restoreOrganizerSession(page)
  await page.goto('/#/')
  await page.getByRole('button', { name: 'Create a Hunt' }).click()
  await page.getByLabel('Venue name').fill('Riverside Park')
  await page.getByLabel(/Hunt title/).fill('Saturday Adventure')
  await page.getByRole('button', { name: 'Add first item' }).click()
  const challengeTitles = page.getByLabel('What should they find?')
  await challengeTitles.first().fill('Find a red leaf')
  await page.getByRole('button', { name: 'Add item' }).click()
  await challengeTitles.nth(1).fill('Find a park sign')
  await page.getByRole('button', { name: 'Save draft hunt' }).click()

  await expect(page.getByRole('heading', { name: 'Saturday Adventure' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Publish & create QR codes' })).toBeVisible()
  await page.getByRole('button', { name: 'Back to your hunts' }).click()
  const huntCard = page.getByRole('article').filter({ hasText: 'Saturday Adventure' })
  await expect(huntCard).toBeVisible()
  expect(savedDraftPayloads).toHaveLength(1)
  expect(savedDraftPayloads[0].p_title).toBe('Saturday Adventure')
  expect(savedDraftPayloads[0].p_venue).toBe('Riverside Park')
  expect(savedDraftPayloads[0].p_items).toEqual([
    { title: 'Find a red leaf', description: null, pointValue: 1, libraryItemId: undefined },
    { title: 'Find a park sign', description: null, pointValue: 1, libraryItemId: undefined },
  ])

  await huntCard.getByRole('button', { name: 'Edit draft' }).click()
  await expect(page.getByRole('heading', { name: 'Edit your draft hunt' })).toBeVisible()
  await expect(page.getByLabel('Venue name')).toHaveValue('Riverside Park')
  await expect(challengeTitles.nth(0)).toHaveValue('Find a red leaf')
  await page.getByLabel(/Hunt title/).fill('Saturday Family Adventure')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Keep editing' }).click()
  await challengeTitles.nth(0).fill('Find a bright red leaf')
  await page.getByRole('button', { name: 'Move item 2 up' }).click()
  await expect(challengeTitles.nth(0)).toHaveValue('Find a park sign')
  await page.getByRole('button', { name: 'Save draft changes' }).click()

  await expect(page.getByRole('heading', { name: 'Saturday Family Adventure' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Publish & create QR codes' })).toBeVisible()
  expect(savedDraftPayloads).toHaveLength(2)
  expect(savedDraftPayloads[1].p_hunt_id).toBe(organizerDraft?.id)
  expect(savedDraftPayloads[1].p_title).toBe('Saturday Family Adventure')
  expect(savedDraftPayloads[1].p_items).toEqual([
    { title: 'Find a park sign', description: null, pointValue: 1, libraryItemId: undefined },
    { title: 'Find a bright red leaf', description: null, pointValue: 1, libraryItemId: undefined },
  ])
})

test('organizer lobby shows the team roster and unread chat count without moving the scroll', async ({ page }) => {
  organizerLobbyMode = true
  const baseTime = Date.now()
  organizerMessages = Array.from({ length: 15 }, (_, index) => ({ id: `message-${index}`, sender_name: index % 2 ? 'Taylor' : 'Organizer', sender_role: index % 2 ? 'participant' as const : 'organizer' as const, body: `Chat message ${index}`, created_at: new Date(baseTime + index * 1000).toISOString() }))
  await page.clock.install()
  await restoreOrganizerSession(page)
  await page.goto('/#/manage/33333333-3333-4333-8333-333333333333')
  const rosterDetails = page.locator('#team-roster')
  if (!(await rosterDetails.getByRole('heading', { name: 'Team lobby' }).isVisible())) await page.getByRole('navigation', { name: 'Hunt sections' }).getByRole('button', { name: 'Team roster' }).click()
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
  await expectKeyboardCanReach(page, page.getByRole('button', { name: 'Start early' }))
  await expectNoHorizontalOverflowAt200Percent(page, 'organizer lobby')
})

test('organizer lobby refreshes roster when the page returns to the foreground', async ({ page }) => {
  organizerLobbyMode = true
  await restoreOrganizerSession(page)
  await page.goto('/#/manage/33333333-3333-4333-8333-333333333333')
  const roster = page.locator('.participant-roster')
  await expect(roster.getByText('Taylor')).toBeVisible()

  organizerLobbyParticipantName = 'Riley'
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))

  await expect(roster.getByText('Riley')).toBeVisible()
  await expect(roster.getByText('Taylor')).toHaveCount(0)

  organizerLobbyParticipantName = 'Morgan'
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: true }); window.dispatchEvent(new Event('online')) })
  await expect(roster.getByText('Morgan')).toBeVisible()
  await expect(roster.getByText('Riley')).toHaveCount(0)

  organizerLobbyParticipantName = 'Jordan'
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(roster.getByText('Jordan')).toBeVisible()
  await expect(roster.getByText('Morgan')).toHaveCount(0)
})

test('hunt chat offers retry after read failure and keeps a message after send failure', async ({ page }) => {
  organizerLobbyMode = true
  chatLoadFailures = 1
  chatSendFailures = 1
  await restoreOrganizerSession(page)
  await page.goto('/#/manage/33333333-3333-4333-8333-333333333333')
  await expect(page.getByRole('heading', { name: 'Keep everyone in the loop' })).toBeVisible()
  const chatError = page.locator('.hunt-chat-error')
  await expect(chatError).toContainText('Messages could not be refreshed')
  await expect.poll(() => auditReports.some(report => {
    const details = report.p_details as Record<string, unknown> | undefined
    return details?.stage === 'chat_refresh_failed' && details.app === 'organizer_web'
  })).toBe(true)
  const loadFailure = auditReports.find(report => (report.p_details as Record<string, unknown> | undefined)?.stage === 'chat_refresh_failed')
  expect(loadFailure?.p_outcome).toBe('failure')
  expect(Object.keys(loadFailure?.p_details as Record<string, unknown>).sort()).toEqual(['app', 'client_report', 'operation_id', 'stage'])
  await chatError.getByRole('button', { name: 'Retry' }).click()
  await expect(chatError).toHaveCount(0)
  const chatRecovery = () => auditReports.find(report => (report.p_details as Record<string, unknown> | undefined)?.stage === 'chat_refresh_recovered')
  await expect.poll(() => chatRecovery()?.p_details).toMatchObject({
    operation_id: (loadFailure?.p_details as Record<string, unknown>).operation_id,
    app: 'organizer_web', recovery_ms: expect.any(Number),
  })

  const message = page.getByRole('textbox', { name: 'Message' })
  await message.fill('Please meet by the fountain')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(chatError).toContainText('Message could not be confirmed')
  await expect(chatError).not.toContainText('simulated chat send failure')
  await expect(message).toHaveValue('Please meet by the fountain')
  await expect.poll(() => auditReports.some(report => {
    const details = report.p_details as Record<string, unknown> | undefined
    return details?.stage === 'chat_send_failed' && details?.app === 'organizer_web'
  })).toBe(true)
  const sendFailure = auditReports.find(report => (report.p_details as Record<string, unknown> | undefined)?.stage === 'chat_send_failed')
  expect(sendFailure?.p_outcome).toBe('failure')
  expect(Object.keys(sendFailure?.p_details as Record<string, unknown>).sort()).toEqual(['app', 'client_report', 'operation_id', 'stage'])
  await page.getByRole('navigation', { name: 'Hunt sections' }).getByRole('button', { name: 'Troubleshooting' }).click()
  const diagnostics = page.locator('.hunt-diagnostics')
  await diagnostics.locator('summary').click()
  await diagnostics.getByRole('button', { name: 'Refresh' }).click()
  await expect(diagnostics).toContainText('Client reported')
  await expect(diagnostics).toContainText('Server authoritative')
  await expect(diagnostics).toContainText('The log is visible to the hunt organizer')
  await expect(diagnostics).not.toContainText('365 days')
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
  const huntStatus = page.getByRole('region', { name: 'Hunt status' })
  const huntFlow = huntStatus.getByRole('list', { name: 'Hunt progress' })
  await expect(huntStatus).toContainText('joined across')
  if (!(await huntFlow.isVisible())) await huntStatus.getByText('See all hunt stages').click()
  await expect(huntFlow.getByRole('listitem')).toHaveCount(5)
  await expect(huntFlow.locator('[aria-current="step"]')).toHaveText(/2\s*Waiting/)
  await expect(huntFlow.locator('.complete .hunt-stage-direction')).toHaveText('DONE')
  await expect(huntFlow.locator('.current .hunt-stage-direction')).toHaveText('YOU ARE HERE')
  await expect(huntFlow.locator('.upcoming .hunt-stage-direction').first()).toHaveText('NEXT')
  await expect(huntFlow.locator('.upcoming .hunt-stage-direction').last()).toHaveText('LATER')
  await expect(huntFlow.getByRole('button')).toHaveCount(0)
  const flowArrow = await huntFlow.getByRole('listitem').nth(0).evaluate(element => getComputedStyle(element, '::after').content)
  expect(flowArrow).toContain(await page.evaluate(() => window.innerWidth <= 600 ? '↓' : '→'))
  await expect(page.getByText('More hunt controls')).toBeVisible()
  const sectionNav = page.getByRole('navigation', { name: 'Hunt sections' })
  await expect(sectionNav.getByRole('button', { name: 'Teams & invitations' })).toBeVisible()
  await expect(sectionNav.getByRole('button', { name: 'Hunt chat' })).toBeVisible()
  const controls = page.getByRole('region', { name: 'Hunt controls' })
  await expect(controls.getByRole('button', { name: 'Start early' })).toBeVisible()
  expect(await controls.evaluate(element => {
    const chat = document.querySelector('.hunt-chat')
    return !!chat && !!(element.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING)
  })).toBe(true)
  await page.getByRole('button', { name: 'Start early' }).click()
  await expect.poll(() => organizerStartCalls).toBe(1)
  await expect(controls.getByRole('heading', { name: 'Hunt in progress' })).toBeVisible()
  await expect(huntFlow.locator('[aria-current="step"]')).toHaveText(/3\s*Playing/)
  await expect(controls.getByRole('button', { name: 'Add 15 minutes' })).toBeVisible()
  await expect(controls.getByRole('button', { name: 'End hunt now and review' })).toBeVisible()
  await controls.getByRole('button', { name: 'End hunt now and review' }).click()
  await expect(page.getByRole('checkbox', { name: 'Photo meets hunt rules: Team Cedar photo for A red leaf' })).toBeChecked()
  await expect(page.getByRole('button', { name: 'Finalize results' })).toBeEnabled()
})

test('organizer lobby follows the server when a scheduled hunt starts', async ({ page }) => {
  organizerLobbyMode = true
  await restoreOrganizerSession(page)
  await page.goto('/#/manage/33333333-3333-4333-8333-333333333333')
  await expect(page.getByRole('heading', { name: 'Ready to start?' })).toBeVisible()
  organizerLobbyStatus = 'active'
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('heading', { name: 'Hunt in progress' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Hunt status' }).locator('[aria-current="step"]')).toHaveText(/3\s*Playing/)
  organizerLobbyStatus = 'ended'
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('region', { name: 'Hunt status' }).locator('[aria-current="step"]')).toHaveText(/4\s*Review/)
  await expect(page.getByRole('region', { name: 'Hunt status' }).getByRole('button', { name: 'Review photos' })).toBeVisible()
})

test('organizer sees when hunt status could not be refreshed and can retry', async ({ page }) => {
  organizerLobbyMode = true
  let fail = true
  await page.route('**/rest/v1/rpc/get_game_lobby', route => fail
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Unavailable' }) })
    : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ runtime_state: 'active' }) }))
  await restoreOrganizerSession(page)
  await page.goto('/#/manage/33333333-3333-4333-8333-333333333333')
  await expect(page.getByText('Hunt status may be out of date.')).toBeVisible()
  fail = false
  await page.getByRole('region', { name: 'Hunt status' }).getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByRole('heading', { name: 'Hunt in progress' })).toBeVisible()
  await expect(page.getByText('Hunt status may be out of date.')).toHaveCount(0)
})

test('organizer lobby updates timing from the server', async ({ page }) => {
  organizerLobbyMode = true
  const start = new Date(Date.now() + 60 * 60_000)
  const end = new Date(start.getTime() + 90 * 60_000)
  await page.route('**/rest/v1/rpc/get_game_lobby', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ runtime_state: 'scheduled', start_at: start.toISOString(), ends_at: end.toISOString() }) }))
  await restoreOrganizerSession(page)
  await page.goto('/#/manage/33333333-3333-4333-8333-333333333333')
  await expect(page.getByText('90 minute time limit')).toBeVisible()
})

test('organizer lobby pauses background polling and refreshes when visible', async ({ page }) => {
  organizerLobbyMode = true
  let lobbyReads = 0
  await page.clock.install()
  page.on('request', request => { if (request.url().includes('/rpc/get_game_lobby')) lobbyReads++ })
  await restoreOrganizerSession(page)
  await page.goto('/#/manage/33333333-3333-4333-8333-333333333333')
  await expect(page.getByRole('heading', { name: 'Ready to start?' })).toBeVisible()
  await expect.poll(() => lobbyReads).toBeGreaterThan(0)
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }))
  const before = lobbyReads
  await page.clock.fastForward(45_000)
  expect(lobbyReads).toBe(before)
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')) })
  await page.clock.runFor(300)
  await expect.poll(() => lobbyReads).toBeGreaterThan(before)
})

test('organizer start failure is recorded with an organizer operation trace', async ({ page }) => {
  organizerLobbyMode = true
  organizerTimingFailure = 'start'
  page.on('dialog', dialog => dialog.accept())
  await restoreOrganizerSession(page)
  await page.goto('/#/manage/33333333-3333-4333-8333-333333333333')
  await page.getByRole('button', { name: 'Start early' }).click()
  await expect(page.getByRole('alert')).toContainText('simulated start failure')
  await expect.poll(() => auditReports.some(report => {
    const details = report.p_details as Record<string, unknown> | undefined
    return details?.stage === 'start_game_now_failed' && details?.app === 'organizer_web'
  })).toBe(true)
  await page.getByRole('navigation', { name: 'Hunt sections' }).getByRole('button', { name: 'Troubleshooting' }).click()
  const diagnostics = page.locator('.hunt-diagnostics')
  await diagnostics.locator('summary').click()
  await diagnostics.getByRole('button', { name: 'Refresh' }).click()
  await expect(diagnostics).toContainText('Client reported')
  await expect(diagnostics).toContainText('start game now failed')
})

test('organizer timing controls record failure traces for reschedule, start, add time, and early end', async ({ page }) => {
  organizerLobbyMode = true
  organizerTimingFailure = 'reschedule'
  page.on('dialog', dialog => dialog.accept())
  await restoreOrganizerSession(page)
  await page.goto('/#/manage/33333333-3333-4333-8333-333333333333')

  const futureStart = await page.evaluate(() => {
    const date = new Date(Date.now() + 2 * 60 * 60_000)
    date.setSeconds(0, 0)
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  })
  await page.getByLabel('New start time').fill(futureStart)
  await page.getByRole('button', { name: 'Save new time' }).click()
  await expect(page.getByRole('alert')).toContainText('simulated reschedule failure')
  await expect.poll(() => auditReports.some(report => (report.p_details as Record<string, unknown> | undefined)?.stage === 'reschedule_game_failed')).toBe(true)

  organizerTimingFailure = 'start'
  await page.getByRole('button', { name: 'Start early' }).click()
  await expect(page.getByRole('alert')).toContainText('simulated start failure')
  await expect.poll(() => auditReports.some(report => (report.p_details as Record<string, unknown> | undefined)?.stage === 'start_game_now_failed')).toBe(true)
  await page.getByRole('button', { name: 'Start early' }).click()
  await page.getByRole('button', { name: 'Add 15 minutes' }).waitFor()

  organizerTimingFailure = 'add'
  await page.getByRole('button', { name: 'Add 15 minutes' }).click()
  await expect(page.getByRole('alert')).toContainText('simulated add-time failure')
  await expect.poll(() => auditReports.some(report => (report.p_details as Record<string, unknown> | undefined)?.stage === 'add_game_time_failed')).toBe(true)

  organizerTimingFailure = 'end'
  await page.getByRole('button', { name: 'End hunt now and review' }).click()
  await expect(page.getByRole('alert')).toContainText('simulated end failure')
  await expect.poll(() => auditReports.some(report => (report.p_details as Record<string, unknown> | undefined)?.stage === 'end_hunt_early_failed')).toBe(true)

  await page.getByRole('navigation', { name: 'Hunt sections' }).getByRole('button', { name: 'Troubleshooting' }).click()
  const diagnostics = page.locator('.hunt-diagnostics')
  await diagnostics.locator('summary').click()
  await diagnostics.getByRole('button', { name: 'Refresh' }).click()
  await expect(diagnostics).toContainText('reschedule game failed')
  await expect(diagnostics).toContainText('start game now failed')
  await expect(diagnostics).toContainText('add game time failed')
  await expect(diagnostics).toContainText('end hunt early failed')
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
  await grantClipboardAccess(page)
  await restoreOrganizerSession(page)
  await page.goto('/#/')
  await page.getByRole('button', { name: 'My hunts' }).click()
  await page.getByRole('button', { name: 'Open lobby' }).click()
  const inviteCard = page.locator('.primary-invite-card')
  const expectedUrl = await page.evaluate(() => {
    const base = `${window.location.origin}${window.location.pathname}`
    const normalizedBase = `${base.replace(/\/$/, '')}${window.location.pathname === '/' ? '/' : ''}`
    return `${normalizedBase}#/join/${'a'.repeat(64)}`
  })
  await inviteCard.getByRole('button', { name: 'Copy invite link' }).click()
  await expect(inviteCard.getByRole('button', { name: 'Link copied' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expectedUrl)
})

test('organizer can recover active team links after invitation cache is cleared', async ({ page }) => {
  organizerLobbyMode = true
  await restoreOrganizerSession(page)
  await page.goto('/#/')
  await page.getByRole('button', { name: 'My hunts' }).click()
  await page.getByRole('button', { name: 'Open lobby' }).click()
  await page.getByText('More invitation options').click()
  const inviteCard = page.locator('.invite-link-row').filter({ hasText: 'Team Cedar' })
  await expect(inviteCard).toBeVisible()
  await expect(inviteCard.locator('input')).toHaveValue(/a{64}$/)
  await expect.poll(() => organizerInviteRecoveryCalls).toBe(1)

  await page.evaluate(() => {
    const authSession = localStorage.getItem('sb-test-project-auth-token')
    localStorage.clear()
    if (authSession) localStorage.setItem('sb-test-project-auth-token', authSession)
  })
  await page.reload()
  await page.getByRole('button', { name: 'My hunts' }).click()
  await page.getByRole('button', { name: 'Open lobby' }).click()

  await page.getByText('More invitation options').click()
  const recoveredCard = page.locator('.invite-link-row').filter({ hasText: 'Team Cedar' })
  await expect(recoveredCard).toBeVisible()
  await expect(recoveredCard.locator('input')).toHaveValue(/a{64}$/)
  await expect.poll(() => organizerInviteRecoveryCalls).toBe(2)
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('snapquest-invites-')))).toEqual([])
})

test('organizer replacement refreshes each displayed team link', async ({ page }) => {
  organizerLobbyMode = true
  page.on('dialog', dialog => dialog.accept())
  await restoreOrganizerSession(page)
  await page.goto('/#/')
  await page.getByRole('button', { name: 'My hunts' }).click()
  await page.getByRole('button', { name: 'Open lobby' }).click()
  await page.getByText('More invitation options').click()
  await expect(page.locator('.invite-link-row').filter({ hasText: 'Team Cedar' }).locator('input')).toHaveValue(/a{64}$/)

  await page.getByRole('button', { name: 'Replace team codes' }).click()

  await expect(page.locator('.invite-link-row').filter({ hasText: 'Team Cedar' }).locator('input')).toHaveValue(/c{64}$/)
  await expect(page.locator('.invite-link-row').filter({ hasText: 'Team Maple' }).locator('input')).toHaveValue(/d{64}$/)
})

test('legacy active invitations are not replaced without explicit confirmation', async ({ page }) => {
  organizerLobbyMode = true
  organizerLegacyInvites = true
  await restoreOrganizerSession(page)
  await page.goto('/#/')
  await page.getByRole('button', { name: 'My hunts' }).click()
  await page.getByRole('button', { name: 'Open lobby' }).click()
  const legacyInviteNotice = page.locator('.locked-note').filter({ hasText: 'Existing invitation links are active' })
  await expect(legacyInviteNotice).toContainText('could not be restored on this device')
  await expect(page.locator('.primary-invite-card')).toHaveCount(0)
  await expect(page.getByText('Replacing the team codes will invalidate every older QR code and link.')).toBeVisible()

  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: 'Replace team codes' }).click()

  await expect.poll(() => organizerInviteRotationCalls).toBe(0)
  await expect(page.locator('.locked-note')).toContainText('Existing invitation links are active')
})

test('organizer can join an assigned team and return to hunt management', async ({ page }) => {
  organizerLobbyMode = true
  await restoreOrganizerSession(page)
  await page.goto('/#/')
  await page.getByRole('button', { name: 'My hunts' }).click()
  await page.getByRole('button', { name: 'Open lobby' }).click()
  await page.getByText('More invitation options').click()
  await page.locator('.invite-link-row').first().getByRole('button', { name: 'Join as player' }).click()
  await expect(page.getByText('You are checked in with Team Cedar')).toBeVisible()
  const organizerMenu = page.getByRole('link', { name: 'Manage hunt' })
  await expect(organizerMenu).toBeVisible()
  await organizerMenu.click()
  const rosterDetails = page.locator('#team-roster')
  if (!(await rosterDetails.getByRole('heading', { name: 'Team lobby' }).isVisible())) await rosterDetails.locator('summary').click()
  await expect(page.getByRole('heading', { name: 'Team lobby' })).toBeVisible()
  await page.goBack()
  await expect(page.getByText('You are checked in with Team Cedar')).toBeVisible()
  await page.goForward()
  await page.getByRole('navigation', { name: 'Hunt sections' }).getByRole('button', { name: 'Team roster' }).click()
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
  await expect.poll(() => organizerSavedWinnerCards.length).toBe(2)
  await chooser.selectOption('55555555-5555-4555-8555-555555555555')
  await expect(page.getByRole('img', { name: 'Winner celebration card for Team Maple' })).toBeVisible()
  const caption = page.locator('.celebration-caption')
  await expect(caption).toContainText('Team Maple')
  await grantClipboardAccess(page)
  await page.getByRole('button', { name: 'Copy caption' }).click()
  await expect(page.getByRole('button', { name: 'Caption copied' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe((await caption.textContent())?.trim())
})

test('organizer chat falls back to the legacy RPC until stable cursor migration is installed', async ({ page }) => {
  organizerLobbyMode = true
  chatLegacyRpcMode = true
  organizerMessages = [
    { id: 'legacy-1', sender_name: 'Taylor', sender_role: 'participant', body: 'Earlier message', created_at: '2026-11-06T17:00:00.000Z' },
    { id: 'legacy-2', sender_name: 'Organizer', sender_role: 'organizer', body: 'Welcome, teams', created_at: '2026-11-06T17:01:00.000Z' },
  ]
  await restoreOrganizerSession(page)
  await page.goto('/#/manage/33333333-3333-4333-8333-333333333333')
  const messages = page.locator('.hunt-chat-message')
  await expect(messages).toHaveCount(2)
  await expect(messages.first()).toContainText('Earlier message')
  await expect(messages.last()).toContainText('Welcome, teams')
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(chatStableCursorCalls).toBe(1)
  expect(chatLegacyCursorCalls).toBe(1)
  await page.getByRole('textbox', { name: 'Message' }).fill('Chat still works on the deployed schema')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(messages).toHaveCount(3)
  await expect(messages.last()).toContainText('Chat still works on the deployed schema')
  expect(chatLegacyCursorCalls).toBeGreaterThanOrEqual(2)
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
  expect(chatStableCursorCalls).toBeGreaterThanOrEqual(3)
  expect(chatLegacyCursorCalls).toBe(0)
})

test('chat keeps an older page when a refresh finishes while it is loading', async ({ page }) => {
  organizerLobbyMode = true
  const sameTime = '2026-11-06T18:00:00.000Z'
  const rows = Array.from({ length: 150 }, (_, index) => ({ id: `message-${String(index).padStart(3, '0')}`, sender_name: 'Taylor', sender_role: 'participant', body: `Page message ${index}`, created_at: sameTime }))
  let releaseOlder: (() => void) | undefined
  const olderHeld = new Promise<void>(resolve => { releaseOlder = resolve })
  let olderStarted = false
  await page.route('**/rest/v1/rpc/get_hunt_messages', async route => {
    const body = route.request().postDataJSON() as { p_before_id?: string | null }
    if (body.p_before_id) { olderStarted = true; await olderHeld }
    const eligible = body.p_before_id ? rows.filter(message => message.id < body.p_before_id!) : rows
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(eligible.slice(-101)) })
  })
  await restoreOrganizerSession(page)
  await page.goto('/#/manage/33333333-3333-4333-8333-333333333333')
  const messages = page.locator('.hunt-chat-message')
  await expect(messages).toHaveCount(100)
  await page.getByRole('button', { name: 'Load older messages' }).click()
  await expect.poll(() => olderStarted).toBe(true)
  const refresh = page.waitForResponse(response => response.url().includes('/rpc/get_hunt_messages') && response.request().postDataJSON()?.p_before_id == null)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await refresh
  releaseOlder?.()
  await expect(messages).toHaveCount(150)
  await expect(messages.first()).toContainText('Page message 0')
})


test('organizer workspace fits common phone widths without horizontal scrolling', async ({ page }) => {
  await restoreOrganizerSession(page)
  await page.goto('/#/')
  await expect(page.getByRole('heading', { name: 'My Hunts' })).toBeVisible()
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
  await expect(page.getByRole('heading', { name: 'My Hunts' })).toBeVisible()
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
