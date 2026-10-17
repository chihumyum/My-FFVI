import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldViewChangeFixture,enterViewWorld,viewHost,viewReached } from './fixtures/field-view-change-session.js';
import { GameSession } from '../src/core/game-session.js';
import { GameBattleHandoff } from '../src/core/game-battle-handoff.js';
import { GameFlow } from '../src/core/game-flow.js';
import { CheckpointStorage } from '../src/core/saved-game.js';
const bird={kind:'change-view' as const,requestedViewType:1 as const,timeScale:1,wait:true};
test('nonworld Bird records the original request but changes no semantic/camera/party/actor owner',async()=>{
  const f=await fieldViewChangeFixture(),{game}=await f.make(),field=game.field,before=game.checkpoint(),player=field.player,entity=player.native!.entity;
  const p=field.prepareViewChange(bird);assert.equal(p.branchReturn,true);p.commit();assert.deepEqual(game.checkpoint(),before);assert.equal(field.currentView,null);assert.equal(field.viewChangeJournal.at(-1)!.requestedViewType,1);
  assert.equal(field.player,player);assert.equal(player.native!.entity,entity);assert.throws(()=>p.commit(),/Stale/);
});
test('actual VM world Bird and FlatBird2 change the same camera and party projection with a single Web clock join',async()=>{
  const f=await fieldViewChangeFixture(),{game,flow}=await f.make();await enterViewWorld(f,game,flow);const field=game.field,player=field.player,entity=player.native!.entity,plan=structuredClone(field.content.entry.viewPlan),owned=game.state.snapshot();
  assert(field.startEvent('view-slow'));assert.equal(field.currentView!.mapViewType,1);assert.equal(field.eventState.read(viewReached),0);assert.equal(game.checkpointReady,false);
  flow.pause(true);flow.advance(500,viewHost);assert.equal(field.eventState.read(viewReached),0);flow.pause(false);flow.advance(10,viewHost);assert.equal(field.eventState.read(viewReached),1);assert.equal(game.checkpointReady,true);
  assert.equal(field.partyActorCheckpoint!.context.camera.mapViewType,1);assert.equal(field.player,player);assert.equal(player.native!.entity,entity);assert.deepEqual(game.state.snapshot(),owned);assert.deepEqual(field.content.entry.viewPlan,plan);
  assert(field.startEvent('view-normal'));flow.advance(20,viewHost);assert.equal(field.currentView!.mapViewType,2);assert.equal(field.partyActorCheckpoint!.context.camera.mapViewType,2);assert.deepEqual(field.content.entry.viewPlan,plan);
  assert(field.startEvent('view-async'));flow.advance(10,viewHost);assert.equal(field.eventState.read(viewReached),3);assert.equal(game.checkpointReady,true);
});
test('late EventState ABA and replaced actor reject prepared view without partial party/camera publication; retry succeeds once',async()=>{
  const f=await fieldViewChangeFixture(),{game,flow}=await f.make();await enterViewWorld(f,game,flow);const field=game.field;
  const p=field.prepareViewChange(bird),before=game.checkpoint(),ref={category:'MapLocalVariable' as const,index:6};
  field.eventState.write(ref,1);field.eventState.write(ref,0);assert.throws(()=>p.commit(),/Stale/);assert.equal(field.currentView,null);assert.deepEqual(field.partyActorCheckpoint,before.world.field.partyActors);
  const q=field.prepareViewChange(bird),actor=field.player;field.actors[actor.id]={...actor};assert.throws(()=>q.commit(),/Stale/);field.actors[actor.id]=actor;
  const retry=field.prepareViewChange(bird);retry.commit();assert.equal(field.currentView!.mapViewType,1);assert.throws(()=>retry.commit(),/Stale/);assert.deepEqual(game.state.snapshot(),before.owned);
});
test('trusted factory replacement or revoked policy rejects a prepared change without granting saved/current view',async()=>{
  const f=await fieldViewChangeFixture(),{game,flow}=await f.make();await enterViewWorld(f,game,flow);const field=game.field,before=game.checkpoint();
  const runtime=Reflect.get(field,'nativeRuntime') as {mapLifecycle:{factory:object}},factory=runtime.mapLifecycle.factory,p=field.prepareViewChange(bird);
  runtime.mapLifecycle.factory=structuredClone(factory);assert.throws(()=>p.commit(),/Stale/);assert.deepEqual(game.checkpoint(),before);runtime.mapLifecycle.factory=factory;
  const q=field.prepareViewChange(bird);Reflect.set(field.options,'viewChange',undefined);assert.throws(()=>q.commit(),/Stale/);assert.deepEqual(game.checkpoint(),before);
});

test('stable Storage restore binds dynamic camera view to the trusted map/policy and rejects mismatched derived party view',async()=>{
  const f=await fieldViewChangeFixture(),{game,flow}=await f.make();await enterViewWorld(f,game,flow);game.field.prepareViewChange(bird).commit();
  const saved=game.checkpoint(),bytes=new Map<string,string>(),store=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>{bytes.set(k,v);}});(await store.prepareSave(saved,1)).commit();const stored=await store.load();assert.ok(stored);const loaded=stored.checkpoint;
  const dependencies={catalog:f.world,map:f.worldMap,initialized:{content:f.content,initialMap:f.map}},restored=GameSession.restore(loaded,undefined,f.battle,dependencies,f.runtime);
  assert.deepEqual(restored.checkpoint(),saved);assert.notEqual(restored.field,game.field);restored.advance(100);assert.deepEqual(restored.state.snapshot(),game.state.snapshot());
  assert.throws(()=>GameSession.restore(loaded,undefined,f.battle,dependencies));const wrong=structuredClone(loaded);wrong.world.field.partyActors!.context.camera.mapViewType=2;assert.throws(()=>GameSession.restore(wrong,undefined,f.battle,dependencies,f.runtime),/camera|view/);
  const malformed=structuredClone(loaded);assert.equal(malformed.world.field.camera!.kind,'field-camera-v3');if(malformed.world.field.camera!.kind==='field-camera-v3')malformed.world.field.camera!.view.binding.mapId=1;
  assert.throws(()=>GameSession.restore(malformed,undefined,f.battle,dependencies,f.runtime),/view|binding/);
  const rflow=new GameFlow(restored);rflow.start(restored);rflow.observeHost(viewHost);assert(rflow.move('right'));rflow.advance(240,viewHost);assert.equal(restored.field.currentView!.mapViewType,1);
});
test('map cancellation leaves dynamic view and native identities intact; successful transfer reconstructs destination view without copying the old view capability',async()=>{
  const f=await fieldViewChangeFixture(),{game,flow}=await f.make();await enterViewWorld(f,game,flow);game.field.prepareViewChange(bird).commit();
  for(const d of ['right','down','right','down'] as const){assert(flow.move(d));flow.advance(240,viewHost);}const field=game.field,old=field.currentView,owned=game.state.snapshot();assert.equal(field.stop?.kind,'map-transition');
  const cancelled=game.world.prepare(f.world,f.map);game.world.discard(cancelled);assert.equal(game.world.commit(cancelled),false);assert.equal(game.field,field);assert.deepEqual(field.currentView,old);assert.deepEqual(game.state.snapshot(),owned);
  const retry=game.world.prepare(f.world,f.map);assert.equal(game.world.commit(retry),true);flow.advance(10,viewHost);assert.notEqual(game.field,field);assert.equal(game.field.currentView,null);assert.equal(game.field.partyActorCheckpoint!.context.camera.mapViewType,0);
});

test('battle media failure and real victory return preserve dynamic view on the same Field and settle once',async()=>{
  const f=await fieldViewChangeFixture(),{game,flow}=await f.make();await enterViewWorld(f,game,flow);const field=game.field;field.prepareViewChange(bird).commit();
  const view=field.currentView,player=field.player,owned=game.state.snapshot();assert(field.startEvent('stone-battle'));assert.equal(field.stop?.kind,'encounter');const request=field.stop;
  let fail=true;const handoff=new GameBattleHandoff(flow,{prepareStart:async()=>{if(fail){fail=false;throw new Error('Controlled missing battle media');}return null;},prepareReturn:async()=>null,discard:()=>{}});
  assert.equal((await handoff.start()).status,'failed');assert.equal(field.stop,request);assert.deepEqual(field.currentView,view);assert.deepEqual(game.state.snapshot(),owned);
  assert.equal((await handoff.start()).status,'committed');const battle=game.battle!;
  for(let i=0;i<3000&&battle.phase==='active';i++){for(const actor of battle.ready)assert(battle.command(actor.id,10,battle.enemies[0]!.id,100));flow.advance(10,viewHost);}
  assert.equal(battle.phase,'victory');assert.equal((await handoff.return()).status,'committed');flow.advance(10,viewHost);
  assert.equal(game.field,field);assert.equal(field.player,player);assert.deepEqual(field.currentView,view);assert.equal(field.partyActorCheckpoint!.context.camera.mapViewType,1);assert(game.checkpointReady);
  const after=game.state.snapshot();assert.equal(after.completedBattles.length,owned.completedBattles.length+1);await assert.rejects(handoff.return());assert.deepEqual(game.state.snapshot(),after);
});

test('default runtime still rejects a reached source ChangeView and cannot grant a Web camera/controller through source data',async()=>{
  const f=await fieldViewChangeFixture(),game=await GameSession.prepareFrameworkNewGame(f.content,f.world,f.map,f.battle,{battleHandoff:'prepared'}),flow=new GameFlow(game);flow.start(game);flow.observeHost(viewHost);flow.advance(10,viewHost);
  const owned=game.state.snapshot();assert(game.field.startEvent('view-normal'));flow.advance(10,viewHost);assert.equal(game.field.stop?.kind,'unsupported');assert.equal(game.field.currentView,null);assert.equal(game.field.partyActorCheckpoint!.context.camera.mapViewType,0);assert.deepEqual(game.state.snapshot(),owned);
});
