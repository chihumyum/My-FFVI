import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldMoveToSessionFixture } from './fixtures/field-move-to-session.js';
import { sourceEncounterSessionFixture } from './fixtures/source-encounter-session.js';
import { sealBatchContent as seal } from './fixtures/content-batch.js';
import { compileSourceScriptAnimations } from '../src/compiler/source-script-animations.js';
import { compileEventScriptTransitionMetadata } from '../src/compiler/event-script-transition.js';
import { SOURCE_FORMAT_FLAG_IMPORT } from '../src/core/source-format-import.js';
import { NewGameFieldEntry } from '../src/core/new-game-field-entry.js';
import { GameSession } from '../src/core/game-session.js';
import { GameFlow } from '../src/core/game-flow.js';
import { GameCommands } from '../src/core/game-commands.js';
import { GameBattleHandoff } from '../src/core/game-battle-handoff.js';
import { GameMapLoader } from '../src/core/game-map-loader.js';
import { GameContentRepository } from '../src/core/game-content.js';
import { GameEventSaveCoordinator } from '../src/core/game-event-save.js';
import { CheckpointStorage } from '../src/core/saved-game.js';
import type { SourceCustomAnimation } from '../src/core/source-script-animations.js';
import type { Op, Site } from '../src/field/types.js';
import { hash } from '../src/compiler/content.js';
type Instruction<T=Op> = T extends Site ? Omit<T,keyof Site> : never;
const host={visible:true,mediaReady:true,overlayOpen:false},counter={category:'MapLocalVariable' as const,index:7};
const physical={file:'authored-animation.bundle',assetPath:'Authored/CustomAnimation',objectId:'-9007199254740995',serializedFile:'authored-cab',sha256:'a'.repeat(64)};
function definition(name:string,x:number):SourceCustomAnimation{return {name,frames:[{sprite_name:'body',offsetx:x,offsety:0,alpha:1,rgb:{r:1,g:1,b:1,a:1},flip:false}],play_mode:0,play_speed:.03,is_reverse:false,next_anim_name:''};}
async function fixture(options:{target?:boolean;battle?:boolean;bad?:boolean;wrongPhysical?:boolean}={}) {
 const f=options.battle?sourceEncounterSessionFixture():await fieldMoveToSessionFixture(),map=structuredClone(f.map),world=structuredClone(f.world);
 const sources=[{file:'GameAssembly.dll',sha256:SOURCE_FORMAT_FLAG_IMPORT.nativeSha256},{file:physical.file,sha256:physical.sha256}],sourceSetHash=hash(sources),parentSourceSetHash='d'.repeat(64);
 map.sourceSetHash=sourceSetHash;map.parentSourceSetHash=parentSourceSetHash;world.sourceSetHash=sourceSetHash;world.parentSourceSetHash=parentSourceSetHash;
 for(const name of Object.keys(map.scripts))(map.scriptTransitionMetadata??={})[name]={customAnimations:'none'};
 const programs:Record<string,Instruction[]>={
  'after-custom-battle':[{kind:'animation-cue',animation:'Other',frame:0},{kind:'event-save'},{kind:'exit'}],
  a:[{kind:'animation-cue',animation:'Pose',frame:0},{kind:'event-save'},{kind:'exit'}],
  b:[{kind:'animation-cue',animation:'Pose',frame:0},{kind:'event-save'},{kind:'exit'}],
  finite:[{kind:'animation-play',animation:'Pose',speed:1,loop:false,repeatCount:2},{kind:'event-save'},{kind:'exit'}],
  caller:[{kind:'animation-cue',animation:'Pose',frame:0},{kind:'script-transition',targetScript:'callee',returnToCaller:true},{kind:'event-save'},{kind:'exit'}],
  callee:[{kind:'nop'},{kind:'animation-cue',animation:'Other',frame:0},{kind:'event-save'},{kind:'exit'}],
  fail:[{kind:'animation-cue',animation:'Bad',frame:0},{kind:'calc',left:counter,operator:'＋',right:{kind:'immediate',value:1}},{kind:'exit'}],
 };
 if(options.battle)programs.fight=[{kind:'animation-cue',animation:'Pose',frame:0},{kind:'encounter',party:Number(Object.keys(f.battle.encounters)[0]),continuation:'after-custom-battle'},{kind:'exit'}];
 const assets=Object.entries(programs).map(([name],index)=>({id:name,kind:'script' as const,source:{...physical,assetPath:physical.assetPath+'/'+name+'.json',objectId:String(BigInt(physical.objectId)-BigInt(index))},data:{SystemFlag:{},Animations:[definition('Pose',name==='b'?20:10),definition('Other',30),{...definition('Bad',40),play_mode:2}]}}));
 if(options.bad)assets.find(a=>a.id==='a')!.data.Animations[0]!.frames[0]!.sprite_name='missing';
 const compiled=compileSourceScriptAnimations({sourceSetHash,manifest:{parentSourceSetHash,sources},assets});assert.equal(compiled.rejected.length,0);world.sourceScriptAnimations=compiled.catalog;
 for(const asset of assets){const name=asset.id,source=options.wrongPhysical&&name==='a'?{...asset.source,objectId:'100'}:asset.source;
  map.scripts[name]=programs[name]!.map((op,index)=>({...op,script:name,index,source})as Op);
  map.scriptPuppetContexts![name]={...map.scriptPuppetContexts!.reserved!,skipInitialize:true,keepPlayerPuppet:true,scriptHash:hash(asset.data)};
  (map.scriptLocals??={})[name]=null;(map.scriptTransitionMetadata??={})[name]=compileEventScriptTransitionMetadata(asset.data,{catalog:compiled.catalog,assetId:compiled.byProgram[name]!});
  (map.scriptSystemFlags??={})[name]={keepBadStatusVisual:false};
 }
 let target=options.target?structuredClone(map):undefined;
 if(target){target.mapId=map.mapId+1;target.map!.identity!.mapId=target.mapId;target.partyEntry!.mapId=target.mapId;target.map!.entryContext!.mapId=target.mapId;
  const points=target.map!.groups!.entity_default!.entities.filter(e=>e.kind===0);target.map!.groups!.entity_default!.entities=points;target.map!.entities=structuredClone(points);
  target.scripts={arrived:[{kind:'exit',script:'arrived',index:0,source:physical}]};target.initializer='arrived';target.scriptLocals={arrived:null};target.scriptTransitionMetadata={arrived:{customAnimations:'none'}};
  target.scriptPuppetContexts={arrived:{...map.scriptPuppetContexts!.reserved!,scriptHash:'7'.repeat(64)}};
  map.scripts.leave=[{kind:'change-map',request:{mapId:target.mapId,entrance:target.partyEntry!.pointIns[0]!.id,continuation:null,birdview:false,skipFade:true,skipBgm:true,origin:'script'},script:'leave',index:0,source:physical}];
  map.scriptPuppetContexts!.leave={...map.scriptPuppetContexts!.a!,scriptHash:'5'.repeat(64)};map.scriptLocals!.leave=null;map.scriptTransitionMetadata!.leave={customAnimations:'none'};
  target=seal(target);world.transportation=structuredClone(f.battle.gameState.sourceNewGame!.transportation);world.maps[String(target.mapId)]={...world.maps[String(map.mapId)]!,url:'/custom-target.json',contentHash:target.contentHash,name:target.name};
 }
 const sealed=seal(map);world.maps[String(map.mapId)]!.contentHash=sealed.contentHash;const catalog=seal(world),entry=seal({...f.content,sourceSetHash,parentSourceSetHash,worldCatalogHash:catalog.contentHash,mapContentHash:sealed.contentHash});
 const runtime={battleHandoff:'prepared' as const};
 function launch(){const seq=new NewGameFieldEntry(entry.entry,f.presentation),start=seq.prepareStart(f.fade,{active:true,callbacks:'absent'});start.commit();let fade=start.fade;fade.advance(.5);
  for(let i=0;i<3;i++){const next=seq.prepareResume(fade,true)!;next.commit();fade=next.fade;}
  const game=GameSession.prepareNewGame(entry,catalog,sealed,f.battle,fade,f.presentation,runtime),ticket=seq.prepareLaunch(fade,game.newGamePreparation(true));game.launchNewGame(ticket.launch);ticket.commit();
  const flow=new GameFlow(game);flow.start();flow.observeHost(host);for(let i=0;i<100&&!game.checkpointReady;i++)flow.advance(10,host);
  assert.equal(game.field.stop,null,game.field.stop?.message);assert.ok(game.checkpointReady);return {game,flow,commands:new GameCommands(flow,game)};}
 const repository=new GameContentRepository(async url=>{if(url==='/world/catalog.json')return catalog;if(url==='/custom-target.json'&&target)return target;throw Error('Undeclared custom fixture '+url);});
 return {...launch(),entry,catalog,map:sealed,target,repository,launch,assetIds:compiled.byProgram,
  restore:(saved:ReturnType<GameSession['checkpoint']>)=>GameSession.restore(saved,undefined,f.battle,{catalog,map:saved.world.location?.mapId===target?.mapId?target!:sealed,source:{content:entry,initialMap:sealed}},runtime)};
}
function tick(f:Awaited<ReturnType<typeof fixture>>,until:()=>boolean,max=3000){for(let i=0;i<max&&!until();i++){assert.equal(f.game.field.stop,null,f.game.field.stop?.message);f.flow.advance(10,host);}assert.ok(until());}
function actor(f:Awaited<ReturnType<typeof fixture>>){return f.game.field.actors['-1001']!;}
function event(f:Awaited<ReturnType<typeof fixture>>,script:string){assert.equal(f.game.field.startEvent(script),true);tick(f,()=>!!f.game.eventSaveRequest);}
function acknowledge(f:Awaited<ReturnType<typeof fixture>>){f.game.field.acknowledgeEventSave(f.game.eventSaveRequest!);tick(f,()=>f.game.checkpointReady);}

test('real native actor materializes only actual sprite media; same instance cache wins across root assets and durable idle restore',async()=>{
 const f=await fixture();event(f,'a');const a=actor(f),entity=a.native!.entity;assert.equal(a.animation!.frame().x,10);
 const checkpoint=f.game.prepareEventSave(f.game.eventSaveRequest!).checkpoint;assert.equal(checkpoint.world.field.kind,'event-field-v8');const restored=f.restore(checkpoint);assert.equal(restored.field.actors[a.id]!.animation!.frame().x,10);
 acknowledge(f);event(f,'b');assert.equal(actor(f),a);assert.equal(a.native!.entity,entity);assert.equal(a.animation!.frame().x,10,'loaded actor cache precedes new current asset');acknowledge(f);
 const saved=f.game.checkpoint();assert.equal(saved.world.field.kind,'idle-field-v17');const reloaded=f.restore(saved);assert.deepEqual(reloaded.checkpoint(),saved);assert.equal(JSON.stringify(saved).includes('sprite_name'),false);
});

test('ChangeScript and hook replace only current asset, keep actual cache, and checkpoint both contexts for next-clock return',async()=>{
 const f=await fixture();event(f,'caller');assert.equal(actor(f).animation!.frame().x,30);const save=f.game.prepareEventSave(f.game.eventSaveRequest!).checkpoint;
 assert.equal(save.world.field.kind,'event-field-v8');if(save.world.field.kind!=='event-field-v8')throw Error('wrong fixture version');assert.deepEqual(save.world.field.scriptAnimations,{kind:'source-field-script-animation-state-v1',catalogHash:f.catalog.sourceScriptAnimations!.contentHash,currentAsset:f.assetIds.callee,hookedAsset:f.assetIds.caller});
 const r=f.restore(save);f.game.field.acknowledgeEventSave(f.game.eventSaveRequest!);tick(f,()=>!!f.game.eventSaveRequest);r.advance(10);for(let i=0;i<100&&!r.eventSaveRequest;i++)r.advance(10);assert.ok(r.eventSaveRequest);assert.ok(f.game.eventSaveRequest);assert.deepEqual(r.prepareEventSave(r.eventSaveRequest).checkpoint,f.game.prepareEventSave(f.game.eventSaveRequest).checkpoint);
});

test('quota failure/cancelled storage preserve exact completed custom playback, retry resumes without reloading/replaying it',async()=>{
 const f=await fixture();event(f,'finite');assert.deepEqual(f.game.field.finiteAnimationExecutions.map(x=>x.phase),['started','replayed','completed']);
 const request=f.game.eventSaveRequest!,animation=actor(f).animation!.snapshot(),bytes=new Map<string,string>();let quota=true;const storage=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>{if(quota)throw Error('custom quota');bytes.set(k,v);}}),coordinator=new GameEventSaveCoordinator(f.flow,storage);
 assert.equal((await coordinator.save(1)).status,'failed');assert.equal(f.game.eventSaveRequest,request);assert.deepEqual(actor(f).animation!.snapshot(),animation);quota=false;
 let release!:()=>void,entered!:()=>void;const hold=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r);const cancelled=new GameEventSaveCoordinator(f.flow,{prepareSave:async(...args)=>{const prepared=await storage.prepareSave(...args);entered();await hold;return prepared;}});
 const pending=cancelled.save(2);await ready;cancelled.cancel();release();assert.equal((await pending).status,'cancelled');assert.equal(bytes.size,0);assert.equal(f.game.eventSaveRequest,request);
 assert.equal((await coordinator.save(3)).status,'committed');const r=f.restore((await storage.load())!.checkpoint);f.flow.advance(10,host);r.advance(10);assert.deepEqual(r.checkpoint(),f.game.checkpoint());assert.deepEqual(r.field.finiteAnimationExecutions,[]);
});

test('unsupported actual media fails before cache/playback publication and changed physical source is not granted',async()=>{
 const f=await fixture();const a=actor(f),before=a.animation!.snapshot();f.game.field.startEvent('fail');f.flow.advance(10,host);assert.match(f.game.field.stop?.message??'',/play mode 2/);assert.deepEqual(a.animation!.snapshot(),before);assert.equal(f.game.field.eventState.read(counter),0);
 const media=await fixture({bad:true}),old=actor(media).animation!.snapshot();media.game.field.startEvent('a');media.flow.advance(10,host);assert.match(media.game.field.stop?.message??'',/Missing actual actor sprite/);assert.deepEqual(actor(media).animation!.snapshot(),old);
 const physical=await fixture({wrongPhysical:true});physical.game.field.startEvent('a');assert.match(physical.game.field.stop?.message??'',/physical/);
});

test('failed/cancelled map preparation preserves cache; successful new instance with same identity cannot inherit old cache',async()=>{
 const f=await fixture({target:true});event(f,'a');acknowledge(f);const old=actor(f);f.game.field.startEvent('leave');tick(f,()=>!!f.game.field.stop);const snapshot=old.animation!.snapshot();let mode='fail',release!:(v:null)=>void,entered!:()=>void;const ready=new Promise<void>(r=>entered=r);
 const loader=new GameMapLoader(f.flow,f.repository,{prepare:async()=>{if(mode==='fail')throw Error('custom map media');if(mode==='hold'){entered();return new Promise<null>(r=>release=r);}return null;},discard(){}});
 assert.equal((await loader.load()).status,'failed');assert.equal(actor(f),old);assert.deepEqual(old.animation!.snapshot(),snapshot);
 mode='hold';const pending=loader.load();await Promise.race([ready,pending.then(x=>assert.fail(x.status+('error' in x?String(x.error):'')))]);loader.cancel();release(null);assert.equal((await pending).status,'cancelled');assert.equal(actor(f),old);
 mode='ok';assert.equal((await loader.load()).status,'committed');assert.notEqual(actor(f),old);assert.equal(actor(f).animation!.hasSourceCustomAnimations,false);const retired=old.animation!.snapshot();f.flow.advance(100,host);assert.deepEqual(old.animation!.snapshot(),retired);assert.ok(f.game.checkpointReady);assert.deepEqual(f.restore(f.game.checkpoint()).checkpoint(),f.game.checkpoint());
});


test('prepared battle failure/cancel and return keep field cache under the same owner; continuation installs its real asset before save',async()=>{
 const f=await fixture({battle:true}),field=f.game.field;field.startEvent('fight');tick(f,()=>!!field.stop);assert.equal(field.stop?.kind,'encounter');const old=actor(f),snapshot=old.animation!.snapshot();let mode='fail',release!:(v:null)=>void;
 const handoff=new GameBattleHandoff(f.flow,{prepareStart:async()=>{if(mode==='fail')throw Error('custom battle media');if(mode==='hold')return new Promise<null>(r=>release=r);return null;},prepareReturn:async()=>null,discard(){}});
 assert.equal((await handoff.start()).status,'failed');mode='hold';const pending=handoff.start();await new Promise<void>(r=>setImmediate(r));handoff.cancel();release(null);assert.equal((await pending).status,'cancelled');assert.equal(actor(f),old);assert.deepEqual(old.animation!.snapshot(),snapshot);
 mode='ok';assert.equal((await handoff.start()).status,'committed');const battle=f.game.battle!;
 for(let i=0;i<3000&&battle.phase==='active';i++){for(const p of battle.ready){const target=battle.enemies.find(e=>e.hp>0);if(target)f.commands.command(battle,p.id,10,{kind:'single',id:target.id},100);}f.flow.advance(20,host);}
 assert.equal(battle.phase,'victory');assert.deepEqual(old.animation!.snapshot(),snapshot);assert.equal((await handoff.return()).status,'committed');assert.equal(f.game.field,field);tick(f,()=>!!f.game.eventSaveRequest);assert.equal(actor(f).animation!.frame().x,30);
 const saved=f.game.prepareEventSave(f.game.eventSaveRequest!).checkpoint;const r=f.restore(saved);acknowledge(f);r.advance(10);assert.deepEqual(r.checkpoint(),f.game.checkpoint());
});

test('save data cannot supply definitions, changed catalog, unknown current refs or load caches without current trusted providers',async()=>{
 const f=await fixture();event(f,'a');const saved=f.game.prepareEventSave(f.game.eventSaveRequest!).checkpoint;assert.equal(saved.world.field.kind,'event-field-v8');if(saved.world.field.kind!=='event-field-v8')throw Error('version');
 for(const change of [(s:typeof saved)=>{(s.world.field as typeof saved.world.field).scriptAnimations.catalogHash='f'.repeat(64);},(s:typeof saved)=>{(s.world.field as typeof saved.world.field).scriptAnimations.currentAsset='f'.repeat(64);},(s:typeof saved)=>{(s.world.field as unknown as {scriptAnimations:{definitions:unknown}}).scriptAnimations.definitions=[definition('Injected',999)];},(s:typeof saved)=>{s.world.field.kind='event-field-v7' as typeof saved.world.field.kind;}]){const bad=structuredClone(saved);change(bad);assert.throws(()=>f.restore(bad));}
 assert.deepEqual(f.game.prepareEventSave(f.game.eventSaveRequest!).checkpoint,saved);
});
