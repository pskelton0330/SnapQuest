import test from 'node:test'
import assert from 'node:assert/strict'
import { configureLocalGame, applyGameCommand, joinLocalGame, gameRuntime, gameDeadline, countdown } from '../src/lib/gameManagement.ts'
import { sampleWorkspace, createLocalWorkspaceRepository } from '../src/lib/workspace.ts'
const now=Date.parse('2026-10-29T12:00:00Z')
let index=0
const id=()=>`test-${++index}`
const draft=()=>({...sampleWorkspace().games[0],id:'draft',status:'setup',startAt:null})
const setup=()=>({name:'Family game',duration:60,teamNames:['Red','Blue'],assignment:'organizer',startAt:new Date(now+3600000).toISOString(),voting:true,bonus:3})
test('setup validates bounds and preserves independent per-game settings',()=>{
  const g=draft(), configured=configureLocalGame(g,setup(),now,id)
  assert.equal(configured.teams.length,2);assert.equal(configured.invites.length,2)
  assert.equal(configured.votingBonus,3);assert.equal(g.status,'setup')
  assert.throws(()=>configureLocalGame(g,{...setup(),teamNames:['Red','red']},now,id))
  assert.throws(()=>configureLocalGame(g,{...setup(),duration:4},now,id))
  assert.throws(()=>configureLocalGame(g,{...setup(),startAt:new Date(now).toISOString()},now,id))
  assert.throws(()=>configureLocalGame(g,{...setup(),bonus:1.5},now,id))
})
test('reschedule and Start Now preserve roster/invites and recompute deadline correctly',()=>{
  const scheduled=configureLocalGame(draft(),setup(),now,id)
  const joined=joinLocalGame(scheduled,scheduled.invites[0].token,'Alex',now,id)
  const shifted=applyGameCommand(joined,{type:'reschedule',startAt:new Date(now+7200000).toISOString()},now,id)
  assert.equal(gameRuntime(shifted,now),'scheduled');assert.deepEqual(shifted.players,joined.players)
  const active=applyGameCommand(shifted,{type:'start'},now+1000,id)
  assert.equal(gameDeadline(active),now+1000+3600000);assert.deepEqual(active.invites,scheduled.invites)
  assert.throws(()=>applyGameCommand(active,{type:'start'},now+1000,id))
  assert.throws(()=>applyGameCommand(active,{type:'reschedule',startAt:new Date(now+7200000).toISOString()},now+1000,id))
})
test('scheduled transitions follow the clock, extensions cannot revive an expired game',()=>{
  const scheduled=configureLocalGame(draft(),setup(),now,id), start=Date.parse(scheduled.startAt)
  assert.equal(gameRuntime(scheduled,start-1),'scheduled');assert.equal(gameRuntime(scheduled,start),'active')
  const extended=applyGameCommand(scheduled,{type:'extend',minutes:10},start+1,id)
  assert.equal(gameDeadline(extended)-gameDeadline(scheduled),600000)
  assert.equal(extended.startAt,scheduled.startAt)
  for(const minutes of [0,-1,121,1.5]) assert.throws(()=>applyGameCommand(extended,{type:'extend',minutes},start+1,id))
  assert.throws(()=>applyGameCommand(scheduled,{type:'extend',minutes:5},gameDeadline(scheduled),id))
  const ended=applyGameCommand(extended,{type:'end'},start+100,id)
  assert.equal(gameRuntime(ended,start+100),'review');assert.throws(()=>applyGameCommand(ended,{type:'extend',minutes:5},start+100,id))
  assert.equal(countdown(-100),'00:00:00')
})
test('balanced preview assigns least-populated teams and rotation preserves existing players',()=>{
  let g=configureLocalGame(draft(),{...setup(),assignment:'balanced'},now,id)
  const token=g.invites[0].token
  for(let i=0;i<9;i++)g=joinLocalGame(g,token,`Player ${i}`,now,id,()=>.99)
  const sizes=g.teams.map(t=>g.players.filter(p=>p.teamId===t.id).length)
  assert.equal(Math.max(...sizes)-Math.min(...sizes),1)
  const rotated=applyGameCommand(g,{type:'rotate'},now,id)
  assert.deepEqual(rotated.players,g.players);assert.notEqual(rotated.invites[0].token,token)
  assert.throws(()=>joinLocalGame(rotated,token,'Late',now,id))
})
test('immediate setup starts atomically and configured data survives repository reload',async()=>{
  const store=new Map(),storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)}
  const repo=createLocalWorkspaceRepository(storage,()=>now)
  await repo.createGame('sample-craft','g',new Date(now).toISOString(),'now')
  const active=await repo.configureGame('g',{...setup(),startNow:true})
  assert.equal(gameRuntime(active,now),'active');assert.equal(active.startAt,new Date(now).toISOString())
  const loaded=(await createLocalWorkspaceRepository(storage).load()).games.find(g=>g.id==='g')
  assert.deepEqual(loaded,active)
  await repo.commandGame('g',{type:'extend',minutes:5})
  assert.equal((await repo.load()).games.find(g=>g.id==='g').duration,65)
})
