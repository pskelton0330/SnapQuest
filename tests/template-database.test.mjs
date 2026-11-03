import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

let db, legacyBefore, templateId
const owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222'
const migrationUrl=new URL('../supabase/migrations/',import.meta.url)
let migration, managementMigration
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
    create schema auth; create schema storage; create schema extensions;
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
  await assert.rejects(as('authenticated',other,'select public.submit_hunt_photo($1,$2)',[item,path1]))
  await as('authenticated',owner,'select public.start_game_now($1)',[id])
  await as('authenticated',other,'select public.submit_hunt_photo($1,$2)',[item,path1])
  const replaced=(await as('authenticated',other,'select public.submit_hunt_photo($1,$2) data',[item,path2])).rows[0].data
  assert.equal(replaced.previous_storage_path,path1)
  const rows=(await db.query('select * from public.submissions where hunt_id=$1',[id])).rows
  assert.equal(rows.length,1);assert.equal(rows[0].participant_id,participant.id)
  await as('authenticated',owner,'select public.end_hunt_early($1)',[id])
  await assert.rejects(as('authenticated',other,'select public.submit_hunt_photo($1,$2)',[item,path1]))
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
