import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'

const url = process.env.API_URL
const serviceRoleKey = process.env.SERVICE_ROLE_KEY
assert.ok(url, 'Supabase CLI did not export API_URL')
assert.ok(serviceRoleKey, 'Supabase CLI did not export SERVICE_ROLE_KEY')

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
const { data: bucket, error: bucketError } = await admin.storage.getBucket('hunt-photos')
assert.ifError(bucketError)
assert.equal(bucket?.public, false, 'hunt-photos must remain private')
console.log('Private hunt-photos bucket is available through Storage HTTP.')

const { error: startError } = await admin.rpc('start_game_now', { p_game_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })
assert.ok(startError, 'start_game_now must reject a service-role request without an organizer session')
assert.match(startError.message, /Organizer access required/)
console.log('start_game_now is installed and enforces its organizer boundary through PostgREST.')
