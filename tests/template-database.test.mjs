import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

let db, legacyBefore, templateId
const owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222'
const migrationUrl=new URL('../supabase/migrations/',import.meta.url)
let migration, managementMigration, auditMigration, timingAuditMigration, teamIdentityMigration, manualStartMigration, messageMigration, manualLobbySelfieMigration, reliabilityMigration, photoVersionMigration, inviteRecoveryMigration, inviteClosedMigration, chatRecoveryMigration
async function as(role, uid, sql, params=[]) {
  await db.exec(`set role ${role}`)
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid ?? ''])
    return await db.query(sql,params)
  } finally { await db.exec('reset role') }
}
before(async () => {
  db=new PGlite({extensions:{pgcrypto}})
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create schema storage; create schema extensions; create schema vault;
    create table vault.test_secrets(name text primary key,decrypted_secret text not null);
    create view vault.decrypted_secrets as select name,decrypted_secret from vault.test_secrets;
    create function vault.create_secret(new_secret text,new_name text default null,new_description text default '') returns uuid language plpgsql security definer set search_path='' as $$
      declare secret_id uuid:=gen_random_uuid(); begin insert into vault.test_secrets(name,decrypted_secret) values(new_name,new_secret); return secret_id; end $$;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;`)
  for(const file of (await readdir(migrationUrl)).filter(f=>f.endsWith('.sql')).sort()) {
    const sql=await readFile(new URL(file,migrationUrl),'utf8')
    if(file.includes('0007')) { migration=sql; continue }
    if(file.includes('0008')) { managementMigration=sql; continue }
    if(file.includes('0010')) { auditMigration=sql; continue }
    if(file.includes('0011')) { timingAuditMigration=sql; continue }
    if(file.includes('0012')) { teamIdentityMigration=sql; continue }
    if(file.includes('0013')) { manualStartMigration=sql; continue }
    if(file.includes('0014')) { messageMigration=sql; continue }
    if(file.includes('0015')) { manualLobbySelfieMigration=sql; continue }
    if(file.includes('0016')) { reliabilityMigration=sql; continue }
    if(file.includes('0017')) { photoVersionMigration=sql; continue }
    if(file.includes('0018')) { inviteRecoveryMigration=sql; continue }
    if(file.includes('0020')) { chatRecoveryMigration=sql; continue }
    if(file.includes('0022')) { inviteClosedMigration=sql; continue }
    await db.exec(sql)
  }
  await db.query('insert into auth.users(id) values ($1),($2)',[owner,other])
  await db.query('insert into public.organizers(id,auth_user_id) values ($1,$1),($2,$2)',[owner,other])
  await db.exec(`insert into public.hunts(id,organizer_id,title,venue,status,final_scores) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${owner}','Legacy game','Shop','completed','[{"total":7}]');
    insert into public.hunt_items(id,hunt_id,title_snapshot,point_value,display_order) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Legacy challenge',7,0);
    insert into public.teams(id,hunt_id,name,display_color,display_order) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Red','#ff0000',0),('dddddddd-dddd-4ddd-8ddd-dddddddddddd','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Blue','#0000ff',1);
    insert into public.participants(id,hunt_id,team_id,auth_user_id,display_name) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cccccccc-cccc-4ccc-8ccc-cccccccccccc','${owner}','Player');
    insert into public.submissions(hunt_id,hunt_item_id,team_id,participant_id,storage_path,approval_status) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','original/photo.jpg','approved');
    insert into public.hunt_votes(hunt_id,hunt_item_id,voting_team_id,selected_team_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','dddddddd-dddd-4ddd-8ddd-dddddddddddd','cccccccc-cccc-4ccc-8ccc-cccccccccccc');`)
  legacyBefore=await snapshot()
  await db.exec(migration)
  await db.exec(managementMigration)
  await db.exec(auditMigration)
  await db.exec(timingAuditMigration)
  await db.exec(teamIdentityMigration)
  await db.exec(manualStartMigration)
  await db.exec(messageMigration)
  await db.exec(manualLobbySelfieMigration)
  await db.exec(reliabilityMigration)
  await db.exec(photoVersionMigration)
  await db.exec(inviteRecoveryMigration)
  await db.exec(inviteClosedMigration)
  await db.exec(chatRecoveryMigration)
})
after(async()=> { await db?.close() })
async function snapshot() {
  const result={}
  for(const table of ['teams','participants','hunt_items','submissions','hunt_votes']) result[table]=(await db.query(`select to_jsonb(t) data from public.${table} t`)).rows
  result.game=(await db.query('select id,organizer_id,title,venue,status,final_scores from public.hunts')).rows
  return result
}
test('additive backfill is private, repeatable, and preserves historical games and child rows',async()=>{
  assert.deepEqual(await snapshot(),legacyBefore)
  await db.exec(migration)
  assert.deepEqual(await snapshot(),legacyBefore)
  assert.equal((await db.query('select count(*)::int n from public.hunt_templates')).rows[0].n,1)
  assert.equal((await as('anon',null,'select public.list_hunt_templates(false) data')).rows[0].data.length,0)
})
test('participants receive aggregate team progress without submission details',async()=>{
  const progress=(await as('authenticated',owner,'select public.get_hunt_progress($1) data',['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'])).rows[0].data
  assert.deepEqual(progress,[
    {team_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',team_name:'Red',display_color:'#ff0000',accepted_count:1,total_items:1},
    {team_id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',team_name:'Blue',display_color:'#0000ff',accepted_count:0,total_items:1},
  ])
  await assert.rejects(as('authenticated',other,'select public.get_hunt_progress($1)', ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']))
  await assert.rejects(as('anon',null,'select public.get_hunt_progress($1)', ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']))
})
test('organizer audit events record timing operations and stay owner-scoped',async()=>{
  assert.equal((await db.query("select to_regclass('public.audit_events') name")).rows[0].name,'audit_events')
  const legacy=(await db.query("select id from public.hunt_templates where legacy_game_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'")).rows[0].id
  const id=(await as('authenticated',owner,'select public.create_game_from_template($1) id',[legacy])).rows[0].id
  const definition=(await db.query("select pg_get_functiondef('public.start_game_now(uuid)'::regprocedure) definition")).rows[0].definition
  assert.match(definition,/audit_events/)
  await as('authenticated',owner,"select * from public.configure_game($1,'Audit game',60,array['Red','Blue'],'organizer',clock_timestamp()+interval '1 hour')",[id])
  await as('authenticated',owner,'select public.start_game_now($1)',[id])
  const raw=(await db.query('select event_type,outcome,details from public.audit_events where hunt_id=$1',[id])).rows
  assert.equal(raw.length,1)
  const events=(await as('authenticated',owner,'select public.list_hunt_audit_events($1) data',[id])).rows[0].data
  assert.equal(events[0].event_type,'game_start_now'); assert.equal(events[0].outcome,'success')
  assert.equal(events[0].details.duration_minutes,60)
  await assert.rejects(as('authenticated',other,"select public.record_audit_event('probe',$1,'notice','{}'::jsonb)",[id]))
})
test('timing transitions create owner-scoped audit events with authoritative details',async()=>{
  const localTemplate=(await as('authenticated',owner,"select public.save_hunt_template('Timing source','Shop','',array[]::text[],$1::jsonb,60,'personal') id",[JSON.stringify([{title:'Timing item'}])])).rows[0].id
  const id=(await as('authenticated',owner,'select public.create_game_from_template($1) id',[localTemplate])).rows[0].id
  await as('authenticated',owner,"select * from public.configure_game($1,'Timing audit',60,array['Red','Blue'],'organizer',clock_timestamp()+interval '1 hour')",[id])
  const original=(await db.query('select start_at from public.hunts where id=$1',[id])).rows[0].start_at
  const nextStart="clock_timestamp()+interval '2 hours'"
  await as('authenticated',owner,`select public.reschedule_game($1,${nextStart})`,[id])
  await as('authenticated',owner,'select public.start_game_now($1)',[id])
  await as('authenticated',owner,'select public.add_game_time($1,10)',[id])
  await as('authenticated',owner,'select public.end_hunt_early($1)',[id])
  const rows=(await db.query("select event_type,outcome,details from public.audit_events where hunt_id=$1 order by created_at",[id])).rows
  assert.deepEqual(rows.map(row=>row.event_type),['game_reschedule','game_start_now','game_time_added','game_end_early'])
  assert.ok(rows.every(row=>row.outcome==='success'))
  assert.equal(new Date(rows[0].details.previous_start_at).getTime(),new Date(original).getTime())
  assert.equal(rows[2].details.minutes_added,10)
  assert.equal(rows[3].details.previous_status,'active')
  await assert.rejects(as('authenticated',other,'select public.reschedule_game($1,clock_timestamp()+interval \'1 hour\')',[id]))
})
test('manual-start hunts hold a lobby until the organizer starts the timer',async()=>{
  const localTemplate=(await as('authenticated',owner,"select public.save_hunt_template('Manual source','Shop','',array[]::text[],$1::jsonb,60,'personal') id",[JSON.stringify([{title:'Manual item'}])])).rows[0].id
  const id=(await as('authenticated',owner,'select public.create_game_from_template($1) id',[localTemplate])).rows[0].id
  const invites=(await as('authenticated',owner,"select * from public.configure_game($1,'Manual game',60,array['Red','Blue'],'organizer',null)",[id])).rows
  const lobby=(await db.query('select status,start_at from public.hunts where id=$1',[id])).rows[0]
  assert.equal(lobby.status,'scheduled'); assert.equal(lobby.start_at,null)
  await as('authenticated',other,"select public.redeem_invitation($1,'Manual player')",[invites[0].invite_token])
  const manualParticipant=(await db.query('select * from public.participants where hunt_id=$1',[id])).rows[0]
  const manualSelfiePath=`${id}/${manualParticipant.team_id}/selfie/33333333-3333-4333-8333-333333333333.jpg`
  await db.query("insert into storage.objects(bucket_id,name) values('hunt-photos',$1)",[manualSelfiePath])
  await as('authenticated',other,'select public.submit_team_selfie($1,$2,$3)',[id,manualParticipant.team_id,manualSelfiePath])
  const before=(await as('authenticated',other,'select public.get_participant_context($1) data',[id])).rows[0].data
  assert.equal(before.runtime_state,'waiting'); assert.equal(before.start_at,null); assert.equal(before.ends_at,null)
  await as('authenticated',owner,'select public.start_game_now($1)',[id])
  const active=(await db.query('select status,start_at from public.hunts where id=$1',[id])).rows[0]
  assert.equal(active.status,'active'); assert.ok(active.start_at)
})
test('hunt lobby messages are shared by members and closed after review',async()=>{
  const localTemplate=(await as('authenticated',owner,"select public.save_hunt_template('Chat source','Shop','',array[]::text[],$1::jsonb,60,'personal') id",[JSON.stringify([{title:'Chat item'}])])).rows[0].id
  const id=(await as('authenticated',owner,'select public.create_game_from_template($1) id',[localTemplate])).rows[0].id
  const invites=(await as('authenticated',owner,"select * from public.configure_game($1,'Chat game',60,array['Red','Blue'],'organizer',null)",[id])).rows
  await as('authenticated',other,"select public.redeem_invitation($1,'Chat player')",[invites[0].invite_token])
  const organizerMessage=(await as('authenticated',owner,"select public.send_hunt_message($1,'Welcome team!') data",[id])).rows[0].data
  assert.equal(organizerMessage.sender_role,'organizer'); assert.equal(organizerMessage.sender_name,'SnapQuest organizer')
  const participantMessage=(await as('authenticated',other,"select public.send_hunt_message($1,'Ready to play') data",[id])).rows[0].data
  assert.equal(participantMessage.sender_role,'participant');
  const messages=(await as('authenticated',other,'select public.get_hunt_messages($1) data',[id])).rows[0].data
  assert.deepEqual(messages.map(message=>message.body),['Welcome team!','Ready to play'])
  const latest=(await as('authenticated',other,'select public.get_hunt_messages($1,1) data',[id])).rows[0].data
  assert.equal(latest.length,1); assert.equal(latest[0].body,'Ready to play')
  const older=(await as('authenticated',other,'select public.get_hunt_messages($1,1,$2::timestamptz) data',[id,latest[0].created_at])).rows[0].data
  assert.equal(older.length,1); assert.equal(older[0].body,'Welcome team!')
  for(let index=0;index<7;index++) await as('authenticated',owner,"select public.send_hunt_message($1,'Update')",[id])
  await assert.rejects(as('authenticated',owner,"select public.send_hunt_message($1,'Rate limit')",[id]),/Wait a minute/)
  await as('authenticated',owner,'select public.start_game_now($1)',[id])
  await as('authenticated',owner,'select public.end_hunt_early($1)',[id])
  await assert.rejects(as('authenticated',other,"select public.send_hunt_message($1,'Too late')",[id]))
})
test('owners can revise saved draft snapshots and cannot edit another or published hunt',async()=>{
  const draft=(await as('authenticated',owner,"select public.create_hunt_draft('Draft title','Old venue',array['Rule'], $1::jsonb,60) id",[JSON.stringify([{title:'Old prompt',pointValue:1}])])).rows[0].id
  await as('authenticated',owner,"select public.update_hunt_draft($1,'Updated title','New venue',array['New rule'],$2::jsonb,90)",[draft,JSON.stringify([{title:'Updated prompt',description:'Find it',pointValue:7}])])
  const result=(await db.query('select h.title,h.venue,h.rules,h.duration_minutes,i.title_snapshot,i.description_snapshot,i.point_value from public.hunts h join public.hunt_items i on i.hunt_id=h.id where h.id=$1',[draft])).rows[0]
  assert.deepEqual(result,{title:'Updated title',venue:'New venue',rules:['New rule'],duration_minutes:90,title_snapshot:'Updated prompt',description_snapshot:'Find it',point_value:7})
  await assert.rejects(as('authenticated',other,"select public.update_hunt_draft($1,'Nope','Shop',array[]::text[],$2::jsonb,60)",[draft,JSON.stringify([{title:'x'}])]),/Organizer access/)
  await db.query("update public.hunts set status='scheduled' where id=$1",[draft])
  await assert.rejects(as('authenticated',owner,"select public.update_hunt_draft($1,'Nope','Shop',array[]::text[],$2::jsonb,60)",[draft,JSON.stringify([{title:'x'}])]),/Only an unpublished draft/)
})
test('teams can choose a unique pre-start name and replace one private selfie',async()=>{
  const localTemplate=(await as('authenticated',owner,"select public.save_hunt_template('Identity source','Shop','',array[]::text[],$1::jsonb,60,'personal') id",[JSON.stringify([{title:'Identity item'}])])).rows[0].id
  const id=(await as('authenticated',owner,'select public.create_game_from_template($1) id',[localTemplate])).rows[0].id
  const invites=(await as('authenticated',owner,"select * from public.configure_game($1,'Identity game',60,array['Red','Blue'],'organizer',clock_timestamp()+interval '1 hour')",[id])).rows
  await as('authenticated',other,"select public.redeem_invitation($1,'Player')",[invites[0].invite_token])
  const participant=(await db.query('select * from public.participants where hunt_id=$1',[id])).rows[0]
  const teamId=participant.team_id
  const before=(await as('authenticated',other,'select public.get_participant_context($1) data',[id])).rows[0].data
  assert.equal(before.team.name,'Red'); assert.equal(before.team.selfie,null)
  await as('authenticated',other,"select public.set_team_name($1,$2,'Fireflies')",[id,teamId])
  const renamed=(await as('authenticated',other,'select public.get_participant_context($1) data',[id])).rows[0].data
  assert.equal(renamed.team.name,'Fireflies')
  await assert.rejects(as('authenticated',owner,"select public.set_team_name($1,$2,'Fireflies')",[id,invites[1].team_id]))
  const path1=`${id}/${teamId}/selfie/11111111-1111-4111-8111-111111111111.jpg`
  const path2=`${id}/${teamId}/selfie/22222222-2222-4222-8222-222222222222.jpg`
  await db.query("insert into storage.objects(bucket_id,name) values('hunt-photos',$1),('hunt-photos',$2)",[path1,path2])
  await as('authenticated',other,'select public.submit_team_selfie($1,$2,$3)',[id,teamId,path1])
  const replaced=(await as('authenticated',other,'select public.submit_team_selfie($1,$2,$3) data',[id,teamId,path2])).rows[0].data
  assert.equal(replaced.previous_storage_path,path1)
  assert.equal((await db.query('select count(*)::int n from public.team_selfies where hunt_id=$1 and team_id=$2',[id,teamId])).rows[0].n,1)
  const withSelfie=(await as('authenticated',other,'select public.get_participant_context($1) data',[id])).rows[0].data
  assert.equal(withSelfie.team.selfie.storage_path,path2); assert.equal(withSelfie.team.selfie.submitted_by,participant.id)
  await as('authenticated',owner,'select public.start_game_now($1)',[id])
  await assert.rejects(as('authenticated',other,"select public.set_team_name($1,$2,'Late name')",[id,teamId]))
  await assert.rejects(as('authenticated',other,'select public.submit_team_selfie($1,$2,$3)',[id,teamId,path1]))
})

async function createReliabilityHunt(name, startAt = null) {
  const template = (await as('authenticated', owner,
    "select public.save_hunt_template($1,'Test venue','',array[]::text[],$2::jsonb,60,'personal') id",
    [name, JSON.stringify([{ title: 'Secret challenge', points: 5 }])])).rows[0].id
  const huntId = (await as('authenticated', owner,
    'select public.create_game_from_template($1) id', [template])).rows[0].id
  const teams = await as('authenticated', owner,
    "select * from public.configure_game($1,$2,60,array['Red','Blue'],'organizer',$3)",
    [huntId, name, startAt])
  const participantData = (await as('authenticated', other,
    "select public.redeem_invitation($1,'Test player') data", [teams.rows[0].invite_token])).rows[0].data
  return { huntId, teams: teams.rows, participant: participantData }
}

test('manual-start participants cannot read the review gallery before the hunt starts', async () => {
  const { huntId } = await createReliabilityHunt('Closed manual lobby')
  await assert.rejects(
    as('authenticated', other, 'select public.get_hunt_review_gallery($1)', [huntId]),
    /gallery opens after the hunt ends/,
  )
  const hiddenTitle = await db.query('select title_snapshot from public.hunt_items where hunt_id=$1', [huntId])
  assert.equal(hiddenTitle.rows[0].title_snapshot, 'Secret challenge')
})

test('an expired hunt can enter photo review through the server-authoritative transition', async () => {
  const startsLater = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  const { huntId } = await createReliabilityHunt('Natural expiry review', startsLater)
  await db.query("update public.hunts set created_at=clock_timestamp()-interval '2 hours',start_at=clock_timestamp()-interval '61 minutes',status='active' where id=$1", [huntId])
  const gallery = (await as('authenticated', owner, 'select public.get_hunt_review_gallery($1) data', [huntId])).rows[0].data
  assert.equal(gallery.status, 'active')
  assert.equal(gallery.can_begin_review, true)
  await as('authenticated', owner, 'select public.begin_hunt_review($1)', [huntId])
  const transitioned = (await db.query('select status from public.hunts where id=$1', [huntId])).rows[0]
  assert.equal(transitioned.status, 'review')
})

test('moving a selfie submitter preserves the original team selfie and attribution', async () => {
  const startsLater = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  const { huntId, teams, participant } = await createReliabilityHunt('Selfie member move', startsLater)
  const selfiePath = `${huntId}/${participant.team_id}/selfie/33333333-3333-4333-8333-333333333333.jpg`
  await db.query("insert into storage.objects(bucket_id,name) values('hunt-photos',$1)", [selfiePath])
  await as('authenticated', other, 'select public.submit_team_selfie($1,$2,$3)', [huntId, participant.team_id, selfiePath])
  const targetTeam = teams.find(team => team.team_id !== participant.team_id).team_id
  await as('authenticated', owner, 'select public.move_participant($1,$2)', [participant.participant_id, targetTeam])
  const saved = (await db.query('select team_id,submitted_by,storage_path from public.team_selfies where hunt_id=$1', [huntId])).rows[0]
  assert.equal(saved.team_id, participant.team_id)
  assert.equal(saved.submitted_by, participant.participant_id)
  assert.equal(saved.storage_path, selfiePath)
  assert.equal((await db.query('select team_id from public.participants where id=$1', [participant.participant_id])).rows[0].team_id, targetTeam)
})

test('review writes stop at completion and finalization retries return the stored result', async () => {
  const submissionId = (await db.query("select id from public.submissions where storage_path='original/photo.jpg'")).rows[0].id
  const original = (await db.query("select approval_status from public.submissions where id=$1", [submissionId])).rows[0].approval_status
  const resultBefore = (await db.query("select final_scores from public.hunts where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'")).rows[0].final_scores
  await assert.rejects(as('authenticated', owner, 'select public.review_submission($1,\'rejected\')', [submissionId]), /Photo review is not open/)
  const retry = (await as('authenticated', owner, "select public.finalize_hunt('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') scores")).rows[0].scores
  assert.deepEqual(retry, resultBefore)
  assert.equal((await db.query('select approval_status from public.submissions where id=$1', [submissionId])).rows[0].approval_status, original)
})

test('ordinary Storage cleanup is denied for referenced photos and selfies', async () => {
  const startsLater = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  const { huntId, teams, participant } = await createReliabilityHunt('Protected media', startsLater)
  const teamId = participant.team_id
  const itemId = (await db.query('select id from public.hunt_items where hunt_id=$1', [huntId])).rows[0].id
  const selfiePath = `${huntId}/${teamId}/selfie/44444444-4444-4444-8444-444444444444.jpg`
  const photoPath = `${huntId}/${teamId}/${itemId}/55555555-5555-4555-8555-555555555555.jpg`
  await db.query("insert into storage.objects(bucket_id,name) values('hunt-photos',$1),('hunt-photos',$2)", [selfiePath, photoPath])
  await as('authenticated', other, 'select public.submit_team_selfie($1,$2,$3)', [huntId, teamId, selfiePath])
  await as('authenticated', owner, 'select public.start_game_now($1)', [huntId])
  await as('authenticated', other, 'select public.submit_hunt_photo($1,$2,null)', [itemId, photoPath])
  assert.equal((await as('authenticated', other, 'select public.can_delete_hunt_photo($1) allowed', [photoPath])).rows[0].allowed, false)
  assert.equal((await as('authenticated', other, 'select public.can_delete_team_selfie($1) allowed', [selfiePath])).rows[0].allowed, false)
  const unreferencedPath = `${huntId}/${teamId}/${itemId}/66666666-6666-4666-8666-666666666666.jpg`
  assert.equal((await as('authenticated', other, 'select public.can_delete_hunt_photo($1) allowed', [unreferencedPath])).rows[0].allowed, true)
  assert.equal(teams.length, 2)
})

test('invitation recovery returns encrypted owner-only links and never rotates legacy links implicitly', async () => {
  const startsLater = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  const { huntId, teams } = await createReliabilityHunt('Recoverable invitations', startsLater)
  const recovered = (await as('authenticated', owner, 'select public.get_hunt_invites($1) data', [huntId])).rows[0].data
  assert.equal(recovered.has_active_invites, true)
  assert.equal(recovered.recoverable, true)
  assert.deepEqual(recovered.invite_codes.map(code => code.team_id), teams.map(team => team.team_id))
  assert.deepEqual(recovered.invite_codes.map(code => code.invite_token), teams.map(team => team.invite_token))
  await assert.rejects(as('authenticated', other, 'select public.get_hunt_invites($1)', [huntId]), /Organizer access required/)

  const oldToken = recovered.invite_codes[0].invite_token
  await db.query("delete from private.invitation_token_secrets where invitation_id=(select id from public.invitations where token_hash=encode(extensions.digest($1,'sha256'),'hex'))", [oldToken])
  const incomplete = (await as('authenticated', owner, 'select public.get_hunt_invites($1) data', [huntId])).rows[0].data
  assert.equal(incomplete.has_active_invites, true)
  assert.equal(incomplete.recoverable, false)
  assert.deepEqual(incomplete.invite_codes, [])
  assert.ok((await as('anon', null, 'select public.preview_invitation($1) data', [oldToken])).rows[0].data)

  const replaced = await as('authenticated', owner, 'select * from public.regenerate_hunt_invites($1)', [huntId])
  assert.equal(replaced.rows.length, 2)
  assert.equal((await as('anon', null, 'select public.preview_invitation($1) data', [oldToken])).rows[0].data, null)
  const refreshed = (await as('authenticated', owner, 'select public.get_hunt_invites($1) data', [huntId])).rows[0].data
  assert.equal(refreshed.recoverable, true)
  assert.deepEqual(refreshed.invite_codes.map(code => code.invite_token), replaced.rows.map(row => row.invite_token))
  await db.query("update public.hunts set status='completed' where id=$1", [huntId])
  const closed = (await as('authenticated', owner, 'select public.get_hunt_invites($1) data', [huntId])).rows[0].data
  assert.equal(closed.has_active_invites, false)
  assert.deepEqual(closed.invite_codes, [])
})
test('organizer creates a public reusable hunt with safe creator attribution',async()=>{
  templateId=(await as('authenticated',owner,"select public.save_hunt_template('Public hunt','Park','Description',array['Be safe'],$1::jsonb) id",[JSON.stringify([{title:'A red item',points:2}])])).rows[0].id
  const docs=(await as('anon',null,'select public.list_hunt_templates(false) data')).rows[0].data
  assert.equal(docs.length,1); assert.equal(docs[0].challenges[0].points,2)
  assert.ok(docs[0].creatorId); assert.equal(docs[0].creatorName,'SnapQuest organizer')
  for(const key of ['organizer_id','auth_user_id','legacy_game_id','final_scores','storage_path']) assert.equal(key in docs[0],false)
})
test('public visitors and non-organizer identities cannot mutate templates or create games',async()=>{
  await assert.rejects(as('anon',null,'select * from public.hunt_templates'))
  await assert.rejects(as('anon',null,'select public.hunt_template_document($1)',[templateId]))
  await assert.rejects(as('anon',null,'select public.create_game_from_template($1)',[templateId]))
  await assert.rejects(as('authenticated',null,'select public.create_game_from_template($1)',[templateId]))
  assert.equal((await as('authenticated',other,'select * from public.hunt_templates')).rows.length,0)
  await assert.rejects(as('authenticated',other,"select public.save_hunt_template('Bad','Park','',array[]::text[],$1::jsonb,60,'public',$2)",[JSON.stringify([{title:'x'}]),templateId]))
})
test('personal copies are independently owned and absent from public discovery',async()=>{
  const copied=(await as('authenticated',other,'select public.copy_hunt_template($1) id',[templateId])).rows[0].id
  await as('authenticated',other,"select public.save_hunt_template('My copy','Garden','',array[]::text[],$1::jsonb,45,'personal',$2)",[JSON.stringify([{title:'Different item'}]),copied])
  const publicDocs=(await as('anon',null,'select public.list_hunt_templates(false) data')).rows[0].data
  assert.equal(publicDocs.length,1); assert.equal(publicDocs[0].title,'Public hunt')
  assert.equal(publicDocs[0].challenges[0].title,'A red item')
  const mine=(await as('authenticated',other,'select public.list_hunt_templates(true) data')).rows[0].data
  assert.equal(mine[0].visibility,'personal'); assert.equal(mine[0].title,'My copy')
  await assert.rejects(as('authenticated',owner,'select public.create_game_from_template($1)',[copied]))
  await assert.rejects(as('authenticated',owner,'select public.copy_hunt_template($1)',[copied]))
})
test('multiple games have independent item IDs and snapshots survive template edits',async()=>{
  const a=(await as('authenticated',owner,"select public.create_game_from_template($1,'Game A',90) id",[templateId])).rows[0].id
  const b=(await as('authenticated',other,"select public.create_game_from_template($1,'Game B') id",[templateId])).rows[0].id
  await as('authenticated',owner,"select public.save_hunt_template('Updated','Park','',array[]::text[],$1::jsonb,60,'public',$2)",[JSON.stringify([{title:'Changed'}]),templateId])
  const games=(await db.query('select id,duration_minutes,template_snapshot from public.hunts where id in ($1,$2)',[a,b])).rows
  assert.equal(games.length,2); assert.ok(games.every(g=>g.template_snapshot.title==='Public hunt'))
  const rows=(await db.query('select id,hunt_id,title_snapshot from public.hunt_items where hunt_id in ($1,$2)',[a,b])).rows
  assert.equal(rows.length,2); assert.notEqual(rows[0].id,rows[1].id); assert.ok(rows.every(r=>r.title_snapshot==='A red item'))
  assert.equal((await as('authenticated',owner,'select * from public.hunts where id=$1',[b])).rows.length,0)
})
test('invalid saves roll back atomically and direct writes cannot bypass RPC validation',async()=>{
  const before=(await db.query('select count(*)::int n from public.hunt_templates')).rows[0].n
  await assert.rejects(as('authenticated',owner,"select public.save_hunt_template('Invalid','Shop','',array[]::text[],$1::jsonb)",[JSON.stringify([{title:''}])]))
  assert.equal((await db.query('select count(*)::int n from public.hunt_templates')).rows[0].n,before)
  await assert.rejects(as('authenticated',owner,"update public.hunt_templates set visibility='public'"))
})
test('an anonymous-auth participant without an organizer profile has no template administration access',async()=>{
  const participant='33333333-3333-4333-8333-333333333333'
  await db.query('insert into auth.users(id) values($1)',[participant])
  await assert.rejects(as('authenticated',participant,'select public.list_hunt_templates(true)'))
  await assert.rejects(as('authenticated',participant,'select public.create_game_from_template($1)',[templateId]))
  assert.equal((await as('authenticated',participant,'select * from public.hunt_template_items')).rows.length,0)
})
test('a creator can choose a public display name without publishing Auth or organizer identifiers',async()=>{
  await as('authenticated',owner,"select public.set_hunt_creator_name('Family Adventures')")
  const docs=(await as('anon',null,'select public.list_hunt_templates(false) data')).rows[0].data
  assert.equal(docs[0].creatorName,'Family Adventures')
  assert.notEqual(docs[0].creatorId,owner)
  await assert.rejects(as('anon',null,'select * from public.hunt_creator_profiles'))
})
test('rerunning the backfill after editing a legacy template does not restore deleted challenges',async()=>{
  const legacy=(await db.query("select id from public.hunt_templates where legacy_game_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'")).rows[0].id
  await as('authenticated',owner,"select public.save_hunt_template('Edited legacy','Shop','',array[]::text[],$1::jsonb,60,'personal',$2)",[JSON.stringify([{title:'New first'},{title:'New second'}]),legacy])
  await db.exec(migration)
  const challenges=(await db.query('select title from public.hunt_template_items where template_id=$1 order by display_order',[legacy])).rows
  assert.deepEqual(challenges.map(c=>c.title),['New first','New second'])
  const original=(await db.query("select title_snapshot from public.hunt_items where hunt_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'")).rows[0]
  assert.equal(original.title_snapshot,'Legacy challenge')
})

async function newGame() {
  return (await as('authenticated',owner,'select public.create_game_from_template($1) id',[templateId])).rows[0].id
}
test('legacy draft creation still works through its checked RPC after raw game writes are removed',async()=>{
  const result=await as('authenticated',owner,"select public.create_hunt_draft('Legacy flow','Shop',array['Stay safe'],$1::jsonb,60) id",[JSON.stringify([{title:'An item',pointValue:1}])])
  assert.ok(result.rows[0].id)
  await assert.rejects(as('authenticated',owner,"update public.hunts set duration_minutes=100"))
})
test('game setup preserves assigned-team QR security and validates setup atomically',async()=>{
  const id=await newGame()
  await assert.rejects(as('authenticated',owner,"select * from public.configure_game($1,'Bad',60,array['Same','same'],'organizer',clock_timestamp()+interval '1 hour')",[id]))
  assert.equal((await db.query('select status from public.hunts where id=$1',[id])).rows[0].status,'draft')
  const codes=(await as('authenticated',owner,"select * from public.configure_game($1,'Family night',90,array['Red','Blue'],'organizer',clock_timestamp()+interval '1 hour',false,true,3)",[id])).rows
  assert.equal(codes.length,2); assert.ok(codes.every(c=>/^[0-9a-f]{64}$/.test(c.invite_token)))
  const hashed=(await db.query('select token_hash from public.invitations where hunt_id=$1',[id])).rows
  assert.ok(hashed.every(row=>!codes.some(c=>c.invite_token===row.token_hash)))
  await assert.rejects(as('authenticated',other,'select public.start_game_now($1)',[id]))
  await assert.rejects(as('anon',null,'select public.get_game_lobby($1)',[id]))
  const joined=(await as('authenticated',other,'select public.redeem_invitation($1,$2) data',[codes[0].invite_token,'Alex'])).rows[0].data
  assert.ok(joined)
  const before=(await as('authenticated',other,'select public.get_participant_context($1) data',[id])).rows[0].data
  assert.equal(before.runtime_state,'waiting')
  await as('authenticated',owner,"select public.reschedule_game($1,clock_timestamp()+interval '2 hours')",[id])
  const after=(await as('authenticated',other,'select public.get_participant_context($1) data',[id])).rows[0].data
  assert.notEqual(after.start_at,before.start_at)
  assert.equal((await as('authenticated',owner,'select public.get_game_lobby($1) data',[id])).rows[0].data.players.length,1)
  await as('authenticated',owner,'select public.start_game_now($1)',[id])
  const active=(await as('authenticated',other,'select public.get_participant_context($1) data',[id])).rows[0].data
  assert.equal(active.runtime_state,'active')
  await as('authenticated',owner,'select public.add_game_time($1,10)',[id])
  const extended=(await as('authenticated',other,'select public.get_participant_context($1) data',[id])).rows[0].data
  assert.equal(Date.parse(extended.ends_at)-Date.parse(active.ends_at),600000)
  assert.equal(extended.start_at,active.start_at)
  await assert.rejects(as('authenticated',other,'select public.add_game_time($1,10)',[id]))
  await assert.rejects(as('authenticated',owner,'select public.start_game_now($1)',[id]))
  await assert.rejects(as('authenticated',owner,"select public.reschedule_game($1,clock_timestamp()+interval '1 day')",[id]))
  await as('authenticated',owner,'select public.end_hunt_early($1)',[id])
  await assert.rejects(as('authenticated',owner,'select public.add_game_time($1,10)',[id]))
})
test('immediate setup and balanced random invitations keep participant assignments stable',async()=>{
  const id=await newGame()
  const codes=(await as('authenticated',owner,"select * from public.configure_game($1,'Immediate',60,array['Green','Gold'],'balanced',null,true)",[id])).rows
  assert.equal(codes.length,1); assert.equal(codes[0].team_id,null)
  assert.equal((await as('authenticated',owner,'select public.get_game_lobby($1) data',[id])).rows[0].data.runtime_state,'active')
  await as('authenticated',other,"select public.redeem_invitation($1,'Taylor')",[codes[0].invite_token])
  const a=(await as('authenticated',other,'select public.get_participant_context($1) data',[id])).rows[0].data
  await as('authenticated',other,"select public.redeem_invitation($1,'Taylor')",[codes[0].invite_token])
  const b=(await as('authenticated',other,'select public.get_participant_context($1) data',[id])).rows[0].data
  assert.equal(a.team.id,b.team.id);assert.equal(a.participant_id,b.participant_id)
  await assert.rejects(as('authenticated',owner,'select public.add_game_time($1,0)',[id]))
  await assert.rejects(as('authenticated',owner,'select public.add_game_time($1,121)',[id]))
})
test('expired games cannot be extended or restarted and the migration is repeatable',async()=>{
  const id=await newGame()
  await db.query("update public.hunts set created_at=clock_timestamp()-interval '2 days',start_at=clock_timestamp()-interval '2 hours',status='active',duration_minutes=30 where id=$1",[id])
  await assert.rejects(as('authenticated',owner,'select public.add_game_time($1,5)',[id]))
  await assert.rejects(as('authenticated',owner,'select public.start_game_now($1)',[id]))
  await db.exec(managementMigration)
  assert.equal((await as('authenticated',owner,'select public.get_game_lobby($1) data',[id])).rows[0].data.runtime_state,'ended')
})
test('timing changes preserve photo acceptance, replacement, attribution and closed deadlines',async()=>{
  const id=await newGame()
  const token=(await as('authenticated',owner,"select * from public.configure_game($1,'Photo game',60,array['Red','Blue'],'organizer',clock_timestamp()+interval '1 hour')",[id])).rows[0].invite_token
  await as('authenticated',other,"select public.redeem_invitation($1,'Photographer')",[token])
  const participant=(await db.query('select * from public.participants where hunt_id=$1',[id])).rows[0]
  const item=(await db.query('select id from public.hunt_items where hunt_id=$1 limit 1',[id])).rows[0].id
  const path1=`${id}/${participant.team_id}/${item}/11111111-1111-4111-8111-111111111111.jpg`
  const path2=`${id}/${participant.team_id}/${item}/22222222-2222-4222-8222-222222222222.jpg`
  await db.query("insert into storage.objects(bucket_id,name) values('hunt-photos',$1),('hunt-photos',$2)",[path1,path2])
  await assert.rejects(as('authenticated',other,'select public.submit_hunt_photo($1,$2,null)',[item,path1]))
  await as('authenticated',owner,'select public.start_game_now($1)',[id])
  await as('authenticated',other,'select public.submit_hunt_photo($1,$2,null)',[item,path1])
  const replaced=(await as('authenticated',other,'select public.submit_hunt_photo($1,$2,$3) data',[item,path2,path1])).rows[0].data
  assert.equal(replaced.previous_storage_path,path1)
  const stalePath=`${id}/${participant.team_id}/${item}/33333333-3333-4333-8333-333333333333.jpg`
  await db.query("insert into storage.objects(bucket_id,name) values('hunt-photos',$1)",[stalePath])
  await assert.rejects(as('authenticated',other,'select public.submit_hunt_photo($1,$2,$3)',[item,stalePath,path1]),/teammate changed this photo slot/)
  assert.equal((await db.query('select storage_path from public.submissions where hunt_id=$1',[id])).rows[0].storage_path,path2)
  const rows=(await db.query('select * from public.submissions where hunt_id=$1',[id])).rows
  assert.equal(rows.length,1);assert.equal(rows[0].participant_id,participant.id)
  await as('authenticated',owner,'select public.end_hunt_early($1)',[id])
  await assert.rejects(as('authenticated',other,'select public.submit_hunt_photo($1,$2,null)',[item,path1]))
})


test('permanent-account rejoin preserves membership across other-team QR, rotation and game closeout',async()=>{
  const id=await newGame()
  const invites=(await as('authenticated',owner,"select * from public.configure_game($1,'Rejoin game',60,array['Red','Blue'],'organizer',clock_timestamp()+interval '1 hour')",[id])).rows
  const first=(await as('authenticated',owner,"select public.redeem_invitation($1,'Host') data",[invites[0].invite_token])).rows[0].data
  const repeated=(await as('authenticated',owner,"select public.redeem_invitation($1,'') data",[invites[1].invite_token])).rows[0].data
  assert.equal(repeated.participant_id,first.participant_id)
  assert.equal(repeated.team_id,first.team_id)
  await as('authenticated',other,"select public.redeem_invitation($1,'Visiting organizer')",[invites[1].invite_token])
  await assert.rejects(as('authenticated',other,'select public.start_game_now($1)',[id]))
  await as('authenticated',owner,'select public.regenerate_hunt_invites($1)',[id])
  await as('authenticated',owner,'select public.end_hunt_early($1)',[id])
  const resumed=(await as('authenticated',owner,"select public.redeem_invitation($1,'') data",[invites[0].invite_token])).rows[0].data
  assert.equal(resumed.participant_id,first.participant_id)
  assert.equal(resumed.team_id,first.team_id)
  const context=(await as('authenticated',owner,'select public.get_participant_context($1) data',[id])).rows[0].data
  assert.equal(context.runtime_state,'review')
  assert.equal((await db.query('select count(*)::int n from public.participants where hunt_id=$1 and auth_user_id=$2',[id,owner])).rows[0].n,1)
})
