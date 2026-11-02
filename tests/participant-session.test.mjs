import test from 'node:test'
import assert from 'node:assert/strict'
import { restoreParticipantSession, resumeInvitation, joinInvitation } from '../src/lib/participantSession.ts'

function fixture(session = null) {
  const calls=[]
  const result={hunt_id:'game',participant_id:'member',title:'Hunt'}
  const client={auth:{
    async getSession(){calls.push('restore');return {data:{session},error:null}},
    async signInAnonymously(){calls.push('anonymous');session={user:{id:'guest',is_anonymous:true}};return {data:{session},error:null}},
  },async rpc(name,args){calls.push({name,args});return {data:result,error:null}}}
  return {client,calls,result}
}

test('permanent and guest identities are restored before joining without replacement',async()=>{
  for(const anonymous of [false,true]) {
    const session={user:{id:'existing',is_anonymous:anonymous}}, f=fixture(session)
    assert.equal(await restoreParticipantSession(f.client,true),session)
    assert.deepEqual(await joinInvitation(f.client,'invite','  Pat  '),f.result)
    assert.equal(f.calls.includes('anonymous'),false)
    assert.equal(f.calls[2].args.p_display_name,'Pat')
  }
})

test('automatic rejoin probes existing membership for permanent identities without a name',async()=>{
  const f=fixture({user:{id:'host',is_anonymous:false}})
  assert.deepEqual(await resumeInvitation(f.client,'invite'),f.result)
  assert.deepEqual(f.calls,['restore',{name:'redeem_invitation',args:{p_token:'invite',p_display_name:''}}])
})

test('signed-out inspection creates no identity; explicit join restores before guest creation',async()=>{
  const f=fixture()
  assert.equal(await resumeInvitation(f.client,'invite'),null)
  assert.deepEqual(f.calls,['restore'])
  await joinInvitation(f.client,'invite','Sam')
  assert.deepEqual(f.calls.slice(1,3),['restore','anonymous'])
})

test('session restoration errors never trigger anonymous sign-in or membership writes',async()=>{
  const f=fixture()
  f.client.auth.getSession=async()=>({data:{session:null},error:new Error('Temporary connection failure')})
  await assert.rejects(joinInvitation(f.client,'invite','Sam'),/Temporary connection failure/)
  await assert.rejects(resumeInvitation(f.client,'invite'),/Temporary connection failure/)
  assert.deepEqual(f.calls,[])
})

test('only an explicit name-required response opens registration; network errors stay retryable',async()=>{
  const f=fixture({user:{id:'guest'}})
  f.client.rpc=async()=>({data:null,error:{message:'Enter a name up to 40 characters'}})
  assert.equal(await resumeInvitation(f.client,'invite'),null)
  f.client.rpc=async()=>({data:null,error:new Error('Network failure')})
  await assert.rejects(resumeInvitation(f.client,'invite'),/Network failure/)
  assert.equal(f.calls.includes('anonymous'),false)
})

test('uncertain join responses are not accepted; retry retains the same identity',async()=>{
  const f=fixture({user:{id:'existing'}})
  f.client.rpc=async()=>({data:null,error:null})
  await assert.rejects(joinInvitation(f.client,'invite','Sam'),/could not be confirmed/)
  f.client.rpc=async()=>({data:f.result,error:null})
  assert.deepEqual(await joinInvitation(f.client,'invite','Sam'),f.result)
  assert.equal(f.calls.includes('anonymous'),false)
})

test('invalid names do not create accounts or invoke membership operations',async()=>{
  const f=fixture()
  await assert.rejects(joinInvitation(f.client,'invite','  '),/Enter a name/)
  await assert.rejects(joinInvitation(f.client,'invite','x'.repeat(41)),/Enter a name/)
  assert.deepEqual(f.calls,[])
})
