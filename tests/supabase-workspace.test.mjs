import test from 'node:test'
import assert from 'node:assert/strict'
import { mapGameRow, createSupabaseWorkspaceRepository } from '../src/lib/supabaseWorkspace.ts'
import { sampleWorkspace, createLocalWorkspaceRepository, LOCAL_CREATOR } from '../src/lib/workspace.ts'

test('legacy draft games retain their snapshots and map to the setup screen',()=>{
  const row={id:'legacy',template_id:null,title:'Game',venue:'Shop',description:null,rules:[],status:'draft',start_at:null,duration_minutes:45,created_at:'2026-01-01',template_snapshot:null}
  const game=mapGameRow(row,[{id:'item',hunt_id:'legacy',title_snapshot:'Original',description_snapshot:null,point_value:3}])
  assert.equal(game.status,'setup'); assert.equal(game.templateId,null)
  assert.equal(game.huntSnapshot.challenges[0].title,'Original'); assert.equal(game.duration,45)
  const snapshot=sampleWorkspace().hunts[0]
  assert.deepEqual(mapGameRow({...row,template_id:snapshot.id,template_snapshot:snapshot}).huntSnapshot,snapshot)
})
test('local customize creates a personal independent copy and preserves original',async()=>{
  const store=new Map()
  const repo=createLocalWorkspaceRepository({getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value)})
  const original=(await repo.load()).hunts[0]
  const copy=await repo.copyHunt(original.id,'personal-copy','2026-10-29')
  assert.equal(copy.creatorId,LOCAL_CREATOR); assert.equal(copy.visibility,'personal')
  assert.notEqual(copy.challenges[0].id,original.challenges[0].id)
  copy.challenges[0].title='Customized'
  await repo.saveHunt(copy)
  assert.deepEqual((await repo.load()).hunts.find(h=>h.id===original.id),original)
})
test('Supabase adapter returns the server-assigned hunt identity after a new save',async()=>{
  let owned=[]
  const hunt={...sampleWorkspace().hunts[0],id:'browser-id'}
  const client={rpc:async(name,args)=>{
    if(name==='list_hunt_templates') return {data:owned,error:null}
    assert.equal(name,'save_hunt_template'); assert.equal(args.p_template_id,null)
    owned=[{...hunt,id:'server-id'}]
    return {data:'server-id',error:null}
  }}
  const saved=await createSupabaseWorkspaceRepository(client,'organizer').saveHunt(hunt)
  assert.equal(saved.id,'server-id')
})
