import test from 'node:test';import assert from 'node:assert/strict';import {resolve}from'node:path';import{pathToFileURL,fileURLToPath}from'node:url';
import{compileFieldNpcRoutes}from'../src/compiler/field-npc-route.js';import{hash,canonical}from'../src/compiler/content.js';import{sourceNewGameFixture}from'./fixtures/source-new-game.js';import type{WorldMapContent}from'../src/field/world.js';
const moduleUrl=pathToFileURL(resolve(process.cwd(),'scripts/source-recipe-inputs.mjs')).href,compiledDir=fileURLToPath(new URL('../',import.meta.url));
async function setup(){
 const f=sourceNewGameFixture(),source={file:'controlled-route.bundle',assetPath:'Synthetic/package.json',objectId:'9223372036854775807',serializedFile:'CAB-route',sha256:'a'.repeat(64)},alias={name:'route_instruction_701',asset:'Room/route701'};
 const corpus={assets:[{id:'package',kind:'map-package' as const,source,data:{asset_group_name:'controlled-map',map:[{name:'Room',route_instruction:[alias]}]}},{id:'route',kind:'data' as const,source:{...source,objectId:'-9223372036854775808',assetPath:'Synthetic/Room/route701.json'},data:{instruction_list:[{instruction_type:2,delay_sec:.1}]}}],tables:{'map.csv':[{id:String(f.map.mapId),map_name:'Room',asset_name:'controlled-map'}]},sourceSetHash:'b'.repeat(64),manifest:{parentSourceSetHash:'c'.repeat(64)}};
 const result=compileFieldNpcRoutes(corpus,f.map.mapId),catalog=result.catalog!;
 const seal=<T extends{contentHash:string}>(v:T):T=>{const{contentHash:_,...body}=structuredClone(v);return {...body,contentHash:hash(body)} as T;};
 const before=seal({...structuredClone(f.map),sourceSetHash:corpus.sourceSetHash,parentSourceSetHash:corpus.manifest.parentSourceSetHash,name:'Room'}),after=seal({...before,npcRoutes:catalog});
 const url=`/world/maps/${before.mapId}.json`,recipe={kind:'initialized-systems-recipe-v1',id:'source-route-evidence',sourceMap:{url,contentHash:before.contentHash},unrelated:{hash:before.contentHash}},recipeBytes=Buffer.from(JSON.stringify(recipe));
 const declaration={kind:'compiled-source-npc-route-evidence-addition-v1',compilerDigest:'d'.repeat(64),sourceSetHash:corpus.sourceSetHash,parentSourceSetHash:corpus.manifest.parentSourceSetHash};
 const evidence={kind:'verified-source-npc-route-evidence-v1',sourceDigest:hash(corpus),sourceSetHash:corpus.sourceSetHash,parentSourceSetHash:corpus.manifest.parentSourceSetHash,rawAliasHash:hash([alias]),rawAliases:[alias],catalog,report:result.report,diagnostics:result.diagnostics};
 const state={before,after,evidence};const run=async(extra:Record<string,unknown>={})=>(await import(moduleUrl)).resolveSourceRecipeInputs({compiledDir,recipePath:'content-batches/source-route-evidence.recipe.json',recipeBytes,
  readCurrentJson:async()=>state.before,readCandidateJson:async()=>state.after,sourceNpcRoutesAddition:declaration,sourceNpcRouteEvidence:async()=>structuredClone(state.evidence),...extra});
 return {state,run,seal,recipeBytes,recipe,declaration,evidence};
}
test('exact additive source route proof keeps old pins/whole identities and reports actual newly read physical refs',async()=>{
 const f=await setup(),bytes=Buffer.from(f.recipeBytes),result=await f.run();assert.deepEqual(f.recipeBytes,bytes);assert.equal(f.recipe.sourceMap.contentHash,f.state.before.contentHash);
 assert.equal(result.recipe.sourceMap.contentHash,f.state.after.contentHash);assert.equal(result.recipe.unrelated.hash,f.state.before.contentHash);
 const audit=result.report.sourceNpcRouteAdditions[0];assert.equal(audit.evidence.sourceDigest,f.evidence.sourceDigest);assert.equal(audit.evidence.rawAliasHash,f.evidence.rawAliasHash);assert.equal(audit.candidateCatalog.routes['701'].source.objectId,'-9223372036854775808');assert.ok(audit.sourceIdentityAfter.physicalSourceCount>audit.sourceIdentityBefore.physicalSourceCount);assert.equal(audit.grantsSourceAdmission,false);assert.equal(audit.saveMigration,false);
 assert.equal(canonical(f.state.before.npcRoutes??null),'null');
});
test('route metadata addition without a named declaration or with unavailable/unknown proof rejects',async()=>{
 const f=await setup();await assert.rejects(()=>f.run({sourceNpcRoutesAddition:undefined}),/explicit compiler declaration/);
 await assert.rejects(()=>f.run({sourceNpcRoutesAddition:{...f.declaration,kind:'guess-routes'}}),/Unknown NPC route/);
 await assert.rejects(()=>f.run({compiledDir:resolve(compiledDir,'unavailable')}),/ENOENT|unavailable/);
 await assert.rejects(()=>f.run({sourceNpcRoutesAddition:{...f.declaration,compilerDigest:'bad'}}),/digest/i);
});
test('combined profile and route audits retain the original candidate identity rather than its comparison projection',async()=>{
 const f=await setup(),marker='web-field-animated-map-entities-v1',profile={kind:'framework-development-v1' as const,
  policy:'omit-anonymous-environment-particles-v1' as const,sourceContentHash:'e'.repeat(64),omissions:[],
  storyRuntime:'web-field-story-runtime-v1' as const,autoSave:'web-field-autosave-barrier-v1' as const};
 f.state.before=f.seal({...f.state.before,developmentProfile:profile});
 f.state.after=f.seal({...f.state.after,developmentProfile:{...profile,mapAnimatedEntities:marker as 'web-field-animated-map-entities-v1'}});
 f.recipe.sourceMap.contentHash=f.state.before.contentHash;const recipeBytes=Buffer.from(JSON.stringify(f.recipe)),before=canonical(f.state);
 const result=await(await import(moduleUrl)).resolveSourceRecipeInputs({compiledDir,recipePath:'controlled-combined.recipe.json',recipeBytes,
  readCurrentJson:async()=>f.state.before,readCandidateJson:async()=>f.state.after,
  sourceNpcRoutesAddition:f.declaration,sourceNpcRouteEvidence:async()=>structuredClone(f.evidence),
  frameworkProfileUpgrade:{kind:'compiled-framework-profile-upgrade-v4',compilerDigest:'d'.repeat(64),
   markers:{storyRuntime:profile.storyRuntime,autoSave:profile.autoSave,mapAnimatedEntities:marker}}});
 const route=result.report.sourceNpcRouteAdditions[0],upgrade=result.report.frameworkProfileUpgrades[0];
 assert.equal(route.sourceIdentityAfter.profileDetails.mapAnimatedEntities,marker);
 assert.deepEqual(route.sourceIdentityBefore,upgrade.sourceIdentityBefore);
 assert.deepEqual(route.sourceIdentityAfter,upgrade.sourceIdentityAfter);
 assert.ok(route.sourceIdentityAfter.physicalSourceCount>route.sourceIdentityBefore.physicalSourceCount);
 assert.equal(upgrade.comparisonIdentityAfter.profileDetails.mapAnimatedEntities,undefined,'Only the comparison projection removes the new marker');
 assert.equal(canonical(f.state),before,'Identity reporting cannot mutate the validated candidate');
});
test('foreign source, raw alias digest, omitted aliases and modified physical source data cannot rebind',async()=>{
 for(const variant of ['source','parent','alias-digest','alias-omission','route-source','route-body']as const){const f=await setup();
  if(variant==='source')f.declaration.sourceSetHash='e'.repeat(64);if(variant==='parent')f.declaration.parentSourceSetHash='e'.repeat(64);
  if(variant==='alias-digest')f.state.evidence.rawAliasHash='e'.repeat(64);if(variant==='alias-omission')f.state.evidence.rawAliases=[];
  if(variant==='route-source')f.state.after.npcRoutes!.routes['701']!.source.objectId='9007199254740993';
  if(variant==='route-body')f.state.after.npcRoutes!.routes['701']!.instructions[0]!.raw.delay_sec=42;
  f.state.after=f.seal(f.state.after);await assert.rejects(()=>f.run(),/mismatch|domain|catalog|binding|source/i,variant);
 }
});
test('an existing catalog cannot be replaced or removed, even under a newer compiler declaration',async()=>{
 for(const variant of ['remove','changed']as const){const f=await setup();f.state.before=f.seal({...f.state.before,npcRoutes:structuredClone(f.evidence.catalog)});
  f.recipe.sourceMap.contentHash=f.state.before.contentHash;f.recipeBytes=Buffer.from(JSON.stringify(f.recipe));
  const result=(await import(moduleUrl)).resolveSourceRecipeInputs;
  if(variant==='remove'){const v=structuredClone(f.state.after);Reflect.deleteProperty(v,'npcRoutes');f.state.after=f.seal(v);}
  else{f.state.after.npcRoutes!.routes['701']!.instructions[0]!.raw.delay_sec=12;f.state.after=f.seal(f.state.after);}
  await assert.rejects(()=>result({compiledDir,recipePath:'controlled.recipe.json',recipeBytes:f.recipeBytes,readCurrentJson:async()=>f.state.before,readCandidateJson:async()=>f.state.after,sourceNpcRoutesAddition:f.declaration,sourceNpcRouteEvidence:async()=>f.evidence}),/cannot be removed|catalog|binding/);
 }
});
test('unrelated source, media and unknown profile changes remain under whole identity comparison',async()=>{
 for(const variant of ['source','media','profile']as const){const f=await setup();
  if(variant==='source')f.state.after.map!.source.file='foreign-map.bundle';
  if(variant==='media')f.state.after.map!.textures.unrelated='/foreign/new.png';
  if(variant==='profile')f.state.after.developmentProfile={kind:'framework-development-v1',policy:'omit-anonymous-environment-particles-v1',sourceContentHash:'e'.repeat(64),omissions:[]};
  f.state.after=f.seal(f.state.after);await assert.rejects(()=>f.run(),/Source identity\/profile\/media/);
 }
});
