import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const HASH=/^[a-f0-9]{64}$/;
function fields(raw,keys,label){
 assert.ok(raw&&typeof raw==='object'&&!Array.isArray(raw)&&[Object.prototype,null].includes(Object.getPrototypeOf(raw)),'Invalid '+label);
 assert.deepEqual(Reflect.ownKeys(raw).sort(),keys.split(',').sort(),'Invalid '+label+' fields');
 assert.ok(Object.values(Object.getOwnPropertyDescriptors(raw)).every(d=>d.enumerable&&'value'in d),'Invalid '+label+' data');
}
export function parseSourceEventActivationAddition(raw){
 if(raw===undefined)return null;
 fields(raw,'kind,compilerDigest,sourceSetHash,parentSourceSetHash','source event activation addition');
 assert.equal(raw.kind,'compiled-source-event-activation-addition-v1');
 for(const key of ['compilerDigest','sourceSetHash','parentSourceSetHash'])assert.ok(typeof raw[key]==='string'&&HASH.test(raw[key]),'Invalid '+key);
 return structuredClone(raw);
}
/** Physical raw source is the authority. An independent import reconstructs
 * both complete typed generations; candidate metadata is not its own proof. */
export function createSourceEventActivationEvidenceReader({root,compiledDir='dist'}){
 let context;const maps=new Map();
 return async document=>{
  context??=(async()=>{
   const load=n=>import(pathToFileURL(resolve(root,compiledDir,'src/compiler',n+'.js'))),
    [{loadCorpus},{loadSystemMessages},{bindMapPackages},{compileEntityGroup,entityProperties},{hash,canonical}]=await Promise.all(
     ['corpus','system-messages','map-package','entity-group','content'].map(load)),corpus=await loadCorpus(root),
    system=await loadSystemMessages(root,corpus.manifest.parentSourceSetHash,corpus.manifest.sources);
   return{corpus,hash,canonical,compileEntityGroup,entityProperties,sourceDigest:hash(corpus),
    assets:new Map(corpus.assets.map(a=>[a.id,a])),messages:{...corpus.messages,system_zhc:system.messages},
    bindings:new Map(bindMapPackages(corpus.assets,corpus.tables).map(b=>[Number(b.id),b]))};
  })();const c=await context;
  assert.equal(document.sourceSetHash,c.corpus.sourceSetHash,'Event addition corpus mismatch');
  assert.equal(document.parentSourceSetHash,c.corpus.manifest.parentSourceSetHash,'Event addition parent mismatch');
  if(document.kind==='world-development')return{kind:'verified-source-event-activation-world-v1',...c};
  if(!maps.has(document.mapId)){
   const binding=c.bindings.get(document.mapId);assert(binding,'Missing source event map binding');const groups={};
   for(const[name,id]of Object.entries(binding.groups)){
    const a=c.assets.get(id);assert(a);const sources=new Set();
    for(const[li,l]of(a.data.layers??[]).entries())for(const[oi,o]of(l.objects??[]).entries()){
     const p=c.entityProperties(o.properties);if(p.object_type===2&&p.gimmick===true)sources.add(c.canonical({...a.source,pointer:`/layers/${li}/objects/${oi}`}));
    }
    const old=c.compileEntityGroup(name,a,c.corpus.tables,c.messages,16,'source-event-activation-legacy-audit-v1'),
     next=c.compileEntityGroup(name,a,c.corpus.tables,c.messages);
    for(const g of[old,next])for(const e of g.entities)if(e.script&&!document.scripts[e.script])g.blockers.push({reason:'Missing entity script '+e.script,source:e.source});
    groups[name]={source:a.source,rawHash:c.hash(a.data),sources,old,next};
   }
   maps.set(document.mapId,{kind:'verified-source-event-activation-map-v1',...c,groups});
  }return maps.get(document.mapId);
 };
}
const familyRows=(g,sources,canonical)=>g.entities.filter(e=>e.eventActivation!==undefined||sources.has(canonical(e.source))),
 familyDiagnostics=(g,sources,canonical)=>g.blockers.filter(b=>sources.has(canonical(b.source)));
/** Insert only this family's old diagnostics. Other families may have their
 * own independently checked additions in the same candidate collection. */
function projectDiagnostics(before,after,sources,canonical){
 const result=after.filter(b=>!sources.has(canonical(b.source))).map(b=>structuredClone(b));
 for(let index=before.length-1;index>=0;index--){const row=before[index];if(!sources.has(canonical(row.source)))continue;
  const following=before.slice(index+1).find(b=>result.some(r=>canonical(r)===canonical(b))),
   at=following?result.findIndex(r=>canonical(r)===canonical(following)):result.length;
  result.splice(at,0,structuredClone(row));
 }return result;
}
/** A comparison projection only. It never edits the candidate payload, source
 * script, profile, media, map positions or runtime/save capability. */
export function compareSourceEventActivationAddition(before,after,evidence,proof){
 const {canonical,hash}=evidence,copy=structuredClone(after),changes=[];
 if(after.kind!=='world-map-development'||!after.map||!before.map)return{after:copy,audit:null};
 const allSources=new Set(Object.values(evidence.groups).flatMap(p=>[...p.sources]));
 for(const[name,pair]of Object.entries(evidence.groups)){
  const old=before.map.groups?.[name],next=after.map.groups?.[name];assert(old&&next,'Source event group disappeared');
  assert.equal(canonical(old.source),canonical(pair.source));assert.equal(canonical(next.source),canonical(pair.source));
  const family=g=>familyRows(g,pair.sources,canonical),diagnostics=g=>familyDiagnostics(g,pair.sources,canonical);
  assert.equal(canonical(family(next)),canonical(family(pair.next)),'Candidate event source rows changed');
  assert.equal(canonical(diagnostics(next)),canonical(diagnostics(pair.next)),'Candidate event diagnostics changed');
  const legacy=canonical(family(old))===canonical(family(pair.old))&&canonical(diagnostics(old))===canonical(diagnostics(pair.old));
  if(!legacy){assert.equal(canonical(family(old)),canonical(family(pair.next)),'Previous event rows are not verified source');
   assert.equal(canonical(diagnostics(old)),canonical(diagnostics(pair.next)),'Previous event diagnostics are not verified source');}
  const projected=copy.map.groups[name];
  projected.entities=projected.entities.map(e=>{
   if(!pair.sources.has(canonical(e.source))&&e.eventActivation===undefined)return e;
   const found=old.entities.filter(row=>row.id===e.id&&canonical(row.source)===canonical(e.source));
   assert.equal(found.length,1,'Source event identity missing or ambiguous');return structuredClone(found[0]);
  });
  projected.blockers=projectDiagnostics(old.blockers,next.blockers,pair.sources,canonical);
  if(canonical(family(old))!==canonical(family(next))||canonical(diagnostics(old))!==canonical(diagnostics(next)))
   changes.push({group:name,source:pair.source,rawHash:pair.rawHash,previousRowsHash:hash(family(old)),candidateRowsHash:hash(family(next)),
    previousDiagnostics:diagnostics(old),candidateDiagnostics:diagnostics(next),legacy});
 }
 const active=e=>e.eventActivation!==undefined||allSources.has(canonical(e.source));
 if(allSources.size||before.map.entities.some(active)||after.map.entities.some(active)){
  const expected=evidence.groups.entity_default;assert(expected,'Source event default group is missing');
  for(const document of[before,after]){
   assert.equal(canonical(document.map.initialGroups),canonical(['entity_default']),'Source event initial membership changed');
   const g=document.map.groups.entity_default;
   assert.equal(canonical(document.map.entities.filter(active)),canonical(g.entities.filter(active)),'Active event family changed or became unbound');
  }
  copy.map.entities=copy.map.entities.map(e=>{
   if(!active(e))return e;const old=before.map.entities.filter(row=>row.id===e.id&&canonical(row.source)===canonical(e.source));
   assert.equal(old.length,1,'Active previous event identity missing');return structuredClone(old[0]);
  });
 }
 return{after:copy,audit:changes.length?{...structuredClone(proof),mapId:after.mapId,sourceDigest:evidence.sourceDigest,changes,
  sourceGameplayAdmitted:false,nativeParity:false,saveMigration:false}:null};
}

export function sourceEventActivationChanged(before,after,canonical){
 const values=d=>d.map?{groups:Object.fromEntries(Object.entries(d.map.groups??{}).map(([name,g])=>[name,g.entities.filter(e=>e.eventActivation!==undefined)])),
  active:d.map.entities.filter(e=>e.eventActivation!==undefined)}:null;
 return canonical(values(before))!==canonical(values(after));
}
