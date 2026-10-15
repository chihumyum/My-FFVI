// Independent whole-source ordinary display addition. A periodic marker or
// previous successful recipe is not source evidence for this family.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const repository=resolve(import.meta.dirname,'..'),digest=/^[a-f0-9]{64}$/;
const policy='framework-ordinary-field-flat-v1';
function jsonData(value){
 if(value===null||['string','boolean'].includes(typeof value)||typeof value==='number'&&Number.isFinite(value))return;
 assert(value&&typeof value==='object');const array=Array.isArray(value);assert.equal(Object.getPrototypeOf(value),array?Array.prototype:Object.prototype);
 const keys=Reflect.ownKeys(value);assert(keys.every(k=>typeof k==='string'));
 if(array){assert.equal(keys.length,value.length+1);for(let i=0;i<value.length;i++)assert(Object.hasOwn(value,String(i)));}
 for(const key of keys){if(array&&key==='length')continue;const d=Object.getOwnPropertyDescriptor(value,key);assert(d.enumerable&&Object.hasOwn(d,'value'));jsonData(d.value);}
}
function fields(value,names){assert(value&&typeof value==='object'&&!Array.isArray(value));assert.deepEqual(Object.keys(value).sort(),names.split(',').sort());}
export function createFrameworkOrdinaryPresentationAddition({compilerDigest,assessments,strictWorld,catalog,entry}){
 assert.match(compilerDigest,digest);assert(Array.isArray(assessments));
 assert.equal(strictWorld.developmentProfile,undefined);assert.equal(catalog.developmentProfile?.sourceContentHash,strictWorld.contentHash);
 return{kind:'compiled-framework-ordinary-presentation-addition-v1',compilerDigest,sourceSetHash:strictWorld.sourceSetHash,
  parentSourceSetHash:strictWorld.parentSourceSetHash,strictWorldHash:strictWorld.contentHash,catalogHash:catalog.contentHash,entryHash:entry.contentHash,
  reason:assessments[0]?.reason??'Explicit ordinary family with no applicable maps',
  maps:assessments.map(row=>({mapId:row.mapId,sourceMapHash:row.sourceMapHash,assessmentHash:row.contentHash})).sort((a,b)=>a.mapId-b.mapId)};
}
export function parseFrameworkOrdinaryPresentationAddition(raw){
 if(raw===undefined)return null;jsonData(raw);
 fields(raw,'kind,compilerDigest,sourceSetHash,parentSourceSetHash,strictWorldHash,catalogHash,entryHash,reason,maps');
 assert.equal(raw.kind,'compiled-framework-ordinary-presentation-addition-v1');
 for(const key of ['compilerDigest','sourceSetHash','parentSourceSetHash','strictWorldHash','catalogHash','entryHash'])assert.match(raw[key],digest);
 assert.equal(typeof raw.reason,'string');assert(raw.reason.trim());assert(Array.isArray(raw.maps));let previous=0;
 for(const row of raw.maps){fields(row,'mapId,sourceMapHash,assessmentHash');assert(Number.isSafeInteger(row.mapId)&&row.mapId>previous);previous=row.mapId;assert.match(row.sourceMapHash,digest);assert.match(row.assessmentHash,digest);}
 return structuredClone(raw);
}
/** Recompute every original ordinary assessment from the same locked raw
 * corpus, source world/map collection and original render host. No world
 * compiler, report fallback, public collection or authored map list is read. */
export function createFrameworkOrdinaryPresentationEvidenceReader({root=repository,compiledDir='dist',compilerDigest,readSourceWorld,readSourceMap}={}){
 assert.equal(typeof readSourceWorld,'function');assert.equal(typeof readSourceMap,'function');assert.match(compilerDigest,digest);let loaded;const proofs=new Map();
 const context=async()=>{
  const load=name=>import(pathToFileURL(resolve(root,compiledDir,'src',name+'.js'))),api=Object.assign({},...await Promise.all([
   'compiler/corpus','compiler/content','core/content-integrity','compiler/framework-ordinary-presentation','compiler/field-native-composition'].map(load))),
   corpus=await api.loadCorpus(root),world=await api.verifyContent(structuredClone(await readSourceWorld())),maps=[];
  assert.equal(world.developmentProfile,undefined);assert.equal(world.sourceSetHash,corpus.sourceSetHash);assert.equal(world.parentSourceSetHash,corpus.manifest.parentSourceSetHash);
  for(const id of Object.keys(world.maps).map(Number).sort((a,b)=>a-b))maps.push(await api.verifyContent(structuredClone(await readSourceMap(id)),world.maps[String(id)].contentHash));
  const sources=corpus.manifest.sources.map(({file,sha256})=>({file,sha256})),renderHost=await api.loadFieldCompositionRenderHost(root,sources);
  return{...api,corpus,world,maps,renderHost};
 };
 return async(raw,mapId=null)=>{
  const proof=parseFrameworkOrdinaryPresentationAddition(raw);loaded??=context();const api=await loaded;
  assert.equal(proof.compilerDigest,compilerDigest,'Ordinary proof compiler differs from the locked producer');
  assert.equal(proof.sourceSetHash,api.world.sourceSetHash);assert.equal(proof.parentSourceSetHash,api.world.parentSourceSetHash);
  assert.equal(proof.strictWorldHash,api.world.contentHash,'Ordinary proof belongs to another complete source world');
  const key=api.canonical(proof);
  if(!proofs.has(key))proofs.set(key,(async()=>{
   const assessments=api.assessFrameworkOrdinaryWorld(api.corpus,api.world,api.maps,api.renderHost,proof.reason),
    expected=assessments.map(row=>({mapId:row.mapId,sourceMapHash:row.sourceMapHash,assessmentHash:row.contentHash}));
   assert.equal(api.canonical(proof.maps),api.canonical(expected),'Ordinary proof omitted, added or changed a source family assessment');
   return new Map(assessments.map(row=>[row.mapId,row]));
  })());
  const assessments=await proofs.get(key);if(mapId===null)return{ordinaryMaps:assessments.size};
  const sourceMap=api.maps.find(map=>map.mapId===mapId);assert(sourceMap,'Unknown original ordinary presentation map');
  return{sourceMap,assessment:assessments.get(mapId)??null};
 };
}

/** The temporary comparison changes only a source-proven added alternative
 * and explicit display marker. Actual original before/after identities remain
 * intact. Other family projections run before/after with their own proofs. */
export async function comparableFrameworkOrdinaryPresentationAddition({before,after,actualBefore=before,actualAfter=after,proof,evidence,canonical,verifyContent}){
 const prev=before.developmentProfile,next=after.developmentProfile,
  changed=canonical(before.frameworkPresentation??null)!==canonical(after.frameworkPresentation??null)||
   canonical(prev?.fieldPresentation??null)!==canonical(next?.fieldPresentation??null);
 if(!changed)return{after,addition:null};
 if(!proof&&canonical(before.frameworkPresentation??null)===canonical(after.frameworkPresentation??null))
  return{after,addition:null}; // Existing marker-only proofs retain their exact old scope.
 // Periodic-only changes have a different owner and remain visible to that
 // family's existing exact proof. This auditor never strips them.
 if(after.kind==='world-map-development'&&(after.entryView?.isWorld!==false||after.entryView.loopType!==0))return{after,addition:null};
 assert(proof,'Ordinary alternative requires an independent complete source proof');assert.equal(typeof evidence,'function');assert.equal(typeof verifyContent,'function');
 await verifyContent(actualBefore);await verifyContent(actualAfter);
 assert.equal(prev?.kind,'framework-development-v1');assert.equal(next?.kind,'framework-development-v1');
 assert.equal(after.sourceSetHash,proof.sourceSetHash);assert.equal(after.parentSourceSetHash,proof.parentSourceSetHash);
 assert.equal(next.fieldPresentation,policy);assert(prev.fieldPresentation===undefined||prev.fieldPresentation===policy,'Ordinary policy cannot replace another policy');
 await evidence(proof);const comparison=structuredClone(after);let map=null;
 if(after.kind==='world-map-development'){
  assert.equal(before.mapId,after.mapId);const{sourceMap,assessment}=await evidence(proof,after.mapId);
  assert(assessment,'Nonordinary map cannot acquire an ordinary alternative');assert.equal(next.sourceContentHash,sourceMap.contentHash);
  const expected=assessment.mode==='flat-alternative'?assessment.presentation:null;
  assert.equal(canonical(after.frameworkPresentation??null),canonical(expected),'Ordinary alternative differs from independently compiled source');
  assert.equal(canonical(after.map??null),canonical(before.map??null),'Ordinary display cannot change the original map/entity/collision body');
  for(const key of ['scripts','scriptLocals','scriptPuppetContexts','initializer','characterAssets'])
   assert.equal(canonical(actualAfter[key]??null),canonical(sourceMap[key]??null),'Ordinary display changed current original source program metadata: '+key);
  for(const original of [actualBefore,actualAfter]){
   // Tile data/coordinates/source Foot applicability are real gameplay inputs,
   // not part of the display-only difference. Never trust a resealed geometry.
   for(const key of ['id','source','identity','tileSize','width','height','layers','textures','topology','collisions','tilesets','entryContext','nativeComposition'])
    assert.equal(canonical(original.map?.[key]??null),canonical(sourceMap.map?.[key]??null),'Ordinary original source geometry changed: '+key);
   for(const key of ['nativeFoot','nativeFootBlockers','entryView','partyEntry','partyEntryBlockers','cameraHost','cameraHostBlockers','actorView','actorViewBlockers','nativeCompositionBlockers'])
    assert.equal(canonical(original[key]??null),canonical(sourceMap[key]??null),'Ordinary original source applicability changed: '+key);
  }
  if(before.frameworkPresentation!==undefined)
   assert.equal(canonical(before.frameworkPresentation),canonical(expected),'Existing ordinary alternative cannot be replaced');
  else delete comparison.frameworkPresentation;
  map={mapId:after.mapId,sourceMapHash:sourceMap.contentHash,assessmentHash:assessment.contentHash,mode:assessment.mode,derived:assessment.mode==='flat-alternative',unready:assessment.presentation===null};
 }else{
  assert.equal(before.frameworkPresentation,undefined);assert.equal(after.frameworkPresentation,undefined);
  if(after.kind==='world-development')assert.equal(actualAfter.contentHash,proof.catalogHash,'Ordinary proof final world identity differs');
  else{assert.equal(after.kind,'source-new-game-content-v1');assert.equal(actualAfter.contentHash,proof.entryHash,'Ordinary proof final entry identity differs');}
 }
 if(prev.fieldPresentation===undefined)delete comparison.developmentProfile.fieldPresentation;
 return{after:comparison,addition:{kind:proof.kind,compilerDigest:proof.compilerDigest,sourceSetHash:proof.sourceSetHash,
  parentSourceSetHash:proof.parentSourceSetHash,strictWorldHash:proof.strictWorldHash,ordinaryMaps:proof.maps.length,map,
  nativeParity:false,runtimeAdmission:'unassessed',previousMarker:prev.fieldPresentation??null,nextMarker:policy}};
}
