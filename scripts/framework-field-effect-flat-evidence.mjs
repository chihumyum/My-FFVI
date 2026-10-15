// Complete same-source projection proof. Never infer permission from an asset
// group, saved board, marker alone, old report, or a successful single map.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {compileLogicalFieldEffects} from './compile-logical-field-effects.mjs';
const repository=resolve(import.meta.dirname,'..'),digest=/^[a-f0-9]{64}$/;
function data(v){if(v===null||['string','boolean'].includes(typeof v)||typeof v==='number'&&Number.isFinite(v))return;
 assert(v&&typeof v==='object');const array=Array.isArray(v);assert.equal(Object.getPrototypeOf(v),array?Array.prototype:Object.prototype);
 const keys=Reflect.ownKeys(v);assert(keys.every(k=>typeof k==='string'));if(array){assert.equal(keys.length,v.length+1);for(let i=0;i<v.length;i++)assert(Object.hasOwn(v,String(i)));}
 for(const k of keys){if(array&&k==='length')continue;const d=Object.getOwnPropertyDescriptor(v,k);assert(d.enumerable&&Object.hasOwn(d,'value'));data(d.value);}}
function fields(v,keys){assert(v&&typeof v==='object'&&!Array.isArray(v));assert.deepEqual(Object.keys(v).sort(),keys.split(',').sort());}
export function createFrameworkFieldEffectFlatAddition({compilerDigest,assessment,catalog,entry}){
 const p=assessment.projection;assert.match(compilerDigest,digest);assert.equal(p.sourceSetHash,catalog.sourceSetHash);
 return{kind:'compiled-framework-field-effect-flat-addition-v1',compilerDigest,sourceSetHash:p.sourceSetHash,parentSourceSetHash:p.parentSourceSetHash,
  sourceMapSetHash:p.sourceMapSetHash,logicalCatalogHash:p.logicalCatalogHash,assessmentHash:assessment.contentHash,reason:p.reason,
  catalogHash:catalog.contentHash,entryHash:entry.contentHash,maps:structuredClone(p.mapSources)};
}
export function parseFrameworkFieldEffectFlatAddition(raw){if(raw===undefined)return null;data(raw);
 fields(raw,'kind,compilerDigest,sourceSetHash,parentSourceSetHash,sourceMapSetHash,logicalCatalogHash,assessmentHash,reason,catalogHash,entryHash,maps');
 assert.equal(raw.kind,'compiled-framework-field-effect-flat-addition-v1');assert.equal(typeof raw.reason,'string');assert(raw.reason.trim());
 for(const k of ['compilerDigest','sourceSetHash','parentSourceSetHash','sourceMapSetHash','logicalCatalogHash','assessmentHash','catalogHash','entryHash'])assert.match(raw[k],digest);
 assert(Array.isArray(raw.maps)&&raw.maps.length);let prior=-1;for(const row of raw.maps){fields(row,'mapId,sourceMapHash');assert(Number.isSafeInteger(row.mapId)&&row.mapId>prior);prior=row.mapId;assert.match(row.sourceMapHash,digest);}
 return structuredClone(raw);
}
export function createFrameworkFieldEffectFlatEvidenceReader({root=repository,compiledDir='dist',readSourceWorld,readSourceMap,
 logicalInputDirectory='build/field-effect-media'}={}){
 assert.equal(typeof readSourceWorld,'function');assert.equal(typeof readSourceMap,'function');let loaded;
 return async(proof,mapId=null)=>{
  const p=parseFrameworkFieldEffectFlatAddition(proof);loaded??=(async()=>{
   const load=n=>import(pathToFileURL(resolve(root,compiledDir,'src',n+'.js'))),[corpus,integrity,compiler,content]=await Promise.all(['compiler/corpus','core/content-integrity','compiler/framework-field-effect-flat-projection','compiler/content'].map(load));
   const snapshot=await corpus.loadCorpus(root),world=await integrity.verifyContent(structuredClone(await readSourceWorld())),maps=[];
   assert.equal(world.developmentProfile,undefined);assert.equal(snapshot.sourceSetHash,world.sourceSetHash);assert.equal(snapshot.manifest.parentSourceSetHash,world.parentSourceSetHash);
   for(const id of Object.keys(world.maps).map(Number).sort((a,b)=>a-b))maps.push(await integrity.verifyContent(structuredClone(await readSourceMap(id)),world.maps[String(id)].contentHash));
   const logical=await compileLogicalFieldEffects({root,compiled:compiledDir,runtimeRoot:repository,input:logicalInputDirectory});
   return{snapshot,world,maps,logical:logical.catalog,...compiler,...content};
  })();const api=await loaded;
  assert.equal(p.sourceSetHash,api.world.sourceSetHash);assert.equal(p.parentSourceSetHash,api.world.parentSourceSetHash);assert.equal(p.sourceMapSetHash,api.hash({sourceSetHash:api.world.sourceSetHash,parentSourceSetHash:api.world.parentSourceSetHash,maps:api.maps.map(m=>({mapId:m.mapId,sourceMapHash:m.contentHash}))}));assert.equal(p.logicalCatalogHash,api.logical.webPolicy.catalogHash);
  assert.equal(api.canonical(p.maps),api.canonical(api.maps.map(m=>({mapId:m.mapId,sourceMapHash:m.contentHash}))),'Flat effect complete strict map membership changed');
  // Recompute all original raw family rows, including failed imports and
  // rejected media. Cache only the exact proof+reason inside this reader.
  api.assessments??=new Map();const key=api.canonical(p);if(!api.assessments.has(key)){
   const assessment=api.assessFrameworkFieldEffectFlatWorld(api.snapshot,api.world,api.maps,api.logical,p.reason);assert.equal(assessment.contentHash,p.assessmentHash,'Flat effect original assessment changed');
   api.assessments.set(key,{assessment,catalog:api.projectFrameworkFieldEffectCatalog(api.logical,assessment)});
  }
  const actual=api.assessments.get(key),sourceMap=mapId===null?null:api.maps.find(m=>m.mapId===mapId);if(mapId!==null)assert(sourceMap,'Unknown source map');
  return{...actual,sourceMap,logical:api.logical};
 };
}
export async function comparableFrameworkFieldEffectFlatAddition({before,after,proof,evidence,canonical}){
 const prev=before.developmentProfile,next=after.developmentProfile,
  changed=canonical(prev?.fieldEffectProjection??null)!==canonical(next?.fieldEffectProjection??null)||
   canonical(before.fieldEffects?.webPolicy?.boardProjection??null)!==canonical(after.fieldEffects?.webPolicy?.boardProjection??null);
 if(!changed)return{after,addition:null};assert(proof,'Flat effect catalog/marker change requires its independent source proof');
 assert.equal(typeof evidence,'function');assert.equal(prev?.kind,'framework-development-v1');assert.equal(next?.kind,'framework-development-v1');
 assert.equal(after.sourceSetHash,proof.sourceSetHash);assert.equal(after.parentSourceSetHash,proof.parentSourceSetHash);assert.equal(next.fieldEffectProjection,'web-source-field-effect-flat-v1');
 assert(prev.fieldEffectProjection===undefined||prev.fieldEffectProjection===next.fieldEffectProjection,'Cannot replace a projection policy');
 const actual=await evidence(proof,after.kind==='world-map-development'?after.mapId:null),comparison=structuredClone(after);let map=null;
 if(after.kind==='world-map-development'){
  assert.equal(before.mapId,after.mapId);assert.equal(next.sourceContentHash,actual.sourceMap.contentHash);
  assert.equal(canonical(after.fieldEffects),canonical(actual.catalog),'Flat effect projected catalog mismatch');
  for(const row of actual.assessment.projection.objects.filter(o=>o.mapId===after.mapId)){
   const expected=actual.sourceMap.map?.groups?.[row.group]?.entities.filter(e=>canonical(e.source)===canonical(row.source))??[],current=after.map?.groups?.[row.group]?.entities.filter(e=>canonical(e.source)===canonical(row.source))??[];
   const previous=before.map?.groups?.[row.group]?.entities.filter(e=>canonical(e.source)===canonical(row.source))??[];
   assert.equal(canonical(previous),canonical(expected),'Flat effect previous source group/entity membership changed');
   assert.equal(canonical(current),canonical(expected),'Flat effect original group/entity membership changed');
  }
  const previousActive=(before.map?.entities??[]).filter(e=>e.kind===11&&e.effect?.birdviewPuppet),nextActive=(after.map?.entities??[]).filter(e=>e.kind===11&&e.effect?.birdviewPuppet);
  assert.equal(canonical(nextActive),canonical(previousActive),'Flat effect active source initialization membership changed');
  if(prev.logicalFieldEffects===undefined){
   // The independent versioned logical-catalog audit runs next. Retain its
   // exact trusted base in this intermediate comparison, never the new
   // projection, and never pretend the old document already had that owner.
   assert.equal(before.fieldEffects?.webPolicy,undefined,'An undeclared old logical owner cannot become proof');
   comparison.fieldEffects=structuredClone(actual.logical);
  }else{
   assert.equal(prev.logicalFieldEffects,'web-logical-all-loop-field-effects-v1');
   const priorCatalog=prev.fieldEffectProjection===undefined?actual.logical:actual.catalog;
   assert.equal(canonical(before.fieldEffects),canonical(priorCatalog),'Flat effect original logical catalog cannot be replaced');
   comparison.fieldEffects=structuredClone(before.fieldEffects);
  }
  map={mapId:after.mapId,sourceMapHash:actual.sourceMap.contentHash};
 }else{
  assert.equal(before.fieldEffects,undefined);assert.equal(after.fieldEffects,undefined);
  if(after.kind==='world-development')assert.equal(after.contentHash,proof.catalogHash);
  else{assert.equal(after.kind,'source-new-game-content-v1');assert.equal(after.contentHash,proof.entryHash);}
 }
 if(prev.fieldEffectProjection===undefined)delete comparison.developmentProfile.fieldEffectProjection;
 return{after:comparison,addition:{kind:proof.kind,compilerDigest:proof.compilerDigest,sourceSetHash:proof.sourceSetHash,parentSourceSetHash:proof.parentSourceSetHash,
  sourceMapSetHash:proof.sourceMapSetHash,assessmentHash:proof.assessmentHash,logicalCatalogHash:proof.logicalCatalogHash,projectedCatalogHash:actual.catalog.webPolicy.catalogHash,
  declared:actual.assessment.projection.objects.length,derived:actual.assessment.projection.bindings.length,map,nativeParity:false,runtimeAdmission:'unassessed'}};
}
