// A distinct versioned transform proof. Legacy logical/flat evidence receives
// its unchanged catalog only after the complete new metadata has verified.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const repository=resolve(import.meta.dirname,'..'),digest=/^[a-f0-9]{64}$/;
export const FIELD_EFFECT_TRANSFORMS='web-source-logical-board-transforms-v1';
export const FIELD_EFFECT_TRANSFORM_REASON='Explicit Web source-bound logical-board transforms: retain complete original object/definition/immutable factory placement and legacy flat policy; allow only the proven current transform under the actual board lifetime owner. No Sprite callbacks, particles, collision, route or source admission grant.';
function data(v){if(v===null||['string','boolean'].includes(typeof v)||typeof v==='number'&&Number.isFinite(v))return;
 assert(v&&typeof v==='object','Invalid board transform proof data');const array=Array.isArray(v);assert.equal(Object.getPrototypeOf(v),array?Array.prototype:Object.prototype);
 const keys=Reflect.ownKeys(v);assert(keys.every(k=>typeof k==='string'));if(array){assert.equal(keys.length,v.length+1);for(let i=0;i<v.length;i++)assert(Object.hasOwn(v,String(i)));}
 for(const key of keys){if(array&&key==='length')continue;const d=Object.getOwnPropertyDescriptor(v,key);assert(d.enumerable&&Object.hasOwn(d,'value'));data(d.value);}}
function fields(v,keys){assert(v&&typeof v==='object'&&!Array.isArray(v),'Invalid board transform proof');assert.deepEqual(Object.keys(v).sort(),keys.split(',').sort(),'Invalid board transform proof fields');}
export function parseFieldEffectTransformAssessment(raw){data(raw);fields(raw,'kind,contentHash,projection');assert.equal(raw.kind,'framework-field-effect-transform-assessment-v1');assert.match(raw.contentHash,digest);assert.equal(raw.projection?.kind,FIELD_EFFECT_TRANSFORMS);return structuredClone(raw);}
export function createFrameworkFieldEffectTransformAddition({compilerDigest,assessment,flatAssessment,catalog,entry,projectedCatalogHash}){
 const a=parseFieldEffectTransformAssessment(assessment),p=a.projection;assert.match(compilerDigest,digest);assert.match(projectedCatalogHash,digest);
 return {kind:'compiled-framework-field-effect-transform-addition-v1',compilerDigest,sourceSetHash:p.sourceSetHash,parentSourceSetHash:p.parentSourceSetHash,sourceMapSetHash:p.sourceMapSetHash,
  assessmentHash:a.contentHash,flatAssessmentHash:flatAssessment.contentHash,logicalCatalogHash:p.logicalCatalogHash,projectedCatalogHash,reason:p.reason,
  catalogHash:catalog.contentHash,entryHash:entry.contentHash,maps:structuredClone(p.mapSources)};
}
export function parseFrameworkFieldEffectTransformAddition(raw){if(raw===undefined)return null;data(raw);
 fields(raw,'kind,compilerDigest,sourceSetHash,parentSourceSetHash,sourceMapSetHash,assessmentHash,flatAssessmentHash,logicalCatalogHash,projectedCatalogHash,reason,catalogHash,entryHash,maps');
 assert.equal(raw.kind,'compiled-framework-field-effect-transform-addition-v1');assert.equal(typeof raw.reason,'string');assert(raw.reason.trim());
 for(const key of ['compilerDigest','sourceSetHash','parentSourceSetHash','sourceMapSetHash','assessmentHash','flatAssessmentHash','logicalCatalogHash','projectedCatalogHash','catalogHash','entryHash'])assert.match(raw[key],digest);
 assert(Array.isArray(raw.maps)&&raw.maps.length);let prior=-1;for(const row of raw.maps){fields(row,'mapId,sourceMapHash');assert(Number.isSafeInteger(row.mapId)&&row.mapId>prior);prior=row.mapId;assert.match(row.sourceMapHash,digest);}return structuredClone(raw);
}
/** Verify the full lock's assessment + legacy flat base, then independently
 * rebuild the final catalog digest from already byte-locked logical media. */
export async function verifyFieldEffectTransformLock({root=repository,compiledDir='dist',assessment,flatAssessment,catalogHash,logicalCatalog}){
 const a=parseFieldEffectTransformAssessment(assessment);assert.match(catalogHash,digest);
 const load=name=>import(pathToFileURL(resolve(root,compiledDir,'src',name+'.js')).href);
 const [flat,transform,content]=await Promise.all(['compiler/framework-field-effect-flat-projection','compiler/framework-field-effect-transforms','compiler/content'].map(load));
 assert.equal(content.hash({kind:a.kind,projection:a.projection}),a.contentHash,'Board transform assessment digest mismatch');
 const base=flat.projectFrameworkFieldEffectCatalog(logicalCatalog,flatAssessment),catalog=transform.projectFrameworkFieldEffectTransformCatalog(base,a);
 assert.equal(content.hash(catalog),catalogHash,'Board transform complete catalog digest mismatch');
 assert.equal(a.projection.logicalCatalogHash,base.webPolicy.catalogHash,'Board transform legacy flat catalog changed');
 assert.equal(content.canonical(a.projection.mapSources),content.canonical(flatAssessment.projection.mapSources),'Board transform complete map scope differs from flat base');
 return {assessment:a,catalog,base};
}
export function createFrameworkFieldEffectTransformEvidenceReader({root=repository,compiledDir='dist',readSourceWorld,readSourceMap,flatEvidence,flatProof}={}){
 assert.equal(typeof readSourceWorld,'function');assert.equal(typeof readSourceMap,'function');assert.equal(typeof flatEvidence,'function');let loaded;const results=new Map();
 return async(proof,mapId=null)=>{
  const p=parseFrameworkFieldEffectTransformAddition(proof);loaded??=(async()=>{
   const load=name=>import(pathToFileURL(resolve(root,compiledDir,'src',name+'.js')).href),api=Object.assign({},...await Promise.all(['compiler/corpus','compiler/framework-field-effect-transforms','compiler/content','core/content-integrity'].map(load)));
   const corpus=await api.loadCorpus(root),world=await api.verifyContent(structuredClone(await readSourceWorld())),maps=[];
   assert.equal(world.developmentProfile,undefined);assert.equal(corpus.sourceSetHash,world.sourceSetHash);assert.equal(corpus.manifest.parentSourceSetHash,world.parentSourceSetHash);
   for(const id of Object.keys(world.maps).map(Number).sort((a,b)=>a-b))maps.push(await api.verifyContent(structuredClone(await readSourceMap(id)),world.maps[String(id)].contentHash));
   const legacy=await flatEvidence(flatProof);return {...api,corpus,world,maps,legacy};
  })();const api=await loaded;
  assert.equal(p.sourceSetHash,api.world.sourceSetHash);assert.equal(p.parentSourceSetHash,api.world.parentSourceSetHash);assert.equal(p.flatAssessmentHash,api.legacy.assessment.contentHash);
  assert.equal(p.logicalCatalogHash,api.legacy.catalog.webPolicy.catalogHash);
  assert.equal(api.canonical(p.maps),api.canonical(api.maps.map(m=>({mapId:m.mapId,sourceMapHash:m.contentHash}))),'Board transform complete strict map membership changed');
  const key=api.canonical(p);if(!results.has(key)){
   const assessment=api.assessFrameworkFieldEffectTransformWorld(api.corpus,api.world,api.maps,api.legacy.catalog,p.reason),catalog=api.projectFrameworkFieldEffectTransformCatalog(api.legacy.catalog,assessment);
   assert.equal(assessment.contentHash,p.assessmentHash,'Board transform complete original assessment changed');assert.equal(assessment.projection.sourceMapSetHash,p.sourceMapSetHash);
   assert.equal(api.hash(catalog),p.projectedCatalogHash,'Board transform exact projected catalog changed');results.set(key,{assessment,catalog,legacy:api.legacy.catalog});
  }
  const sourceMap=mapId===null?null:api.maps.find(m=>m.mapId===mapId);if(mapId!==null)assert(sourceMap,'Unknown board transform source map');return {...results.get(key),sourceMap};
 };
}
export async function comparableFrameworkFieldEffectTransformAddition({before,after,proof,evidence,assessment,canonical}){
 const prev=before.developmentProfile,next=after.developmentProfile,old=before.fieldEffects?.boardTransforms,current=after.fieldEffects?.boardTransforms;
 if(prev?.fieldEffectTransforms===undefined&&next?.fieldEffectTransforms===undefined&&old===undefined&&current===undefined)return {after,addition:null};
 assert(proof,'Board transforms require their separate complete source proof');assert.equal(typeof evidence,'function');
 assert.equal(prev?.kind,'framework-development-v1');assert.equal(next?.kind,'framework-development-v1');assert.equal(next.fieldEffectTransforms,FIELD_EFFECT_TRANSFORMS);
 assert(prev.fieldEffectTransforms===undefined||prev.fieldEffectTransforms===FIELD_EFFECT_TRANSFORMS,'Cannot replace board transform policy');
 assert.equal(after.sourceSetHash,proof.sourceSetHash);assert.equal(after.parentSourceSetHash,proof.parentSourceSetHash);
 const actual=await evidence(proof,after.kind==='world-map-development'?after.mapId:null),a=parseFieldEffectTransformAssessment(assessment);
 assert.equal(a.contentHash,proof.assessmentHash);assert.equal(canonical(a),canonical(actual.assessment),'Board transform profile assessment differs from complete source reconstruction');
 for(const key of ['sourceSetHash','parentSourceSetHash','sourceMapSetHash','logicalCatalogHash','reason'])assert.equal(a.projection[key],proof[key],'Board transform source proof differs from assessment: '+key);
 assert.equal(canonical(a.projection.mapSources),canonical(proof.maps),'Board transform proof map scope changed');
 assert.equal(actual.legacy.webPolicy.catalogHash,proof.logicalCatalogHash,'Board transform legacy catalog proof changed');
 assert.equal(createHash('sha256').update(canonical(actual.catalog)).digest('hex'),proof.projectedCatalogHash,'Board transform full catalog proof changed');
 const comparison=structuredClone(after);let map=null;
 if(after.kind==='world-map-development'){
  assert.equal(before.mapId,after.mapId);assert.equal(next.sourceContentHash,actual.sourceMap.contentHash);
  assert.equal(canonical(after.fieldEffects),canonical(actual.catalog),'Board transform current catalog differs from full source reconstruction');
  if(old!==undefined){assert.equal(prev.fieldEffectTransforms,FIELD_EFFECT_TRANSFORMS);assert.equal(canonical(before.fieldEffects),canonical(actual.catalog),'Existing board transform catalog cannot change');}
  else{assert.equal(prev.fieldEffectTransforms,undefined,'Old marker without a board transform catalog');comparison.fieldEffects=structuredClone(actual.legacy);}
  for(const binding of a.projection.bindings.filter(b=>b.ref.mapId===after.mapId))for(const value of[before,after]){
   const matches=value.map?.groups?.[binding.ref.group]?.entities.filter(e=>canonical(e.source)===canonical(binding.entity.source))??[];
   assert.equal(canonical(matches),canonical([binding.entity]),'Board transform immutable original source entity changed');
  }
  map={mapId:after.mapId,sourceMapHash:actual.sourceMap.contentHash};
 }else{
  assert.equal(before.fieldEffects,undefined);assert.equal(after.fieldEffects,undefined);
  if(after.kind==='world-development')assert.equal(after.contentHash,proof.catalogHash);
  else{assert.equal(after.kind,'source-new-game-content-v1');assert.equal(after.contentHash,proof.entryHash);}
 }
 return {after:comparison,addition:{...structuredClone(proof),map,declared:a.projection.objects.length,derived:a.projection.bindings.length,
  normalization:'Only exact independently rebuilt boardTransforms metadata; new marker requires explicit v11 host declaration. Legacy logical/flat catalogs, raw entities and immutable placement are untouched.',nativeParity:false,runtimeAdmission:'unassessed'}};
}
