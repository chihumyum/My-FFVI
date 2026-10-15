import test from 'node:test';
import type { SourceNewGameContent } from '../src/core/source-new-game.js';
import type { WorldMapContent,WorldCatalog } from '../src/field/world.js';
import assert from 'node:assert/strict';
import { GameFlow } from '../src/core/game-flow.js';
import { GameMapLoader } from '../src/core/game-map-loader.js';
import { GameBattleHandoff } from '../src/core/game-battle-handoff.js';
import { GameCommands } from '../src/core/game-commands.js';
import { CheckpointStorage } from '../src/core/saved-game.js';
import { fieldNpcSessionFixture } from './fixtures/field-npc-session.js';
import { validateFieldNpcFlatBinding, flatNpcInteractionLayer, bindFieldNpcFlatProjections, flatNpcGroupBlockers } from '../src/core/field-npc-flat-projection.js';
import { compileFieldNativeNpc } from '../src/compiler/field-native-npc.js';
import { assessFrameworkNpcFlatMap } from '../src/compiler/framework-npc-flat-projection.js';
import { contentDigest } from '../src/core/content-integrity.js';
const host={visible:true,mediaReady:true,overlayOpen:false};
const options={flatNpc:{allLayers:true,birdview:false,layer:1 as const}};
const observation=(g:ReturnType<Awaited<ReturnType<typeof fieldNpcSessionFixture>>['make']>)=>{
 const a=g.field.actors['602']!;return {position:structuredClone(a.native!.entity.position),layer:a.layer,direction:a.direction,animation:a.animation!.snapshot(),visible:g.field.isEntityVisible(a.id)};
};
function start(game:ReturnType<Awaited<ReturnType<typeof fieldNpcSessionFixture>>['make']>){const flow=new GameFlow(game);flow.start();flow.advance(0,host);return flow;}
function until(flow:GameFlow,done:()=>boolean){for(let n=0;!done();n++){assert(n<4000);assert.notEqual(flow.phase,'blocked',JSON.stringify(flow.session.field.stop));flow.advance(10,host);}}

test('strict native NPC imports remain blocked; explicit source-bound projection retains layers, geometry and original diagnostics',async()=>{
 const f=await fieldNpcSessionFixture(options),map=f.map,hostDef=map.frameworkNpcFlat!,b=hostDef.bindings[0]!;
 assert.equal(b.definition.controller,'wait');assert.equal(b.definition.geometry.layer,1);assert.equal(b.entity.layer,1);
 assert(b.entity.nativeNpcBlockers!.includes('Native NPC birdview/cross-layer provider is unresolved'));
 assert(map.map!.groups!.entity_default!.blockers.some(b=>b.reason==='Unsupported cross-layer or birdview NPC'));
 const p=Object.fromEntries((b.rawObject.properties as {name:string;value:unknown}[]).map(p=>[p.name,p.value]));
 const strict=compileFieldNativeNpc({group:b.definition.group,object:b.rawObject,entity:b.entity,properties:p,tables:f.sourceCorpus.tables});
 assert.equal(strict.definition,null);assert(strict.blockers.some(r=>/birdview\/cross-layer/.test(r)));
 const game=f.make();assert.equal(game.field.actors['602']!.layer,1);assert.equal(game.field.player.layer,0);
 assert.equal(game.field.actors['602']!.native!.entity.layer,10);assert.equal(game.field.actors['602']!.native!.entity.position.z,249);
 assert.equal(game.field.actors['602']!.native!.entity,game.field.actors['602']!.native!.entity);
 assert.equal(flatNpcInteractionLayer(b,1,0),true);assert.equal(flatNpcInteractionLayer({...b,allLayerTarget:true},1,0),true);
 const without={...game.field.content};delete without.developmentProfile;assert.throws(()=>bindFieldNpcFlatProjections(without),/Unbound/);
 const markerOnly=structuredClone(game.field.content);delete markerOnly.frameworkNpcFlat;assert.throws(()=>bindFieldNpcFlatProjections(markerOnly),/requires/);
});

test('raw flags, source identity, exact source geometry and group membership cannot be forged through the sidecar',async()=>{
 const f=await fieldNpcSessionFixture(options),game=f.make(),content=game.field.content,b=content.frameworkNpcFlat!.bindings[0]!;
 for(const change of [(v:typeof b)=>v.allLayerTarget=false,(v:typeof b)=>v.definition.geometry.x=999,(v:typeof b)=>v.entity.source.pointer='/layers/9/objects/9',(v:typeof b)=>v.definition.geometry.layer=0]){
  const copy=structuredClone(b);change(copy);assert.throws(()=>validateFieldNpcFlatBinding(copy),/binding|identity/);
 }
 const duplicate=structuredClone(content);duplicate.frameworkNpcFlat!.bindings.push(structuredClone(b));assert.throws(()=>bindFieldNpcFlatProjections(duplicate),/membership/);
 const moved=structuredClone(content);moved.map.groups!.entity_default!.entities.find(e=>e.id==='602')!.x=999;
 assert.throws(()=>bindFieldNpcFlatProjections(moved),/membership/);
 const original=content.map.groups!.entity_default!,unknown=structuredClone(original);unknown.blockers.push({reason:'Unrelated source provider',source:b.entity.source});
 assert(flatNpcGroupBlockers(unknown,content.frameworkNpcFlat).some(r=>r.reason==='Unrelated source provider'));
 assert(flatNpcGroupBlockers(original).some(r=>r.reason==='Unsupported cross-layer or birdview NPC'));
 const noProof=structuredClone(f.map);delete noProof.developmentProfile;delete noProof.frameworkNpcFlat;delete noProof.frameworkNpcActivity;
 const {contentHash:_,...body}=noProof;noProof.contentHash=await contentDigest(body);
 const assessed=assessFrameworkNpcFlatMap(f.sourceCorpus,noProof,'Controlled exact source import');assert.equal(assessed.host.bindings.length,1);
 const forged=structuredClone(noProof);forged.map!.groups!.entity_default!.entities.find(e=>e.id==='602')!.x=999;
 const {contentHash:__,...bad}=forged;forged.contentHash=await contentDigest(bad);
 const denied=assessFrameworkNpcFlatMap(f.sourceCorpus,forged,'Controlled exact source import');assert.equal(denied.host.bindings.length,0);assert(denied.host.diagnostics.some(d=>/geometry binding/.test(d.reason)));
});

test('birdview flat display keeps source layer and does not grant cross-layer interaction or collision',async()=>{
 const f=await fieldNpcSessionFixture({flatNpc:{allLayers:false,birdview:true,layer:1}}),game=f.make(),b=f.map.frameworkNpcFlat!.bindings[0]!;
 assert.equal(b.birdviewPuppet,true);assert.equal(flatNpcInteractionLayer(b,1,0),false);
 const a=game.field.actors['602']!,native=a.native!.entity,flow=start(game),before=observation(game);
 flow.advance(500,host);assert.equal(game.field.actors['602'],a);assert.equal(a.native!.entity,native);assert.deepEqual(observation(game),before);
 assert.equal(game.field.content.entry.viewPlan?.presentationViewType??0,0);assert.equal(a.layer,1);assert.equal(game.checkpointReady,true);
 const r=f.restore(game.checkpoint());assert.deepEqual(observation(r),before);assert.notEqual(r.field.actors['602']!.native!.entity,native);
});

test('actual interaction uses source all-layer eligibility while the same actor retains its layer and same-layer collider',async()=>{
 const f=await fieldNpcSessionFixture(options),game=f.make(),flow=start(game),field=game.field,a=field.actors['602']!,native=a.native!.entity;
 // Source-style controlled test data puts the stationary Wait actor at (6,5)
 // on layer 1. Ordinary player input walks on layer 0 without changing it.
 for(const d of ['down','down','right','right','right'] as const){assert.equal(flow.move(d),true);until(flow,()=>!field.player.motion);}
 assert.deepEqual([field.player.x,field.player.y,field.player.layer],[6,6,0]);
 assert.equal(field.interactionTarget('up')?.id,'602');assert.equal(flow.move('up'),true,'different source layer must not become a collider');until(flow,()=>!field.player.motion);
 assert.deepEqual([a.x,a.y,a.layer],[6,5,1]);assert.equal(a.native!.entity,native);
 assert.equal(flow.move('down'),true);until(flow,()=>!field.player.motion);assert.equal(field.interactionTarget('up')?.id,'602');
 for(const d of ['down','up'] as const){assert.equal(flow.move(d),true);until(flow,()=>!field.player.motion);}
 assert.equal(field.player.direction,'up');assert.equal(flow.confirm(),true);assert.ok(field.dialogue);
 assert.equal(a.layer,1);assert.equal(native.layer,10);assert.equal(a.native!.entity,native);
 assert.equal(flow.confirm(),true);until(flow,()=>!field.busy);
 const same=await fieldNpcSessionFixture({flatNpc:{allLayers:true,birdview:false,layer:0}}),g=same.make(),sameFlow=start(g);
 for(const d of ['down','down','right','right','right'] as const){assert.equal(sameFlow.move(d),true);until(sameFlow,()=>!g.field.player.motion);}
 assert.equal(sameFlow.move('up'),false,'same source layer keeps its original NPC collider');
 assert.equal(sameFlow.confirm(),true);assert.ok(g.field.dialogue);
});

test('stable storage/restore reuses existing codec with no perspective state, source reinitialization or second actor owner',async()=>{
 const f=await fieldNpcSessionFixture(options),game=f.make(),flow=start(game),actor=game.field.actors['602']!,before=observation(game),owned=game.state.snapshot();
 const bytes=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>{bytes.set(k,v);}},'framework','flat-npc');
 const checkpoint=game.checkpoint();(await storage.prepareSave(checkpoint,1730000000000)).commit();const saved=await storage.load();assert(saved);const restored=f.restore(saved.checkpoint);
 assert.deepEqual(observation(restored),before);assert.deepEqual(restored.state.snapshot(),owned);assert.notEqual(restored.field.actors['602'],actor);
 const commands=new GameCommands(flow,game),ticket=flow.beginOperation('load');assert(ticket.publish(restored));assert.equal(commands.menu({kind:'set-preferences',preferences:{mode:'wait',speedIndex:1}}),false);
 const next=start(restored);next.advance(10,host);assert.deepEqual(observation(restored),before);assert.equal(restored.field.stop,null);
 const forged=structuredClone(saved.checkpoint);forged.world.field.contentHash='0'.repeat(64);assert.throws(()=>f.restore(forged),/content|Content|source\/version/);
});

test('map failure/cancel/retry installs a fresh same-ID actor on its original layer and preserves the old owner until commit',async()=>{
 const f=await fieldNpcSessionFixture(options),game=f.make(),flow=start(game),field=game.field,actor=field.actors['602']!,before=observation(game),owned=game.state.snapshot();
 assert.equal(flow.move('left'),true);until(flow,()=>!field.player.motion);assert.equal(field.stop?.kind,'map-transition');
 let attempts=0,release!:(v:null)=>void,entered!:()=>void;const pendingMedia=new Promise<null>(r=>release=r),ready=new Promise<void>(r=>entered=r);
 const loader=new GameMapLoader(flow,{world:async()=>f.world,map:async id=>f.maps[id]!},{prepare:async()=>{if(++attempts===1)throw Error('controlled flat NPC media');if(attempts===2){entered();return pendingMedia;}return null;},discard(){}});
 assert.equal((await loader.load()).status,'failed');assert.equal(game.field,field);assert.equal(field.actors['602'],actor);assert.deepEqual(observation(game),before);assert.deepEqual(game.state.snapshot(),owned);
 const cancelled=loader.load();await ready;loader.cancel();release(null);assert.equal((await cancelled).status,'cancelled');assert.equal(game.field,field);
 assert.equal((await loader.load()).status,'committed');flow.advance(10,host);assert.equal(game.field.content.map.identity!.mapId,f.secondMap);assert.notEqual(game.field.actors['602'],actor);assert.equal(game.field.actors['602']!.layer,1);
 assert.deepEqual(game.state.snapshot(),owned);const fresh=game.field;const oldTime=field.time;field.advance(500);assert.equal(field.time,oldTime,'retired owner is not clocked');
 assert.equal(flow.move('left'),true);until(flow,()=>!game.field.player.motion);assert.equal((await loader.load()).status,'committed');flow.advance(10,host);assert.notEqual(game.field,fresh);assert.equal(game.field.actors['602']!.layer,1);assert.equal(game.checkpointReady,true);
});

test('actual battle failure/retry/return keeps the same flat NPC native actor and existing saved source flags',async()=>{
 const f=await fieldNpcSessionFixture(options),game=f.make(),flow=start(game),actor=game.field.actors['602']!,before=observation(game);
 assert.equal(flow.move('up'),true);until(flow,()=>!game.field.player.motion);assert.equal(game.field.stop?.kind,'encounter');let tries=0;
 const handoff=new GameBattleHandoff(flow,{prepareStart:async()=>{if(++tries===1)throw Error('controlled flat battle media');return null;},prepareReturn:async()=>null,discard(){}});
 assert.equal((await handoff.start()).status,'failed');assert.deepEqual(observation(game),before);assert.equal((await handoff.start()).status,'committed');const battle=game.battle!,commands=new GameCommands(flow,game);
 for(let n=0;battle.phase==='active';n++){assert(n<2000);for(const p of battle.ready)assert(commands.command(battle,p.id,10,battle.enemies[0]!.id,100));flow.advance(10,host);}
 assert.equal(battle.phase,'victory');assert.equal((await handoff.return()).status,'committed');assert.equal(game.field.actors['602'],actor);assert.deepEqual(observation(game),before);flow.advance(10,host);until(flow,()=>!game.field.busy);
 assert.equal(game.state.snapshot().completedBattles.length,1);const restored=f.restore(game.checkpoint());assert.equal(restored.state.snapshot().completedBattles.length,1);assert.deepEqual(observation(restored),observation(game));
});

test('complete framework derivation is opt-in, retains source diagnostics and rejects removed/duplicate assessments',async()=>{
 const {assessFrameworkNpcFlatWorld}=await import('../src/compiler/framework-npc-flat-projection.js'),{compileFrameworkContent}=await import('../src/compiler/framework-content.js');
 const f=await fieldNpcSessionFixture(options),seal=async<T extends {contentHash:string}>(v:T)=>{const{contentHash:_,...body}=v;return{...body,contentHash:await contentDigest(body)} as T;};
 const maps:WorldMapContent[]=[];for(const original of Object.values(f.maps)){const m=structuredClone(original);delete m.developmentProfile;delete m.frameworkNpcActivity;delete m.frameworkNpcFlat;maps.push(await seal(m));}
 const originalWorld:WorldCatalog=structuredClone(f.world);delete originalWorld.developmentProfile;for(const m of maps)originalWorld.maps[String(m.mapId)]!.contentHash=m.contentHash;const world=await seal(originalWorld);
 const originalEntry:SourceNewGameContent=structuredClone(f.content);delete originalEntry.developmentProfile;originalEntry.worldCatalogHash=world.contentHash;originalEntry.mapContentHash=maps[0]!.contentHash;const entry=await seal(originalEntry);
 const assessments=assessFrameworkNpcFlatWorld(f.sourceCorpus,world,maps,'Controlled complete framework projection'),strict=compileFrameworkContent(world,maps,entry),next=compileFrameworkContent(world,maps,entry,{npcFlatAssessments:assessments});
 assert.equal(strict.catalog.developmentProfile.npcProjection,undefined);assert.equal(strict.maps[0]!.frameworkNpcFlat,undefined);assert(strict.maps[0]!.map!.groups!.entity_default!.blockers.some(b=>/cross-layer/.test(b.reason)));
 assert.equal(next.report.npcProjection!.derived,2);assert.equal(next.catalog.developmentProfile.npcProjection,'web-source-npc-flat-projection-v1');assert.equal(next.entry.developmentProfile.npcProjection,next.catalog.developmentProfile.npcProjection);
 for(let i=0;i<maps.length;i++){assert.deepEqual(next.maps[i]!.map,strict.maps[i]!.map);assert.deepEqual(next.maps[i]!.scripts,maps[i]!.scripts);assert.deepEqual(next.maps[i]!.blockers,strict.maps[i]!.blockers);}
 assert.throws(()=>compileFrameworkContent(world,maps,entry,{npcFlatAssessments:assessments.slice(1)}),/complete/);
 const omitted=structuredClone(assessments[0]!);omitted.objects=[];omitted.host.bindings=[];const bad=await seal(omitted);
 assert.throws(()=>compileFrameworkContent(world,maps,entry,{npcFlatAssessments:[bad,assessments[1]!]}),/membership/);
 assert.throws(()=>compileFrameworkContent(world,maps,entry,{npcFlatAssessments:[assessments[0]!,assessments[0]!]}),/complete/);
 const original=JSON.stringify(assessments);next.maps[0]!.frameworkNpcFlat!.bindings[0]!.rawObject.x=999;assert.equal(JSON.stringify(assessments),original);
});
