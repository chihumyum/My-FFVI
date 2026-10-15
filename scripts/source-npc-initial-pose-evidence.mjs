import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createSourceMapAnimationEvidenceReader} from './source-map-animation-evidence.mjs';
const HASH=/^[a-f0-9]{64}$/;
function fields(raw,names,label){
 assert.ok(raw&&typeof raw==='object'&&!Array.isArray(raw)&&[Object.prototype,null].includes(Object.getPrototypeOf(raw)),'Invalid '+label);
 assert.deepEqual(Reflect.ownKeys(raw).sort(),names.split(',').sort(),'Invalid '+label+' fields');
 assert.ok(Object.values(Object.getOwnPropertyDescriptors(raw)).every(d=>d.enumerable&&Object.hasOwn(d,'value')),'Invalid '+label+' data');
}
export function parseSourceNpcInitialPoseAddition(raw){
 if(raw===undefined)return null;
 fields(raw,'kind,compilerDigest,sourceSetHash,parentSourceSetHash','NPC initial pose addition');
 assert.equal(raw.kind,'compiled-source-npc-initial-pose-contract-addition-v1','Unknown NPC initial pose addition');
 for(const k of['compilerDigest','sourceSetHash','parentSourceSetHash'])assert.ok(typeof raw[k]==='string'&&HASH.test(raw[k]),'Invalid NPC initial pose '+k);
 return structuredClone(raw);
}
/** Share verified physical corpus/media reads, not the kind10 permission. This
 * independent reader reconstructs NPC rows and every old/new pose diagnostic.
 * A recipe/save/candidate body is never the source for the expected values. */
export function createSourceNpcInitialPoseEvidenceReader({root,compiledDir='dist',sourceMapAnimationEvidence}={}){
 const physical=sourceMapAnimationEvidence??createSourceMapAnimationEvidenceReader({root,compiledDir}),maps=new Map();let compiler;
 return async document=>{
  compiler??=import(pathToFileURL(resolve(root,compiledDir,'src/compiler/field-initial-npc-pose.js')).href);
  const[{compileFieldEntityPoseBlockers},c]=await Promise.all([compiler,physical(document)]);
  if(document.kind==='world-development')return{kind:'verified-source-npc-initial-pose-world-v1',canonical:c.canonical,hash:c.hash,sourceDigest:c.sourceDigest};
  if(!maps.has(document.mapId)){
   const binding=c.bindings.get(document.mapId);assert.ok(binding,'Missing NPC initial pose source map binding');const groups={};
   for(const[name,id]of Object.entries(binding.groups)){
    const asset=c.byId.get(id);assert.ok(asset,'Missing NPC initial pose physical group');
    const compiled=c.compileEntityGroup(name,asset,c.corpus.tables,c.messages),rows=compiled.entities.filter(e=>e.kind===6||e.kind===17),
     sources=new Set(rows.map(e=>c.canonical(e.source)));
    assert.equal(sources.size,rows.length,'Ambiguous NPC initial pose physical identity');
    const diagnostics=(characters,contract)=>compileFieldEntityPoseBlockers(rows,characters,contract);
    groups[name]={source:asset.source,rawHash:c.hash(asset.data),rows,sources,
     previous:diagnostics(c.oldCharacters,'legacy-four-directions-v1'),
     fourDirection:diagnostics(c.newCharacters,'legacy-four-directions-v1'),
     initial:diagnostics(c.newCharacters,'source-initial-direction-v1'),
     media:rows.map(e=>({entityId:e.id,source:e.source,asset:e.asset,character:c.newCharacters[e.asset],
      characterHash:c.newCharacters[e.asset]?c.hash(c.newCharacters[e.asset]):null}))};
   }
   maps.set(document.mapId,{kind:'verified-source-npc-initial-pose-map-v1',canonical:c.canonical,hash:c.hash,
    sourceDigest:c.sourceDigest,sourceSetHash:c.corpus.sourceSetHash,parentSourceSetHash:c.corpus.manifest.parentSourceSetHash,groups});
  }
  return maps.get(document.mapId);
 };
}
const npc=e=>e.kind===6||e.kind===17;
function poseDiagnostic(row,sources,canonical){return sources.has(canonical(row.source))&&
 (row.reason.startsWith('Missing character pose ')||row.reason.startsWith('Invalid NPC initial pose '));}
function replacePoseDiagnostics(before,after,sources,canonical){
 const result=after.filter(row=>!poseDiagnostic(row,sources,canonical)).map(row=>structuredClone(row));
 for(let i=before.length-1;i>=0;i--){const row=before[i];if(!poseDiagnostic(row,sources,canonical))continue;
  const next=before.slice(i+1).find(b=>result.some(r=>canonical(r)===canonical(b))),at=next?result.findIndex(r=>canonical(r)===canonical(next)):result.length;
  result.splice(at,0,structuredClone(row));
 }return result;
}
/** Only a comparison copy receives the previous exact diagnostics. All source
 * entity/media/geometry/script/collision data and the candidate stay untouched. */
export function compareSourceNpcInitialPoseAddition(before,after,evidence,proof){
 const{canonical,hash}=evidence,copy=structuredClone(after),changes=[];
 assert.equal(before.sourceSetHash,proof.sourceSetHash,'NPC initial pose previous source mismatch');
 assert.equal(after.sourceSetHash,proof.sourceSetHash,'NPC initial pose candidate source mismatch');
 assert.equal(before.parentSourceSetHash,proof.parentSourceSetHash,'NPC initial pose previous parent mismatch');
 assert.equal(after.parentSourceSetHash,proof.parentSourceSetHash,'NPC initial pose candidate parent mismatch');
 if(after.kind!=='world-map-development'||!after.map||!before.map)return{after:copy,audit:null};
 assert.equal(evidence.kind,'verified-source-npc-initial-pose-map-v1');
 assert.equal(evidence.sourceSetHash,after.sourceSetHash);assert.equal(evidence.parentSourceSetHash,after.parentSourceSetHash);
 const oldGroups=before.map.groups??{},newGroups=after.map.groups??{};
 assert.deepEqual(Object.keys(oldGroups).sort(),Object.keys(evidence.groups).sort(),'Previous NPC pose source group membership changed');
 assert.deepEqual(Object.keys(newGroups).sort(),Object.keys(evidence.groups).sort(),'Candidate NPC pose source group membership changed');
 for(const[name,pair]of Object.entries(evidence.groups)){
  const old=oldGroups[name],next=newGroups[name];
  for(const[label,g]of[['previous',old],['candidate',next]]){
   assert.equal(canonical(g.source),canonical(pair.source),'NPC pose '+label+' group source changed');
   assert.equal(canonical(g.entities.filter(npc)),canonical(pair.rows),'NPC pose '+label+' entity differs from complete source');
  }
  const diagnostics=g=>g.blockers.filter(row=>poseDiagnostic(row,pair.sources,canonical)),oldPose=diagnostics(old),nextPose=diagnostics(next);
  assert.equal(canonical(nextPose),canonical(pair.initial),'Candidate NPC initial pose diagnostics differ from source/media');
  const variants=[['legacy-source-import',pair.previous],['four-direction-source-import',pair.fourDirection],['current-initial-direction',pair.initial]],
   matches=variants.filter(([,rows])=>canonical(rows)===canonical(oldPose));
  assert.ok(matches.length,'Previous NPC pose diagnostics are not a verified source generation');
  copy.map.groups[name].blockers=replacePoseDiagnostics(old.blockers,next.blockers,pair.sources,canonical);
  if(canonical(oldPose)!==canonical(nextPose))changes.push({group:name,source:pair.source,rawHash:pair.rawHash,
   previousContract:matches.map(([name])=>name),previousDiagnostics:structuredClone(oldPose),candidateDiagnostics:structuredClone(nextPose),
   mediaBindings:pair.media.map(({character:_,...row})=>row)});
 }
 const initial=evidence.groups.entity_default;assert.ok(initial,'Missing NPC pose source default group');
 for(const[label,d]of[['previous',before],['candidate',after]]){
  assert.equal(canonical(d.map.initialGroups),canonical(['entity_default']),'NPC pose '+label+' initial membership changed');
  assert.equal(canonical(d.map.entities.filter(npc)),canonical(initial.rows),'NPC pose '+label+' active membership changed');
 }
 return{after:copy,audit:changes.length?{...structuredClone(proof),mapId:after.mapId,sourceDigest:evidence.sourceDigest,
  changes,diagnosticsOnly:true,partyFourDirectionContractChanged:false,sourceGameplayAdmitted:false,nativeParity:false,saveMigration:false}:null};
}
export function sourceNpcInitialPoseChanged(before,after,canonical){
 const project=d=>d.kind==='world-map-development'&&d.map?Object.fromEntries(Object.entries(d.map.groups??{}).map(([name,g])=>{
  const sources=new Set(g.entities.filter(npc).map(e=>canonical(e.source)));return[name,g.blockers.filter(row=>poseDiagnostic(row,sources,canonical))];
 })):null;
 return canonical(project(before))!==canonical(project(after));
}
