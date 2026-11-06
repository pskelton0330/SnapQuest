// Local-only review evidence. No credentials, network requests, or production writes.
// Run: node --experimental-strip-types docs/reviews/2026-11-06-probes.mjs
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFile, readdir } from 'node:fs/promises'
import { calculateTeamScores } from '../../src/lib/scoring.ts'
const db = new PGlite({ extensions: { pgcrypto } })
const owner = '11111111-1111-4111-8111-111111111111'
const guest = '22222222-2222-4222-8222-222222222222'
async function as(uid, sql, params = []) {
  await db.exec('set role authenticated')
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid])
    return await db.query(sql, params)
  } finally { await db.exec('reset role') }
}
function log(name, evidence) { console.log(JSON.stringify({ name, evidence })) }
try {
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create schema storage; create schema extensions;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;`)
  const migrations = new URL('../../supabase/migrations/', import.meta.url)
  for (const file of (await readdir(migrations)).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(file, migrations), 'utf8'))
  }
  await db.query('insert into auth.users values($1),($2)', [owner, guest])
  await db.query('insert into public.organizers(id,auth_user_id) values($1,$1)', [owner])
  const template = (await as(owner, "select public.save_hunt_template('Review probes','Shop','',array[]::text[],$1::jsonb,60,'personal') id", [JSON.stringify([{ title: 'Item', points: 5 }])])).rows[0].id
  const hunt = (await as(owner, 'select public.create_game_from_template($1) id', [template])).rows[0].id
  const invites = (await as(owner, "select * from public.configure_game($1,'Probe hunt',60,array['Red','Blue'],'organizer',null)", [hunt])).rows
  await as(guest, "select public.redeem_invitation($1,'Guest')", [invites[0].invite_token])
  const member = (await db.query('select * from public.participants where hunt_id=$1', [hunt])).rows[0]
  const item = (await db.query('select id from public.hunt_items where hunt_id=$1', [hunt])).rows[0].id
  const path = `${hunt}/${member.team_id}/selfie/33333333-3333-4333-8333-333333333333.jpg`
  const earlyGallery = (await as(guest, 'select public.get_hunt_review_gallery($1) data', [hunt])).rows[0].data
  log('manual lobby can access hidden challenges via gallery RPC', { status: earlyGallery.status, revealedItems: earlyGallery.items.length })
  await db.query("insert into storage.objects(bucket_id,name) values('hunt-photos',$1)", [path])
  await as(guest, 'select public.submit_team_selfie($1,$2,$3)', [hunt, member.team_id, path])
  try {
    await as(owner, 'select public.move_participant($1,$2)', [member.id, invites[1].team_id])
    log('move selfie submitter', 'unexpectedly succeeded; recheck finding')
  } catch (error) { log('move selfie submitter fails', { code: error.code, message: error.message }) }
  await as(owner, 'select public.start_game_now($1)', [hunt])
  const photoPath = `${hunt}/${member.team_id}/${item}/44444444-4444-4444-8444-444444444444.jpg`
  await db.query("insert into storage.objects(bucket_id,name) values('hunt-photos',$1)", [photoPath])
  await as(guest, 'select public.submit_hunt_photo($1,$2)', [item, photoPath])
  const submission = (await db.query('select id from public.submissions where hunt_id=$1', [hunt])).rows[0].id
  // Model the passage of time in the isolated fixture, not in production.
  await db.query("update public.hunts set created_at=clock_timestamp()-interval '2 hours',start_at=clock_timestamp()-interval '61 minutes' where id=$1", [hunt])
  const expiredGallery = (await as(owner, 'select public.get_hunt_review_gallery($1) data', [hunt])).rows[0].data
  log('timer expiry leaves persisted status active', { status: expiredGallery.status, pending: expiredGallery.submissions[0].status })
  await as(owner, 'select public.begin_hunt_review($1)', [hunt])
  await as(owner, "select public.review_submission($1,'approved')", [submission])
  await as(owner, 'select public.finalize_hunt($1)', [hunt])
  await as(owner, "select public.review_submission($1,'rejected')", [submission])
  const drift = (await db.query('select approval_status,final_scores from public.submissions s join public.hunts h on h.id=s.hunt_id where s.id=$1', [submission])).rows[0]
  log('completed review can mutate without changing stored final scores', { status: drift.approval_status, storedScore: drift.final_scores.find(r => r.team_id === member.team_id).total })
  log('participant can delete a referenced finalized photo', (await as(guest, 'select public.can_delete_hunt_photo($1) allowed', [photoPath])).rows[0])
  const teams = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]
  const approved = teams.slice(0, 2).map(t => ({ teamId: t.id, itemId: 'i', approvalStatus: 'approved' }))
  log('display ranking uses competition rather than dense ranks', calculateTeamScores(teams, [{ id: 'i', pointValue: 5 }], approved).map(r => r.rank))
  log('raw gallery vote keys ignored by score helper', calculateTeamScores(teams, [{ id: 'i', pointValue: 5 }], approved, [{ item_id: 'i', voting_team_id: 'b', selected_team_id: 'a' }], 3).find(r => r.teamId === 'a').votingBonus)
} finally { await db.close() }
