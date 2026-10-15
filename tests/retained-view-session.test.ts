import test from 'node:test';
import assert from 'node:assert/strict';
import { retainedViewFixture,enterRetainedViewWorld,retainedViewHost as host } from './fixtures/retained-view-session.js';
import { WEB_FLAT_FIELD_VIEW_CHANGE as v1,WEB_FLAT_RETAINED_FIELD_VIEW_CHANGE as v2 } from '../src/core/field-view-change.js';
import { CheckpointStorage } from '../src/core/saved-game.js';
import { GameBattleHandoff } from '../src/core/game-battle-handoff.js';
import { GameCommands } from '../src/core/game-commands.js';
import type { FieldPuppetHostProviders } from '../src/core/field-puppet-effects.js';
const bird={kind:'change-view' as const,requestedViewType:1 as const,timeScale:1,wait:true};
test('explicit shared flat/retained policies execute world Bird and FlatBird2 without changing transport, media, parking or original entry',async()=>{
  for(const armor of [false,true])for(const nonperiodic of [false,true]){
    const h=await retainedViewFixture({armor,nonperiodic});enterRetainedViewWorld(h);
    const field=h.game.field,player=field.player,entity=player.native!.entity,owned=h.game.state.snapshot(),
      plan=structuredClone(field.content.entry.viewPlan),appearance=structuredClone(field.partyActorCheckpoint!.context.player),
      native=field.nativeActorStateFingerprint;
    for(const [name,view]of [['view-bird',1],['view-normal',2]] as const){
      assert(field.startEvent(name));h.flow.advance(10,host);assert.equal(field.stop,null,field.stop?.message);
      assert.equal(field.currentView!.mapViewType,view);assert.equal(field.currentView!.policy,v2);
      assert.equal(field.partyActorCheckpoint!.context.camera.mapViewType,view);
      assert.equal(field.player,player);assert.equal(player.native!.entity,entity);
      assert.deepEqual(field.partyActorCheckpoint!.context.player,appearance);assert.deepEqual(h.game.state.snapshot(),owned);
      assert.equal(field.nativeActorStateFingerprint,native);assert.deepEqual(field.content.entry.viewPlan,plan);
    }
    assert.equal(field.transportationId,armor?6:1);assert.equal(h.game.checkpointReady,true);
    const bytes=new Map<string,string>(),store=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>{bytes.set(k,v);}}),saved=h.game.checkpoint();
    (await store.prepareSave(saved,1)).commit();const loaded=(await store.load())!;
    assert.deepEqual(h.restore(loaded.checkpoint).checkpoint(),saved);
  }
});
test('v1 walking saves keep their original policy under v2; no saved data grants riding or an older host',async()=>{
  const walking=await retainedViewFixture({armor:false,runtime:{viewChange:v1}});enterRetainedViewWorld(walking);
  walking.game.field.prepareViewChange(bird).commit();const old=walking.game.checkpoint();
  const newer=walking.restore(old,{...walking.runtime,viewChange:v2});assert.deepEqual(newer.checkpoint(),old);
  assert.equal(newer.field.currentView!.policy,v1);
  const h=await retainedViewFixture();enterRetainedViewWorld(h);h.game.field.prepareViewChange(bird).commit();const saved=h.game.checkpoint();
  assert.throws(()=>h.restore(saved,{...h.runtime,viewChange:v1}),/policy|view/i);
  const {retainedWorldTransportation:_,...withoutRetained}=h.runtime;assert.throws(()=>h.restore(saved,withoutRetained));
  const forged=structuredClone(saved);assert.equal(forged.world.field.camera!.kind,'field-camera-v3');
  if(forged.world.field.camera!.kind==='field-camera-v3')forged.world.field.camera!.view.policy=v1;
  assert.throws(()=>h.restore(forged),/riding|transport/i);
});
test('v1 riding and nonworld Normal remain gated while nonworld Bird returns before any riding applicability read',async()=>{
  const h=await retainedViewFixture({runtime:{viewChange:v1}}),before=h.game.checkpoint();
  const returned=h.game.field.prepareViewChange(bird);assert(returned.branchReturn);returned.commit();assert.deepEqual(h.game.checkpoint(),before);
  assert.throws(()=>h.game.field.prepareViewChange({...bird,requestedViewType:0}),/transport|riding/i);
  enterRetainedViewWorld(h);const state=h.game.checkpoint();assert.throws(()=>h.game.field.prepareViewChange(bird),/transport|riding/i);assert.deepEqual(h.game.checkpoint(),state);
  const v=await retainedViewFixture();assert.throws(()=>v.game.field.prepareViewChange({...bird,requestedViewType:0}),/policy|world/i);
});
test('late policy, owned source and EventState changes reject a prepared riding view atomically; clean retry commits once',async()=>{
  const h=await retainedViewFixture();enterRetainedViewWorld(h);const field=h.game.field,before=h.game.checkpoint();
  const p=field.prepareViewChange(bird);Reflect.set(field.options,'retainedWorldTransportation',undefined);
  assert.throws(()=>p.commit(),/Stale/);assert.deepEqual(h.game.checkpoint(),before);
  Reflect.set(field.options,'retainedWorldTransportation',h.runtime.retainedWorldTransportation);
  const q=field.prepareViewChange(bird),port=field.options.transportation!;
  Reflect.set(field.options,'transportation',{...port});assert.throws(()=>q.commit(),/Stale/);assert.deepEqual(h.game.checkpoint(),before);
  Reflect.set(field.options,'transportation',port);
  const r=field.prepareViewChange(bird),ref={category:'MapLocalVariable' as const,index:6};field.eventState.write(ref,1);field.eventState.write(ref,0);
  assert.throws(()=>r.commit(),/Stale/);assert.equal(field.currentView,null);
  const retry=field.prepareViewChange(bird);retry.commit();assert.equal(field.currentView!.mapViewType,1);assert.throws(()=>retry.commit(),/Stale/);
});
test('riding view refuses missing profiles, unavailable ownership, unknown source identity and changed inner/outer or material bindings',async()=>{
  for(const [index,change]of [
    (h:Awaited<ReturnType<typeof retainedViewFixture>>)=>{delete h.game.field.content.developmentProfile!.transportation;},
    (h:Awaited<ReturnType<typeof retainedViewFixture>>)=>{delete h.game.field.content.developmentProfile!.worldMap;},
    (h:Awaited<ReturnType<typeof retainedViewFixture>>)=>{h.game.field.eventState.write({category:'TreasureFlag4',index:137},0);},
    (h:Awaited<ReturnType<typeof retainedViewFixture>>)=>{Reflect.set(h.game.field.options,'transportation',{...h.game.field.options.transportation!,read:()=>[]});},
    (h:Awaited<ReturnType<typeof retainedViewFixture>>)=>{h.game.field.options.transportation!.catalog.definitions.find(row=>row.id===h.game.field.transportationId)!.assetId=999;},
    (h:Awaited<ReturnType<typeof retainedViewFixture>>)=>{h.game.field.player.native!.entity.riderAssetId=999;},
    (h:Awaited<ReturnType<typeof retainedViewFixture>>)=>{h.game.field.player.native!.fieldAssetId=999;},
    (h:Awaited<ReturnType<typeof retainedViewFixture>>)=>{h.game.field.player.native!.entity.viewBinding=null;},
    (h:Awaited<ReturnType<typeof retainedViewFixture>>)=>{const prior=Reflect.get(h.game.field,'nativeActorProviders') as ()=>FieldPuppetHostProviders;
      Reflect.set(h.game.field,'nativeActorProviders',()=>({...prior(),transportationType:null}));},
  ].entries()){
    const h=await retainedViewFixture();enterRetainedViewWorld(h);change(h);
    const field=h.game.field,view=field.currentView,camera=field.cameraSnapshot,party=field.partyActorCheckpoint,owned=h.game.state.snapshot();
    assert.throws(()=>field.prepareViewChange(bird),/./,'guard case '+index);assert.deepEqual(field.currentView,view);assert.deepEqual(field.cameraSnapshot,camera);
    assert.deepEqual(field.partyActorCheckpoint,party);assert.deepEqual(h.game.state.snapshot(),owned);
  }
});
test('riding dynamic view survives map cancellation and transfers with existing native identities, then can be used on a second world entry',async()=>{
  const h=await retainedViewFixture();enterRetainedViewWorld(h);h.game.field.prepareViewChange(bird).commit();
  const old=h.game.field,view=old.currentView,owned=h.game.state.snapshot();assert(old.startEvent('world-return'));h.flow.advance(10,host);
  const candidate=h.game.world.prepare(h.world,h.map);h.game.world.discard(candidate);assert.equal(h.game.world.commit(candidate),false);
  assert.equal(h.game.field,old);assert.deepEqual(old.currentView,view);assert.deepEqual(h.game.state.snapshot(),owned);
  assert(h.game.world.commit(h.game.world.prepare(h.world,h.map)));h.flow.advance(10,host);assert.equal(h.game.field.currentView,null);
  assert.equal(h.game.field.transportationId,6);assert.equal(h.game.field.player.native!.entity.riding,true);
  enterRetainedViewWorld(h);h.game.field.prepareViewChange({...bird,requestedViewType:0}).commit();
  assert.equal(h.game.field.currentView!.mapViewType,2);assert.deepEqual(h.game.state.snapshot().nativeState!.ownedTransportations,owned.nativeState!.ownedTransportations);
});
test('event save restores the riding view without replay and resumes the original continuation once',async()=>{
  const h=await retainedViewFixture();enterRetainedViewWorld(h);h.game.field.prepareViewChange(bird).commit();
  const view=h.game.field.currentView,parking=structuredClone(h.game.state.snapshot().nativeState!.ownedTransportations);
  assert(h.game.field.startEvent('world-save'));h.flow.advance(10,host);assert(h.game.eventSaveRequest);
  const pending=h.game.prepareEventSave(h.game.eventSaveRequest),restored=h.restore(pending.checkpoint);
  assert.deepEqual(restored.field.currentView,view);assert.equal(restored.eventSaveRequest,null);
  pending.commitWith(()=>{});h.flow.advance(10,host);restored.advance(10);
  assert.deepEqual(restored.checkpoint(),h.game.checkpoint());assert.deepEqual(restored.state.snapshot().nativeState!.ownedTransportations,parking);
});
test('battle media failure and settled return retain the same riding field, view and parking owner',async()=>{
  const h=await retainedViewFixture();enterRetainedViewWorld(h);h.game.field.prepareViewChange(bird).commit();
  const field=h.game.field,view=field.currentView,parking=structuredClone(h.game.state.snapshot().nativeState!.ownedTransportations);
  assert(field.startEvent('world-fight'));h.flow.advance(10,host);let fail=true;
  const handoff=new GameBattleHandoff(h.flow,{prepareStart:async()=>{if(fail)throw Error('held media');return {};},prepareReturn:async()=>({}),discard(){}});
  assert.equal((await handoff.start()).status,'failed');assert.equal(h.game.field,field);assert.deepEqual(field.currentView,view);
  fail=false;assert.equal((await handoff.start()).status,'committed');const commands=new GameCommands(h.flow,h.game);
  for(let i=0;i<2000&&h.game.battle!.phase==='active';i++){
    const battle=h.game.battle!;for(const actor of battle.ready){const enemy=battle.enemies.find(e=>e.hp>0);if(enemy)commands.command(battle,actor.id,10,{kind:'single',id:enemy.id},100);}h.flow.advance(20,host);
  }
  assert.equal(h.game.battle!.phase,'victory');assert.equal((await handoff.return()).status,'committed');h.flow.advance(20,host);
  assert.equal(h.game.field,field);assert.deepEqual(field.currentView,view);assert.deepEqual(h.game.state.snapshot().nativeState!.ownedTransportations,parking);
  const saved=h.game.checkpoint();assert.deepEqual(h.restore(saved).checkpoint(),saved);
});
