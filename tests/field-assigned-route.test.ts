import test from 'node:test';
import assert from 'node:assert/strict';
import { compileFieldAssignedRouteInstruction } from '../src/compiler/field-assigned-route.js';
import { decodeFieldOp } from '../src/compiler/field.js';
import { compileAssignedRouteProgram,createAssignedRouteCursor,settleAssignedRouteCursor,searchAssignedRouteGrid,assignedRouteLineClear,WEB_ASSIGNED_ROUTE_POLICY } from '../src/core/field-assigned-route.js';
import type { FieldNpcRouteDefinition,FieldNpcRouteRawInstruction,FieldNpcRouteCatalog } from '../src/core/field-npc-route.js';
import { fieldNpcRouteInstructionKind } from '../src/core/field-npc-route.js';
import { contentDigest } from '../src/core/content-integrity.js';
import { fieldMoveToSessionFixture } from './fixtures/field-move-to-session.js';
import { NewGameFieldEntry } from '../src/core/new-game-field-entry.js';
import { GameSession } from '../src/core/game-session.js';
import { GameEntryLoader } from '../src/core/game-entry-loader.js';
import { GameMapLoader } from '../src/core/game-map-loader.js';
import { GameContentRepository } from '../src/core/game-content.js';
import { GameBattleHandoff } from '../src/core/game-battle-handoff.js';
import { GameCommands } from '../src/core/game-commands.js';
import { GameEventSaveCoordinator } from '../src/core/game-event-save.js';
import { CheckpointStorage } from '../src/core/saved-game.js';
import { compileFieldAutoSaveInstruction } from '../src/compiler/field-auto-save.js';
import { WEB_AUTO_SAVE_POLICY } from '../src/core/field-auto-save.js';
import { sourceEncounterSessionFixture } from './fixtures/source-encounter-session.js';
import { GameFlow } from '../src/core/game-flow.js';
import type { Op,Site } from '../src/field/types.js';
const source={file:'controlled-assigned.bundle',assetPath:'Map/routes.json',serializedFile:'CAB-controlled',sha256:'a'.repeat(64),objectId:'9223372036854775807'};
function route(ops:FieldNpcRouteRawInstruction[],id=1):FieldNpcRouteDefinition{return {id,alias:`route_instruction_${id}`,source,aliasSource:{...source,pointer:`/map/0/route_instruction/${id-1}`},instructions:ops.map((raw,index)=>({index,kind:fieldNpcRouteInstructionKind(raw.instruction_type),raw,source:{...source,pointer:`/instruction_list/${index}`}}))};}
const raw=(ints=[601,1,0])=>({type:1,mnemonic:'AssignMoveRoute',operands:{iValues:[...ints,...Array(8-ints.length).fill(0)],rValues:Array(8).fill(0),sValues:Array(8).fill('')}});
test('External assignment preserves entity, route, loop and PC without granting Puppet Route',()=>{
 for(const loop of [0,1]){const op=decodeFieldOp(raw([601,9,loop]),{script:'whole',index:42,source},{});assert.deepEqual(op,{script:'whole',index:42,source,kind:'assign-npc-route',entityId:601,routeId:9,loop:loop===1});}
 for(const mutate of [(x:ReturnType<typeof raw>)=>x.type=2,(x:ReturnType<typeof raw>)=>x.operands.iValues[2]=2,(x:ReturnType<typeof raw>)=>x.operands.iValues[7]=1,(x:ReturnType<typeof raw>)=>x.operands.sValues[0]='foreign']){
  const r=raw();mutate(r);assert.throws(()=>compileFieldAssignedRouteInstruction(r));const op=decodeFieldOp(r,{script:'whole',index:42,source},{});assert.equal(op.kind,'blocked');assert.equal(op.index,42);
 }
});
test('all ten consumers keep raw/source/default absence and unknown does not reindex',()=>{
 const r=route([{instruction_type:1,cellx:5,celly:7,speed_id:0},{instruction_type:2,delay_sec:.03},{instruction_type:3,animation_key:'wave',speed_scale:1,loop_cnt:2},{instruction_type:4,animation_key:'wave',frame:-1},{instruction_type:5},{instruction_type:6},{instruction_type:7,cellx:6,celly:7,layer:0,duration:.2},{instruction_type:8,se_id:11},{instruction_type:9,category:2,index:3,value:1},{instruction_type:10,category:2,index:3,value:1}]);
 const before=structuredClone(r),p=compileAssignedRouteProgram(r);assert.ok(p.instructions.every(i=>i.action));assert.deepEqual(r,before);assert.equal(Object.hasOwn(p.instructions[0]!.raw,'layer'),false);assert.equal((p.instructions[0]!.action as {layer:number}).layer,0);assert.equal(p.source.objectId,source.objectId);
 const unknown=compileAssignedRouteProgram(route([{instruction_type:2},{instruction_type:999},{instruction_type:2}]));assert.equal(unknown.instructions[1]!.action,null);assert.equal(unknown.instructions[2]!.index,2);assert.throws(()=>createAssignedRouteCursor(unknown),/instruction 1/);
});
test('one update makes one phase, including compare polling and loop boundaries',()=>{
 const p=compileAssignedRouteProgram(route([{instruction_type:10,category:2,index:3,value:1},{instruction_type:2}]));let c=createAssignedRouteCursor(p);
 c=settleAssignedRouteCursor(p,c,true,true);assert.equal(c.index,0);assert.equal(c.phase,'update');c=settleAssignedRouteCursor(p,c,false,true);assert.equal(c.index,0);
 c=settleAssignedRouteCursor(p,c,true,true);assert.equal(c.index,1);assert.equal(c.phase,'execute');c=settleAssignedRouteCursor(p,c,true,true);c=settleAssignedRouteCursor(p,c,true,true);assert.equal(c.index,0);assert.equal(c.completed,false);
 assert.throws(()=>createAssignedRouteCursor(compileAssignedRouteProgram(route([]))),/Empty/);
});
test('explicit collision grid takes a detour and never teleports or traverses unknown cells',()=>{
 const range={x:0,y:0,width:4,height:4},from={x:0,y:0},to={x:2,y:0};
 const path=searchAssignedRouteGrid(from,to,range,(_,b)=>!(b.x===1&&b.y===0));assert.deepEqual(path,[{x:0,y:1},{x:1,y:1},{x:2,y:1},to]);
 assert.equal(searchAssignedRouteGrid(from,to,range,()=>false),null);assert.throws(()=>searchAssignedRouteGrid(from,{x:99,y:0},range,()=>true),/outside/);assert.throws(()=>searchAssignedRouteGrid(from,to,range,()=>{throw Error('unknown collision')}),/unknown collision/);
});
async function seal<T extends {contentHash:string}>(x:T):Promise<T>{const{contentHash:_,...b}=x;return {...b,contentHash:await contentDigest(b)} as T;}
async function fixture(ops:FieldNpcRouteRawInstruction[],loop=false,extraRoutes:FieldNpcRouteDefinition[]=[],options:{battle?:boolean;save?:boolean;target?:boolean;sourcePc?:number;sourceScript?:string}={}){
 const original=await fieldMoveToSessionFixture(),f=options.battle?{...original,...sourceEncounterSessionFixture()}:original,
   map=structuredClone(f.map),world=structuredClone(f.world),entry=structuredClone(f.content);
 if(options.battle){const npc=original.map.map!.groups!.entity_default!.entities.find(e=>e.id==='601')!;if(!map.map!.groups!.entity_default!.entities.some(e=>e.id==='601')){map.map!.groups!.entity_default!.entities.push(structuredClone(npc));if(map.map!.entities!==map.map!.groups!.entity_default!.entities)map.map!.entities.push(structuredClone(npc));}}
 if(options.save)for(const x of [map,world,entry])x.developmentProfile={kind:'framework-development-v1',policy:'omit-anonymous-environment-particles-v1',sourceContentHash:x.contentHash,omissions:[],autoSave:WEB_AUTO_SAVE_POLICY};
 for(const x of [map,world,entry]){x.sourceSetHash='1'.repeat(64);x.parentSourceSetHash='2'.repeat(64);}
 const routes=[route(ops),...extraRoutes];const payload={kind:'field-npc-route-catalog-v1' as const,sourceSetHash:map.sourceSetHash,parentSourceSetHash:map.parentSourceSetHash,mapId:map.mapId,mapName:map.name,packageSource:source,routes:Object.fromEntries(routes.map(r=>[r.id,r])),executionSupport:'none' as const,migrationReady:false as const};
 map.npcRoutes={...payload,contentHash:await contentDigest(payload)} satisfies FieldNpcRouteCatalog;
 const script='assigned-route-root',counter={category:'MapLocalVariable' as const,index:7};
 const emit=(values:unknown[])=>values.map((op,index)=>({...op as object,script,index,source}) as unknown as Op);
 map.scripts[script]=emit([{kind:'assign-npc-route',entityId:601,routeId:1,loop},{kind:'calc',left:counter,operator:'←',right:{kind:'immediate',value:1}},{kind:'exit'}]);
 if(options.sourcePc!==undefined)map.scripts[script]![0]!.index=options.sourcePc;
 if(options.sourceScript!==undefined)map.scripts[script]![0]!.script=options.sourceScript;
 map.scriptPuppetContexts![script]={...map.scriptPuppetContexts!.reserved!,scriptHash:'8'.repeat(64)};map.scriptLocals[script]=null;
 map.scripts.replacement=emit([{kind:'assign-npc-route',entityId:601,routeId:2,loop:false},{kind:'exit'}]).map(op=>({...op,script:'replacement'}));
 map.scriptPuppetContexts!.replacement={...map.scriptPuppetContexts!.reserved!,scriptHash:'9'.repeat(64)};map.scriptLocals.replacement=null;
 for(const name of [script,'replacement']){(map.scriptTransitionMetadata??={})[name]={customAnimations:'none'};(map.scriptSystemFlags??={})[name]={keepBadStatusVisual:false};}
 if(options.save){map.scripts['save-route']=emit([{kind:'assign-npc-route',entityId:601,routeId:1,loop},
   {kind:'wait',seconds:.04},compileFieldAutoSaveInstruction({type:1,mnemonic:'AutoSave',operands:{iValues:Array(8).fill(0),rValues:Array(8).fill(0),sValues:Array(8).fill('')}}),
   {kind:'calc',left:counter,operator:'＋',right:{kind:'immediate',value:1}},{kind:'exit'}]).map(op=>({...op,script:'save-route'}));
   map.scriptPuppetContexts!['save-route']={...map.scriptPuppetContexts!.reserved!,scriptHash:'7'.repeat(64)};
   map.scriptLocals['save-route']=null;map.scriptTransitionMetadata!['save-route']={customAnimations:'none'};map.scriptSystemFlags!['save-route']={keepBadStatusVisual:false};}
 let target=options.target?structuredClone(map):undefined;
 if(target){const targetId=map.mapId+1;target.mapId=targetId;target.map!.identity!.mapId=targetId;target.map!.entryContext!.mapId=targetId;target.partyEntry!.mapId=targetId;
   const points=target.map!.groups!.entity_default!.entities.filter(e=>e.kind===0);target.map!.groups!.entity_default!.entities=points;target.map!.entities=structuredClone(points);delete target.npcRoutes;
   target.scripts={arrived:emit([{kind:'exit'}]).map(op=>({...op,script:'arrived'}))};target.scriptLocals={arrived:null};target.scriptPuppetContexts={arrived:{...map.scriptPuppetContexts!.reserved!,scriptHash:'6'.repeat(64)}};target.initializer='arrived';
   map.scripts.leave=emit([{kind:'change-map',request:{mapId:targetId,entrance:target.partyEntry!.pointIns[0]!.id,continuation:null,birdview:false,skipFade:true,skipBgm:true,origin:'script'}}]).map(op=>({...op,script:'leave'}));map.scriptLocals.leave=null;map.scriptPuppetContexts!.leave={...map.scriptPuppetContexts!.reserved!,scriptHash:'5'.repeat(64)};
   target=await seal(target);world.maps[String(targetId)]={...world.maps[String(map.mapId)]!,url:'/assigned-route-target.json',contentHash:target.contentHash,name:target.name};world.transportation=structuredClone(f.battle.gameState.sourceNewGame!.transportation);
 }
 const sealedMap=await seal(map);world.maps[String(map.mapId)]!.contentHash=sealedMap.contentHash;const sealedWorld=await seal(world),content=await seal({...entry,mapContentHash:sealedMap.contentHash,worldCatalogHash:sealedWorld.contentHash});
 function launch(policy:boolean){const sequence=new NewGameFieldEntry(content.entry,f.presentation);const first=sequence.prepareStart(f.fade,{active:true,callbacks:'absent'});first.commit();let fade=first.fade;fade.advance(.5);for(let i=0;i<3;i++){const n=sequence.prepareResume(fade,true)!;n.commit();fade=n.fade;}
  const runtime=policy?{assignedNpcRoutes:WEB_ASSIGNED_ROUTE_POLICY,battleHandoff:'prepared' as const}:{};const game=GameSession.prepareNewGame(content,sealedWorld,sealedMap,f.battle,fade,f.presentation,runtime);const ticket=sequence.prepareLaunch(fade,game.newGamePreparation(true));game.launchNewGame(ticket.launch);ticket.commit();return game;}
 const game=launch(true),flow=new GameFlow();new GameEntryLoader(flow,{discard:()=>{}}).begin('new-game').commit({session:game,presentation:null});for(let i=0;i<100&&!game.checkpointReady;i++)flow.advance(10,{visible:true,mediaReady:true,overlayOpen:false});assert.equal(game.field.stop,null);assert.equal(game.checkpointReady,true);
 const repository=new GameContentRepository(async url=>{if(url==='/world/catalog.json')return sealedWorld;if(url==='/assigned-route-target.json'&&target)return target;throw Error('Missing controlled assigned route content '+url);});
 return {game,flow,script,counter,launch,repository,target,restore:(saved:ReturnType<GameSession['checkpoint']>)=>GameSession.restore(saved,undefined,f.battle,{catalog:sealedWorld,map:sealedMap,source:{content,initialMap:sealedMap}},{assignedNpcRoutes:WEB_ASSIGNED_ROUTE_POLICY})};
}
const host={visible:true,mediaReady:true,overlayOpen:false};
function tick(f:Awaited<ReturnType<typeof fixture>>,until:()=>boolean,max=2000){for(let i=0;i<max;i++){assert.equal(f.game.field.stop,null,f.game.field.stop?.message);if(until())return;f.flow.advance(10,host);}assert.fail('assigned route clock budget');}
test('actual Session executes route after Main exit, pauses with Flow, drains once and restores without replay',async()=>{
 const f=await fixture([{instruction_type:2,delay_sec:.04},{instruction_type:1,cellx:7,celly:5,layer:0,speed_id:0},{instruction_type:4,animation_key:'wave',frame:0},{instruction_type:9,category:2,index:8,value:1}]);
 const field=f.game.field,actor=field.actors['601']!,entity=actor.native!.entity,owner=f.game.state;
 assert.equal(field.startEvent(f.script),true);assert.equal(field.eventState.read(f.counter),1);assert.equal(field.busy,false);assert.equal(field.assignedRouteSnapshot.length,1);assert.equal(f.game.checkpointReady,true);assert.equal(f.restore(f.game.checkpoint()).field.assignedRouteSnapshot.length,1);
 tick(f,()=>actor.motion!==null);const before={motion:structuredClone(actor.motion),time:field.time,route:field.assignedRouteSnapshot};assert.equal(f.flow.pause(true),true);f.flow.advance(5000,host);assert.deepEqual({motion:actor.motion,time:field.time,route:field.assignedRouteSnapshot},before);assert.equal(f.flow.pause(false),true);
 tick(f,()=>field.assignedRouteSnapshot.length===0);assert.equal(actor.x,7);assert.equal(actor.y,5);assert.equal(field.eventState.read({category:'ScenarioFlag3',index:8}),1);assert.equal(actor.native!.entity,entity);assert.equal(f.game.state,owner);assert.equal(f.game.checkpointReady,true);
 const saved=f.game.checkpoint(),restored=f.restore(saved);assert.deepEqual(restored.checkpoint(),saved);restored.advance(1000);assert.equal(restored.field.actors['601']!.x,7);assert.equal(restored.field.assignedRouteSnapshot.length,0);
});
test('replacement preflights whole program before cancelling the current route or resetting source pose',async()=>{
 const f=await fixture([{instruction_type:1,cellx:8,celly:5,layer:0,speed_id:0}],true,[route([{instruction_type:4,animation_key:'missing'}],2)]);
 const field=f.game.field,actor=field.actors['601']!;field.startEvent(f.script);tick(f,()=>actor.motion!==null);const before={x:actor.x,y:actor.y,motion:structuredClone(actor.motion),route:field.assignedRouteSnapshot,animation:actor.animation!.snapshot()};
 field.startEvent('replacement');assert.match(field.stop!.message,/Missing actor animation/);assert.deepEqual({x:actor.x,y:actor.y,motion:actor.motion,route:field.assignedRouteSnapshot,animation:actor.animation!.snapshot()},before);
});
test('missing explicit policy and unknown route action leave the source actor unchanged',async()=>{
 const f=await fixture([{instruction_type:2}]),game=f.launch(false);for(let i=0;i<100&&!game.checkpointReady;i++)game.advance(10);const actor=game.field.actors['601']!,before={x:actor.x,y:actor.y,animation:actor.animation!.snapshot()};
 game.field.startEvent(f.script);assert.match(game.field.stop!.message,/Assigned NPC route|assigned NPC route/);assert.deepEqual({x:actor.x,y:actor.y,animation:actor.animation!.snapshot()},before);
 const u=await fixture([{instruction_type:2},{instruction_type:99}]);const a=u.game.field.actors['601']!,p={x:a.x,y:a.y};u.game.field.startEvent(u.script);assert.match(u.game.field.stop!.message,/instruction 1/);assert.deepEqual({x:a.x,y:a.y},p);assert.equal(u.game.field.assignedRouteSnapshot.length,0);
});

test('active delay and moving route checkpoints rebind the same cursor without Assign/Setup/replay',async()=>{
 const f=await fixture([{instruction_type:2,delay_sec:.15},{instruction_type:1,cellx:8,celly:5,layer:0,speed_id:2},{instruction_type:9,category:2,index:9,value:1}]);
 f.game.field.startEvent(f.script);f.flow.advance(50,host);const waiting=f.game.checkpoint(),delay=f.restore(waiting);
 assert.deepEqual(delay.checkpoint(),waiting);assert.equal(delay.field.assignedRouteSnapshot[0]!.cursor.elapsed,f.game.field.assignedRouteSnapshot[0]!.cursor.elapsed);
 tick(f,()=>f.game.field.actors['601']!.motion!==null);f.flow.advance(40,host);const moving=f.game.checkpoint(),r=f.restore(moving),a=r.field.actors['601']!;
 assert.deepEqual(r.checkpoint(),moving);assert.equal(a.x,f.game.field.actors['601']!.x);assert.notEqual(a.native!.entity,f.game.field.actors['601']!.native!.entity);
 for(let i=0;i<2000&&r.field.assignedRouteSnapshot.length;i++){assert.equal(r.field.stop,null,r.field.stop?.message);r.advance(10);}
 assert.equal(r.field.assignedRouteSnapshot.length,0);assert.equal(a.x,8);assert.equal(r.field.eventState.read({category:'ScenarioFlag3',index:9}),1);assert.equal(r.field.eventState.read(f.counter),1);
 const still=f.game.checkpoint();assert.deepEqual(still,moving,'fresh restored cursor cannot clock the retired session');
 const bad=structuredClone(moving);if(bad.world.field.kind!=='idle-field-v14')throw Error('expected new route codec');bad.world.field.assignedNpcRoutes.routes[0]!.routeId=99;
 assert.throws(()=>f.restore(bad),/source op|source assigned route/);assert.deepEqual(f.game.checkpoint(),moving);
});
test('loop/Compare waits survive restore and consume the existing EventState only',async()=>{
 const f=await fixture([{instruction_type:10,category:2,index:10,value:1},{instruction_type:2,delay_sec:.1}],true);
 f.game.field.startEvent(f.script);f.flow.advance(40,host);const saved=f.game.checkpoint(),r=f.restore(saved);
 assert.deepEqual(r.checkpoint(),saved);r.advance(200);assert.equal(r.field.assignedRouteSnapshot[0]!.cursor.index,0);assert.equal(r.field.assignedRouteSnapshot[0]!.cursor.phase,'update');
 r.field.eventState.write({category:'ScenarioFlag3',index:10},1);r.advance(300);assert.ok(r.field.assignedRouteSnapshot[0]!.cursor.cycles>=1);assert.equal(r.field.eventState.read(f.counter),1);
 const reloaded=f.restore(r.checkpoint());assert.deepEqual(reloaded.checkpoint(),r.checkpoint());
});
test('active ordinary Lerp restores its original start clock/pose rather than restarting',async()=>{
 const f=await fixture([{instruction_type:7,cellx:8,celly:5,layer:0,duration:.4,animation_key:'WalkR'}]);
 f.game.field.startEvent(f.script);f.flow.advance(120,host);const before=f.game.checkpoint(),r=f.restore(before);assert.deepEqual(r.checkpoint(),before);
 const p=r.field.actors['601']!.x;assert.ok(p>5&&p<8);r.advance(100);assert.ok(r.field.actors['601']!.x>p);r.advance(300);assert.equal(r.field.actors['601']!.x,8);assert.equal(r.field.assignedRouteSnapshot.length,0);assert.equal(r.field.stop,null);
});

test('pending route survives failed/cancelled map preparation and retires only with the old map owner',async()=>{
 const f=await fixture([{instruction_type:1,cellx:9,celly:5,layer:0,speed_id:0}],true,[],{target:true});const field=f.game.field,actor=field.actors['601']!;
 field.startEvent(f.script);tick(f,()=>actor.motion!==null);field.startEvent('leave');assert.equal(field.stop?.kind,'map-transition');
 const before={route:field.assignedRouteSnapshot,native:field.nativeActorStateFingerprint,time:field.time};let mode='fail',release!:(v:null)=>void,prepared!:()=>void;
 const entered=new Promise<void>(r=>{prepared=r;}),loader=new GameMapLoader(f.flow,f.repository,{prepare:async next=>{assert.equal(next.actors['601'],undefined);if(mode==='fail')throw Error('controlled assigned media');if(mode==='hold'){prepared();return new Promise<null>(r=>{release=r;});}return null;},discard(){}});
 assert.equal((await loader.load()).status,'failed');assert.deepEqual({route:field.assignedRouteSnapshot,native:field.nativeActorStateFingerprint,time:field.time},before);
 mode='hold';const pending=loader.load();await entered;f.flow.advance(5000,host);assert.deepEqual({route:field.assignedRouteSnapshot,native:field.nativeActorStateFingerprint,time:field.time},before);loader.cancel();release(null);assert.equal((await pending).status,'cancelled');assert.equal(f.game.field,field);
 mode='ok';assert.equal((await loader.load()).status,'committed');assert.equal(f.game.field.content.map.identity!.mapId,f.target!.mapId);assert.equal(f.game.field.actors['601'],undefined);
 field.advance(5000);assert.deepEqual({route:field.assignedRouteSnapshot,native:field.nativeActorStateFingerprint,time:field.time},before,'retired Field cannot clock a route');
});
test('actual battle preparation failure/cancel and victory return pause and resume the same pending route',async()=>{
 const f=await fixture([{instruction_type:1,cellx:9,celly:5,layer:0,speed_id:0},{instruction_type:9,category:2,index:11,value:1}],false,[],{battle:true});
 const field=f.game.field,actor=field.actors['601']!,native=actor.native!.entity;field.startEvent(f.script);tick(f,()=>actor.motion!==null);assert.equal(field.startEvent('legacy-fight'),true);assert.equal(field.stop?.kind,'encounter');
 const before={route:field.assignedRouteSnapshot,motion:structuredClone(actor.motion),time:field.time};let mode='fail',release!:(v:null)=>void;
 const handoff=new GameBattleHandoff(f.flow,{prepareStart:async()=>{if(mode==='fail')throw Error('assigned battle media');if(mode==='hold')return new Promise<null>(r=>{release=r;});return null;},prepareReturn:async()=>null,discard(){}});
 assert.equal((await handoff.start()).status,'failed');assert.deepEqual({route:field.assignedRouteSnapshot,motion:actor.motion,time:field.time},before);
 mode='hold';const pending=handoff.start();await new Promise<void>(r=>setImmediate(r));handoff.cancel();release(null);assert.equal((await pending).status,'cancelled');mode='ok';assert.equal((await handoff.start()).status,'committed');
 const battle=f.game.battle!,commands=new GameCommands(f.flow,f.game);for(let i=0;i<3000&&battle.phase==='active';i++){for(const p of battle.ready){const target=battle.enemies.find(e=>e.hp>0);if(target)commands.command(battle,p.id,10,{kind:'single',id:target.id},100);}f.flow.advance(20,host);}
 assert.equal(battle.phase,'victory');assert.deepEqual({route:field.assignedRouteSnapshot,motion:actor.motion,time:field.time},before);assert.equal((await handoff.return()).status,'committed');
 tick(f,()=>field.assignedRouteSnapshot.length===0);assert.equal(field.actors['601'],actor);assert.equal(actor.native!.entity,native);assert.equal(actor.x,9);assert.equal(field.eventState.read({category:'ScenarioFlag3',index:11}),1);assert.equal(f.game.state.completedEncounters.length,1);
 assert.deepEqual(f.restore(f.game.checkpoint()).checkpoint(),f.game.checkpoint());
});
test('source AutoSave ACK and strict event restore retain an active route without issuing it twice',async()=>{
 const f=await fixture([{instruction_type:1,cellx:9,celly:5,layer:0,speed_id:0}],false,[],{save:true});const field=f.game.field;
 assert.equal(field.startEvent('save-route'),true);for(let i=0;i<100&&!f.game.eventSaveRequest&&!field.stop;i++)f.flow.advance(10,host);assert.equal(field.stop,null,field.stop?.message);assert.ok(f.game.eventSaveRequest);assert.equal(field.assignedRouteSnapshot.length,1);
 const bytes=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>{bytes.set(k,v);}},'source','assigned-route'),coordinator=new GameEventSaveCoordinator(f.flow,storage);
 assert.equal((await coordinator.save(42)).status,'committed');const saved=(await storage.load())!,r=f.restore(saved.checkpoint);assert.equal(r.eventSaveRequest,null);assert.equal(r.field.assignedRouteSnapshot.length,1);assert.deepEqual(r.checkpointReady,false);
 f.flow.advance(10,host);r.advance(10);assert.equal(r.field.eventState.read(f.counter),1);assert.equal(field.eventState.read(f.counter),1);
 for(let i=0;i<2000&&r.field.assignedRouteSnapshot.length;i++)r.advance(10);tick(f,()=>field.assignedRouteSnapshot.length===0);assert.equal(r.field.actors['601']!.x,9);assert.deepEqual(r.checkpoint(),f.game.checkpoint());
});

test('direct Lerp collision does not accept a bent detour as a clear segment',()=>{
 const blocked=(_:unknown,b:{x:number;y:number})=>!(b.x===1&&b.y===0);
 assert.equal(assignedRouteLineClear({x:0,y:0},{x:2,y:0},blocked),false);
 assert.equal(assignedRouteLineClear({x:0,y:0},{x:2,y:2},blocked),false,'both corner-adjacent cells must be clear');
 assert.equal(assignedRouteLineClear({x:0,y:0},{x:2,y:2},()=>true),true);
});
test('tampered source route/catalog and restored policy cannot grant a moving actor',async()=>{
 const f=await fixture([{instruction_type:1,cellx:9,celly:5,layer:0,speed_id:0}]);f.game.field.startEvent(f.script);tick(f,()=>f.game.field.actors['601']!.motion!==null);f.flow.advance(20,host);
 const saved=f.game.checkpoint(),bad=structuredClone(saved);if(bad.world.field.kind!=='idle-field-v14')throw Error('Expected route format');bad.world.field.assignedNpcRoutes.catalogHash='f'.repeat(64);assert.throws(()=>f.restore(bad),/source\/catalog/);
 const badMotion=structuredClone(saved),row=badMotion.world.field.native!.actors.actors.find(a=>a.id==='601')!;if(!('motion'in row))throw Error('Expected native motion');(row.motion as {state:{duration:number}}).state.duration=1;assert.throws(()=>f.restore(badMotion),/duration/);
 const actor=f.game.field.actors['601']!,before={x:actor.x,y:actor.y,motion:structuredClone(actor.motion)};f.game.field.content.npcRoutes!.routes['1']!.instructions[0]!.raw.cellx=2;f.flow.advance(10,host);assert.match(f.game.field.stop!.message,/Stale assigned/);assert.deepEqual({x:actor.x,y:actor.y,motion:actor.motion},before);
});

test('numeric event values remain Int32 and decoder does not execute accessors or array iterators',()=>{
 const p=compileAssignedRouteProgram(route([{instruction_type:9,category:8,index:0,value:2147483647}]));assert.equal((p.instructions[0]!.action as {value:number}).value,2147483647);
 const sparse=raw();delete sparse.operands.iValues[7];assert.throws(()=>compileFieldAssignedRouteInstruction(sparse),/dense|arrays/);
 let reads=0;const getter=raw();Object.defineProperty(getter.operands.iValues,'2',{get(){reads++;return 1;},enumerable:true});assert.throws(()=>compileFieldAssignedRouteInstruction(getter),/dense/);assert.equal(reads,0);
 const iterator=raw();Object.setPrototypeOf(iterator.operands.iValues,{...Array.prototype,[Symbol.iterator](){reads++;throw Error('must not run');}});assert.throws(()=>compileFieldAssignedRouteInstruction(iterator),/arrays/);assert.equal(reads,0);
});

for(const evidence of [{sourcePc:99},{sourceScript:'physical-original-program'},{sourcePc:99,sourceScript:'physical-original-program'}])test('actual Web route save binding stays independent from source evidence '+JSON.stringify(evidence),async()=>{
 const f=await fixture([{instruction_type:2,delay_sec:.12},{instruction_type:1,cellx:8,celly:5,layer:0,speed_id:0}],false,[],evidence);
 assert.equal(f.game.field.startEvent(f.script),true);assert.equal(f.game.field.eventState.read(f.counter),1);
 const waiting=f.game.checkpoint();if(waiting.world.field.kind!=='idle-field-v14')throw Error('Expected route field codec');
 const row=waiting.world.field.assignedNpcRoutes.routes[0]!;assert.equal(row.script,f.script);assert.equal(row.index,0);
 assert.equal(row.assignment.index,evidence.sourcePc??0);assert.equal(row.assignment.script,evidence.sourceScript??f.script);
 const delay=f.restore(waiting);assert.deepEqual(delay.checkpoint(),waiting);assert.equal(delay.field.assignedRouteExecutions.filter(r=>r.phase==='assigned').length,0);
 tick(f,()=>f.game.field.actors['601']!.motion!==null);f.flow.advance(20,host);const moving=f.game.checkpoint(),restored=f.restore(moving);
 assert.deepEqual(restored.checkpoint(),moving);for(let i=0;i<2000&&restored.field.assignedRouteSnapshot.length;i++)restored.advance(10);
 assert.equal(restored.field.stop,null);assert.equal(restored.field.actors['601']!.x,8);assert.equal(restored.field.eventState.read(f.counter),1);
 assert.equal(restored.field.assignedRouteExecutions.filter(r=>r.phase==='assigned').length,0);
 const stable=restored.checkpoint(),again=f.restore(stable);assert.deepEqual(again.checkpoint(),stable);again.advance(200);assert.equal(again.field.actors['601']!.x,8);assert.equal(again.field.eventState.read(f.counter),1);
 const forged=structuredClone(waiting);if(forged.world.field.kind!=='idle-field-v14')throw Error('Expected route field codec');forged.world.field.assignedNpcRoutes.routes[0]!.assignment.source.objectId='9007199254740993';
 assert.throws(()=>f.restore(forged),/source op/);assert.deepEqual(f.game.checkpoint(),moving);
});
