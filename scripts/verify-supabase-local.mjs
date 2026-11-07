import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const url = process.env.API_URL
const serviceRoleKey = process.env.SERVICE_ROLE_KEY
const anonKey = process.env.ANON_KEY
assert.ok(url, 'Supabase CLI did not export API_URL')
assert.ok(serviceRoleKey, 'Supabase CLI did not export SERVICE_ROLE_KEY')
assert.ok(anonKey, 'Supabase CLI did not export ANON_KEY')

const authOptions = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, serviceRoleKey, authOptions)
const anonymous = createClient(url, anonKey, authOptions)

const { data: bucket, error: bucketError } = await admin.storage.getBucket('hunt-photos')
assert.ifError(bucketError)
assert.equal(bucket?.public, false, 'hunt-photos must remain private')
console.log('Private hunt-photos bucket is available through Storage HTTP.')

const identities = []
const objectPaths = []

async function createIdentity(label) {
  const email = `snapquest-${label}-${randomUUID()}@example.test`
  const password = `${randomUUID()}Aa1!`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  assert.ifError(error)
  identities.push(data.user.id)
  const client = createClient(url, anonKey, authOptions)
  const { data: session, error: loginError } = await client.auth.signInWithPassword({ email, password })
  assert.ifError(loginError)
  assert.ok(session.session, `${label} should receive an authenticated session`)
  return client
}

async function expectDenied(operation, message) {
  const { error } = await operation()
  assert.ok(error, message)
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
    p_voting_enabled: false,
    p_bonus: 0,
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

  const { error: startNowError } = await organizer.rpc('start_game_now', { p_game_id: huntId })
  assert.ifError(startNowError)
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

  const concurrentPathOne = `${huntId}/${teamOne.team_id}/${firstItem.id}/${randomUUID()}.jpg`
  const concurrentPathTwo = `${huntId}/${teamOne.team_id}/${firstItem.id}/${randomUUID()}.jpg`
  for (const [client, path] of [[participantOne, concurrentPathOne], [participantOneConcurrent, concurrentPathTwo]]) {
    const { error } = await client.storage.from('hunt-photos').upload(path, jpeg, { contentType: 'image/jpeg' })
    assert.ifError(error)
    objectPaths.push(path)
  }
  const [raceOne, raceTwo] = await Promise.all([
    participantOne.rpc('submit_hunt_photo', {
      p_hunt_item_id: firstItem.id,
      p_storage_path: concurrentPathOne,
      p_expected_storage_path: replacePath,
    }),
    participantOneConcurrent.rpc('submit_hunt_photo', {
      p_hunt_item_id: firstItem.id,
      p_storage_path: concurrentPathTwo,
      p_expected_storage_path: replacePath,
    }),
  ])
  const raceResults = [raceOne, raceTwo]
  assert.equal(raceResults.filter((result) => !result.error).length, 1, 'Exactly one concurrent replacement should win')
  assert.equal(raceResults.filter((result) => result.error).length, 1, 'The stale concurrent replacement should be rejected')
  assert.equal(raceResults.find((result) => !result.error).data?.accepted, true)
  const { data: savedSubmission, error: savedSubmissionError } = await admin
    .from('submissions')
    .select('id,storage_path')
    .eq('hunt_id', huntId)
    .single()
  assert.ifError(savedSubmissionError)
  const winningPath = raceOne.error ? concurrentPathTwo : concurrentPathOne
  const losingPath = raceOne.error ? concurrentPathOne : concurrentPathTwo
  assert.equal(savedSubmission.storage_path, winningPath, 'The stored submission must match the one accepted replacement')
  const { error: staleCleanupError } = await participantOne.storage.from('hunt-photos').remove([losingPath])
  assert.ifError(staleCleanupError)
  await assertObjectMissing(losingPath, 'The rejected concurrent upload should be removable as unreferenced')
  objectPaths.splice(objectPaths.indexOf(losingPath), 1)
  const { error: replacedCleanupError } = await participantOne.storage.from('hunt-photos').remove([replacePath])
  assert.ifError(replacedCleanupError)
  await assertObjectMissing(replacePath, 'The prior version should be removable after concurrent replacement')
  objectPaths.splice(objectPaths.indexOf(replacePath), 1)
  console.log('Concurrent same-slot photo replacements serialize: exactly one succeeds, and only its path is referenced.')

  const { error: endHuntError } = await organizer.rpc('end_hunt_early', { p_hunt_id: huntId })
  assert.ifError(endHuntError)
  const [reviewRace, finalizeRace] = await Promise.all([
    organizer.rpc('review_submission', {
      p_submission_id: savedSubmission.id,
      p_decision: 'approved',
    }),
    organizerConcurrent.rpc('finalize_hunt', { p_hunt_id: huntId }),
  ])
  assert.ifError(reviewRace.error)
  if (finalizeRace.error) {
    assert.match(finalizeRace.error.message, /Review or reject every submitted photo before finalizing/)
  }
  console.log('Concurrent review/finalize preserves the pending-review guard and allows the decision to complete.')
  const [finalizeOne, finalizeTwo] = await Promise.all([
    organizer.rpc('finalize_hunt', { p_hunt_id: huntId }),
    organizerConcurrent.rpc('finalize_hunt', { p_hunt_id: huntId }),
  ])
  assert.ifError(finalizeOne.error)
  assert.ifError(finalizeTwo.error)
  assert.deepEqual(finalizeOne.data, finalizeTwo.data, 'Concurrent finalization should return the same immutable score snapshot')
  const { data: completedHunt, error: completedHuntError } = await admin
    .from('hunts')
    .select('status,final_scores')
    .eq('id', huntId)
    .single()
  assert.ifError(completedHuntError)
  assert.equal(completedHunt.status, 'completed')
  assert.deepEqual(completedHunt.final_scores, finalizeOne.data)
  const { error: closedReviewError } = await organizer.rpc('review_submission', {
    p_submission_id: savedSubmission.id,
    p_decision: 'rejected',
  })
  assert.ok(closedReviewError, 'A finalized hunt must reject further review changes')
  assert.match(closedReviewError.message, /Photo review is not open/)
  console.log('Concurrent finalization returns one immutable score snapshot and closes review decisions.')

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
