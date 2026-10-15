// Trusted same-candidate metadata addition. No reader fallback or save selector.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const repository=resolve(import.meta.dirname,'..'),digest=/^[a-f0-9]{64}$/;
function jsonData(value){
 if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return;
 assert.ok(value&&typeof value==='object','NPC flat proof requires JSON data');
 const array=Array.isArray(value);assert.equal(Object.getPrototypeOf(value),array?Array.prototype:Object.prototype);
 const keys=Reflect.ownKeys(value);assert.ok(keys.every(key=>typeof key==='string'),'NPC flat proof contains symbols');
 if(array){assert.equal(keys.length,value.length+1,'NPC flat proof array must be dense');
  for(let i=0;i<value.length;i++)assert.ok(Object.hasOwn(value,String(i)),'NPC flat proof array must be dense');}
 for(const key of keys){if(array&&key==='length')continue;const descriptor=Object.getOwnPropertyDescriptor(value,key);
  assert.ok(descriptor.enumerable&&Object.hasOwn(descriptor,'value'),'NPC flat proof requires own data');jsonData(descriptor.value);}
}
function fields(value,expected){
 assert.ok(value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype,'Invalid NPC flat addition record');
 assert.deepEqual(Reflect.ownKeys(value).sort(),expected.split(',').sort(),'Invalid NPC flat addition fields');
 assert(Object.values(Object.getOwnPropertyDescriptors(value)).every(d=>d.enumerable&&Object.hasOwn(d,'value')),'NPC flat addition requires own data');
}
export function createFrameworkNpcFlatAddition({compilerDigest,assessments,catalog,entry}){
 assert.match(compilerDigest,digest);assert.ok(Array.isArray(assessments)&&assessments.length>0);
 const first=assessments[0],ids=assessments.map(a=>a.mapId).sort((a,b)=>a-b);
 assert.deepEqual(ids,Object.keys(catalog.maps).map(Number).sort((a,b)=>a-b),'Incomplete NPC flat addition scope');
 assert.ok(assessments.every(a=>JSON.stringify(a.reason)===JSON.stringify(first.reason)),'Mixed NPC flat templates');
 return {kind:'compiled-framework-npc-flat-addition-v1',compilerDigest,sourceSetHash:first.sourceSetHash,
  parentSourceSetHash:first.parentSourceSetHash,reason:first.reason,catalogHash:catalog.contentHash,entryHash:entry.contentHash,
  maps:[...assessments].sort((a,b)=>a.mapId-b.mapId).map(a=>({mapId:a.mapId,sourceMapHash:a.sourceMapHash,assessmentHash:a.contentHash}))};
}
export function parseFrameworkNpcFlatAddition(raw){
 if(raw===undefined)return null;
 jsonData(raw);
 fields(raw,'kind,compilerDigest,sourceSetHash,parentSourceSetHash,reason,catalogHash,entryHash,maps');
 assert.equal(raw.kind,'compiled-framework-npc-flat-addition-v1');assert.equal(typeof raw.reason,'string');assert.ok(raw.reason.trim());
 for(const key of ['compilerDigest','sourceSetHash','parentSourceSetHash','catalogHash','entryHash'])assert.match(raw[key],digest);
 assert.ok(Array.isArray(raw.maps)&&raw.maps.length>0&&Object.getPrototypeOf(raw.maps)===Array.prototype);
 assert.equal(Reflect.ownKeys(raw.maps).length,raw.maps.length+1,'NPC flat addition maps must be dense');
 const seen=new Set();let previous=0;
 for(let i=0;i<raw.maps.length;i++){
  const descriptor=Object.getOwnPropertyDescriptor(raw.maps,String(i));assert.ok(descriptor?.enumerable&&Object.hasOwn(descriptor,'value'));
  const row=descriptor.value;fields(row,'mapId,sourceMapHash,assessmentHash');
  assert.ok(Number.isSafeInteger(row.mapId)&&row.mapId>previous&&!seen.has(row.mapId));previous=row.mapId;seen.add(row.mapId);
  assert.match(row.sourceMapHash,digest);assert.match(row.assessmentHash,digest);
 }
 return structuredClone(raw);
}

/** The caller supplies its locked original candidate world/map reader. The
 * corpus is loaded once and each exact map assessment is recomputed once;
 * no report, mutable publication or missing source can stand in for it. */
export function createFrameworkNpcFlatEvidenceReader({root=repository,compiledDir='dist',readSourceWorld,readSourceMap}={}){
 assert.equal(typeof readSourceWorld,'function');assert.equal(typeof readSourceMap,'function');
 let context;const maps=new Map();
 const load=async()=>{
  const importer=name=>import(pathToFileURL(resolve(root,compiledDir,'src',name+'.js')).href),
   [corpus,compiler,integrity,content]=await Promise.all(['compiler/corpus','compiler/framework-npc-flat-projection','core/content-integrity','compiler/content'].map(importer));
  const snapshot=await corpus.loadCorpus(root),world=await integrity.verifyContent(structuredClone(await readSourceWorld()));
  assert.equal(world.developmentProfile,undefined);assert.equal(world.sourceSetHash,snapshot.sourceSetHash);
  assert.equal(world.parentSourceSetHash,snapshot.manifest.parentSourceSetHash);
  return{snapshot,world,...compiler,...integrity,...content};
 };
 const complete=new Map();
 async function assessed(api,proof,row){
  const key=api.canonical({mapId:row.mapId,reason:proof.reason});
  if(!maps.has(key))maps.set(key,(async()=>{
   const sourceMap=await api.verifyContent(structuredClone(await readSourceMap(row.mapId)),api.world.maps[String(row.mapId)].contentHash),
    assessment=api.assessFrameworkNpcFlatMap(api.snapshot,sourceMap,proof.reason);
   // The candidate/input collection retains the complete source body.
   // This proof cache needs only the verified map identity and derived assessment.
   return{sourceMap:{contentHash:sourceMap.contentHash},assessment};
  })());
  const result=await maps.get(key);assert.equal(row.sourceMapHash,result.sourceMap.contentHash,'NPC flat strict map pin mismatch');
  assert.equal(row.assessmentHash,result.assessment.contentHash,'NPC flat original source assessment mismatch');
  return result;
 }
 return async(proof,mapId=null)=>{
  context??=load();const api=await context;
  assert.equal(proof.sourceSetHash,api.world.sourceSetHash);assert.equal(proof.parentSourceSetHash,api.world.parentSourceSetHash);
  assert.deepEqual(proof.maps.map(row=>row.mapId),Object.keys(api.world.maps).map(Number).sort((a,b)=>a-b),'NPC flat proof must retain every source map');
  assert.equal(typeof proof.reason,'string');assert.ok(proof.reason.trim());
  const proofKey=api.canonical(proof);
  if(!complete.has(proofKey))complete.set(proofKey,(async()=>{
   // Every source map/failed object is recomputed, not just recipe-selected
   // maps. The one complete candidate proof is shared across all recipes.
   const sourceMaps=[];for(const row of proof.maps)sourceMaps.push(await api.verifyContent(structuredClone(await readSourceMap(row.mapId)),api.world.maps[String(row.mapId)].contentHash));
   const all=api.assessFrameworkNpcFlatWorld(api.snapshot,api.world,sourceMaps,proof.reason);
   for(let i=0;i<proof.maps.length;i++){const row=proof.maps[i],assessment=all[i];assert.equal(row.sourceMapHash,sourceMaps[i].contentHash);assert.equal(row.assessmentHash,assessment.contentHash);
     maps.set(api.canonical({mapId:row.mapId,reason:proof.reason}),Promise.resolve({sourceMap:{contentHash:sourceMaps[i].contentHash},assessment}));}
  })());
  await complete.get(proofKey);
  if(mapId===null)return{reason:proof.reason};
  const row=proof.maps.find(row=>row.mapId===mapId);assert.ok(row,'Unknown NPC flat map');
  return assessed(api,proof,row);
 };
}

/** Normalize only a proved additive sidecar/marker in a detached comparison.
 * The actual body, refs, original blockers and all unrelated metadata remain. */
export async function comparableFrameworkNpcFlatAddition({before,after,proof,evidence,canonical}){
 if(!proof)return{after,addition:null};
 const previous=before.developmentProfile,next=after.developmentProfile,
  changed=canonical(before.frameworkNpcFlat??null)!==canonical(after.frameworkNpcFlat??null)||
   canonical(previous?.npcProjection??null)!==canonical(next?.npcProjection??null);
 if(!changed)return{after,addition:null};
 assert.equal(typeof evidence,'function','Missing trusted NPC flat evidence reader');
 assert.equal(previous?.kind,'framework-development-v1','NPC flat addition requires an existing framework profile');
 assert.equal(next?.kind,'framework-development-v1','NPC flat addition requires a framework profile');
 assert.equal(after.sourceSetHash,proof.sourceSetHash);assert.equal(after.parentSourceSetHash,proof.parentSourceSetHash);
 const {reason}=await evidence(proof);const policy='web-source-npc-flat-projection-v1';assert.equal(next.npcProjection,policy);
 assert.ok(previous.npcProjection===undefined||previous.npcProjection===policy,'NPC flat policy cannot be replaced');
 const comparison=structuredClone(after);let map=null;
 if(after.kind==='world-map-development'){
  assert.equal(before.mapId,after.mapId);const{sourceMap,assessment}=await evidence(proof,after.mapId);
  assert.equal(after.developmentProfile.sourceContentHash,sourceMap.contentHash);
  assert.equal(canonical(after.frameworkNpcFlat),canonical(assessment.host),'NPC flat sidecar differs from complete original derivation');
  if(before.frameworkNpcFlat!==undefined){
   assert.equal(before.frameworkNpcFlat.sourceMapHash,previous.sourceContentHash);
   const{sourceMapHash:_,...old}=before.frameworkNpcFlat,{sourceMapHash:__,...current}=assessment.host;
   assert.equal(canonical(old),canonical(current),'NPC flat existing programs or policy cannot be replaced');
   comparison.frameworkNpcFlat=structuredClone(before.frameworkNpcFlat);
  }else delete comparison.frameworkNpcFlat;
  map={mapId:after.mapId,sourceMapHash:sourceMap.contentHash,assessmentHash:assessment.contentHash,
   declared:assessment.objects.length,derived:assessment.host.bindings.length,
   unready:assessment.objects.length-assessment.host.bindings.length};
 }else{
  assert.equal(before.frameworkNpcFlat,undefined);assert.equal(after.frameworkNpcFlat,undefined);
  if(after.kind==='world-development')assert.equal(after.contentHash,proof.catalogHash,'NPC flat candidate world mismatch');
  else{assert.equal(after.kind,'source-new-game-content-v1');assert.equal(after.contentHash,proof.entryHash,'NPC flat candidate entry mismatch');}
 }
 if(previous.npcProjection===undefined)delete comparison.developmentProfile.npcProjection;
 return{after:comparison,addition:{kind:proof.kind,compilerDigest:proof.compilerDigest,sourceSetHash:proof.sourceSetHash,
  parentSourceSetHash:proof.parentSourceSetHash,map,previousMarker:previous.npcProjection??null,nextMarker:policy,
  nativeParity:false,runtimeAdmission:'unassessed'}};
}
