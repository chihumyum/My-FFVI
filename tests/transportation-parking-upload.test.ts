import test from 'node:test';import assert from 'node:assert/strict';
import {projectTransportationParkingUpload,transportationDirectionMask,transportationStoredPosition,WEB_SOURCE_TRANSPORT_PARKING_UPLOAD,fieldTransportationParkingBinding}from '../src/core/transportation-parking-upload.js';
import {initialOwnedTransportations}from '../src/core/transportation-state.js';
import {vehicleLifecycleSessionFixture}from './fixtures/vehicle-lifecycle-session.js';
import {createNativeFieldActorProjection}from '../src/core/field-native-actors.js';
import {CheckpointStorage}from '../src/core/saved-game.js';
const currentBattle=(f:ReturnType<typeof vehicleLifecycleSessionFixture>)=>f.game.battle!;
const complete=(f:ReturnType<typeof vehicleLifecycleSessionFixture>)=>f.game.state.fieldTransportation!.read().map(r=>({id:r.id,info:{stayMapId:r.mapId,pose:null}}));
const state=(f:ReturnType<typeof vehicleLifecycleSessionFixture>)=>({owned:f.game.state.snapshot(),events:f.game.field.eventState.snapshot(),actors:f.game.field.nativeActorStateFingerprint,current:f.game.field.transportationId,camera:f.game.field.cameraSnapshot});
function moveActualBody(f:ReturnType<typeof vehicleLifecycleSessionFixture>,dx=32){
 const old=f.game.field.actors[f.actorId]!,native=old.native!,position={...native.entity.position,x:Math.fround(native.entity.position.x+dx)};
 // Controlled actual host-pose input, not execution of an original source body.
 native.entity.position=position;return old;
}
test('source parking position copies concrete cell floor and exact worldZ, direction tests signs without nearest angle',()=>{
 assert.deepEqual(transportationStoredPosition({x:91,y:73,width:16,height:12},{x:25,y:-21,z:349}),{x:9,y:7,z:349});
 assert.equal(transportationDirectionMask(0,0),0);assert.equal(transportationDirectionMask(.5,1),3);assert.equal(transportationDirectionMask(-1,-1),12);assert.throws(()=>transportationDirectionMask(NaN,0));
});
test('whole source registry projects map-only/absent info/real pose while preserving IDs order flags and timestamp',()=>{
 const f=vehicleLifecycleSessionFixture(),catalog=f.game.state.fieldTransportation!.catalog,records=f.game.state.fieldTransportation!.read(),obs=complete(f);
 obs[0]!.info!.stayMapId=900;const pose={position:{x:4,y:6,z:249},direction:9};const changed=obs as import('../src/core/transportation-parking-upload.js').TransportationParkingObservation[];changed[1]!.info={stayMapId:901,pose};
 const result=projectTransportationParkingUpload(catalog,records,changed);assert.equal(result.after[0]!.mapId,900);assert.deepEqual(result.after[0]!.position,records[0]!.position);assert.equal(result.after[1]!.direction,9);assert.equal(result.after[1]!.timeStampTicks,records[1]!.timeStampTicks);assert.deepEqual(result.before,records);assert.deepEqual(f.game.state.fieldTransportation!.read(),records);
 changed[0]!.info=null;assert.deepEqual(projectTransportationParkingUpload(catalog,records,changed).after[0],records[0]);assert.throws(()=>projectTransportationParkingUpload(catalog,records,[...changed].reverse()),/registry/);
});
test('invalid second target and throwing publication leave the single owned state completely unchanged',()=>{
 const f=vehicleLifecycleSessionFixture(),before=state(f),obs=complete(f) as import('../src/core/transportation-parking-upload.js').TransportationParkingObservation[];obs[0]!.info!.stayMapId=900;obs[1]!.info={stayMapId:901,pose:{position:{x:NaN,y:0,z:349},direction:1}};
 assert.throws(()=>f.game.state.fieldTransportation!.prepareUpload!(obs),/coordinate/);assert.deepEqual(state(f),before);
 const valid=complete(f);valid[0]!.info!.stayMapId=900;const t=f.game.state.fieldTransportation!.prepareUpload!(valid);assert.throws(()=>t.commitWith(()=>{throw Error('controlled publish failure');}));assert.deepEqual(state(f),before);t.commit();assert.equal(f.game.state.fieldTransportation!.read()[0]!.mapId,900);assert.throws(()=>t.commit(),/Stale/);
});
test('actual source Change uploads the existing real parked instance, keeps current/enable/time and round-trips Storage',async()=>{
 for(const id of [44,71]){const f=vehicleLifecycleSessionFixture({id,parkingUpload:true});f.run('park');const old=f.game.state.nativeState!.ownedTransportations.find(r=>r.id===id)!,body=moveActualBody(f,32.25),expected=transportationStoredPosition(f.map.cameraHost!.mapRange,body.native!.entity.position);f.run('change');
  const after=f.game.state.nativeState!.ownedTransportations.find(r=>r.id===id)!;assert.deepEqual(after.position,expected);assert.equal(after.timeStampTicks,old.timeStampTicks);assert.equal(f.game.field.eventState.read(f.flag),1);assert.equal(f.game.field.transportationId,1);assert.equal(f.game.field.actors[f.actorId],body);
  const stable=f.game.checkpoint(),bytes=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>{bytes.set(k,v);}});await storage.save(stable,1);const restored=f.restore((await storage.load())!.checkpoint);assert.deepEqual(restored.checkpoint(),stable);assert.equal(restored.field.transportationParkingUploadPolicy,WEB_SOURCE_TRANSPORT_PARKING_UPLOAD);
  const forged=structuredClone(stable);forged.world.field.native!.actors.actors.find(a=>a.id===f.actorId)!.position.x+=16;assert.throws(()=>f.restore(forged),/parking/);
 }
});
test('old content/runtime never acquires upload and missing actual instance fails before Change actor publication',()=>{
 const legacy=vehicleLifecycleSessionFixture();legacy.run('park');const before=legacy.game.state.snapshot();moveActualBody(legacy);legacy.run('change');assert.deepEqual(legacy.game.state.snapshot(),before);
 const f=vehicleLifecycleSessionFixture({parkingUpload:true});f.run('park');delete f.game.field.actors[f.actorId];assert.equal(f.game.field.startEvent('change'),true);const beforeFailure=state(f);f.game.advance(20);assert.equal(f.game.field.stop?.kind,'unsupported');assert.match(f.game.field.stop!.message,/registry/);assert.deepEqual(state(f),beforeFailure);
 const policy={kind:'framework-development-v1',policy:'omit-anonymous-environment-particles-v1',sourceContentHash:'a'.repeat(64),omissions:[],transportation:'walking-magitek-framework-v1',vehicleLifecycle:'web-source-vehicle-lifecycle-v1',transportationParkingUpload:WEB_SOURCE_TRANSPORT_PARKING_UPLOAD}as const;
 assert.throws(()=>fieldTransportationParkingBinding({developmentProfile:{...policy,omissions:[]}},undefined),/authorization|content\/runtime/);
});
test('owned publication invalidates old batch and a cancelled map draft cannot write parking',()=>{
 const f=vehicleLifecycleSessionFixture({parkingUpload:true});f.run('park');const port=f.game.state.fieldTransportation!,old=port.prepareUpload!(complete(f));f.run('hide');const next=port.prepare({id:f.id,enable:false,mapId:-1,position:null,layer:null,direction:null,timeStampTicks:null});next.commit();assert.throws(()=>old.commit(),/Stale/);
 const map=f.target(),field=f.game.field;field.previewMap(902,f.content.entry.entrance);const pending=f.game.world.prepare(f.world,map),before=f.game.state.snapshot();f.game.world.discard(pending);assert.equal(f.game.world.commit(pending),false);assert.deepEqual(f.game.state.snapshot(),before);
});
test('uploaded parking survives actual prepared Battle failure/cancel/retry/return and map retirement, Storage cannot authorize a missing runtime',async()=>{
 const f=vehicleLifecycleSessionFixture({parkingUpload:true});f.run('park');moveActualBody(f,32);f.run('change');const owned=structuredClone(f.game.state.nativeState!.ownedTransportations),field=f.game.field;
 assert(field.startEvent('parking_fight'));f.game.advance(10);const key=Number(Object.keys(f.battle.encounters)[0]),encounter=f.battle.encounters[key]!;delete f.battle.encounters[key];assert.throws(()=>f.game.prepareBattleStart(),/unavailable/);assert.equal(f.game.state.inBattle,false);assert.deepEqual(f.game.state.nativeState!.ownedTransportations,owned);f.battle.encounters[key]=encounter;
 const cancelled=f.game.prepareBattleStart()!;cancelled.discard();assert.equal(cancelled.commit(),false);assert.equal(f.game.battle,null);assert.deepEqual(f.game.state.nativeState!.ownedTransportations,owned);assert(f.game.prepareBattleStart()!.commit());const old=f.game.battle!;
 for(const p of old.players){p.hp=0;p.conditionIds=[305];}for(let n=0;n<30&&old.phase==='active';n++)f.game.advance(10);assert.equal(old.phase,'defeat');const noRetry=f.game.prepareBattleRetry()!;noRetry.discard();assert.equal(f.game.battle,old);assert(f.game.prepareBattleRetry()!.commit());assert.throws(()=>old.advance(10),/Retired/);
 const battle=currentBattle(f);for(let n=0;n<20000&&battle.phase==='active';n++){for(const actor of battle.ready){const target=battle.targets(actor.id,10)[0];if(target)battle.command(actor.id,10,target.id);}f.game.advance(10);}assert.equal(battle.phase,'victory');const noReturn=f.game.prepareBattleReturn()!;noReturn.discard();assert.equal(f.game.field,field);assert.deepEqual(f.game.state.nativeState!.ownedTransportations,owned);assert(f.game.prepareBattleReturn()!.commit());f.game.advance(20);assert.equal(f.game.field,field);assert.deepEqual(f.game.state.nativeState!.ownedTransportations,owned);
 const saved=f.game.checkpoint();assert.throws(()=>f.restore(saved,f.map,{...f.runtime,transportationParkingUpload:undefined}as never),/content\/runtime/);const bytes=new Map<string,string>();let fail=true;const storage=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>{if(fail)throw Error('controlled storage failure');bytes.set(k,v);}});await assert.rejects(storage.save(saved,1),/storage failure/);assert.deepEqual(f.game.checkpoint(),saved);fail=false;await storage.save(saved,2);assert.deepEqual(f.restore((await storage.load())!.checkpoint).checkpoint(),saved);
 const target=f.target();field.previewMap(902,f.content.entry.entrance);const pending=f.game.world.prepare(f.world,target);f.game.world.discard(pending);assert.equal(f.game.world.commit(pending),false);assert.deepEqual(f.game.state.nativeState!.ownedTransportations,owned);assert(f.game.world.commit(f.game.world.prepare(f.world,target)));f.game.advance(20);assert.equal(field.vehicleLifecycleRetired,true);assert.equal(field.startEvent('change'),false);assert.equal(f.game.field.transportationParkingUploadPolicy,WEB_SOURCE_TRANSPORT_PARKING_UPLOAD);assert.deepEqual(f.game.state.nativeState!.ownedTransportations,owned);
});
