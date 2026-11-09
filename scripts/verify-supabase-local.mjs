import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { normalizeFinalScores, winningTeams } from '../src/lib/scoring.ts'
import { winnerCaption } from '../src/lib/celebrationCard.ts'

const url = process.env.API_URL
const serviceRoleKey = process.env.SERVICE_ROLE_KEY
const anonKey = process.env.ANON_KEY
const mailpitUrl = process.env.MAILPIT_URL
assert.ok(url, 'Supabase CLI did not export API_URL')
assert.ok(serviceRoleKey, 'Supabase CLI did not export SERVICE_ROLE_KEY')
assert.ok(anonKey, 'Supabase CLI did not export ANON_KEY')
assert.ok(mailpitUrl, 'Supabase CLI did not export MAILPIT_URL')

const authOptions = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, serviceRoleKey, authOptions)
const anonymous = createClient(url, anonKey, authOptions)

const { data: bucket, error: bucketError } = await admin.storage.getBucket('hunt-photos')
assert.ifError(bucketError)
assert.equal(bucket?.public, false, 'hunt-photos must remain private')
console.log('Private hunt-photos bucket is available through Storage HTTP.')

async function verifyAuditEventsAreRetained() {
  const marker = randomUUID()
  const recentId = randomUUID()
  const expiredId = randomUUID()
  const now = Date.now()
  const hour = 60 * 60 * 1000
  const rows = [
    {
      id: recentId,
      created_at: new Date(now - 364 * 24 * hour).toISOString(),
      event_type: 'retention_test',
      outcome: 'notice',
      details: { retention_test_id: marker, age: '364-day' },
    },
    {
      id: expiredId,
      created_at: new Date(now - 366 * 24 * hour).toISOString(),
      event_type: 'retention_test',
      outcome: 'notice',
      details: { retention_test_id: marker, age: '366-day' },
    },
  ]

  try {
    const { error: insertError } = await admin.from('audit_events').insert(rows)
    assert.ifError(insertError, 'Synthetic retention rows should be insertable in the isolated stack')

    const { data, error } = await admin.from('audit_events').select('id').in('id', [recentId, expiredId])
    assert.ifError(error)
    assert.deepEqual(data.map(({ id }) => id).sort(), [recentId, expiredId].sort(), 'Audit events older than 365 days must remain available')
    console.log('Audit events aged 364 and 366 days are both retained in the isolated database.')
  } finally {
    const { error: cleanupError } = await admin.from('audit_events').delete().in('id', [recentId, expiredId])
    assert.ifError(cleanupError, 'Synthetic retention rows should be cleaned up')
  }
}

await verifyAuditEventsAreRetained()

const identities = []
const testCredentials = new Map()
const objectPaths = []

async function createIdentity(label) {
  const email = `snapquest-${label}-${randomUUID()}@example.test`
  const password = `${randomUUID()}Aa1!`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  assert.ifError(error)
  identities.push(data.user.id)
  testCredentials.set(data.user.id, { email, password })
  const client = createClient(url, anonKey, authOptions)
  const { data: session, error: loginError } = await client.auth.signInWithPassword({ email, password })
  assert.ifError(loginError)
  assert.ok(session.session, `${label} should receive an authenticated session`)
  return client
}

async function signInSameIdentityOnFreshClient(sourceClient) {
  const { data: sourceUser, error: sourceUserError } = await sourceClient.auth.getUser()
  assert.ifError(sourceUserError)
  const credentials = testCredentials.get(sourceUser.user.id)
  assert.ok(credentials, 'Synthetic test identity credentials should be available for a fresh session')
  const freshClient = createClient(url, anonKey, authOptions)
  const { data, error } = await freshClient.auth.signInWithPassword(credentials)
  assert.ifError(error)
  assert.equal(data.user.id, sourceUser.user.id, 'Fresh client should authenticate the same organizer identity')
  assert.ok(data.session)
  return freshClient
}

async function expectDenied(operation, message) {
  const { error } = await operation()
  assert.ok(error, message)
}

async function verifyHuntTableRoleMatrix(huntId, organizer, participant, outsider, anonymous) {
  const tables = [
    'hunts',
    'hunt_items',
    'teams',
    'participants',
    'submissions',
    'hunt_votes',
    'team_selfies',
    'hunt_messages',
    'audit_events',
  ]
  for (const table of tables) {
    const huntKey = table === 'hunts' ? 'id' : 'hunt_id'
    const readHuntRows = (client) => client.from(table).select('id').eq(huntKey, huntId)
    const [organizerResult, participantResult, outsiderResult, anonymousResult] = await Promise.all([
      readHuntRows(organizer),
      readHuntRows(participant),
      readHuntRows(outsider),
      readHuntRows(anonymous),
    ])
    assert.ifError(organizerResult.error, `Organizer should have access to ${table}`)
    assert.ifError(participantResult.error, `Participant SELECT should be evaluated by RLS for ${table}`)
    assert.ifError(outsiderResult.error, `Outsider SELECT should be evaluated by RLS for ${table}`)
    if (!anonymousResult.error) {
      assert.equal(anonymousResult.data?.length, 0, `Anonymous role must not see ${table} rows`)
    }
    assert.ok(organizerResult.data?.length, `Organizer should see rows in ${table}`)
    if (table === 'audit_events') {
      assert.equal(participantResult.data?.length, 0, 'Participants must not see organizer audit rows')
    } else {
      assert.ok(participantResult.data?.length, `Hunt participants should see authorized ${table} rows`)
    }
    assert.equal(outsiderResult.data?.length, 0, `Outsiders must not see ${table} rows for this hunt`)
  }
  console.log(`Organizer, participant, outsider, and anonymous SELECT boundaries pass for ${tables.length} hunt tables.`)
}

async function verifyEmailMagicLinkReturnPath() {
  const email = `snapquest-magic-link-${randomUUID()}@example.test`
  const callbackUrl = 'http://127.0.0.1:5173/'
  const { error: sendError } = await anonymous.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: callbackUrl },
  })
  assert.ifError(sendError)

  let messageId
  for (let attempt = 0; attempt < 40 && !messageId; attempt += 1) {
    const response = await fetch(`${mailpitUrl}/api/v1/messages?start=0&limit=50`)
    assert.equal(response.ok, true, `Mailpit message listing failed: ${response.status}`)
    const mailbox = await response.json()
    const message = mailbox.messages?.find((candidate) =>
      candidate.To?.some((recipient) => recipient.Address?.toLowerCase() === email.toLowerCase()),
    )
    messageId = message?.ID
    if (!messageId) await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert.ok(messageId, 'Supabase auth email should arrive in the isolated Mailpit inbox')

  const textResponse = await fetch(`${mailpitUrl}/view/${encodeURIComponent(messageId)}.txt`)
  assert.equal(textResponse.ok, true, `Mailpit email body request failed: ${textResponse.status}`)
  const emailBody = await textResponse.text()
  const confirmationLink = emailBody.match(/https?:\/\/[^\s<>"']+/)?.[0]?.replace(/[),.;]+$/, '')
  assert.ok(confirmationLink, 'Magic-link email should contain a confirmation URL')
  const confirmationUrl = new URL(confirmationLink)
  assert.equal(confirmationUrl.searchParams.get('redirect_to'), callbackUrl, 'Magic-link should return to the app root')

  const callbackClient = createClient(url, anonKey, authOptions)
  const verificationResponse = await fetch(confirmationUrl, { redirect: 'manual' })
  assert.ok(verificationResponse.status >= 300 && verificationResponse.status < 400, 'Auth should verify the email link and redirect to the app')
  const returnLocation = verificationResponse.headers.get('location')
  assert.ok(returnLocation, 'Verified magic link should return an app callback URL')
  const returnedUrl = new URL(returnLocation, callbackUrl)
  assert.equal(`${returnedUrl.origin}${returnedUrl.pathname}`, callbackUrl, 'Auth should return to the configured app root')
  const callbackParams = new URLSearchParams(returnedUrl.hash.slice(1))
  const accessToken = callbackParams.get('access_token') ?? returnedUrl.searchParams.get('access_token')
  const refreshToken = callbackParams.get('refresh_token') ?? returnedUrl.searchParams.get('refresh_token')
  assert.ok(accessToken && refreshToken, 'Verified email return should include session tokens for the app callback')
  const { data, error } = await callbackClient.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
  assert.ifError(error)
  assert.ok(data.session, 'Email verification should establish an authenticated session')
  assert.equal(data.user?.email?.toLowerCase(), email.toLowerCase())
  identities.push(data.user.id)
  console.log('Magic-link email delivery, app callback URL, one-time link verification, and authenticated return session pass through local Supabase Auth and Mailpit.')
}

async function assertObjectExists(path, message) {
  const { data, error } = await admin.storage.from('hunt-photos').download(path)
  assert.ifError(error)
  assert.ok(data, message)
}

async function assertObjectMissing(path, message) {
  const { error } = await admin.storage.from('hunt-photos').download(path)
  assert.ok(error, message)
}

try {
  await verifyEmailMagicLinkReturnPath()
  const organizer = await createIdentity('organizer')
  const organizerConcurrent = createClient(url, anonKey, authOptions)
  const { data: organizerSession } = await organizer.auth.getSession()
  assert.ok(organizerSession.session)
  const { error: concurrentSessionError } = await organizerConcurrent.auth.setSession(organizerSession.session)
  assert.ifError(concurrentSessionError)
  const outsider = await createIdentity('outsider')
  const { error: organizerProvisionError } = await admin.from('organizers').insert({ auth_user_id: (await organizer.auth.getUser()).data.user.id })
  assert.ifError(organizerProvisionError)

  const { data: templateId, error: templateError } = await organizer.rpc('save_hunt_template', {
    p_title: 'Local Storage authorization test',
    p_venue: 'Isolated CI',
    p_description: '',
    p_rules: [],
    p_items: [
      { title: 'First challenge', description: '', points: 10 },
      { title: 'Second challenge', description: '', points: 5 },
    ],
    p_duration: 30,
    p_visibility: 'personal',
    p_template_id: null,
  })
  assert.ifError(templateError)

  const { data: huntId, error: gameError } = await organizer.rpc('create_game_from_template', {
    p_template_id: templateId,
    p_game_name: 'Local Storage authorization test',
    p_duration: 30,
  })
  assert.ifError(gameError)

  const { data: configuredTeams, error: configureError } = await organizer.rpc('configure_game', {
    p_game_id: huntId,
    p_name: 'Local Storage authorization test',
    p_duration: 30,
    p_team_names: ['CI Team One', 'CI Team Two'],
    p_assignment_mode: 'organizer',
    p_start_at: null,
    p_start_now: false,
    p_voting_enabled: true,
    p_bonus: 5,
  })
  assert.ifError(configureError)
  assert.equal(configuredTeams?.length, 2)

  const teamOne = configuredTeams[0]
  const teamTwo = configuredTeams[1]
  const participantOne = await createIdentity('participant-one')
  const participantOneConcurrent = await createIdentity('participant-one-concurrent')
  const participantTwo = await createIdentity('participant-two')
  const outsiderClient = outsider
  const { error: joinOneError } = await participantOne.rpc('redeem_invitation', {
    p_token: teamOne.invite_token,
    p_display_name: 'CI Player One',
  })
  assert.ifError(joinOneError)
  const { error: joinConcurrentError } = await participantOneConcurrent.rpc('redeem_invitation', {
    p_token: teamOne.invite_token,
    p_display_name: 'CI Player One Concurrent',
  })
  assert.ifError(joinConcurrentError)
  const { error: joinTwoError } = await participantTwo.rpc('redeem_invitation', {
    p_token: teamTwo.invite_token,
    p_display_name: 'CI Player Two',
  })
  assert.ifError(joinTwoError)
  const participantUser = await participantOne.auth.getUser()
  assert.ifError(participantUser.error)
  const { error: selfProvisionError } = await participantOne.from('organizers').insert({ auth_user_id: participantUser.data.user.id })
  assert.ok(selfProvisionError, 'Participants must not provision themselves as organizers through the table API')

  const { data: recoveredInvites, error: recoverInvitesError } = await organizer.rpc('get_hunt_invites', { p_hunt_id: huntId })
  assert.ifError(recoverInvitesError)
  assert.equal(recoveredInvites.has_active_invites, true)
  assert.equal(recoveredInvites.recoverable, true)
  assert.deepEqual(
    new Set(recoveredInvites.invite_codes.map((invite) => invite.invite_token)),
    new Set(configuredTeams.map((team) => team.invite_token)),
    'Organizer recovery should return the currently active invitation tokens',
  )
  const organizerFreshDevice = await signInSameIdentityOnFreshClient(organizer)
  const { data: recoveredOnFreshDevice, error: freshDeviceRecoveryError } = await organizerFreshDevice.rpc('get_hunt_invites', { p_hunt_id: huntId })
  assert.ifError(freshDeviceRecoveryError)
  assert.deepEqual(
    new Set(recoveredOnFreshDevice.invite_codes.map((invite) => invite.invite_token)),
    new Set(configuredTeams.map((team) => team.invite_token)),
    'A fresh organizer session should recover the same active invitations without prior device storage',
  )
  const { error: outsiderInviteRecoveryError } = await outsider.rpc('get_hunt_invites', { p_hunt_id: huntId })
  assert.ok(outsiderInviteRecoveryError, 'An outsider must not recover organizer invitation links')
  const { data: rotatedInvites, error: rotateInvitesError } = await organizer.rpc('regenerate_hunt_invites', { p_hunt_id: huntId })
  assert.ifError(rotateInvitesError)
  assert.equal(rotatedInvites.length, configuredTeams.length)
  assert.ok(rotatedInvites.every((invite) => !configuredTeams.some((oldInvite) => oldInvite.invite_token === invite.invite_token)))
  const staleInviteIdentity = await createIdentity('stale-invite')
  const { error: staleInviteRedeemError } = await staleInviteIdentity.rpc('redeem_invitation', {
    p_token: configuredTeams[0].invite_token,
    p_display_name: 'Stale Invite Player',
  })
  assert.ok(staleInviteRedeemError, 'A rotated invitation must no longer admit new participants')
  const { data: recoveredRotatedInvites, error: recoverRotatedError } = await organizer.rpc('get_hunt_invites', { p_hunt_id: huntId })
  assert.ifError(recoverRotatedError)
  assert.equal(recoveredRotatedInvites.has_active_invites, true)
  assert.equal(recoveredRotatedInvites.invite_codes.length, configuredTeams.length)
  assert.deepEqual(
    new Set(recoveredRotatedInvites.invite_codes.map((invite) => invite.invite_token)),
    new Set(rotatedInvites.map((invite) => invite.invite_token)),
    'Organizer recovery should return only the replacement links after rotation',
  )
  const { data: freshDeviceRotatedInvites, error: freshDeviceRotatedRecoveryError } = await organizerFreshDevice.rpc('get_hunt_invites', { p_hunt_id: huntId })
  assert.ifError(freshDeviceRotatedRecoveryError)
  assert.deepEqual(
    new Set(freshDeviceRotatedInvites.invite_codes.map((invite) => invite.invite_token)),
    new Set(rotatedInvites.map((invite) => invite.invite_token)),
    'A fresh organizer session should recover only rotated invitations',
  )
  console.log('Invitation recovery works in a fresh authenticated organizer session; rotation revokes old links and exposes only the replacements.')

  const selfiePath = `${huntId}/${teamOne.team_id}/selfie/${randomUUID()}.jpg`
  const replacementSelfiePath = `${huntId}/${teamOne.team_id}/selfie/${randomUUID()}.jpg`
  const { error: selfieUploadError } = await participantOne.storage.from('hunt-photos').upload(selfiePath, Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/AP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8Af//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Af//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Af//Z', 'base64'), { contentType: 'image/jpeg' })
  assert.ifError(selfieUploadError)
  objectPaths.push(selfiePath)
  const { data: savedSelfie, error: saveSelfieError } = await participantOne.rpc('submit_team_selfie', {
    p_hunt_id: huntId,
    p_team_id: teamOne.team_id,
    p_storage_path: selfiePath,
  })
  assert.ifError(saveSelfieError)
  assert.equal(savedSelfie?.accepted, true)
  await expectDenied(
    () => participantTwo.storage.from('hunt-photos').download(selfiePath),
    'A different team must not read this team selfie',
  )
  const { data: organizerSelfie, error: organizerSelfieError } = await organizer.storage.from('hunt-photos').download(selfiePath)
  assert.ifError(organizerSelfieError)
  assert.ok(organizerSelfie)
  const { data: participantContext, error: participantContextError } = await participantOne.rpc('get_participant_context', { p_hunt_id: huntId })
  assert.ifError(participantContextError)
  assert.equal(participantContext.team.selfie.storage_path, selfiePath)
  const { error: referencedSelfieDeleteError } = await participantOne.storage.from('hunt-photos').remove([selfiePath])
  assert.ifError(referencedSelfieDeleteError)
  await assertObjectExists(selfiePath, 'A participant must not delete a selfie referenced by the team')
  const { error: replacementSelfieUploadError } = await participantOneConcurrent.storage.from('hunt-photos').upload(replacementSelfiePath, Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/AP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8Af//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Af//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Af//Z', 'base64'), { contentType: 'image/jpeg' })
  assert.ifError(replacementSelfieUploadError)
  objectPaths.push(replacementSelfiePath)
  const { data: replacedSelfie, error: replaceSelfieError } = await participantOneConcurrent.rpc('submit_team_selfie', {
    p_hunt_id: huntId,
    p_team_id: teamOne.team_id,
    p_storage_path: replacementSelfiePath,
  })
  assert.ifError(replaceSelfieError)
  assert.equal(replacedSelfie.previous_storage_path, selfiePath)
  const { error: oldSelfieCleanupError } = await participantOne.storage.from('hunt-photos').remove([selfiePath])
  assert.ifError(oldSelfieCleanupError)
  await assertObjectMissing(selfiePath, 'The previous selfie should be removable after replacement')
  objectPaths.splice(objectPaths.indexOf(selfiePath), 1)
  const { data: refreshedContext, error: refreshedContextError } = await participantOne.rpc('get_participant_context', { p_hunt_id: huntId })
  assert.ifError(refreshedContextError)
  assert.equal(refreshedContext.team.selfie.storage_path, replacementSelfiePath)
  console.log('Team selfie upload, private team visibility, organizer access, context refresh, and safe replacement pass through real Storage HTTP.')

  const realtimeMessageBody = `Realtime CI ${randomUUID()}`
  function watchChatRealtime(client, audience, withHuntFilter = true, expectedBody = realtimeMessageBody) {
    let receiveMessage
    const message = new Promise((resolve) => { receiveMessage = resolve })
    let markSubscribed
    let rejectSubscription
    const subscribed = new Promise((resolve, reject) => { markSubscribed = resolve; rejectSubscription = reject })
    let markReplicationReady
    let rejectReplicationReady
    const replicationReady = new Promise((resolve, reject) => { markReplicationReady = resolve; rejectReplicationReady = reject })
    const change = { event: 'INSERT', schema: 'public', table: 'hunt_messages' }
    if (withHuntFilter) change.filter = `hunt_id=eq.${huntId}`
    const channel = client
      .channel(`ci-hunt-chat-${audience}-${huntId}-${randomUUID()}`, { config: { broadcast: { replication_ready: true } } })
      .on('system', {}, (payload) => {
        console.log(`Chat Realtime ${audience}${withHuntFilter ? ' filtered' : ' unfiltered'} ${payload.extension}: ${payload.status} (${payload.message})`)
        if (payload.extension === 'postgres_changes' && payload.status === 'ok') markReplicationReady()
        else if (payload.status === 'error' || payload.status === 'timeout') rejectReplicationReady(new Error(`${audience} chat replication failed: ${payload.message}`))
      })
      .on('postgres_changes', change, (payload) => {
        if (payload.new?.body === expectedBody) receiveMessage(payload.new)
      })
      .subscribe((status, error) => {
        console.log(`Chat Realtime ${audience}${withHuntFilter ? ' filtered' : ' unfiltered'} status: ${status}${error ? ` (${JSON.stringify(error)})` : ''}`)
        if (status === 'SUBSCRIBED') markSubscribed()
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') rejectSubscription(new Error(`${audience} chat Realtime subscription failed: ${status}`))
      })
    return { channel, message, subscribed, replicationReady }
  }
  const organizerRealtime = watchChatRealtime(organizer, 'organizer')
  const organizerUnfilteredRealtime = watchChatRealtime(organizer, 'organizer', false)
  const participantRealtime = watchChatRealtime(participantOne, 'participant')
  const withTimeout = (promise, label) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} timed out`)), 15_000)
    promise.then(
      (value) => { clearTimeout(timeout); resolve(value) },
      (error) => { clearTimeout(timeout); reject(error) },
    )
  })
  function watchTeamIdentity(client, audience, expectedName) {
    let markSubscribed
    let rejectSubscription
    const subscribed = new Promise((resolve, reject) => { markSubscribed = resolve; rejectSubscription = reject })
    let markReplicationReady
    let rejectReplicationReady
    const replicationReady = new Promise((resolve, reject) => { markReplicationReady = resolve; rejectReplicationReady = reject })
    let receiveUpdate
    const update = new Promise((resolve) => { receiveUpdate = resolve })
    const channel = client
      .channel(`ci-team-identity-${audience}-${huntId}-${randomUUID()}`, { config: { broadcast: { replication_ready: true } } })
      .on('system', {}, (payload) => {
        console.log(`Team identity Realtime ${audience} ${payload.extension}: ${payload.status} (${payload.message})`)
        if (payload.extension === 'postgres_changes' && payload.status === 'ok') markReplicationReady()
        else if (payload.status === 'error' || payload.status === 'timeout') rejectReplicationReady(new Error(`${audience} team identity replication failed: ${payload.message}`))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'teams', filter: `id=eq.${teamOne.team_id}` }, (payload) => {
        if (payload.new?.name === expectedName) receiveUpdate(payload.new)
      })
      .subscribe((status, error) => {
        console.log(`Team identity Realtime ${audience} status: ${status}${error ? ` (${JSON.stringify(error)})` : ''}`)
        if (status === 'SUBSCRIBED') markSubscribed()
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') rejectSubscription(new Error(`${audience} team identity Realtime subscription failed: ${status}`))
      })
    return { channel, subscribed, replicationReady, update }
  }
  const firstRealtimeTeamName = `CI Live ${randomUUID().slice(0, 8)}`
  const participantTeamRealtime = watchTeamIdentity(participantOne, 'participant device one', firstRealtimeTeamName)
  try {
    await withTimeout(participantTeamRealtime.subscribed, 'Participant team identity subscription')
    await withTimeout(participantTeamRealtime.replicationReady, 'Participant team identity replication readiness')
    const { error: firstTeamNameError } = await organizer.rpc('set_team_name', {
      p_hunt_id: huntId,
      p_team_id: teamOne.team_id,
      p_name: firstRealtimeTeamName,
    })
    assert.ifError(firstTeamNameError)
    assert.equal((await withTimeout(participantTeamRealtime.update, 'Participant team name update')).name, firstRealtimeTeamName)

    await participantOne.removeChannel(participantTeamRealtime.channel)
    const missedRealtimeTeamName = `CI Catchup ${randomUUID().slice(0, 8)}`
    const { error: offlineTeamNameError } = await organizer.rpc('set_team_name', {
      p_hunt_id: huntId,
      p_team_id: teamOne.team_id,
      p_name: missedRealtimeTeamName,
    })
    assert.ifError(offlineTeamNameError)
    const finalRealtimeTeamName = `CI Restored ${randomUUID().slice(0, 8)}`
    const reconnectedTeamRealtime = watchTeamIdentity(participantOneConcurrent, 'participant reconnect', finalRealtimeTeamName)
    try {
      await withTimeout(reconnectedTeamRealtime.subscribed, 'Reconnected participant team identity subscription')
      await withTimeout(reconnectedTeamRealtime.replicationReady, 'Reconnected participant team identity replication readiness')
      const { data: reconciledTeam, error: reconciledTeamError } = await participantOneConcurrent
        .from('teams')
        .select('id,name')
        .eq('id', teamOne.team_id)
        .single()
      assert.ifError(reconciledTeamError)
      assert.equal(reconciledTeam.name, missedRealtimeTeamName, 'A reconnecting device must reconcile team state changed while it was offline')
      const { error: restoredTeamNameError } = await organizer.rpc('set_team_name', {
        p_hunt_id: huntId,
        p_team_id: teamOne.team_id,
        p_name: finalRealtimeTeamName,
      })
      assert.ifError(restoredTeamNameError)
      assert.equal((await withTimeout(reconnectedTeamRealtime.update, 'Restored team name update')).name, finalRealtimeTeamName)
    } finally {
      await participantOneConcurrent.removeChannel(reconnectedTeamRealtime.channel)
    }
    console.log('Two authenticated participant sessions receive team identity updates; a reconnected session catches up from its RLS-protected snapshot and resumes live updates.')
  } finally {
    await participantOne.removeChannel(participantTeamRealtime.channel)
  }
  try {
    await Promise.all([
      withTimeout(organizerRealtime.subscribed, 'Organizer chat Realtime subscription'),
      withTimeout(organizerUnfilteredRealtime.subscribed, 'Unfiltered organizer chat Realtime subscription'),
      withTimeout(participantRealtime.subscribed, 'Participant chat Realtime subscription'),
      withTimeout(organizerRealtime.replicationReady, 'Organizer Postgres replication readiness'),
      withTimeout(organizerUnfilteredRealtime.replicationReady, 'Unfiltered organizer Postgres replication readiness'),
      withTimeout(participantRealtime.replicationReady, 'Participant Postgres replication readiness'),
    ])
    const { data: realtimeSentMessage, error: realtimeSendError } = await organizer.rpc('send_hunt_message', {
      p_hunt_id: huntId,
      p_body: realtimeMessageBody,
    })
    assert.ifError(realtimeSendError)
    for (const [client, audience] of [[organizer, 'organizer'], [participantOne, 'participant']]) {
      const { data: visibleRows, error: visibleRowsError } = await client
        .from('hunt_messages')
        .select('id')
        .eq('id', realtimeSentMessage.id)
      assert.ifError(visibleRowsError)
      assert.equal(visibleRows?.length, 1, `${audience} RLS must allow reading the inserted chat row`)
    }
    const [organizerReceived, organizerUnfilteredReceived, participantReceived] = await Promise.all([
      withTimeout(organizerRealtime.message, 'Organizer chat Realtime delivery'),
      withTimeout(organizerUnfilteredRealtime.message, 'Unfiltered organizer chat Realtime delivery'),
      withTimeout(participantRealtime.message, 'Participant chat Realtime delivery'),
    ])
    for (const receivedMessage of [organizerReceived, organizerUnfilteredReceived, participantReceived]) {
      assert.equal(receivedMessage.id, realtimeSentMessage.id)
      assert.equal(receivedMessage.sender_role, 'organizer')
    }
    console.log('Organizer and participant receive a new organizer chat message through Supabase Realtime.')
  } finally {
    await Promise.all([
      organizer.removeChannel(organizerRealtime.channel),
      organizer.removeChannel(organizerUnfilteredRealtime.channel),
      participantOne.removeChannel(participantRealtime.channel),
    ])
  }

  const offlineChatBody = `Offline recovery CI ${randomUUID()}`
  const { data: offlineChatMessage, error: offlineChatError } = await organizer.rpc('send_hunt_message', {
    p_hunt_id: huntId,
    p_body: offlineChatBody,
  })
  assert.ifError(offlineChatError)
  const reconnectedChatBody = `Realtime restored CI ${randomUUID()}`
  const reconnectedParticipantRealtime = watchChatRealtime(participantOne, 'participant reconnect', true, reconnectedChatBody)
  try {
    await withTimeout(reconnectedParticipantRealtime.subscribed, 'Reconnected participant chat subscription')
    await withTimeout(reconnectedParticipantRealtime.replicationReady, 'Reconnected participant chat replication readiness')
    const { data: reconciledMessages, error: reconciledMessagesError } = await participantOne.rpc('get_hunt_messages', {
      p_hunt_id: huntId,
      p_limit: 100,
      p_before: null,
      p_before_id: null,
    })
    assert.ifError(reconciledMessagesError)
    assert.ok(reconciledMessages.some((message) => message.id === offlineChatMessage.id), 'A participant reconnecting after a missed message must recover it from chat history')
    const { data: reconnectedLiveMessage, error: reconnectedLiveError } = await organizer.rpc('send_hunt_message', {
      p_hunt_id: huntId,
      p_body: reconnectedChatBody,
    })
    assert.ifError(reconnectedLiveError)
    const receivedAfterReconnect = await withTimeout(reconnectedParticipantRealtime.message, 'Participant chat delivery after reconnect')
    assert.equal(receivedAfterReconnect.id, reconnectedLiveMessage.id)
    console.log('A participant reconnecting after a missed chat message recovers history and receives subsequent messages through Realtime.')
  } finally {
    await participantOne.removeChannel(reconnectedParticipantRealtime.channel)
  }

  const { data: organizerMessage, error: organizerMessageError } = await organizer.rpc('send_hunt_message', {
    p_hunt_id: huntId,
    p_body: 'Organizer CI message',
  })
  assert.ifError(organizerMessageError)
  assert.equal(organizerMessage.sender_role, 'organizer')
  const { data: participantMessage, error: participantMessageError } = await participantTwo.rpc('send_hunt_message', {
    p_hunt_id: huntId,
    p_body: 'Participant CI message',
  })
  assert.ifError(participantMessageError)
  assert.equal(participantMessage.sender_role, 'participant')
  assert.equal(participantMessage.sender_name, 'CI Player Two')
  const { data: messages, error: messagesError } = await participantOne.rpc('get_hunt_messages', {
    p_hunt_id: huntId,
    p_limit: 100,
    p_before: null,
    p_before_id: null,
  })
  assert.ifError(messagesError)
  assert.ok(messages.some((message) => message.id === organizerMessage.id))
  assert.ok(messages.some((message) => message.id === participantMessage.id))
  const { error: outsiderMessageError } = await outsider.rpc('send_hunt_message', {
    p_hunt_id: huntId,
    p_body: 'Outsider must not send',
  })
  assert.ok(outsiderMessageError, 'Outsiders must not send hunt chat messages')
  assert.match(outsiderMessageError.message, /Participant access required/)
  const { error: outsiderReadMessagesError } = await outsider.rpc('get_hunt_messages', {
    p_hunt_id: huntId,
    p_limit: 100,
    p_before: null,
    p_before_id: null,
  })
  assert.ok(outsiderReadMessagesError, 'Outsiders must not read hunt chat messages')
  assert.match(outsiderReadMessagesError.message, /Hunt access required/)
  const { error: directMessageInsertError } = await participantOne.from('hunt_messages').insert({
    hunt_id: huntId,
    sender_user_id: (await participantOne.auth.getUser()).data.user.id,
    sender_participant_id: null,
    sender_name: 'Forged sender',
    sender_role: 'organizer',
    body: 'Forged direct insert',
  })
  assert.ok(directMessageInsertError, 'Clients must not insert or forge chat rows directly')
  for (let messageNumber = 0; messageNumber < 7; messageNumber += 1) {
    const { error } = await participantTwo.rpc('send_hunt_message', {
      p_hunt_id: huntId,
      p_body: `Rate limit fixture ${messageNumber}`,
    })
    assert.ifError(error)
  }
  const { error: rateLimitError } = await participantTwo.rpc('send_hunt_message', {
    p_hunt_id: huntId,
    p_body: 'One too many messages',
  })
  assert.ok(rateLimitError, 'Chat should enforce its per-user send rate limit')
  assert.match(rateLimitError.message, /Wait a minute before sending another/)

  const outsiderUser = await outsider.auth.getUser()
  const { data: outsiderParticipant } = await admin.from('participants').select('id').eq('auth_user_id', outsiderUser.data.user.id).maybeSingle()
  assert.equal(outsiderParticipant, null)
  const stableTime = '2099-01-01T00:00:00.000Z'
  const stableMessages = Array.from({ length: 205 }, (_, index) => ({
    hunt_id: huntId,
    sender_user_id: outsiderUser.data.user.id,
    sender_participant_id: null,
    sender_name: 'CI Pagination Fixture',
    sender_role: 'participant',
    body: `Stable cursor message ${index}`,
    created_at: stableTime,
  }))
  const stableMessageIds = []
  for (let offset = 0; offset < stableMessages.length; offset += 100) {
    const { data: insertedMessages, error } = await admin
      .from('hunt_messages')
      .insert(stableMessages.slice(offset, offset + 100))
      .select('id')
    assert.ifError(error)
    stableMessageIds.push(...insertedMessages.map((message) => message.id))
  }
  const pagedMessageIds = []
  const pageSizes = []
  let cursorTime = null
  let cursorId = null
  while (true) {
    const { data: page, error } = await participantOne.rpc('get_hunt_messages', {
      p_hunt_id: huntId,
      p_limit: 100,
      p_before: cursorTime,
      p_before_id: cursorId,
    })
    assert.ifError(error)
    if (page.length === 0) break
    pageSizes.push(page.length)
    pagedMessageIds.push(...page.map((message) => message.id))
    const oldestMessage = page[0]
    cursorTime = oldestMessage.created_at
    cursorId = oldestMessage.id
    if (page.length < 100) break
  }
  const stableMessageIdSet = new Set(stableMessageIds)
  const pagedFixtureIds = pagedMessageIds.filter((id) => stableMessageIdSet.has(id))
  assert.deepEqual(pageSizes.slice(0, 2), [100, 100], 'Stable-cursor pagination must fill each requested page before the final page')
  assert.ok(pageSizes.at(-1) >= 15 && pageSizes.at(-1) < 100, 'The final cursor page must include every fixture row without exceeding its page limit')
  assert.equal(new Set(pagedMessageIds).size, pagedMessageIds.length, 'Chat pagination must not duplicate any rows')
  assert.equal(pagedFixtureIds.length, 205)
  assert.equal(new Set(pagedFixtureIds).size, 205, 'Stable pagination must not skip or duplicate same-timestamp rows')
  console.log('Organizer/participant chat HTTP access, sender identity, send rate limit, and 205-row stable-cursor paging pass.')

  const { data: huntItems, error: itemsError } = await admin.from('hunt_items').select('id,display_order').eq('hunt_id', huntId).order('display_order')
  assert.ifError(itemsError)
  assert.equal(huntItems?.length, 2)
  const [firstItem, secondItem] = huntItems
  const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/AP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8Af//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Af//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Af//Z', 'base64')
  const photoPath = `${huntId}/${teamOne.team_id}/${firstItem.id}/${randomUUID()}.jpg`
  const replacePath = `${huntId}/${teamOne.team_id}/${firstItem.id}/${randomUUID()}.jpg`
  const cleanupPath = `${huntId}/${teamOne.team_id}/${secondItem.id}/${randomUUID()}.jpg`
  const crossTeamPath = `${huntId}/${teamTwo.team_id}/${firstItem.id}/${randomUUID()}.jpg`

  await expectDenied(
    () => participantOne.storage.from('hunt-photos').upload(photoPath, jpeg, { contentType: 'image/jpeg' }),
    'A participant must not upload before a manual-start hunt begins',
  )
  await expectDenied(
    () => anonymous.storage.from('hunt-photos').upload(photoPath, jpeg, { contentType: 'image/jpeg' }),
    'Anonymous users must not upload hunt photos',
  )
  console.log('Manual-start pre-start and anonymous Storage uploads are denied.')

  const { error: startError } = await outsiderClient.rpc('start_game_now', { p_game_id: huntId })
  assert.ok(startError, 'A non-organizer must not start a hunt')
  assert.match(startError.message, /Organizer access required/)
  await expectDenied(
    () => organizer.storage.from('hunt-photos').upload(photoPath, jpeg, { contentType: 'image/jpeg' }),
    'Organizers must not upload into participant photo paths',
  )

  const startRace = await Promise.all([
    organizer.rpc('start_game_now', { p_game_id: huntId }),
    organizerConcurrent.rpc('start_game_now', { p_game_id: huntId }),
  ])
  assert.equal(startRace.filter((result) => !result.error).length, 1, 'Exactly one concurrent Start Now request should win')
  const rejectedStart = startRace.find((result) => result.error)
  assert.ok(rejectedStart, 'The losing concurrent Start Now request should be rejected')
  assert.match(rejectedStart.error.message, /Only an unstarted hunt can start now/)
  const { data: startRaceState, error: startRaceStateError } = await admin
    .from('hunts')
    .select('status,start_at')
    .eq('id', huntId)
    .single()
  assert.ifError(startRaceStateError)
  assert.equal(startRaceState.status, 'active')
  assert.ok(startRaceState.start_at, 'A winning Start Now request should set a server start time')
  const { count: startEventCount, error: startEventCountError } = await admin
    .from('audit_events')
    .select('id', { count: 'exact', head: true })
    .eq('hunt_id', huntId)
    .eq('event_type', 'game_start_now')
  assert.ifError(startEventCountError)
  assert.equal(startEventCount, 1, 'Concurrent Start Now requests should create exactly one audit event')
  console.log('Concurrent Start Now requests serialize: one starts the hunt, and only the winner records an audit event.')
  const operationId = randomUUID()
  const { data: clientAuditId, error: clientAuditError } = await participantOne.rpc('record_audit_event', {
    p_event_type: 'client_operation',
    p_hunt_id: huntId,
    p_outcome: 'failure',
    p_details: {
      client_report: true,
      operation_id: operationId,
      stage: 'upload_denied',
      app: 'participant_web',
    },
  })
  assert.ifError(clientAuditError)
  assert.ok(clientAuditId)
  const failureTraceCases = [
    { actor: participantOne, app: 'participant_web', stage: 'authorization_denied' },
    { actor: participantOne, app: 'participant_web', stage: 'photo_preview_unavailable' },
    { actor: organizer, app: 'organizer_web', stage: 'chat_send_failed' },
    { actor: organizer, app: 'organizer_web', stage: 'review_decision_failed' },
    { actor: organizer, app: 'organizer_web', stage: 'finalization_retry_failed' },
  ]
  const failureTraceIds = new Map()
  for (const trace of failureTraceCases) {
    const operationId = randomUUID()
    const { data: eventId, error } = await trace.actor.rpc('record_audit_event', {
      p_event_type: 'client_operation',
      p_hunt_id: huntId,
      p_outcome: 'failure',
      p_details: { client_report: true, operation_id: operationId, stage: trace.stage, app: trace.app },
    })
    assert.ifError(error)
    assert.ok(eventId, `${trace.stage} should produce an audit event`)
    failureTraceIds.set(trace.stage, eventId)
  }
  const { error: forgedAuditError } = await participantOne.rpc('record_audit_event', {
    p_event_type: 'client_operation',
    p_hunt_id: huntId,
    p_outcome: 'failure',
    p_details: {
      client_report: true,
      operation_id: randomUUID(),
      stage: 'upload_denied',
      app: 'participant_web',
      email: 'player@example.test',
    },
  })
  assert.ok(forgedAuditError, 'Client audit reports must reject unsupported potentially identifying fields')
  assert.match(forgedAuditError.message, /Unsupported client audit detail/)
  const { error: forgedServerEventError } = await participantOne.rpc('record_audit_event', {
    p_event_type: 'game_start_now',
    p_hunt_id: huntId,
    p_outcome: 'success',
    p_details: {},
  })
  assert.ok(forgedServerEventError, 'Clients must not forge server-authoritative event types')
  assert.match(forgedServerEventError.message, /Only client operation reports are accepted/)
  console.log('Only the organizer can manually start the hunt.')

  const { error: uploadError } = await participantOne.storage.from('hunt-photos').upload(photoPath, jpeg, { contentType: 'image/jpeg' })
  assert.ifError(uploadError)
  objectPaths.push(photoPath)
  await expectDenied(
    () => participantOne.storage.from('hunt-photos').upload(crossTeamPath, jpeg, { contentType: 'image/jpeg' }),
    'A participant must not upload into another team path',
  )
  await expectDenied(
    () => participantTwo.storage.from('hunt-photos').download(photoPath),
    'A different team must not read another team photo during active play',
  )
  const { data: organizerPhoto, error: organizerReadError } = await organizer.storage.from('hunt-photos').download(photoPath)
  assert.ifError(organizerReadError)
  assert.ok(organizerPhoto, 'The organizer should be able to review a team photo')
  console.log('Active-hunt upload succeeds for the assigned team; cross-team upload/read are denied and organizer read succeeds.')

  const { data: submitted, error: submitError } = await participantOne.rpc('submit_hunt_photo', {
    p_hunt_item_id: firstItem.id,
    p_storage_path: photoPath,
    p_expected_storage_path: null,
  })
  assert.ifError(submitError)
  assert.equal(submitted?.accepted, true)
  objectPaths.push(photoPath)
  const { error: referencedDeleteError } = await participantOne.storage.from('hunt-photos').remove([photoPath])
  assert.ifError(referencedDeleteError)
  await assertObjectExists(photoPath, 'A participant must not delete an object referenced by a submission')

  const { error: replaceUploadError } = await participantOne.storage.from('hunt-photos').upload(replacePath, jpeg, { contentType: 'image/jpeg' })
  assert.ifError(replaceUploadError)
  objectPaths.push(replacePath)
  const { error: replaceSubmitError } = await participantOne.rpc('submit_hunt_photo', {
    p_hunt_item_id: firstItem.id,
    p_storage_path: replacePath,
    p_expected_storage_path: photoPath,
  })
  assert.ifError(replaceSubmitError)
  const { error: oldPhotoCleanupError } = await participantOne.storage.from('hunt-photos').remove([photoPath])
  assert.ifError(oldPhotoCleanupError)
  await assertObjectMissing(photoPath, 'The old photo should be removable after its submission reference moves')
  console.log('Submitted objects cannot be deleted while referenced; replacement updates the reference and then permits old-object cleanup.')

  const { error: cleanupUploadError } = await participantOne.storage.from('hunt-photos').upload(cleanupPath, jpeg, { contentType: 'image/jpeg' })
  assert.ifError(cleanupUploadError)
  objectPaths.push(cleanupPath)
  const { error: cleanupError } = await participantOne.storage.from('hunt-photos').remove([cleanupPath])
  assert.ifError(cleanupError)
  await assertObjectMissing(cleanupPath, 'Unreferenced same-team cleanup should remove the object')
  objectPaths.splice(objectPaths.indexOf(cleanupPath), 1)
  console.log('Unreferenced same-team object cleanup succeeds.')

  let currentPath = replacePath
  let savedSubmission
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const candidateOne = `${huntId}/${teamOne.team_id}/${firstItem.id}/${randomUUID()}.jpg`
    const candidateTwo = `${huntId}/${teamOne.team_id}/${firstItem.id}/${randomUUID()}.jpg`
    for (const [client, path] of [[participantOne, candidateOne], [participantOneConcurrent, candidateTwo]]) {
      const { error } = await client.storage.from('hunt-photos').upload(path, jpeg, { contentType: 'image/jpeg' })
      assert.ifError(error)
      objectPaths.push(path)
    }
    const [resultOne, resultTwo] = await Promise.all([
      participantOne.rpc('submit_hunt_photo', {
        p_hunt_item_id: firstItem.id,
        p_storage_path: candidateOne,
        p_expected_storage_path: currentPath,
      }),
      participantOneConcurrent.rpc('submit_hunt_photo', {
        p_hunt_item_id: firstItem.id,
        p_storage_path: candidateTwo,
        p_expected_storage_path: currentPath,
      }),
    ])
    const raceResults = [resultOne, resultTwo]
    assert.equal(raceResults.filter((result) => !result.error).length, 1, `Exactly one concurrent replacement should win in attempt ${attempt}`)
    assert.equal(raceResults.filter((result) => result.error).length, 1, `The stale concurrent replacement should be rejected in attempt ${attempt}`)
    assert.equal(raceResults.find((result) => !result.error).data?.accepted, true)
    const { data, error } = await admin
      .from('submissions')
      .select('id,storage_path,approval_status')
      .eq('hunt_id', huntId)
      .single()
    assert.ifError(error)
    savedSubmission = data
    assert.equal(savedSubmission.approval_status, 'approved', 'Accepted and replacement photos should count by default')
    const winningPath = resultOne.error ? candidateTwo : candidateOne
    const losingPath = resultOne.error ? candidateOne : candidateTwo
    assert.equal(savedSubmission.storage_path, winningPath, `Attempt ${attempt} must leave the accepted path referenced`)
    const { error: staleCleanupError } = await participantOne.storage.from('hunt-photos').remove([losingPath])
    assert.ifError(staleCleanupError)
    await assertObjectMissing(losingPath, `Attempt ${attempt} rejected upload should be removable as unreferenced`)
    objectPaths.splice(objectPaths.indexOf(losingPath), 1)
    const { error: replacedCleanupError } = await participantOne.storage.from('hunt-photos').remove([currentPath])
    assert.ifError(replacedCleanupError)
    await assertObjectMissing(currentPath, `Attempt ${attempt} prior version should be removable after replacement`)
    objectPaths.splice(objectPaths.indexOf(currentPath), 1)
    currentPath = winningPath
  }
  console.log('Five concurrent same-slot photo replacement races each select one winner and leave only that path referenced.')

  const secondTeamPhotoPath = `${huntId}/${teamTwo.team_id}/${secondItem.id}/${randomUUID()}.jpg`
  const { error: secondTeamUploadError } = await participantTwo.storage.from('hunt-photos').upload(secondTeamPhotoPath, jpeg, { contentType: 'image/jpeg' })
  assert.ifError(secondTeamUploadError)
  objectPaths.push(secondTeamPhotoPath)
  const { error: secondTeamSubmitError } = await participantTwo.rpc('submit_hunt_photo', {
    p_hunt_item_id: secondItem.id,
    p_storage_path: secondTeamPhotoPath,
    p_expected_storage_path: null,
  })
  assert.ifError(secondTeamSubmitError)

  const endRace = await Promise.all([
    organizer.rpc('end_hunt_early', { p_hunt_id: huntId }),
    organizerConcurrent.rpc('end_hunt_early', { p_hunt_id: huntId }),
  ])
  assert.equal(endRace.filter((result) => !result.error).length, 1, 'Exactly one concurrent End request should close the hunt')
  const rejectedEnd = endRace.find((result) => result.error)
  assert.ok(rejectedEnd, 'The losing concurrent End request should be rejected')
  assert.match(rejectedEnd.error.message, /This hunt cannot be ended from its current state/)
  const { data: endRaceState, error: endRaceStateError } = await admin
    .from('hunts')
    .select('status,ended_at')
    .eq('id', huntId)
    .single()
  assert.ifError(endRaceStateError)
  assert.equal(endRaceState.status, 'review')
  assert.ok(endRaceState.ended_at, 'The winning End request should set the review cutoff')
  console.log('Concurrent End requests serialize: one closes the hunt, and the other is rejected.')
  const { error: closedChatSendError } = await participantOne.rpc('send_hunt_message', {
    p_hunt_id: huntId,
    p_body: 'Chat should be closed with the hunt',
  })
  assert.ok(closedChatSendError, 'Participants must not send chat messages after the hunt enters review')
  assert.match(closedChatSendError.message, /Chat is only open before or during the hunt/)
  const { data: reviewPhoto, error: reviewPhotoError } = await participantTwo.storage.from('hunt-photos').download(currentPath)
  assert.ifError(reviewPhotoError)
  assert.ok(reviewPhoto, 'Participants should be able to view hunt photos after the hunt ends')
  await expectDenied(
    () => participantTwo.storage.from('hunt-photos').download(replacementSelfiePath),
    'Post-hunt photo access must not reveal another team selfie',
  )
  console.log('After the hunt ends, participants can review hunt photos while other teams’ selfies remain private.')
  const { error: markLegacyPendingError } = await admin
    .from('submissions')
    .update({ approval_status: 'pending' })
    .eq('hunt_id', huntId)
    .eq('hunt_item_id', secondItem.id)
  assert.ifError(markLegacyPendingError)
  console.log('Explicitly restore one pending legacy submission to verify the finalization safety guard.')
  const [reviewRace, finalizeRace] = await Promise.all([
    organizer.rpc('review_submission', {
      p_submission_id: savedSubmission.id,
      p_decision: 'approved',
    }),
    organizerConcurrent.rpc('finalize_hunt', { p_hunt_id: huntId }),
  ])
  assert.ifError(reviewRace.error)
  assert.ok(finalizeRace.error, 'Finalization must wait while another submission remains pending')
  assert.match(finalizeRace.error.message, /Review or reject every submitted photo before finalizing/)
  const { data: secondTeamSubmission, error: secondSubmissionError } = await admin
    .from('submissions')
    .select('id')
    .eq('hunt_id', huntId)
    .eq('hunt_item_id', secondItem.id)
    .single()
  assert.ifError(secondSubmissionError)
  const { error: selfVoteError } = await participantOne.rpc('cast_hunt_vote', {
    p_hunt_id: huntId,
    p_hunt_item_id: firstItem.id,
    p_selected_team_id: teamOne.team_id,
  })
  assert.ok(selfVoteError, 'Participants must not vote for their own team')
  assert.match(selfVoteError.message, /You cannot vote for your own team/)
  const { error: unapprovedVoteError } = await participantTwo.rpc('cast_hunt_vote', {
    p_hunt_id: huntId,
    p_hunt_item_id: firstItem.id,
    p_selected_team_id: teamTwo.team_id,
  })
  assert.ok(unapprovedVoteError, 'Participants must not vote for a submission that is not approved')
  assert.match(unapprovedVoteError.message, /You can vote only for an approved photo/)
  const { error: outsiderVoteError } = await outsider.rpc('cast_hunt_vote', {
    p_hunt_id: huntId,
    p_hunt_item_id: firstItem.id,
    p_selected_team_id: teamOne.team_id,
  })
  assert.ok(outsiderVoteError, 'An outsider must not vote in the hunt')
  assert.match(outsiderVoteError.message, /Participant access required/)
  const { error: castVoteError } = await participantTwo.rpc('cast_hunt_vote', {
    p_hunt_id: huntId,
    p_hunt_item_id: firstItem.id,
    p_selected_team_id: teamOne.team_id,
  })
  assert.ifError(castVoteError)
  const { data: votes, error: votesError } = await participantTwo
    .from('hunt_votes')
    .select('hunt_item_id,voting_team_id,selected_team_id')
    .eq('hunt_id', huntId)
  assert.ifError(votesError)
  assert.equal(votes?.length, 1)
  assert.equal(votes[0].voting_team_id, teamTwo.team_id)
  assert.equal(votes[0].selected_team_id, teamOne.team_id)
  const { error: rejectSecondSubmissionError } = await organizer.rpc('review_submission', {
    p_submission_id: secondTeamSubmission.id,
    p_decision: 'rejected',
  })
  assert.ifError(rejectSecondSubmissionError)
  console.log('Review/finalize preserves the pending guard; valid cross-team voting works while self, unapproved, and outsider votes are denied.')
  const [finalizeOne, finalizeTwo] = await Promise.all([
    organizer.rpc('finalize_hunt', { p_hunt_id: huntId }),
    organizerConcurrent.rpc('finalize_hunt', { p_hunt_id: huntId }),
  ])
  assert.ifError(finalizeOne.error)
  assert.ifError(finalizeTwo.error)
  assert.deepEqual(finalizeOne.data, finalizeTwo.data, 'Concurrent finalization should return the same immutable score snapshot')
  assert.equal(finalizeOne.data?.length, 2)
  const winningScore = finalizeOne.data.find((score) => score.team_id === teamOne.team_id)
  const losingScore = finalizeOne.data.find((score) => score.team_id === teamTwo.team_id)
  assert.equal(winningScore?.base_points, 10)
  assert.equal(winningScore?.voting_bonus, 5)
  assert.equal(winningScore?.total, 15)
  assert.equal(winningScore?.rank, 1)
  assert.equal(losingScore?.base_points, 0)
  assert.equal(losingScore?.total, 0)
  assert.equal(losingScore?.rank, 2)
  const [organizerGallery, participantGallery] = await Promise.all([
    organizer.rpc('get_hunt_review_gallery', { p_hunt_id: huntId }),
    participantOne.rpc('get_hunt_review_gallery', { p_hunt_id: huntId }),
  ])
  assert.ifError(organizerGallery.error)
  assert.ifError(participantGallery.error)
  assert.deepEqual(organizerGallery.data.final_scores, finalizeOne.data)
  assert.deepEqual(participantGallery.data.final_scores, finalizeOne.data)
  assert.equal(organizerGallery.data.votes.length, 1)
  assert.deepEqual(participantGallery.data.votes, organizerGallery.data.votes)
  const galleryWinners = winningTeams(normalizeFinalScores(participantGallery.data.final_scores))
  assert.equal(galleryWinners.length, 1)
  assert.equal(galleryWinners[0].teamId, teamOne.team_id)
  assert.equal(winnerCaption({
    title: 'Local Storage authorization test',
    teamName: galleryWinners[0].teamName,
    score: galleryWinners[0].total,
  }), `🏆 ${galleryWinners[0].teamName} won Local Storage authorization test with 15 points! #SnapQuest`, 'The celebration caption must use the immutable database winner, team name, and total')
  console.log('The finalized Supabase score snapshot normalizes to the same winning team and caption used by the celebration UI.')
  const { error: outsiderGalleryError } = await outsider.rpc('get_hunt_review_gallery', { p_hunt_id: huntId })
  assert.ok(outsiderGalleryError, 'An outsider must not read finalized hunt results')
  assert.match(outsiderGalleryError.message, /Hunt access required/)
  const { data: completedHunt, error: completedHuntError } = await admin
    .from('hunts')
    .select('status,final_scores')
    .eq('id', huntId)
    .single()
  assert.ifError(completedHuntError)
  assert.equal(completedHunt.status, 'completed')
  assert.deepEqual(completedHunt.final_scores, finalizeOne.data)
  const { data: closedInvites, error: closedInvitesError } = await organizer.rpc('get_hunt_invites', { p_hunt_id: huntId })
  assert.ifError(closedInvitesError)
  assert.equal(closedInvites.has_active_invites, false)
  assert.equal(closedInvites.invite_codes.length, 0, 'Closed hunts must not disclose recoverable invitation tokens')
  const { error: outsiderClosedInviteRecoveryError } = await outsider.rpc('get_hunt_invites', { p_hunt_id: huntId })
  assert.ok(outsiderClosedInviteRecoveryError, 'An outsider must not recover invitations after a hunt closes')
  assert.match(outsiderClosedInviteRecoveryError.message, /Organizer access required/)
  const { data: closedInvitePreview, error: closedInvitePreviewError } = await anonymous.rpc('preview_invitation', {
    p_token: rotatedInvites[0].invite_token,
  })
  assert.ifError(closedInvitePreviewError)
  assert.equal(closedInvitePreview, null, 'Closed-hunt invite links must not reveal a preview')
  const closedInviteIdentity = await createIdentity('closed-invite')
  const { error: closedInviteRedeemError } = await closedInviteIdentity.rpc('redeem_invitation', {
    p_token: rotatedInvites[0].invite_token,
    p_display_name: 'Late Player',
  })
  assert.ok(closedInviteRedeemError, 'A closed-hunt invite must not admit a new participant')
  assert.match(closedInviteRedeemError.message, /This invitation link is invalid or expired|This hunt is not accepting participants/)
  const closedInviteUser = await closedInviteIdentity.auth.getUser()
  assert.ifError(closedInviteUser.error)
  const { data: lateParticipant, error: lateParticipantError } = await admin
    .from('participants')
    .select('id')
    .eq('auth_user_id', closedInviteUser.data.user.id)
    .eq('hunt_id', huntId)
    .maybeSingle()
  assert.ifError(lateParticipantError)
  assert.equal(lateParticipant, null, 'A failed closed-hunt invitation redemption must not create membership')
  console.log('Closed hunts hide recoverable invites/previews and reject outsider recovery and late participant redemption.')
  const { error: closedReviewError } = await organizer.rpc('review_submission', {
    p_submission_id: savedSubmission.id,
    p_decision: 'rejected',
  })
  assert.ok(closedReviewError, 'A finalized hunt must reject further review changes')
  assert.match(closedReviewError.message, /Photo review is not open/)
  console.log('Concurrent finalization preserves one immutable score/rank snapshot for organizer and participant, while outsiders are denied.')

  const { data: auditEvents, error: auditEventsError } = await organizer.rpc('list_hunt_audit_events', {
    p_hunt_id: huntId,
    p_limit: 100,
  })
  assert.ifError(auditEventsError)
  const serverStartEvent = auditEvents.find((event) => event.event_type === 'game_start_now')
  const serverEndEvent = auditEvents.find((event) => event.event_type === 'game_end_early')
  const clientOperationEvent = auditEvents.find((event) => event.id === clientAuditId)
  assert.equal(serverStartEvent?.source, 'server-authoritative')
  assert.equal(serverEndEvent?.source, 'server-authoritative')
  assert.equal(clientOperationEvent?.source, 'client-reported')
  assert.deepEqual(Object.keys(clientOperationEvent.details).sort(), ['app', 'client_report', 'operation_id', 'stage'])
  assert.equal(clientOperationEvent.details.operation_id, operationId)
  for (const trace of failureTraceCases) {
    const event = auditEvents.find((candidate) => candidate.id === failureTraceIds.get(trace.stage))
    assert.ok(event, `${trace.stage} should appear in organizer-visible audit logs`)
    assert.equal(event.outcome, 'failure')
    assert.equal(event.source, 'client-reported')
    assert.deepEqual(Object.keys(event.details).sort(), ['app', 'client_report', 'operation_id', 'stage'])
    assert.equal(event.details.stage, trace.stage)
    assert.equal(event.details.app, trace.app)
  }
  const { error: participantAuditListError } = await participantOne.rpc('list_hunt_audit_events', { p_hunt_id: huntId, p_limit: 100 })
  assert.ok(participantAuditListError, 'Participants must not read organizer audit logs')
  assert.match(participantAuditListError.message, /Organizer access required/)
  const { error: outsiderAuditListError } = await outsider.rpc('list_hunt_audit_events', { p_hunt_id: huntId, p_limit: 100 })
  assert.ok(outsiderAuditListError, 'Outsiders must not read hunt audit logs')
  const { count: participantAuditRows, error: participantAuditRowsError } = await participantOne
    .from('audit_events')
    .select('id', { count: 'exact', head: true })
    .eq('hunt_id', huntId)
  assert.ifError(participantAuditRowsError)
  assert.equal(participantAuditRows, 0, 'Participants must not read audit rows directly')
  await verifyHuntTableRoleMatrix(huntId, organizer, participantOne, outsider, anonymous)
  console.log('Audit events distinguish server and client sources, strip the client report to an allowlist, and enforce organizer-only log access.')

  const { error: outsiderRowsError, count: outsiderRowCount } = await outsider.from('submissions').select('id', { count: 'exact', head: true }).eq('hunt_id', huntId)
  assert.ifError(outsiderRowsError)
  assert.equal(outsiderRowCount, 0, 'An outsider must not read hunt submissions')
  console.log('Outsider submission-table reads return no rows.')
} finally {
  for (const objectPath of new Set(objectPaths)) {
    await admin.storage.from('hunt-photos').remove([objectPath])
  }
  if (identities.length) {
    for (const identity of identities) {
      await admin.auth.admin.deleteUser(identity)
    }
  }
}
