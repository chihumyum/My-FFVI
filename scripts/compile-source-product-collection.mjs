// One full source-newgame collection from one already complete fresh candidate.
// Existing publisher/repository/archive owners retain all publication authority.
import assert from'node:assert/strict';import{resolve}from'node:path';import{pathToFileURL}from'node:url';
import{sourceSpriteMediaInput}from'./compile-source-prerequisites.mjs';
import{runtimeDigest}from'./runtime-digest.mjs';
import{openSourceCandidate}from'./source-candidate.mjs';
import{FRESH_SOURCE_PRODUCTS,FRESH_SOURCE_INPUT_LOCK,FRESH_SOURCE_PACKAGE_NAMESPACE,sourceInputEnvelopeKind}from'./source-production-mode.mjs';
export async function compileSourceProductCollection({root,compiledDir='dist',runtimeRoot=root,candidateDir,sourceSpriteMedia,sourceRecipePaths,sourceSelectionPath}={}){
 assert(candidateDir,'Fresh collection requires an explicit complete candidate directory');
 assert(sourceRecipePaths===undefined&&sourceSelectionPath===undefined,'Fresh collection cannot consume authored recipe selections');
 root=resolve(root);compiledDir=resolve(root,compiledDir);
 const candidate=await openSourceCandidate({root,runtimeRoot,compiledDir,candidateDir});
 return prepareSourceProductCollection({root,runtimeRoot,compiledDir,candidate,sourceSpriteMedia});
}
/** The shared internal collection boundary is also exercised with synthetic
 * candidates; that is publication mechanism evidence, never source acceptance. */
export async function prepareSourceProductCollection({root,runtimeRoot=root,compiledDir,candidate,sourceSpriteMedia}){
 root=resolve(root);compiledDir=resolve(root,compiledDir);
 assert.equal(candidate.report.status,'complete');assert.equal(candidate.report.productMode,FRESH_SOURCE_PRODUCTS);
 assert.equal(candidate.lock.kind,FRESH_SOURCE_INPUT_LOCK,'Fresh collection cannot promote a legacy candidate');
 assert.equal(candidate.lock.packageNamespace,FRESH_SOURCE_PACKAGE_NAMESPACE);assert.equal(candidate.report.link.packageNamespace,FRESH_SOURCE_PACKAGE_NAMESPACE);
 assert(candidate.report.frameworkBattleDirectory,'Fresh newgame requires the complete battle directory');
 assert.equal(candidate.runtimeSha256,await runtimeDigest(runtimeRoot,compiledDir),'Foreign runtime cannot be re-signed by collection assembly');
 const spriteMediaDeclaration=sourceSpriteMediaInput(sourceSpriteMedia,root);
 if(spriteMediaDeclaration||candidate.lock.sourceSpriteMedia){assert.equal(sourceInputEnvelopeKind(candidate.lock),'source-prerequisite-input-lock-v6','Fresh media collection needs its dual-generation lock');assert.deepEqual(candidate.lock.sourceSpriteMedia,spriteMediaDeclaration,'Fresh media collection declaration differs from the complete candidate');}
 await candidate.validate();
 const api=Object.assign({},...await Promise.all(['core/game-content','core/game-content-refs','core/content-integrity','compiler/content'].map(n=>import(pathToFileURL(resolve(compiledDir,'src',n+'.js')).href))));
 const urls=['/world/catalog.json','/game/source-new-game.json','/game/source-catalog.json','/framework/world/catalog.json','/framework/full-new-game.json','/framework/full-battle.json','/framework/full-content-refs.json'];
 const [world,entry,battle,frameworkWorld,frameworkEntry,frameworkBattle,fullRefs]=await Promise.all(urls.map(u=>candidate.read(u)));
 assert.equal(entry.worldCatalogHash,world.contentHash);assert.equal(entry.battleCatalogHash,battle.contentHash);
 assert.equal(frameworkEntry.worldCatalogHash,frameworkWorld.contentHash);assert.equal(frameworkEntry.battleCatalogHash,frameworkBattle.contentHash);
 const existing=api.parseGameContentRefs(fullRefs);assert.equal(existing.profile,'framework');assert.equal(existing.development,null);
 assert.equal(existing.world.contentHash,frameworkWorld.contentHash);assert.equal(existing.source.entry.contentHash,frameworkEntry.contentHash);assert.equal(existing.source.battle.contentHash,frameworkBattle.contentHash);
 const payloads=new Map(),put=(url,v)=>{assert(!payloads.has(url));payloads.set(url,structuredClone(v));};
 for(const [prefix,w,e,b]of[['source',world,entry,battle],['framework',frameworkWorld,frameworkEntry,frameworkBattle]]){
  for(const [name,v]of[['world',w],['entry',e],['battle',b]])put(FRESH_SOURCE_PACKAGE_NAMESPACE+'/'+prefix+'/'+name+'.json',v);
  const ids=Object.keys(w.maps).sort();assert.equal(ids.length,candidate.report.producer.strict.maps,'Fresh collection cannot drop unvisited maps');
  for(const id of ids){const ref=w.maps[id];assert.equal(ref.url,FRESH_SOURCE_PACKAGE_NAMESPACE+'/'+prefix+'/maps/'+id+'.json');const m=await candidate.read(ref.url);await api.verifyContent(m,ref.contentHash);api.assertGameWorldMapIdentity(Number(id),w,m);put(ref.url,m);}
  const reference=name=>({url:FRESH_SOURCE_PACKAGE_NAMESPACE+'/'+prefix+'/'+name+'.json',contentHash:payloads.get(FRESH_SOURCE_PACKAGE_NAMESPACE+'/'+prefix+'/'+name+'.json').contentHash});
  put('/content-packages/source-products-'+prefix+'.json',api.parseGameContentRefs({kind:'game-content-refs-v1',profile:prefix==='source'?'source':'framework',world:reference('world'),source:{entry:reference('entry'),battle:reference('battle')},development:null}));
 }
 assert.deepEqual(Object.keys(world.maps).sort(),Object.keys(frameworkWorld.maps).sort());
 for(const [name,url]of[['battle-binding','/framework/full-battle-binding.json'],['battle-directory-requests','/framework/full-battle-directory-requests.json'],['battle-directory-report','/framework/full-battle-directory-report.json']])put('/content-packages/source-products/'+name+'.json',await candidate.read(url));
 const report={kind:'fresh-source-product-collection-v1',sourceCandidateRuntime:candidate.runtimeSha256,sourceSetHash:candidate.lock.sourceSetHash,parentSourceSetHash:candidate.lock.parentSourceSetHash,
  sourceMaps:Object.keys(world.maps).length,frameworkMaps:Object.keys(frameworkWorld.maps).length,developmentRoles:null,legacyRecipesConsumed:0,legacySeedsConsumed:0,sourceGameplayAdmitted:false,sourceCampaignComplete:false};
 put('/content-packages/source-products/build-report.json',{...report,contentHash:api.hash(report)});
 // Validate both actual Repository roles before the shared publisher receives
 // a candidate. No fallback reader reaches old build/game or public caches.
 for(const name of['source','framework']){const refs=payloads.get('/content-packages/source-products-'+name+'.json'),repository=new api.GameContentRepository(async url=>{assert(payloads.has(url),'Missing same-candidate collection body '+url);return structuredClone(payloads.get(url));},refs.profile,refs);
  await repository.world();await repository.sourceNewGame();assert.equal(repository.hasDevelopmentEntry,false);}
 return {payloads,reports:[{id:'fresh-source-products',report}],recipes:new Map(),rebindings:[],battleRebindings:[],sourceInputs:candidate.lock,runtimeSha256:candidate.runtimeSha256,
  sourceProductMode:FRESH_SOURCE_PRODUCTS,validateInputs:async()=>{await candidate.validate();assert.equal(await runtimeDigest(runtimeRoot,compiledDir),candidate.runtimeSha256,'Fresh collection runtime changed');}};
}
