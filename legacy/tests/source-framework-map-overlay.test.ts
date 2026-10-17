import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { canonical,hash } from '../src/compiler/content.js';
import { FieldGame } from '../src/core/field.js';
import { fieldNpcSessionFixture } from './fixtures/field-npc-session.js';
const url=pathToFileURL(resolve(process.cwd(),'scripts/source-framework-map-overlay.mjs')).href;
function seal<T extends {contentHash:string}>(v:T):T{const {contentHash:_,...body}=v;return{...body,contentHash:hash(body)} as T;}
async function fixture(){
 const f=await fieldNpcSessionFixture({flatNpc:{allLayers:true,birdview:false,layer:1}}),source=structuredClone(f.map);
 delete source.developmentProfile;delete source.frameworkNpcActivity;delete source.frameworkNpcFlat;const strict=seal(source);
 assert.equal(strict.contentHash,f.map.developmentProfile!.sourceContentHash);
 const framework=structuredClone(f.map),initialized=structuredClone(strict);
 initialized.developmentProfile={kind:'framework-development-v1',policy:'omit-anonymous-environment-particles-v1',sourceContentHash:strict.contentHash,omissions:[],npcActivity:'framework-npc-area-v1'};
 initialized.frameworkNpcActivity=structuredClone(framework.frameworkNpcActivity!);
 return{f,source:strict,framework,initialized:seal(initialized),canonical,hash};
}
test('shared overlay keeps the flat source sidecar with real actor geometry and recipe NPC owner; actual Field constructor no longer loses admission',async()=>{
 const {overlaySourceFrameworkMap:overlay}=await import(url),v=await fixture(),original=canonical([v.source,v.framework,v.initialized]),map=overlay(v),g=v.f.make(),content=structuredClone(g.field.content);
 delete content.frameworkNpcFlat;assert.throws(()=>new FieldGame(content,undefined,undefined,undefined,g.field.options),/requires|Unbound/);
 content.frameworkNpcFlat=map.frameworkNpcFlat;content.developmentProfile=map.developmentProfile;
 const actual=new FieldGame(content,undefined,undefined,undefined,g.field.options);
 assert.equal(actual.content.frameworkNpcFlat!.bindings[0]!.definition.geometry.layer,1);
 assert.deepEqual(map.map,v.framework.map);assert.deepEqual(map.blockers,v.framework.blockers);assert.deepEqual(map.fieldEffects,v.framework.fieldEffects);
 assert.deepEqual(map.scripts,v.source.scripts);assert.deepEqual(map.scriptLocals,v.source.scriptLocals);assert.deepEqual(map.scriptPuppetContexts,v.source.scriptPuppetContexts);
 assert.deepEqual(map.frameworkNpcActivity,v.initialized.frameworkNpcActivity);assert.equal(canonical([v.source,v.framework,v.initialized]),original);
 map.frameworkNpcFlat!.bindings[0]!.definition.geometry.x=999;assert.notEqual(v.framework.frameworkNpcFlat!.bindings[0]!.definition.geometry.x,999);
});
test('overlay rejects changed source namespace, original metadata, identity and implicit recipe policy grants',async()=>{
 const {overlaySourceFrameworkMap:overlay}=await import(url);
 for(const change of [(v:any)=>v.initialized.scripts.reserved[0].index=99,(v:any)=>v.initialized.scriptLocals.reserved={invented:3},(v:any)=>v.initialized.scriptPuppetContexts.reserved.scriptHash='0'.repeat(64),(v:any)=>v.initialized.map.groups.entity_default.entities[0].x=999,(v:any)=>v.framework.initializer='invented',(v:any)=>v.framework.mapId=999,(v:any)=>v.initialized.developmentProfile.guessedPolicy='true',(v:any)=>v.framework.developmentProfile.sourceContentHash='0'.repeat(64)]){
  const v=await fixture();change(v);v.initialized=seal(v.initialized);v.framework=seal(v.framework);assert.throws(()=>overlay(v));
 }
 const v=await fixture();v.initialized.scripts.reserved![0]!.index=99;assert.throws(()=>overlay(v),/identity changed/);
});
test('overlay preserves trusted source FX/presentation and recipe service/view additions without granting unknown source policies',async()=>{
 const {overlaySourceFrameworkMap:overlay}=await import(url),v:any=await fixture();
 v.initialized.frameworkRelayInteraction={controlled:'recipe relay'};v.initialized.frameworkPassiveEffects={controlled:'recipe passive'};
 v.initialized.frameworkPresentation={controlled:'recipe view'};v.initialized.walkEncounters={controlled:'recipe walk'};v.initialized.frameworkWalkBinding={controlled:'recipe bound walk'};
 v.framework.fieldEffects={media:{controlled:'source FX catalog'}};v.initialized=seal(v.initialized);v.framework=seal(v.framework);
 let map=overlay(v);for(const key of ['frameworkRelayInteraction','frameworkPassiveEffects','frameworkPresentation','walkEncounters','frameworkWalkBinding'])assert.deepEqual(map[key],v.initialized[key]);assert.deepEqual(map.fieldEffects,v.framework.fieldEffects);
 v.framework.frameworkPresentation={controlled:'source periodic view'};v.framework=seal(v.framework);map=overlay(v);assert.deepEqual(map.frameworkPresentation,v.framework.frameworkPresentation);
});

test('world overlay pins exact map membership and hashes while retaining initialized URLs and source capabilities',async()=>{
 const {overlaySourceFrameworkMap:overlay,overlaySourceFrameworkWorld:worldOverlay}=await import(url),v=await fixture(),map=overlay(v);
 const source:any=seal({kind:'world-development',formatVersion:1,sourceSetHash:v.source.sourceSetHash,parentSourceSetHash:v.source.parentSourceSetHash,mediaSourceSetHash:v.source.mediaSourceSetHash,characters:{},maps:{[map.mapId]:{url:'/world/original.json',contentHash:v.source.contentHash}},contentHash:''});
 const framework=seal({...source,developmentProfile:{...v.framework.developmentProfile!,sourceContentHash:source.contentHash}}),initialized=seal({...source,developmentProfile:{...v.initialized.developmentProfile!,sourceContentHash:source.contentHash},maps:{[map.mapId]:{url:'/initialized/map.json',contentHash:v.source.contentHash}}});
 const args={source,framework,initialized,maps:[map],canonical,hash},world=worldOverlay(args);
 assert.equal(world.maps[map.mapId].url,'/initialized/map.json');assert.equal(world.maps[map.mapId].contentHash,map.contentHash);assert.equal(world.developmentProfile.npcProjection,v.framework.developmentProfile!.npcProjection);
 assert.throws(()=>worldOverlay({...args,maps:[map,map]}),/Duplicate/);assert.throws(()=>worldOverlay({...args,maps:[]}),/membership/);
 const wrong=structuredClone(map);wrong.developmentProfile.sourceContentHash='0'.repeat(64);assert.throws(()=>worldOverlay({...args,maps:[seal(wrong)]}));
 const forged=seal({...initialized,characters:{invented:{}}});assert.throws(()=>worldOverlay({...args,initialized:forged}),/characters/);
});
