import test from "node:test";
import assert from "node:assert/strict";
import {compileFrameworkContent} from "../src/compiler/framework-content.js";
import {compileFrameworkOrdinaryPresentation, type FrameworkOrdinaryAssessment} from "../src/compiler/framework-ordinary-presentation.js";
import {resolveFieldPresentation, fieldMapPresentationBlockers} from "../src/core/field-presentation.js";
import {ordinaryPresentationFixture} from "./fixtures/ordinary-presentation.js";
import {sealBatchContent} from "./fixtures/content-batch.js";
import {compileFrameworkNewGame} from "../src/compiler/framework-new-game.js";
import {GameSession} from "../src/core/game-session.js";
import {GameFlow} from "../src/core/game-flow.js";
import {GameContentRepository} from "../src/core/game-content.js";
import {GameMapLoader} from "../src/core/game-map-loader.js";
import {CheckpointStorage} from "../src/core/saved-game.js";
import {magicStonesSessionFixture} from "./fixtures/magic-stones-session.js";
import type {Op} from "../src/field/types.js";

const fixture=ordinaryPresentationFixture;

test("ordinary flat derivation requires independent explicit opt-in and retains every original diagnostic",async()=>{
 const f=await fixture(),before=structuredClone(f.strict),base=compileFrameworkContent(f.catalog,[f.strict],f.entry);
 assert.equal(base.maps[0]!.frameworkPresentation,undefined);assert.equal(base.maps[0]!.developmentProfile.fieldPresentation,undefined);
 assert.throws(()=>resolveFieldPresentation(base.maps[0]!),/water\/group/);
 const candidate=compileFrameworkContent(f.catalog,[f.strict],f.entry,{ordinaryPresentations:[f.assessment]}),map=candidate.maps[0]!;
 assert.equal(resolveFieldPresentation(map).view.kind,"framework-flat-field-view-v1");
 assert.deepEqual(map.actorViewBlockers,before.actorViewBlockers);assert.deepEqual(map.nativeCompositionBlockers,before.nativeCompositionBlockers);
 for(const key of ["scripts","scriptPuppetContexts","nativeFoot","entryView","blockers"] as const)assert.deepEqual(map[key],before[key]);
 assert.deepEqual(map.map!.groups,before.map!.groups);assert.deepEqual(map.map!.entities,before.map!.entities);
 assert.deepEqual(fieldMapPresentationBlockers(map),before.blockers);assert.deepEqual(f.strict,before);
 assert.equal(candidate.report.ordinaryPresentation!.sourceGameplayAdmitted,false);
});
test("ordinary family refuses omitted, duplicated, foreign or corrupt source assessments",async()=>{
 const f=await fixture();
 for(const rows of [[],[f.assessment,f.assessment],[sealBatchContent({...f.assessment,sourceMapHash:"f".repeat(64)})]])
  assert.throws(()=>compileFrameworkContent(f.catalog,[f.strict],f.entry,{ordinaryPresentations:rows}),/complete ordinary|source assessment/);
 const corrupt=structuredClone(f.assessment);corrupt.reason="tampered after hash";
 assert.throws(()=>compileFrameworkContent(f.catalog,[f.strict],f.entry,{ordinaryPresentations:[corrupt]}),/content identity/);
 assert.throws(()=>compileFrameworkContent(f.catalog,[f.strict],f.entry,{ordinaryPresentations:null as unknown as FrameworkOrdinaryAssessment[]}),/complete ordinary/);
});
test("ordinary policy preserves genuine water, palette and missing source range rejection",async()=>{
 for(const kind of ["water","palette","range"] as const){
  const f=await fixture(),input=structuredClone(f.input);
  if(kind==="water")input.tilemap.data.layers.push({...input.tilemap.data.layers[0]!,name:"WaterGroup"});
  if(kind==="palette")(input.mapPackage.data.texture as {name:string;asset:string}[]).push({name:"sample_pal_anim",asset:"sample"});
  if(kind==="range")input.map=sealBatchContent({...input.map,cameraHost:null as never});
  const before=structuredClone(input);assert.throws(()=>compileFrameworkOrdinaryPresentation(input),/group|palette|range|camera/);
  assert.deepEqual(input,before);
 }
});
test("unready ordinary assessment remains unready and never gains an alternative",async()=>{
 const f=await fixture(),assessment=sealBatchContent({...f.assessment,mode:"unready" as const,presentation:null,blockers:["Unknown real WaterGroup"]}),
  result=compileFrameworkContent(f.catalog,[f.strict],f.entry,{ordinaryPresentations:[assessment]});
 assert.equal(result.maps[0]!.frameworkPresentation,undefined);assert.throws(()=>resolveFieldPresentation(result.maps[0]!),/water\/group/);
 assert.equal(result.report.ordinaryPresentation!.unready,1);assert.deepEqual(result.maps[0]!.blockers,f.strict.blockers);
});
test("already qualified native maps keep their original view and initial source entry binding",async()=>{
 const f=await fixture(),native=sealBatchContent({...f.strict,actorViewBlockers:[],nativeCompositionBlockers:[]}),world=structuredClone(f.catalog);
 world.maps[native.mapId]!.contentHash=native.contentHash;const catalog=sealBatchContent(world),
  entry=sealBatchContent({...f.entry,worldCatalogHash:catalog.contentHash,mapContentHash:native.contentHash}),
  assessment=sealBatchContent({...f.assessment,sourceMapHash:native.contentHash,mode:"native-preserved" as const,
   presentation:compileFrameworkOrdinaryPresentation({...f.input,map:native})}),
  result=compileFrameworkContent(catalog,[native],entry,{ordinaryPresentations:[assessment]});
 assert.equal(result.maps[0]!.frameworkPresentation,undefined);assert.deepEqual(resolveFieldPresentation(result.maps[0]!).view,native.actorView);
 assert.deepEqual(result.entry.view,entry.view);assert.equal(result.report.ordinaryPresentation!.available,1);
 assert.equal(result.report.ordinaryPresentation!.derived,0);assert.equal(result.report.ordinaryPresentation!.nativePreserved,1);
});
test("ordinary alternative uses actual initialized Session owners and stable restore",async()=>{
 const f=await fixture(),derived=compileFrameworkContent(f.catalog,[f.strict],f.entry,{ordinaryPresentations:[f.assessment]}),map=derived.maps[0]!,
  content=await compileFrameworkNewGame({sourceEntry:f.entry,sourceBattle:f.sourceBattle,sourceMap:f.strict,
   world:derived.catalog,map,battle:f.battle,entrance:map.partyEntry!.pointIns[0]!.id});
 const game=await GameSession.prepareFrameworkNewGame(content,derived.catalog,map,f.battle,{battleHandoff:"prepared"});
 game.advance(10);assert.equal(game.checkpointReady,true);
 const checkpoint=game.checkpoint(),owned=game.state.snapshot(),native=game.field.player.native!.entity;
 const restored=GameSession.restore(checkpoint,undefined,f.battle,{catalog:derived.catalog,map,initialized:{content,initialMap:map}},{battleHandoff:"prepared"});
 assert.deepEqual(restored.checkpoint(),checkpoint);assert.deepEqual(restored.state.snapshot(),owned);
 assert.equal(restored.field.player.native!.entity.id,native.id);assert.equal(native.viewBinding!.properties!.kind,"framework-flat-field-view-projection-v1");
 assert.deepEqual(restored.field.content.map.groups,game.field.content.map.groups);
});

test("ordinary maps keep one owner through media failure, retry, battle, Storage and return",async()=>{
 const f=await fixture(),first=structuredClone(f.strict),second=structuredClone(f.strict),next=first.mapId+1,
  point=first.partyEntry!.pointIns[0]!,ref={category:"MapLocalVariable" as const,index:0},site={source:f.source};
 const request=(script:string,mapId:number):Op=>({...site,script,index:0,kind:"change-map",request:{
  mapId,entrance:point.id,continuation:null,birdview:false,skipFade:true,skipBgm:true,origin:"script"}});
 first.scripts["ordinary-next"]=[request("ordinary-next",next)];
 first.scriptPuppetContexts!["ordinary-next"]={...structuredClone(first.scriptPuppetContexts!.fallback!),scriptHash:"5".repeat(64)};
 second.mapId=next;second.name="Second authored ordinary source shape";second.map!.identity!.mapId=next;
 second.map!.entryContext!.mapId=next;second.entryView!.mapId=next;second.partyEntry!.mapId=next;
 second.scripts["ordinary-return"]=[request("ordinary-return",first.mapId)];
 second.scriptPuppetContexts!["ordinary-return"]={...structuredClone(second.scriptPuppetContexts!.fallback!),scriptHash:"6".repeat(64)};
 second.scripts["ordinary-initialize"]=[
  {...site,script:"ordinary-initialize",index:0,kind:"inventory",command:{kind:"grant-item",id:701,count:1},result:null,dependencies:[]},
  {...site,script:"ordinary-initialize",index:1,kind:"calc",left:ref,operator:"＋",right:{kind:"immediate",value:1}},
  {...site,script:"ordinary-initialize",index:2,kind:"exit"}];
 second.scriptPuppetContexts!["ordinary-initialize"]={...structuredClone(second.scriptPuppetContexts!.fallback!),scriptHash:"7".repeat(64)};
 second.initializer="ordinary-initialize";
 for(const name of ["stone-battle","after-stone-battle"]){second.scripts[name]=structuredClone(f.map.scripts[name]!);second.scriptPuppetContexts![name]=structuredClone(f.map.scriptPuppetContexts![name]!);}
 const strict=[sealBatchContent(first),sealBatchContent(second)],sourceWorld=structuredClone(f.catalog);
 sourceWorld.transportation=structuredClone(f.battle.gameState.sourceNewGame!.transportation);
 const battleDraft=structuredClone(f.battle),qualification=battleDraft.common.battleEntry!.maps.find(row=>row.id===first.mapId)!;
 battleDraft.common.battleEntry!.maps.push({...structuredClone(qualification),id:next});const battle=sealBatchContent(battleDraft);
 sourceWorld.maps=Object.fromEntries(strict.map(map=>[map.mapId,{...f.catalog.maps[first.mapId]!,name:map.name,
  url:`/ordinary-source/${map.mapId}.json`,contentHash:map.contentHash}]));
 const original=sealBatchContent(sourceWorld),sourceEntry=sealBatchContent({...f.entry,worldCatalogHash:original.contentHash,mapContentHash:strict[0]!.contentHash});
 const assessments=strict.map(map=>sealBatchContent({...f.assessment,mapId:map.mapId,sourceMapHash:map.contentHash,
  presentation:compileFrameworkOrdinaryPresentation({...f.input,map})}));
 const derived=compileFrameworkContent(original,strict,sourceEntry,{ordinaryPresentations:assessments}),initial=derived.maps[0]!,target=derived.maps[1]!,
  content=await compileFrameworkNewGame({sourceEntry,sourceBattle:f.sourceBattle,sourceMap:strict[0]!,world:derived.catalog,map:initial,battle,entrance:point.id}),
  files=new Map<string,unknown>([["/ordinary/world.json",derived.catalog],["/ordinary/entry.json",content],["/ordinary/battle.json",battle],
   ...derived.maps.map(map=>[derived.catalog.maps[map.mapId]!.url,map] as [string,unknown])]),
  refs={kind:"game-content-refs-v2" as const,profile:"framework" as const,source:null,development:null,
   world:{url:"/ordinary/world.json",contentHash:derived.catalog.contentHash},initialized:{entry:{url:"/ordinary/entry.json",contentHash:content.contentHash},battle:{url:"/ordinary/battle.json",contentHash:battle.contentHash}}},
  repo=new GameContentRepository(async url=>{assert(files.has(url));return structuredClone(files.get(url));},"framework",refs),
  game=await GameSession.prepareFrameworkNewGame(content,derived.catalog,initial,battle),flow=new GameFlow(game),
  host={visible:true,mediaReady:true,overlayOpen:false};
 flow.start();flow.observeHost(host);flow.advance(10,host);const old=game.field,owner=game.state,owned=owner.snapshot(),nativeId=old.player.native!.entity.id;
 assert.equal(game.field.startEvent("ordinary-next"),true);assert.equal(game.field.stop?.kind,"map-transition");
 let allocations=0;const loader=new GameMapLoader(flow,repo,{prepare:async()=>{if(++allocations===1)throw Error("Controlled media preparation failure");return null;},discard(){}});
 const failed=await loader.load();assert.equal(failed.status,"failed");
 assert(failed.status==="failed");assert.match(String(failed.error),/Controlled media preparation failure/);
 assert.equal(game.field,old);assert.equal(game.state,owner);assert.deepEqual(game.state.snapshot(),owned);
 const cancelled=game.world.prepare(derived.catalog,target);assert.equal(game.field,old);assert.deepEqual(game.state.snapshot(),owned);
 game.world.discard(cancelled);assert.equal(game.world.commit(cancelled),false);assert.equal(game.field,old);assert.deepEqual(game.state.snapshot(),owned);
 const retry=await loader.load();assert.equal(retry.status,"committed",retry.status==="failed"?String(retry.error):retry.status);flow.advance(10,host);
 assert.equal(game.state,owner);assert.equal(game.field.eventState.read(ref),1);assert.equal(game.field.player.native!.entity.id,nativeId);
 const current=game.field,afterInit=game.state.snapshot();
 const mechanics=magicStonesSessionFixture();mechanics.win(game);assert.equal(game.field,current);
 assert.equal(game.field.player.native!.entity.id,nativeId);assert.equal(game.field.player.native!.entity.viewBinding!.properties!.kind,"framework-flat-field-view-projection-v1");
 const stored=new Map<string,string>(),storage=new CheckpointStorage({getItem:key=>stored.get(key)??null,setItem:(key,value)=>{stored.set(key,value);}},"framework"),
  saved=game.checkpoint();await storage.save(saved,1);
 const loaded=await storage.load();assert(loaded);
 const restored=GameSession.restore(loaded.checkpoint,undefined,battle,{catalog:derived.catalog,map:target,initialized:{content,initialMap:initial}});
 assert.deepEqual(restored.checkpoint(),saved);assert.equal(restored.field.eventState.read(ref),1);
 const after=game.state.snapshot();assert.equal(game.field.eventState.read(ref),1);assert.notDeepEqual(afterInit,owned);
 assert.deepEqual(restored.state.snapshot(),after);assert.equal(game.field.startEvent("ordinary-return"),true);
 const returning=await loader.load();assert.equal(returning.status,"committed");flow.advance(10,host);
 assert.equal(game.field.content.map.identity!.mapId,initial.mapId);assert.equal(game.state,owner);assert.equal(game.checkpointReady,true);
});
