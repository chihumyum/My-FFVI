// Trusted same-candidate metadata addition. No reader fallback or save selector.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const repository=resolve(import.meta.dirname,'..'),digest=/^[a-f0-9]{64}$/;
function jsonData(value){
 if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return;
 assert.ok(value&&typeof value==='object','NPC Area proof requires JSON data');
 const array=Array.isArray(value);assert.equal(Object.getPrototypeOf(value),array?Array.prototype:Object.prototype);
 const keys=Reflect.ownKeys(value);assert.ok(keys.every(key=>typeof key==='string'),'NPC Area proof contains symbols');
 if(array){assert.equal(keys.length,value.length+1,'NPC Area proof array must be dense');
  for(let i=0;i<value.length;i++)assert.ok(Object.hasOwn(value,String(i)),'NPC Area proof array must be dense');}
 for(const key of keys){if(array&&key==='length')continue;const descriptor=Object.getOwnPropertyDescriptor(value,key);
  assert.ok(descriptor.enumerable&&Object.hasOwn(descriptor,'value'),'NPC Area proof requires own data');jsonData(descriptor.value);}
}
function fields(value,expected){
 assert.ok(value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype,'Invalid NPC Area addition record');
 assert.deepEqual(Reflect.ownKeys(value).sort(),expected.split(',').sort(),'Invalid NPC Area addition fields');
 assert(Object.values(Object.getOwnPropertyDescriptors(value)).every(d=>d.enumerable&&Object.hasOwn(d,'value')),'NPC Area addition requires own data');
}
export function createFrameworkNpcAreaAddition({compilerDigest,assessments,catalog,entry}){
 assert.match(compilerDigest,digest);assert.ok(Array.isArray(assessments)&&assessments.length>0);
 const first=assessments[0],ids=assessments.map(a=>a.record.mapId).sort((a,b)=>a-b);
 assert.deepEqual(ids,Object.keys(catalog.maps).map(Number).sort((a,b)=>a-b),'Incomplete NPC Area addition scope');
 assert.ok(assessments.every(a=>JSON.stringify(a.template)===JSON.stringify(first.template)),'Mixed NPC Area templates');
 return {kind:'compiled-framework-npc-area-addition-v1',compilerDigest,sourceSetHash:first.sourceSetHash,
  parentSourceSetHash:first.parentSourceSetHash,template:structuredClone(first.template),catalogHash:catalog.contentHash,entryHash:entry.contentHash,
  maps:[...assessments].sort((a,b)=>a.record.mapId-b.record.mapId).map(a=>({mapId:a.record.mapId,sourceMapHash:a.record.sourceMapHash,assessmentHash:a.contentHash}))};
}
export function parseFrameworkNpcAreaAddition(raw){
 if(raw===undefined)return null;
 jsonData(raw);
 fields(raw,'kind,compilerDigest,sourceSetHash,parentSourceSetHash,template,catalogHash,entryHash,maps');
 assert.equal(raw.kind,'compiled-framework-npc-area-addition-v1');
 for(const key of ['compilerDigest','sourceSetHash','parentSourceSetHash','catalogHash','entryHash'])assert.match(raw[key],digest);
 assert.ok(Array.isArray(raw.maps)&&raw.maps.length>0&&Object.getPrototypeOf(raw.maps)===Array.prototype);
 assert.equal(Reflect.ownKeys(raw.maps).length,raw.maps.length+1,'NPC Area addition maps must be dense');
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
export function createFrameworkNpcAreaEvidenceReader({root=repository,compiledDir='dist',readSourceWorld,readSourceMap}={}){
 assert.equal(typeof readSourceWorld,'function');assert.equal(typeof readSourceMap,'function');
 let context;const maps=new Map();
 const load=async()=>{
  const importer=name=>import(pathToFileURL(resolve(root,compiledDir,'src',name+'.js')).href),
   [corpus,compiler,integrity,content]=await Promise.all(['compiler/corpus','compiler/framework-npc-area','core/content-integrity','compiler/content'].map(importer));
  const snapshot=await corpus.loadCorpus(root),world=await integrity.verifyContent(structuredClone(await readSourceWorld()));
  assert.equal(world.developmentProfile,undefined);assert.equal(world.sourceSetHash,snapshot.sourceSetHash);
  assert.equal(world.parentSourceSetHash,snapshot.manifest.parentSourceSetHash);
  return{snapshot,world,...compiler,...integrity,...content};
 };
 const complete=new Map();
 async function assessed(api,proof,row){
  const key=api.canonical({mapId:row.mapId,template:proof.template});
  if(!maps.has(key))maps.set(key,(async()=>{
   const sourceMap=await api.verifyContent(structuredClone(await readSourceMap(row.mapId)),api.world.maps[String(row.mapId)].contentHash),
    assessment=api.assessFrameworkNpcAreaMap(api.snapshot,sourceMap,proof.template);
   return{sourceMap,assessment};
  })());
  const result=await maps.get(key);assert.equal(row.sourceMapHash,result.sourceMap.contentHash,'NPC Area strict map pin mismatch');
  assert.equal(row.assessmentHash,result.assessment.contentHash,'NPC Area original source assessment mismatch');
  return result;
 }
 return async(proof,mapId=null)=>{
  context??=load();const api=await context;
  assert.equal(proof.sourceSetHash,api.world.sourceSetHash);assert.equal(proof.parentSourceSetHash,api.world.parentSourceSetHash);
  assert.deepEqual(proof.maps.map(row=>row.mapId),Object.keys(api.world.maps).map(Number).sort((a,b)=>a-b),'NPC Area proof must retain every source map');
  api.parseFrameworkNpcAreaTemplate(proof.template);
  const proofKey=api.canonical(proof);
  if(!complete.has(proofKey))complete.set(proofKey,(async()=>{
   // Every source map/failed object is recomputed, not just recipe-selected
   // maps. The one complete candidate proof is shared across all recipes.
   for(const row of proof.maps)await assessed(api,proof,row);
  })());
  await complete.get(proofKey);
  if(mapId===null)return{template:structuredClone(proof.template)};
  const row=proof.maps.find(row=>row.mapId===mapId);assert.ok(row,'Unknown NPC Area map');
  return assessed(api,proof,row);
 };
}

/** Normalize only a proved additive sidecar/marker in a detached comparison.
 * The actual body, refs, original blockers and all unrelated metadata remain. */
export async function comparableFrameworkNpcAreaAddition({before,after,proof,evidence,canonical}){
 if(!proof)return{after,addition:null};
 const previous=before.developmentProfile,next=after.developmentProfile,
  changed=canonical(before.frameworkNpcActivity??null)!==canonical(after.frameworkNpcActivity??null)||
   canonical(previous?.npcActivity??null)!==canonical(next?.npcActivity??null);
 if(!changed)return{after,addition:null};
 assert.equal(typeof evidence,'function','Missing trusted NPC Area evidence reader');
 assert.equal(previous?.kind,'framework-development-v1','NPC Area addition requires an existing framework profile');
 assert.equal(next?.kind,'framework-development-v1','NPC Area addition requires a framework profile');
 assert.equal(after.sourceSetHash,proof.sourceSetHash);assert.equal(after.parentSourceSetHash,proof.parentSourceSetHash);
 const {template}=await evidence(proof);assert.equal(next.npcActivity,template.policy);
 assert.ok(previous.npcActivity===undefined||previous.npcActivity===template.policy,'NPC Area policy cannot be replaced');
 const comparison=structuredClone(after);let map=null;
 if(after.kind==='world-map-development'){
  assert.equal(before.mapId,after.mapId);const{sourceMap,assessment}=await evidence(proof,after.mapId);
  assert.equal(after.developmentProfile.sourceContentHash,sourceMap.contentHash);
  assert.equal(canonical(after.frameworkNpcActivity),canonical(assessment.host),'NPC Area sidecar differs from complete original derivation');
  if(before.frameworkNpcActivity!==undefined){
   assert.equal(before.frameworkNpcActivity.sourceMapHash,previous.sourceContentHash);
   const{sourceMapHash:_,...old}=before.frameworkNpcActivity,{sourceMapHash:__,...current}=assessment.host;
   assert.equal(canonical(old),canonical(current),'NPC Area existing programs or policy cannot be replaced');
   comparison.frameworkNpcActivity=structuredClone(before.frameworkNpcActivity);
  }else delete comparison.frameworkNpcActivity;
  map={mapId:after.mapId,sourceMapHash:sourceMap.contentHash,assessmentHash:assessment.contentHash,
   declared:assessment.record.counts.declared,derived:assessment.record.counts.derived,
   unready:assessment.record.counts.declared-assessment.record.counts.derived};
 }else{
  assert.equal(before.frameworkNpcActivity,undefined);assert.equal(after.frameworkNpcActivity,undefined);
  if(after.kind==='world-development')assert.equal(after.contentHash,proof.catalogHash,'NPC Area candidate world mismatch');
  else{assert.equal(after.kind,'source-new-game-content-v1');assert.equal(after.contentHash,proof.entryHash,'NPC Area candidate entry mismatch');}
 }
 if(previous.npcActivity===undefined)delete comparison.developmentProfile.npcActivity;
 return{after:comparison,addition:{kind:proof.kind,compilerDigest:proof.compilerDigest,sourceSetHash:proof.sourceSetHash,
  parentSourceSetHash:proof.parentSourceSetHash,map,previousMarker:previous.npcActivity??null,nextMarker:template.policy,
  nativeParity:false,runtimeAdmission:'unassessed'}};
}
