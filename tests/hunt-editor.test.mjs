import test from 'node:test'
import assert from 'node:assert/strict'
import { importChallenges, moveChallenge, validateHuntDraft, discoverHunts, completedPlayCounts } from '../src/lib/huntEditor.ts'
import { sampleWorkspace, createLocalWorkspaceRepository, LOCAL_CREATOR } from '../src/lib/workspace.ts'

test('bulk import handles pasted numbered and bullet lists, blanks, CRLF, and preserves meaningful duplicates',()=>{
  let id=0
  const imported=importChallenges('1. Red item\r\n\r\n• Flamingo\n- Wood\n* Team selfie\n5) Funny sign\nRed item',[],()=>String(++id),true)
  assert.deepEqual(imported.map(c=>c.title),['Red item','Flamingo','Wood','Team selfie','Funny sign','Red item'])
  assert.ok(imported.every(c=>c.points===1)); assert.equal(new Set(imported.map(c=>c.id)).size,6)
})
test('oversized imports and invalid lines fail atomically without changing existing items',()=>{
  const existing=sampleWorkspace().hunts[0].challenges
  const original=structuredClone(existing)
  assert.throws(()=>importChallenges('x'.repeat(121),existing,()=>''))
  assert.throws(()=>importChallenges(Array(100).fill('item').join('\n'),existing,()=>''))
  assert.throws(()=>importChallenges('\n  ',existing,()=>''))
  assert.deepEqual(existing,original)
})
test('reordering keeps identity, instructions and points together and respects boundaries',()=>{
  const items=sampleWorkspace().hunts[0].challenges
  items[0].points=8; items[0].description='Keep this instruction'
  const moved=moveChallenge(items,0,1)
  assert.deepEqual(moved[1],items[0]); assert.notEqual(moved,items)
  assert.equal(moveChallenge(items,0,-1),items)
  assert.equal(moveChallenge(items,items.length-1,1),items)
})
test('review validation catches empty challenges, fractional points and duration boundaries',()=>{
  const hunt=sampleWorkspace().hunts[0]
  assert.equal(validateHuntDraft(hunt),null)
  assert.ok(validateHuntDraft({...hunt,challenges:[]}))
  assert.equal(validateHuntDraft({...hunt,challenges:[]},true),null)
  assert.ok(validateHuntDraft({...hunt,defaultDuration:4}))
  assert.ok(validateHuntDraft({...hunt,challenges:[{...hunt.challenges[0],points:1.5}]}))
  assert.ok(validateHuntDraft({...hunt,challenges:[{...hunt.challenges[0],title:'  '}]}))
})
test('discovery combines title, venue and creator filters and uses completed games only for popularity',()=>{
  const {hunts,games}=sampleWorkspace()
  const filters={search:'',venue:'',creator:'',sort:'popular'}
  assert.equal(discoverHunts(hunts,games,filters)[0].id,'sample-park')
  assert.equal(discoverHunts(hunts,games,{...filters,search:'  CRAFT  ',venue:'Craft store',creator:'sample-creator'}).length,1)
  assert.equal(discoverHunts(hunts,games,{...filters,venue:'Missing'}).length,0)
  assert.equal(discoverHunts(hunts,games,{...filters,creator:LOCAL_CREATOR})[0].id,'sample-family')
  assert.equal(completedPlayCounts([...games,games[1]]).get('sample-park'),1)
  const newest={...hunts[0],id:'new',createdAt:'2027-01-01T00:00:00Z'}
  assert.equal(discoverHunts([...hunts,newest],games,{...filters,sort:'newest'})[0].id,'new')
})
test('editing a saved personal copy preserves its privacy, order, points, and existing game snapshots',async()=>{
  const storage=new Map(), repo=createLocalWorkspaceRepository({getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)})
  const original=(await repo.load()).hunts[0]
  const copy=await repo.copyHunt(original.id,'copy','2026-10-29')
  await repo.createGame(copy.id,'game','2026-10-29')
  copy.challenges=moveChallenge(copy.challenges,0,1); copy.challenges[0].points=7; copy.title='My custom hunt'
  await repo.saveHunt(copy)
  const data=await repo.load()
  assert.equal(data.hunts.find(h=>h.id==='copy').visibility,'personal')
  assert.equal(data.hunts.find(h=>h.id==='copy').challenges[0].points,7)
  assert.deepEqual(data.hunts.find(h=>h.id===original.id),original)
  assert.notEqual(data.games.find(g=>g.id==='game').huntSnapshot.title,copy.title)
})

test('bulk import preserves meaningful numbering and punctuation by default',()=>{
  const rows=importChallenges('  3. Find three birds  \n- Follow this clue\n\n* A star-shaped item',[],()=>crypto.randomUUID())
  assert.deepEqual(rows.map(c=>c.title),['3. Find three birds','- Follow this clue','* A star-shaped item'])
  assert.equal(importChallenges('1. A clue',[],()=> 'id',true)[0].title,'A clue')
})
