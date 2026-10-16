import test from 'node:test';import assert from 'node:assert/strict';
import{vehicleLifecycleSessionFixture}from './fixtures/vehicle-lifecycle-session.js';
import{CheckpointStorage}from '../src/core/saved-game.js';
import{sourceVehicleParkingPose,fieldVehicleActorId,FieldVehicleLifecycle}from '../src/core/field-vehicle-lifecycle.js';
const snapshot=(f:ReturnType<typeof vehicleLifecycleSessionFixture>)=>({owned:f.game.state.snapshot(),events:f.game.field.eventState.snapshot(),actors:f.game.field.nativeActorStateFingerprint,camera:f.game.field.cameraSnapshot,current:f.game.field.transportationId});

test('real source-initialized Session creates a distinct Web body then jointly loses exact parking and release flag',()=>{
 for(const id of [44,71]){const f=vehicleLifecycleSessionFixture({id});f.run('park');const body=f.game.field.actors[f.actorId]!;
  assert.equal(body.native!.sourceTransportationId,id);assert.notEqual(body.id,f.game.field.player.id);assert(!body.id.startsWith('native:resident:'));
  assert.deepEqual(body.native!.entity.position,sourceVehicleParkingPose(f.game.state.nativeState!.ownedTransportations.find(r=>r.id===id)!,f.map.cameraHost!.mapRange).position);
  assert.equal(f.game.field.eventState.read(f.flag),1);const old=structuredClone(f.game.state.nativeState!.ownedTransportations.find(r=>r.id===id)!);f.run('lose');
  assert.equal(f.game.field.actors[f.actorId],undefined);assert.equal(f.game.field.eventState.read(f.flag),0);assert.equal(f.game.field.transportationId,1);
  assert.deepEqual(f.game.state.nativeState!.ownedTransportations.find(r=>r.id===id),{...old,mapId:-1});
  f.run('park');assert.notEqual(f.game.field.actors[f.actorId],body,'recreation uses a new actual instance in same Field owner');}
});

test('OnTheVehicle moves actual first-member, player and one camera owner without changing transport or parking',()=>{
 const f=vehicleLifecycleSessionFixture();f.run('park');const before=f.game.state.snapshot(),body=f.game.field.actors[f.actorId]!,entity=body.native!.entity,player=f.game.field.player;
 f.run('position');assert.equal(f.game.field.player,player);assert.equal(f.game.field.actors[f.actorId]!.native!.entity,entity);
 assert.deepEqual(player.native!.entity.position,entity.position);assert.deepEqual(f.game.field.cameraSnapshot!.dummy.position,entity.position);
 assert.equal(f.game.field.transportationId,1);assert.deepEqual(f.game.state.snapshot(),before);
});

test('SwitchVehicleActive writes the existing bodies only and preserves flag/current/parking through Storage restore',async()=>{
 const f=vehicleLifecycleSessionFixture();f.run('park');const body=f.game.field.actors[f.actorId]!,owned=f.game.state.snapshot();f.run('hide');assert.equal(body.native!.entity.visible,false);
 assert.equal(f.game.field.eventState.read(f.flag),1);assert.deepEqual(f.game.state.snapshot(),owned);
 const bytes=new Map<string,string>();let fail=true;const storage=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>{if(fail)throw Error('controlled quota');bytes.set(k,v);}});
 const stable=f.game.checkpoint();await assert.rejects(storage.save(stable,1),/quota/);assert.deepEqual(f.game.checkpoint(),stable);fail=false;await storage.save(stable,2);
 const saved=(await storage.load())!,restored=f.restore(saved.checkpoint);assert.deepEqual(restored.checkpoint(),stable);assert.equal(restored.field.actors[f.actorId]!.native!.entity.visible,false);
 f.run('show',restored);assert.equal(restored.field.actors[f.actorId]!.native!.entity.visible,true);assert.equal(f.game.field.actors[f.actorId]!.native!.entity.visible,false);
 assert.throws(()=>f.restore(saved.checkpoint,f.map,{}),/authorization/);
 const forged=structuredClone(saved.checkpoint);forged.world.field.native!.actors.actors.find(a=>a.id===f.actorId)!.position.x+=16;assert.throws(()=>f.restore(forged),/parking/);
});

test('missing source/runtime policy, actual body or media fails before the opcode commits',()=>{
 assert.throws(()=>vehicleLifecycleSessionFixture({runtimePolicy:false}),/authorization/);
 const strict=vehicleLifecycleSessionFixture({contentPolicy:false});assert.equal(strict.game.field.startEvent('lose'),true);const before=snapshot(strict);strict.game.advance(10);assert.equal(strict.game.field.stop?.kind,'unsupported');assert.deepEqual(snapshot(strict),before);
 const absent=vehicleLifecycleSessionFixture();assert.equal(absent.game.field.startEvent('position'),true);const a=snapshot(absent);absent.game.advance(10);assert.equal(absent.game.field.stop?.kind,'unsupported');assert.match(absent.game.field.stop!.message,/body is absent/);assert.deepEqual(snapshot(absent),a);
 const media=vehicleLifecycleSessionFixture();delete media.game.field.content.characters.armor;assert.equal(media.game.field.startEvent('park'),true);const m=snapshot(media);media.game.advance(10);assert.equal(media.game.field.stop?.kind,'unsupported');assert.deepEqual(snapshot(media),m);assert.equal(media.game.field.actors[media.actorId],undefined);
});

test('a later source failure retains a committed phase and does not claim whole-script rollback',()=>{
 const f=vehicleLifecycleSessionFixture();assert.equal(f.game.field.startEvent('after_commit_failure'),true);f.game.advance(10);assert.equal(f.game.field.stop?.kind,'unsupported');assert.match(f.game.field.stop!.message,/after parking commit/);assert.equal(f.game.field.eventState.read(f.flag),1);assert(f.game.field.actors[f.actorId]);assert.equal(f.game.state.nativeState!.ownedTransportations.find(r=>r.id===f.id)!.mapId,901);assert.equal(f.game.field.transportationExecutions.length,1);assert.equal(f.game.checkpointReady,false);f.game.advance(100);assert.equal(f.game.field.transportationExecutions.length,1);
});

test('prepared/cancelled map creates no visible body and successful map publication retires old vehicle authority',()=>{
 const f=vehicleLifecycleSessionFixture();f.run('park');const map=f.target(),old=f.game.field,body=old.actors[f.actorId]!,before=snapshot(f);old.previewMap(902,f.content.entry.entrance);const pending=f.game.world.prepare(f.world,map);assert.equal(pending.field.actors[f.actorId],undefined);assert.deepEqual(snapshot(f),before);f.game.world.discard(pending);assert.equal(f.game.world.commit(pending),false);assert.deepEqual(snapshot(f),before);assert.equal(old.actors[f.actorId],body);
 const again=f.game.world.prepare(f.world,map);assert.equal(f.game.world.commit(again),true);f.game.advance(10);assert.notEqual(f.game.field,old);assert.equal(f.game.field.actors[f.actorId],undefined);assert.equal(old.vehicleLifecycleRetired,true);assert.throws(()=>old.checkpoint());assert.equal(old.startEvent('lose'),false);assert.equal(f.game.state.nativeState!.ownedTransportations.find(r=>r.id===f.id)!.mapId,901);
});

test('the shared lifecycle fence rejects reentry/stale/late retirement without a second state register',()=>{
 const owner=new FieldVehicleLifecycle();let value=1;const t=owner.prepare('lose',()=>String(value));assert.throws(()=>owner.prepare('active',()=>''),/already/);value=2;assert.throws(()=>t.commit(()=>{value=3;}),/Stale/);assert.equal(value,2);t.cancel();const fresh=owner.prepare('position',()=>String(value));owner.retire();assert.throws(()=>fresh.commit(()=>{value=4;}),/Stale/);assert.equal(value,2);assert.equal(fieldVehicleActorId(71),'web:source-transportation:71');
});

test('source-bound transportation foot confirmation runs one original VM and waits for its actual completion',()=>{
 const f=vehicleLifecycleSessionFixture({footAction:'normal'}),field=f.game.field;assert.equal(field.busy,false);field.confirm();assert.equal(field.stop,null);assert.equal(field.busy,true);assert.equal(f.game.checkpointReady,false);
 f.game.advance(20);assert.equal(field.busy,true);assert(field.actors[f.actorId]);assert.equal(field.transportationExecutions.length,1);
 f.game.advance(200);assert.equal(field.busy,false);assert.equal(field.stop,null);assert.equal(f.game.checkpointReady,true);assert.equal(field.transportationExecutions.length,1);const saved=f.game.checkpoint(),restored=f.restore(saved);assert.deepEqual(restored.checkpoint(),saved);
});

test('source foot target/namespace/late failure gates are not empty callbacks or rolled-back source phases',()=>{
 const other=vehicleLifecycleSessionFixture({footAction:'normal',footTarget:44});other.game.field.confirm();assert.equal(other.game.field.stop,null);assert.equal(other.game.field.busy,false);assert.equal(other.game.field.transportationExecutions.length,0);
 const missing=vehicleLifecycleSessionFixture({footAction:'missing'}),before=snapshot(missing);missing.game.field.confirm();assert.match(missing.game.field.stop!.message,/original script namespace/);assert.deepEqual(snapshot(missing),before);
 const failed=vehicleLifecycleSessionFixture({footAction:'blocked'});failed.game.field.confirm();failed.game.advance(200);assert.equal(failed.game.field.stop?.kind,'unsupported');assert.match(failed.game.field.stop!.message,/failed after source commit/);assert.equal(failed.game.field.transportationExecutions.length,1);assert(failed.game.field.actors[failed.actorId]);assert.equal(failed.game.checkpointReady,false);failed.game.advance(100);assert.equal(failed.game.field.transportationExecutions.length,1);
});

test('parking converts map-local source cell units and stored layer once, with no camera/SetPos sentinel substitution',()=>{
 const record={id:74,mapId:91,position:{x:4,y:3,z:349},direction:2,timeStampTicks:'0'};
 assert.deepEqual(sourceVehicleParkingPose(record as any,{x:0,y:0,width:20,height:16}as any),{position:{x:-88,y:72,z:349},layer:9});
});

test('manual contact uses the same actual vehicle body and retains its unknown collision/boarding phase without movement',()=>{
 const f=vehicleLifecycleSessionFixture();f.run('park');const player=f.game.field.player,body=f.game.field.actors[f.actorId]!;
 // Controlled contact caller: choose the same actual actor-relative neighbour,
 // rather than authoring a transport/map ID or granting a collider shape.
 assert.notEqual(body.layer,null);player.x=body.x-1;player.y=body.y;player.layer=body.layer!;const before=snapshot(f),pose={x:player.x,y:player.y,direction:player.direction};
 assert.equal(f.game.field.move('right'),false);assert.match(f.game.field.stop!.message,/collision\/boarding phase/);assert.deepEqual(snapshot(f),before);assert.deepEqual({x:player.x,y:player.y,direction:player.direction},pose);
});
