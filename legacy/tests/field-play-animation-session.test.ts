import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldMoveToSessionFixture } from './fixtures/field-move-to-session.js';
import { sourceEncounterSessionFixture } from './fixtures/source-encounter-session.js';
import { sealBatchContent as seal } from './fixtures/content-batch.js';
import { NewGameFieldEntry } from '../src/core/new-game-field-entry.js';
import { GameSession } from '../src/core/game-session.js';
import { GameFlow } from '../src/core/game-flow.js';
import { GameCommands } from '../src/core/game-commands.js';
import { GameBattleHandoff } from '../src/core/game-battle-handoff.js';
import { GameMapLoader } from '../src/core/game-map-loader.js';
import { GameContentRepository } from '../src/core/game-content.js';
import { GameEventSaveCoordinator } from '../src/core/game-event-save.js';
import { CheckpointStorage } from '../src/core/saved-game.js';
import type { Op, Site } from '../src/field/types.js';
type Instruction<T=Op> = T extends Site ? Omit<T,keyof Site> : never;
const source={file:'controlled-finite-animation',assetPath:'Fixtures/FiniteAnimation/v1'};
const host={visible:true,mediaReady:true,overlayOpen:false};
const counter={category:'MapLocalVariable' as const,index:7};
async function fixture(options:{target?:boolean;battle?:boolean}={}) {
 const f=options.battle?sourceEncounterSessionFixture():await fieldMoveToSessionFixture(),map=structuredClone(f.map),world=structuredClone(f.world);
 const add=(name:string,ops:Instruction[])=>{
  map.scripts[name]=ops.map((op,index)=>({...op,script:name,index,source}) as Op);
  map.scriptPuppetContexts![name]={...map.scriptPuppetContexts!.reserved!,scriptHash:'8'.repeat(64)};
  (map.scriptLocals??={})[name]=null;(map.scriptTransitionMetadata??={})[name]={customAnimations:'none'};
  (map.scriptSystemFlags??={})[name]={keepBadStatusVisual:false};
 };
 add('finite-save',[
  {kind:'puppet',slot:0,actor:'-1001',target:6},{kind:'exec-puppets',asynchronous:false},{kind:'finish-puppets'},
  {kind:'calc',left:counter,operator:'＋',right:{kind:'immediate',value:1}},{kind:'event-save'},{kind:'exit'},{kind:'nop'},
  {kind:'animation-play',animation:'Default',speed:2,loop:false,repeatCount:3},{kind:'exit'},
 ]);
 add('native-finite-main',[
  {kind:'animation-play',animation:'Default',speed:2,loop:false,repeatCount:3},
  {kind:'event-save'},{kind:'calc',left:counter,operator:'＋',right:{kind:'immediate',value:1}},{kind:'exit'},
 ]);
 let target=options.target?structuredClone(map):undefined;
 if(target){target.mapId=map.mapId+1;target.map!.identity!.mapId=target.mapId;
  target.partyEntry!.mapId=target.mapId;target.map!.entryContext!.mapId=target.mapId;
  const points=target.map!.groups!.entity_default!.entities.filter(e=>e.kind===0);target.map!.groups!.entity_default!.entities=points;target.map!.entities=structuredClone(points);
  if(target.cameraHost)target.cameraHost.mapRange=target.partyEntry!.mapRange;
  target.scripts={arrived:[{kind:'exit',script:'arrived',index:0,source}]};target.initializer='arrived';target.scriptLocals={arrived:null};
  target.scriptPuppetContexts={arrived:{...map.scriptPuppetContexts!.reserved!,scriptHash:'7'.repeat(64)}};
  add('finite-leave',[
   {kind:'puppet',slot:0,actor:'-1001',target:5},{kind:'exec-puppets',asynchronous:true},{kind:'wait',seconds:.03},
   {kind:'change-map',request:{mapId:target.mapId,entrance:target.partyEntry!.pointIns[0]!.id,continuation:null,birdview:false,skipFade:true,skipBgm:true,origin:'script'}},
   {kind:'exit'},{kind:'nop'},{kind:'animation-play',animation:'Default',speed:.5,loop:false,repeatCount:23},{kind:'exit'},
  ]);target=seal(target);world.transportation=structuredClone(f.battle.gameState.sourceNewGame!.transportation);world.maps[String(target.mapId)]={...world.maps[String(map.mapId)]!,url:'/finite-target.json',contentHash:target.contentHash,name:target.name};
 }
 if(options.battle)add('finite-fight',[
  {kind:'puppet',slot:0,actor:'-1001',target:5},{kind:'exec-puppets',asynchronous:true},{kind:'wait',seconds:.03},
  {kind:'encounter',party:Number(Object.keys(f.battle.encounters)[0]),continuation:'source-after'},{kind:'exit'},
  {kind:'nop'},{kind:'animation-play',animation:'Default',speed:.5,loop:false,repeatCount:23},{kind:'exit'},
 ]);
 const sealed=seal(map);world.maps[String(map.mapId)]!.contentHash=sealed.contentHash;const catalog=seal(world),entry=seal({...f.content,worldCatalogHash:catalog.contentHash,mapContentHash:sealed.contentHash});
 const runtime={battleHandoff:'prepared' as const};
 function launch(){const seq=new NewGameFieldEntry(entry.entry,f.presentation),start=seq.prepareStart(f.fade,{active:true,callbacks:'absent'});start.commit();let fade=start.fade;fade.advance(.5);
  for(let i=0;i<3;i++){const next=seq.prepareResume(fade,true)!;next.commit();fade=next.fade;}
  const game=GameSession.prepareNewGame(entry,catalog,sealed,f.battle,fade,f.presentation,runtime);
  const ticket=seq.prepareLaunch(fade,game.newGamePreparation(true));game.launchNewGame(ticket.launch);ticket.commit();
  const flow=new GameFlow(game);flow.start();flow.observeHost(host);for(let i=0;i<100&&!game.checkpointReady;i++)flow.advance(10,host);
  assert.equal(game.field.stop,null,game.field.stop?.message);assert.ok(game.checkpointReady);return {game,flow,commands:new GameCommands(flow,game)};}
 const repository=new GameContentRepository(async url=>{if(url==='/world/catalog.json')return catalog;if(url==='/finite-target.json'&&target)return target;throw Error('Undeclared finite fixture input '+url);});
 return {...launch(),repository,target,launch,restore:(saved:ReturnType<GameSession['checkpoint']>)=>GameSession.restore(saved,undefined,f.battle,{catalog,map:sealed,source:{content:entry,initialMap:sealed}},runtime)};
}
function tick(f:Awaited<ReturnType<typeof fixture>>,until:()=>boolean,max=3000){for(let i=0;i<max&&!until();i++){assert.equal(f.game.field.stop,null,f.game.field.stop?.message);f.flow.advance(10,host);}assert.ok(until());}

test('native source puppet repeats share the actual actor identity, honor paused Flow and reach finish/save only after three plays',async()=>{
 const f=await fixture(),g=f.game,field=g.field,owned=g.state;assert.equal(field.startEvent('finite-save'),true);
 tick(f,()=>field.finiteAnimationExecutions.length>0);const actor=field.actors['native:puppet:0']!,entity=actor.native!.entity;
 const before={time:field.time,animation:actor.animation!.snapshot(),trace:field.finiteAnimationExecutions};
 f.flow.advance(5000,{...host,overlayOpen:true});assert.deepEqual({time:field.time,animation:actor.animation!.snapshot(),trace:field.finiteAnimationExecutions},before);
 tick(f,()=>!!g.eventSaveRequest);assert.equal(field.actors[actor.id],actor);assert.equal(actor.native!.entity,entity);assert.equal(g.state,owned);
 assert.deepEqual(field.finiteAnimationExecutions.map(x=>x.phase),['started','replayed','replayed','completed']);
 assert.equal(field.eventState.read(counter),1);assert.equal(g.checkpointReady,false);
});

test('quota failure and cancelled encoding preserve the completed source plays; durable retry/restore resume after barrier once',async()=>{
 const f=await fixture(),field=f.game.field;field.startEvent('finite-save');tick(f,()=>!!f.game.eventSaveRequest);
 const bytes=new Map<string,string>();let quota=true;const storage=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>{if(quota)throw Error('finite quota');bytes.set(k,v);}}),coordinator=new GameEventSaveCoordinator(f.flow,storage),request=f.game.eventSaveRequest,trace=field.finiteAnimationExecutions;
 assert.equal((await coordinator.save(1)).status,'failed');assert.equal(f.game.eventSaveRequest,request);assert.deepEqual(field.finiteAnimationExecutions,trace);assert.equal(bytes.size,0);
 let release!:()=>void,entered!:()=>void;const held=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r);
 const cancelled=new GameEventSaveCoordinator(f.flow,{prepareSave:async(...args)=>{const save=await storage.prepareSave(...args);entered();await held;return save;}});
 quota=false;const pending=cancelled.save(2);await ready;cancelled.cancel();release();assert.equal((await pending).status,'cancelled');assert.equal(bytes.size,0);assert.equal(f.game.eventSaveRequest,request);
 assert.equal((await coordinator.save(3)).status,'committed');const loaded=(await storage.load())!,restored=f.restore(loaded.checkpoint);
 assert.deepEqual(restored.field.finiteAnimationExecutions,[]);assert.equal(restored.field.eventState.read(counter),1);f.flow.advance(10,host);restored.advance(10);
 assert.deepEqual(restored.checkpoint(),f.game.checkpoint());restored.advance(1000);assert.equal(restored.field.eventState.read(counter),1);assert.deepEqual(field.finiteAnimationExecutions,trace);
});

test('native main Core finite counter survives the same strict event codec without restart',async()=>{
 const f=await fixture();f.game.field.startEvent('native-finite-main');tick(f,()=>!!f.game.eventSaveRequest);
 const request=f.game.eventSaveRequest!,save=f.game.prepareEventSave(request).checkpoint;
 assert.ok('execution' in save.world.field);assert.deepEqual(save.world.field.execution.main.generalRegisters!.i,[0,3,0,0,0,0,0,0]);
 const r=f.restore(save);assert.deepEqual(r.field.finiteAnimationExecutions,[]);f.game.field.acknowledgeEventSave(request);f.flow.advance(10,host);r.advance(10);
 assert.equal(r.field.eventState.read(counter),1);assert.deepEqual(r.checkpoint(),f.game.checkpoint());
});

test('map media failure/cancel/retry never clocks suspended finite playback or retargets its captured actor to the new map',async()=>{
 const f=await fixture({target:true}),field=f.game.field;field.startEvent('finite-leave');
 tick(f,()=>!!field.stop);assert.equal(field.stop?.kind,'map-transition');assert.equal(field.finiteAnimationExecutions.length,1);
 const actor=field.actors['native:puppet:0']!,before={time:field.time,animation:actor.animation!.snapshot(),trace:field.finiteAnimationExecutions};
 let mode='fail',release!:(v:null)=>void,entered!:()=>void;const ready=new Promise<void>(r=>entered=r);
 const loader=new GameMapLoader(f.flow,f.repository,{prepare:async()=>{if(mode==='fail')throw Error('finite media failure');if(mode==='hold'){entered();return new Promise<null>(r=>release=r);}return null;},discard(){}});
 const failed=await loader.load();assert.equal(failed.status,'failed');if(failed.status==='failed')assert.match(String(failed.error),/finite media failure/);assert.deepEqual({time:field.time,animation:actor.animation!.snapshot(),trace:field.finiteAnimationExecutions},before);
 mode='hold';const pending=loader.load();await Promise.race([ready,pending.then(result=>assert.fail('Loader stopped before media hold: '+JSON.stringify(result)))]);f.flow.advance(5000,host);loader.cancel();release(null);assert.equal((await pending).status,'cancelled');assert.equal(f.game.field,field);
 mode='ok';assert.equal((await loader.load()).status,'committed');assert.notEqual(f.game.field,field);assert.notEqual(f.game.field.actors['native:puppet:0'],actor);
 field.advance(5000);assert.deepEqual({time:field.time,animation:actor.animation!.snapshot(),trace:field.finiteAnimationExecutions},before);
 f.flow.advance(10,host);assert.deepEqual(f.game.field.finiteAnimationExecutions,[]);assert.ok(f.game.checkpointReady);
});


test('prepared battle failure/cancel freezes finite playback; the existing source return replaces obsolete coroutines without replay',async()=>{
 const f=await fixture({battle:true}),field=f.game.field;field.startEvent('finite-fight');tick(f,()=>!!field.stop);
 assert.equal(field.stop?.kind,'encounter');assert.equal(field.finiteAnimationExecutions.length,1);
 const actor=field.actors['native:puppet:0']!,before={time:field.time,animation:actor.animation!.snapshot(),trace:field.finiteAnimationExecutions};
 let mode='fail',release!:(v:null)=>void;const handoff=new GameBattleHandoff(f.flow,{prepareStart:async()=>{if(mode==='fail')throw Error('finite battle media');if(mode==='hold')return new Promise<null>(r=>release=r);return null;},prepareReturn:async()=>null,discard(){}});
 const failed=await handoff.start();assert.equal(failed.status,'failed');if(failed.status==='failed')assert.match(String(failed.error),/finite battle media/);
 mode='hold';const pending=handoff.start();await new Promise<void>(r=>setImmediate(r));f.flow.advance(5000,host);handoff.cancel();release(null);assert.equal((await pending).status,'cancelled');
 assert.deepEqual({time:field.time,animation:actor.animation!.snapshot(),trace:field.finiteAnimationExecutions},before);
 mode='ok';assert.equal((await handoff.start()).status,'committed');const battle=f.game.battle!;
 for(let i=0;i<3000&&battle.phase==='active';i++){for(const p of battle.ready){const target=battle.enemies.find(e=>e.hp>0);if(target)f.commands.command(battle,p.id,10,{kind:'single',id:target.id},100);}f.flow.advance(20,host);}
 assert.equal(battle.phase,'victory');assert.deepEqual({time:field.time,animation:actor.animation!.snapshot(),trace:field.finiteAnimationExecutions},before);
 assert.equal((await handoff.return()).status,'committed');assert.equal(f.game.field,field);f.flow.advance(1000,host);assert.equal(field.stop,null);
 assert.deepEqual(field.finiteAnimationExecutions,before.trace,'existing source continuation replaces the old Core; it must not run its remaining repeats');
 assert.ok(f.game.checkpointReady);const saved=f.game.checkpoint(),restored=f.restore(saved);assert.deepEqual(restored.checkpoint(),saved);restored.advance(1000);assert.deepEqual(restored.field.finiteAnimationExecutions,[]);
});
