import test from 'node:test';import assert from 'node:assert/strict';
import { projectPuppetReplacement,parsePuppetReplacementState,type FieldPuppetReplacementRoster } from '../src/core/field-puppet-replacement.js';
import { decodeFieldOp } from '../src/compiler/field.js';
import { sourcePuppetReplacementSelectors } from '../src/compiler/field-puppet-replacement.js';
import { fieldInstructionRequirements,assessFieldRequirements } from '../src/core/field-content-admission.js';
import { puppetReplacementFixture,puppetHost,replacementRaw } from './fixtures/puppet-replacement.js';
import { GameBattleHandoff } from '../src/core/game-battle-handoff.js';
import { CheckpointStorage } from '../src/core/saved-game.js';
import { ownedConditionGameFixture } from './fixtures/owned-condition.js';
import { resolveFieldPuppetActor } from '../src/core/field-puppet-actors.js';
const site={script:'authored',index:0,source:{file:'authored',assetPath:'authored/replacement'}};
const readRoster:FieldPuppetReplacementRoster={selectedSlot:2,slots:[[0,0,0,0],[0,17,0,32],[32,0,17,0]],owned:[{ownedId:17,sourceId:4},{ownedId:32,sourceId:9}]};
test('all nine generic source spellings decode with their reserved operands; three dictionary forms and malformed shapes stay specific gates',()=>{
 for(const [index,selector]of sourcePuppetReplacementSelectors.entries()){
  const raw=replacementRaw(selector.slice('パペット入れ替え：'.length)),op=decodeFieldOp(raw,site,{});
  assert.equal(op.kind,index<9?'field-puppet-replacement':'blocked');
  if(op.kind==='blocked')assert.match(op.reason,/dictionary\/placement/);
  else{const required=fieldInstructionRequirements(op);assert.notEqual(assessFieldRequirements(required,{providers:{},actorKind:'unknown'}).status,'ready');}
  for(const mutate of [(r:typeof raw)=>r.operands.iValues[7]=1,(r:typeof raw)=>r.operands.rValues[0]=.01,(r:typeof raw)=>r.operands.sValues[1]='x',(r:typeof raw)=>r.operands.iValues.pop()]){
   const bad=structuredClone(raw);mutate(bad);assert.equal(decodeFieldOp(bad,site,{}).kind,'blocked');
  }
 }
 const rts=replacementRaw('解除');rts.operands.sValues[0]='RTS：エンカウント前パーティ復元';assert.equal(decodeFieldOp(rts,site,{}).kind,'blocked');
});
test('raw Corps order, holes, first nonzero source owner and previous callback preservation do not use party appearance ordering',()=>{
 const before=structuredClone(readRoster),all=projectPuppetReplacement({kind:'slot',slot:1,selection:'all'},null,readRoster);
 assert.deepEqual(all,[0,-4,0,-9]);assert.deepEqual(projectPuppetReplacement({kind:'slot',slot:1,selection:'leader'},null,readRoster),[-4]);
 assert.deepEqual(projectPuppetReplacement({kind:'slot',slot:1,selection:'except-leader'},null,readRoster),[0,0,0,-9]);
 assert.deepEqual(projectPuppetReplacement({kind:'leaders'},null,readRoster),[-4,-9]);
 assert.deepEqual(projectPuppetReplacement({kind:'battle-party'},all,readRoster,2),all);assert.notEqual(projectPuppetReplacement({kind:'battle-party'},all,readRoster,2),all);
 assert.deepEqual(projectPuppetReplacement({kind:'battle-party'},all,readRoster,0),[-1032]);assert.throws(()=>projectPuppetReplacement({kind:'battle-party'},all,readRoster),/known/);
 assert.equal(projectPuppetReplacement({kind:'reset'},null,readRoster),null);assert.deepEqual(readRoster,before);
 for(const r of [{...readRoster,slots:[[0,0,0,0]]},{...readRoster,slots:[[0,0,0,0],[0,90,0,0],[0,0,0,0]]}])assert.throws(()=>projectPuppetReplacement({kind:'leaders'},null,r));
});
test('checkpoint callback is a bounded integer value, cannot introduce runtime flags, source sets, selectors or sparse slots',()=>{
 const source={sourceSetHash:'a'.repeat(64),parentSourceSetHash:'b'.repeat(64),miscHash:'c'.repeat(64)},raw={kind:'field-puppet-replacement-v1' as const,...source,selectors:[0,-4]};
 assert.deepEqual(parsePuppetReplacementState(raw,source),raw);
 for(const bad of [{...raw,selectors:[-1001]},{...raw,selectors:[-1011]},{...raw,selectors:Array(5).fill(0)},{...raw,selectors:[]},{...raw,selectors:[0,0,0]},{...raw,selectors:[-1030,0]},{...raw,miscHash:'d'.repeat(64)},{...raw,callback:'present'},{...raw,selectors:new Array(4)}])assert.throws(()=>parsePuppetReplacementState(bad,source));
});
const finish=(flow:Awaited<ReturnType<Awaited<ReturnType<typeof puppetReplacementFixture>>['make']>>['flow'])=>flow.advance(250,puppetHost);
function tasks(field:unknown){return Reflect.get(field as object,'tasks')as {slot:number|null;actor:string;sourceEntityId:number|null;done:boolean;state:string}[];}
test('real GameState full Corps port is detached and follows committed candidate updates; temporary selection leaves permanent owners unchanged',async()=>{
 const f=await puppetReplacementFixture(),{game,flow}=await f.make(),field=game.field,owned=game.state.snapshot().roster;
 game.state.fieldParty.prepare({kind:'organize-slot',slot:1,members:[null,owned[0]!.sourceId,null,owned[1]!.sourceId],refreshActors:true}).commit();
 const before=game.state.snapshot(),r=game.state.fieldPuppetRoster.replacement!();
 assert.equal(r.slots.length,3);assert.deepEqual(r.slots[1],[0,owned[0]!.ownedId,0,owned[1]!.ownedId]);r.slots[1]!.fill(0);assert.deepEqual(game.state.snapshot(),before);
 assert(field.startEvent('replace-slot2'));finish(flow);assert.equal(field.stop,null,String(field.stop));
 assert.deepEqual(field.puppetReplacementSnapshot!.selectors,[0,-owned[0]!.sourceId,0,-owned[1]!.sourceId]);assert.deepEqual(game.state.snapshot(),before);
 assert(field.startEvent('replace-reset'));finish(flow);assert.equal(field.puppetReplacementSnapshot,null);assert(field.startEvent('replace-reset'));finish(flow);assert.equal(field.puppetReplacementSnapshot,null);
});
test('first Exec uses list track index, sleeps zero and copies actual player Z/layer into existing dummy; nonzero actual actor keeps XY and identity',async()=>{
 const f=await puppetReplacementFixture(),{game,flow}=await f.make(),field=game.field,owned=game.state.snapshot().roster;
 game.state.fieldParty.prepare({kind:'organize-slot',slot:1,members:[null,owned[1]!.sourceId,null,null],refreshActors:true}).commit();
 assert(field.startEvent('replace-slot2'));finish(flow);const {catalog,context}=field.options.puppetActors!.read(),id=resolveFieldPuppetActor(catalog,context,-owned[1]!.sourceId).actor!,actor=field.actors[id]!;
 const before={actor,native:actor.native,entity:actor.native!.entity,xy:{x:actor.native!.entity.position.x,y:actor.native!.entity.position.y}},dummy=field.cameraSnapshot!.dummy,ownedBefore=game.state.snapshot();
 assert(field.startEvent('exec-pair'));flow.advance(10,puppetHost);assert.equal(field.stop,null,String(field.stop));
 const slots=tasks(field).filter(t=>t.slot!==null);assert.equal(slots.find(t=>t.slot===0)!.done,true);assert.equal(slots.find(t=>t.slot===0)!.sourceEntityId,0);
 assert.equal(slots.find(t=>t.slot===1)!.sourceEntityId,-owned[1]!.sourceId);assert.equal(slots.find(t=>t.slot===1)!.actor,id);
 assert.equal(field.actors[id],before.actor);assert.equal(actor.native,before.native);assert.equal(actor.native!.entity,before.entity);
 assert.deepEqual({x:actor.native!.entity.position.x,y:actor.native!.entity.position.y},before.xy);assert.equal(actor.native!.entity.position.z,field.player.native!.entity.position.z);assert.equal(actor.native!.entity.layer,field.player.native!.entity.layer);
 assert.equal(field.cameraSnapshot!.dummy.position.x,dummy.position.x);assert.equal(field.cameraSnapshot!.dummy.position.y,dummy.position.y);assert.equal(field.cameraSnapshot!.dummy.position.z,field.player.native!.entity.position.z);assert.equal(field.cameraSnapshot!.dummy.layer,field.player.native!.entity.layer);
 assert.equal(actor.native!.entity.visible,true);assert.deepEqual(game.state.snapshot(),ownedBefore);assert.throws(()=>game.checkpoint(),/during|active|event/i);
 finish(flow);assert.equal(field.stop,null);assert.deepEqual(field.puppetReplacementSnapshot!.selectors,[0,-owned[1]!.sourceId,0,0]);
 assert(field.startEvent('exec-sparse'));flow.advance(10,puppetHost);assert.equal(field.stop,null);assert.equal(tasks(field).filter(t=>!t.done&&t.slot===1).at(-1)!.actor,id);finish(flow);
});
test('empty Exec warning and foreign callbacks reject the whole rebind batch, including zero dummy/collision writes',async()=>{
 for(const mode of ['zero','foreign','missing']as const){const f=await puppetReplacementFixture(),{game,flow}=await f.make(),field=game.field,owned=game.state.snapshot().roster;
  game.state.fieldParty.prepare({kind:'organize-slot',slot:1,members:mode==='zero'?[null,null,null,null]:[owned[0]!.sourceId,owned[1]!.sourceId,null,null],refreshActors:true}).commit();
  assert(field.startEvent('replace-slot2'));finish(flow);const before=field.nativeActorStateFingerprint,collision=field.collisionState,port=field.options.puppetActors!;
  assert(field.startEvent(mode==='zero'?'exec-first':'exec-pair'));assert.equal(field.stop?.kind??null,null);
  if(mode==='foreign')Reflect.set(field.options,'puppetActors',{...port,controlContext:()=>({worldMapScript:false,callback:'unknown'})});
  if(mode==='missing'){const {catalog,context}=port.read(),id=resolveFieldPuppetActor(catalog,context,-owned[1]!.sourceId).actor!;field.actors[id]!.native!.entity.childEntityObject='unknown';}
  const effective=field.nativeActorStateFingerprint,camera=field.cameraSnapshot;flow.advance(10,puppetHost);assert.equal(field.stop?.kind,'unsupported',mode);assert.match(field.stop!.message,/warning|callback|visibility/i);
  assert.deepEqual(field.collisionState,collision);assert.equal(field.nativeActorStateFingerprint,effective);assert.deepEqual(field.cameraSnapshot,camera);assert(tasks(field).filter(t=>t.slot!==null).every(t=>t.state==='awake'&&!t.done));
 }
});
test('stable callback survives Storage quota retry, actual restore and failed/cancelled map preparation without resurrecting an old actor owner',async()=>{
 const f=await puppetReplacementFixture(),{game,flow}=await f.make(),old=game.field,owned=game.state.snapshot().roster;
 game.state.fieldParty.prepare({kind:'organize-slot',slot:1,members:[owned[0]!.sourceId,null,null,null],refreshActors:true}).commit();
 assert(old.startEvent('replace-slot2'));finish(flow);const saved=game.checkpoint(),memory=new Map<string,string>();let fail=true;
 const store=new CheckpointStorage({getItem:k=>memory.get(k)??null,setItem:(k,v)=>{if(fail)throw Error('controlled quota');memory.set(k,v);}});
 assert.throws((await store.prepareSave(saved,1)).commit,/quota/);assert.deepEqual(game.checkpoint(),saved);fail=false;(await store.prepareSave(saved,1)).commit();
 const restored=f.restore((await store.load())!.checkpoint);assert.deepEqual(restored.field.puppetReplacementSnapshot,old.puppetReplacementSnapshot);
 const forged=structuredClone(saved);forged.world.field.native!.puppetReplacement!.selectors=[-990];assert.throws(()=>f.restore(forged),/trusted resident/);
 assert(old.startEvent('go-world'));flow.advance(10,puppetHost);const before=old.puppetReplacementSnapshot,draft=game.world.prepare(f.world,f.worldMap);game.world.discard(draft);assert.equal(game.field,old);assert.deepEqual(old.puppetReplacementSnapshot,before);
 const next=game.world.prepare(f.world,f.worldMap);assert(game.world.commit(next));finish(flow);assert.deepEqual(game.field.puppetReplacementSnapshot,before);assert.notEqual(game.field,old);const oldTime=old.time;old.advance(10);assert.equal(old.time,oldTime);
 assert(game.field.startEvent('replace-reset'));finish(flow);assert.equal(game.field.puppetReplacementSnapshot,null);assert.deepEqual(old.puppetReplacementSnapshot,before);
});

test('battle-party reads ScenarioVariable four and preserves an existing callback only for the actual selected Corps',async()=>{
 const f=await puppetReplacementFixture(),{game,flow}=await f.make(),field=game.field,owned=game.state.snapshot().roster;
 game.state.fieldParty.prepare({kind:'organize-slot',slot:1,members:[owned[1]!.sourceId,null,null,null],refreshActors:true}).commit();
 assert(field.startEvent('replace-slot2'));finish(flow);const previous=field.puppetReplacementSnapshot;
 field.eventState.write({category:'ScenarioVariable',index:4},0);assert(field.startEvent('replace-battle'));finish(flow);assert.deepEqual(field.puppetReplacementSnapshot,previous);
 field.eventState.write({category:'ScenarioVariable',index:4},2);assert(field.startEvent('replace-battle'));finish(flow);assert.deepEqual(field.puppetReplacementSnapshot!.selectors,[-1030]);
 assert.equal(game.state.snapshot().party.selectedSlot,0);
});
test('a failed destination initializer after callback inheritance cannot publish or retire the source callback',async()=>{
 const f=await puppetReplacementFixture({initializationFailure:true}),{game,flow}=await f.make(),field=game.field;
 assert(field.startEvent('replace-leaders'));finish(flow);const value=field.puppetReplacementSnapshot,owned=game.state.snapshot();
 assert(field.startEvent('go-world'));flow.advance(10,puppetHost);const request=field.stop;
 assert.throws(()=>game.world.prepare(f.world,f.worldMap),/Controlled world initializer failed/);
 assert.equal(game.field,field);assert.equal(field.stop,request);assert.deepEqual(field.puppetReplacementSnapshot,value);assert.deepEqual(game.state.snapshot(),owned);
});
test('prepared battle media failure, cancellation and once-only victory return retain the session callback and actual field owner',async()=>{
 const f=await puppetReplacementFixture(),{game,flow}=await f.make(),field=game.field;
 assert(field.startEvent('replace-leaders'));finish(flow);const value=field.puppetReplacementSnapshot,owned=game.state.snapshot();
 assert(field.startEvent('stone-battle'));assert.equal(field.stop?.kind,'encounter');const request=field.stop;
 let fail=true;const handoff=new GameBattleHandoff(flow,{prepareStart:async()=>{if(fail){fail=false;throw Error('Controlled battle media');}return null;},prepareReturn:async()=>null,discard:()=>{}});
 assert.equal((await handoff.start()).status,'failed');assert.equal(field.stop,request);assert.deepEqual(game.state.snapshot(),owned);assert.deepEqual(field.puppetReplacementSnapshot,value);
 let release!:(v:null)=>void;const cancel=new GameBattleHandoff(flow,{prepareStart:()=>new Promise<null>(r=>release=r),prepareReturn:async()=>null,discard:()=>{}}),attempt=cancel.start();cancel.cancel();release(null);
 assert.equal((await attempt).status,'cancelled');assert.deepEqual(field.puppetReplacementSnapshot,value);assert.equal(game.field,field);
 assert.equal((await handoff.start()).status,'committed');const battle=game.battle!;
 for(let i=0;i<3000&&battle.phase==='active';i++){for(const a of battle.ready)assert(battle.command(a.id,10,battle.enemies[0]!.id,100));flow.advance(10,puppetHost);}
 assert.equal(battle.phase,'victory');assert.equal((await handoff.return()).status,'committed');flow.advance(10,puppetHost);
 assert.equal(game.field,field);assert.deepEqual(field.puppetReplacementSnapshot,value);assert(game.checkpointReady);
 const settled=game.state.snapshot();await assert.rejects(handoff.return());assert.deepEqual(game.state.snapshot(),settled);assert.equal(settled.completedBattles.length,owned.completedBattles.length+1);
});

test('all-Corps reader uses the same private map candidate and turns live only after its one accepted publication',()=>{
 const {state}=ownedConditionGameFixture(),before=state.snapshot(),draft=state.prepareFieldState(),live=state.fieldPuppetRoster.replacement!;
 draft.ports.party.prepare({kind:'organize-slot',slot:2,members:[null,2,null,1],refreshActors:true}).commit();
 draft.ports.party.prepare({kind:'select-slot',slot:2,refreshActors:false}).commit();
 const read=draft.ports.puppetRoster.replacement!();assert.equal(read.selectedSlot,2);assert.deepEqual(read.slots[2],[0,before.roster[1]!.ownedId,0,before.roster[0]!.ownedId]);assert.deepEqual(state.snapshot(),before);
 state.fieldInventory.prepare({kind:'grant-gil',amount:1}).commit();assert.equal(draft.commit(),false);assert.equal(live().selectedSlot,0);
 const accepted=state.prepareFieldState();accepted.ports.party.prepare({kind:'select-slot',slot:1,refreshActors:false}).commit();assert(accepted.commit());assert.deepEqual(accepted.ports.puppetRoster.replacement!(),live());
 state.fieldParty.prepare({kind:'select-slot',slot:2,refreshActors:false}).commit();assert.equal(accepted.ports.puppetRoster.replacement!().selectedSlot,2);
});
