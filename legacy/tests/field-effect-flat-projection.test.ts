import test from 'node:test';import assert from 'node:assert/strict';
import {FieldEffects,createFieldEffectState,projectFieldEffects,fieldEffectBoardBlockers,fieldEffectBoardId,type FieldEffectOperation} from '../src/core/field-effects.js';
import {createWebLogicalFieldEffectsHost} from '../src/core/field-logical-effects.js';
import {fieldEffectRuntimeBoardBlockers,validateFieldEffectFlatPolicy,matchFieldEffectFlatProjection,validateFieldEffectFlatBinding} from '../src/core/field-effect-flat-projection.js';
import {flatEffectCatalog,flatEffectBinding} from './fixtures/flat-field-effects.js';
const create=(f:ReturnType<typeof flatEffectCatalog>,scope='0'):Extract<FieldEffectOperation,{kind:'create'}>=>({kind:'create',id:fieldEffectBoardId(scope,f.binding.ref.entityId),definition:f.binding.entity.effect!,position:{x:2,y:3,z:249},flatProjection:structuredClone(f.binding.ref)});
function owner(){const f=flatEffectCatalog(),host=createWebLogicalFieldEffectsHost(),effects=new FieldEffects(f.catalog,host),op=create(f);effects.prepare([op,{kind:'setup',registeredBoards:[op.id!],groupUpdate:false}]).commit();return{...f,host,effects};}

test('strict and old logical catalogs retain birdview rejection and old state shape',()=>{
 const f=flatEffectCatalog(),old=structuredClone(f.strictLogicalCatalog);
 const def=f.binding.entity.effect!;assert(fieldEffectBoardBlockers(def).some(r=>r.includes('birdview')));
 assert.throws(()=>projectFieldEffects(createFieldEffectState(),old,[{kind:'create',id:'900',definition:def,position:{x:0,y:0,z:249}}]),/birdview/);
 const unchanged={...def,birdviewPuppet:false};const state=projectFieldEffects(createFieldEffectState(),old,[{kind:'create',id:'900',definition:unchanged,position:{x:0,y:0,z:249}},{kind:'setup',registeredBoards:['900'],groupUpdate:false}]).after;
 assert.equal(Object.hasOwn(state.boards[0]!,'flatProjection'),false);assert.deepEqual(FieldEffects.restoreLogical(old,createWebLogicalFieldEffectsHost(),state).snapshot(),state);
});
test('exact map/group/entity/layer/source definition is required; same asset group is insufficient',()=>{
 const f=flatEffectCatalog(),def=f.binding.entity.effect!;assert.deepEqual(fieldEffectRuntimeBoardBlockers(def,f.catalog,f.binding.ref,'900'),[]);
 assert.throws(()=>projectFieldEffects(createFieldEffectState(),f.catalog,[{kind:'create',id:'900',definition:def,position:{x:0,y:0,z:249}}]),/birdview/);
 for(const change of [(r:typeof f.binding.ref)=>r.mapId++,(r:typeof f.binding.ref)=>r.group='other',(r:typeof f.binding.ref)=>r.entityId='901',(r:typeof f.binding.ref)=>r.layer=0,(r:typeof f.binding.ref)=>r.sourceMapHash='f'.repeat(64)]){
  const ref=structuredClone(f.binding.ref);change(ref);assert.equal(matchFieldEffectFlatProjection(f.catalog,def,ref,'900'),false);
  assert.throws(()=>projectFieldEffects(createFieldEffectState(),f.catalog,[{...create(f),flatProjection:ref}]),/reference/);
 }
 assert.equal(matchFieldEffectFlatProjection(f.catalog,def,f.binding.ref,'901'),false);
 assert.equal(matchFieldEffectFlatProjection(f.catalog,{...def,source:{...def.source,pointer:'/other'}},f.binding.ref,'900'),false);
});
test('shared real owner retains clocks, positive playback, registration, visibility and source geometry',()=>{
 const f=owner(),before=f.effects.snapshot(),id=before.boards[0]!.id;
 assert.equal(before.boards[0]!.definition.birdviewPuppet,true);assert.equal(before.boards[0]!.position.z,249);assert.equal(before.players.length,1);
 f.effects.prepareTick(.02).commit();assert(f.effects.snapshot().players[0]!.elapsedSec>0);
 f.effects.prepare([{kind:'play',id,loopLimit:2},{kind:'visibility',id,visible:false,duration:0}]).commit();
 f.effects.prepareTick(.01).commit();f.effects.prepareTick(.01).commit();const state=f.effects.snapshot();assert.equal(state.players[0]!.loopCount,2);assert.equal(state.players[0]!.playing,false);assert.equal(state.boards[0]!.activeSelf,false);assert.equal(state.instanceCount,1);
});
test('candidate cancel/stale/retry preserves the live owner and only source-authorized board identity',()=>{
 const f=owner(),before=f.effects.snapshot(),id=before.boards[0]!.id,cancel=f.effects.fork();cancel.prepare([{kind:'destroy',id}]).commit();cancel.discard();assert.deepEqual(f.effects.snapshot(),before);
 const stale=f.effects.fork();stale.prepare([{kind:'destroy',id}]).commit();f.effects.prepareTick(.01).commit();assert.throws(()=>stale.seal(),/Stale/);stale.discard();
 const current=f.effects.snapshot(),next=f.effects.fork(),op=create(f,'1');next.prepare([{kind:'release-prefab',assetGroup:'controlled_effect'},{kind:'destroy',id},op,{kind:'setup',registeredBoards:[op.id!],groupUpdate:false}]).commit();assert.deepEqual(f.effects.snapshot(),current);next.seal().commit();assert.equal(f.effects.snapshot().instanceCount,2);assert.deepEqual(f.effects.snapshot().boards[0]!.flatProjection,f.binding.ref);
});
test('stable restore selects current trusted proof and rejects forged saved projection/definition without initialization replay',()=>{
 const f=owner();f.effects.prepareTick(.03).commit();const state=f.effects.snapshot();assert.deepEqual(FieldEffects.restoreLogical(f.catalog,f.host,state).snapshot(),state);
 for(const change of [(s:typeof state)=>s.boards[0]!.flatProjection!.layer=0,(s:typeof state)=>{delete s.boards[0]!.flatProjection;},(s:typeof state)=>s.boards[0]!.definition.pixelPosition.x=999,(s:typeof state)=>s.boards[0]!.id=fieldEffectBoardId('0','new'),(s:typeof state)=>Object.assign(s.boards[0]!.flatProjection!,{savedGrant:true})]){
  const bad=structuredClone(state);change(bad);assert.throws(()=>FieldEffects.restoreLogical(f.catalog,f.host,bad));assert.deepEqual(f.effects.snapshot(),state);
 }
 const noGrant=structuredClone(f.catalog);delete noGrant.webPolicy!.boardProjection;assert.throws(()=>FieldEffects.restoreLogical(noGrant,f.host,state),/reference/);
});
test('full raw membership, duplicate binding and side-effect-free media proof cannot be lost or swapped',()=>{
 const f=flatEffectCatalog();for(const change of [(c:typeof f.catalog)=>c.webPolicy!.boardProjection!.bindings.push(structuredClone(f.binding)),(c:typeof f.catalog)=>c.webPolicy!.boardProjection!.objects=[],(c:typeof f.catalog)=>c.webPolicy!.boardProjection!.bindings=[],(c:typeof f.catalog)=>c.media.controlled_effect!.particles[0]!.loop=false]){
  const c=structuredClone(f.catalog);change(c);assert.throws(()=>validateFieldEffectFlatPolicy(c));
 }
});

test('source tile objects keep the existing gid bottom-anchor codec while raw board placement remains unchanged',()=>{
 for(const gid of [0,1,2147483649]){
  const binding=flatEffectBinding();binding.rawObject.gid=gid;binding.entity.y=gid?1:2;
  assert.doesNotThrow(()=>validateFieldEffectFlatBinding(binding));
  const raw=structuredClone(binding.rawObject),placement=structuredClone(binding.position);
  binding.entity.y+=1;assert.throws(()=>validateFieldEffectFlatBinding(binding),/geometry binding/);
  assert.deepEqual(binding.rawObject,raw);assert.deepEqual(binding.position,placement);
 }
});
