// Closed source catalog additions: immutable capability facts, never save state.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';import {readFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
const repository=resolve(import.meta.dirname,'..'),sha=b=>createHash('sha256').update(b).digest('hex'),digest=/^[a-f0-9]{64}$/;
export const sourceOwnedCapabilityCatalogKeys=Object.freeze(['sourceBattleHandoffs','sourceSpecialOwnedMembers','equipmentStrongestMetadata']);
const masterNames=['condition.csv','character_status.csv','job.csv','exp_table.csv','content.csv','weapon.csv','armor.csv'];
const evidenceModules=keys=>['compiler/source-owned-capability-catalogs','compiler/source-battle-handoffs','compiler/source-special-owned-members','core/source-special-owned-members',...(keys.includes('equipmentStrongestMetadata')?['compiler/equipment']:[])];
function equipmentMetadataProjection(gameState){
 const containers=[gameState?.equipmentSystem?.catalog?.definitions,gameState?.sourceNewGame?.equipment?.definitions];
 if(containers.every(value=>value===undefined))return undefined;
 assert(containers.every(value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length),'Missing equipment metadata definition container');
 const copies=containers.map(definitions=>Object.fromEntries(Object.entries(definitions).map(([id,value])=>{
  assert(value&&typeof value==='object'&&!Array.isArray(value),'Invalid equipment metadata definition');return [id,value.strongest];
 }))),values=copies.flatMap(definitions=>Object.values(definitions)),present=values.filter(value=>value!==undefined).length;
 if(present===0)return undefined;
 assert.equal(present,values.length,'Partial or mixed equipment strongest metadata cannot grant an addition');
 return {kind:'source-equipment-strongest-metadata-v1',definitions:copies[0],initialDefinitions:copies[1]};
}
export function sourceOwnedCapabilityProjection(gameState,key){
 assert(sourceOwnedCapabilityCatalogKeys.includes(key),'Unknown owned capability projection');
 return key==='equipmentStrongestMetadata'?equipmentMetadataProjection(gameState):gameState?.[key];
}
export function sourceOwnedCapabilityOmissions(gameState){
 return sourceOwnedCapabilityCatalogKeys.filter(key=>
  (key!=='equipmentStrongestMetadata'||gameState?.equipmentSystem?.catalog?.definitions!==undefined||gameState?.sourceNewGame?.equipment?.definitions!==undefined)&&sourceOwnedCapabilityProjection(gameState,key)===undefined);
}
/** A comparison projection only. It is never a compiler input or a baseline. */
export function projectSourceOwnedCapabilityAdditions(gameState,keys){
 assert(Array.isArray(keys)&&keys.every(key=>sourceOwnedCapabilityCatalogKeys.includes(key))&&new Set(keys).size===keys.length,'Unknown owned capability comparison projection');
 const value=structuredClone(gameState);
 for(const key of keys){if(key==='equipmentStrongestMetadata'){
   equipmentMetadataProjection(value);
   for(const definitions of [value.equipmentSystem.catalog.definitions,value.sourceNewGame.equipment.definitions])for(const item of Object.values(definitions))delete item.strongest;
  }else delete value[key];}
 return value;
}
function fields(raw,keys,label){
 assert(raw&&typeof raw==='object'&&!Array.isArray(raw)&&[Object.prototype,null].includes(Object.getPrototypeOf(raw)),'Invalid '+label);
 assert.deepEqual(Reflect.ownKeys(raw).sort(),[...keys].sort(),'Invalid '+label+' fields');
 assert(Object.values(Object.getOwnPropertyDescriptors(raw)).every(d=>d.enumerable&&Object.hasOwn(d,'value')),'Invalid '+label+' own data');
}
export function parseSourceOwnedCapabilityAddition(raw){
 if(raw===undefined)return null;fields(raw,['kind','compilerDigest','sourceSetHash','parentSourceSetHash','catalogKeys'],'owned capability addition');
 assert.equal(raw.kind,'compiled-source-owned-capability-additions-v1');
 for(const key of ['compilerDigest','sourceSetHash','parentSourceSetHash'])assert(typeof raw[key]==='string'&&digest.test(raw[key]),'Invalid owned capability addition '+key);
 const keys=raw.catalogKeys;assert(Array.isArray(keys)&&keys.length&&Reflect.ownKeys(keys).length===keys.length+1,'Invalid owned capability catalog key collection');
 const seen=new Set();for(let i=0;i<keys.length;i++){const d=Object.getOwnPropertyDescriptor(keys,i);assert(d?.enumerable&&Object.hasOwn(d,'value')&&sourceOwnedCapabilityCatalogKeys.includes(d.value)&&!seen.has(d.value),'Unknown owned capability catalog key');seen.add(d.value);}
 return {...raw,catalogKeys:sourceOwnedCapabilityCatalogKeys.filter(key=>keys.includes(key))};
}
export function parseSourceOwnedCapabilityAdditions(raw){
 if(raw===undefined)return null;assert(raw&&typeof raw==='object');const keys=Reflect.ownKeys(raw);assert(keys.every(k=>['declaration','evidence','baselines'].includes(k)),'Unknown owned capability additions option');
 fields(raw,keys,'owned capability additions options');const declaration=parseSourceOwnedCapabilityAddition(raw.declaration);assert(declaration,'Owned capability additions require declaration');
 assert(raw.baselines instanceof Map,'Owned capability additions require same-input compiled baselines');assert(raw.evidence===undefined||typeof raw.evidence==='function','Unknown owned capability evidence reader');
 return {declaration,evidence:raw.evidence,baselines:raw.baselines};
}
async function compiler(root,compiledDir){const load=n=>import(pathToFileURL(resolve(root,compiledDir,'src/compiler',n+'.js')).href),api=await load('source-owned-capability-catalogs');assert.deepEqual(api.sourceOwnedCapabilityCatalogKeys,sourceOwnedCapabilityCatalogKeys,'Owned catalog registry mismatch');return api;}
export function createSourceOwnedCapabilityEvidenceReader({root=repository,compiledDir='dist',catalogKeys=sourceOwnedCapabilityCatalogKeys}={}){
 root=resolve(root);let pending;
 return async()=>{pending??=(async()=>{
  const api=await compiler(root,compiledDir),load=n=>import(pathToFileURL(resolve(root,compiledDir,'src/compiler',n+'.js')).href),[{loadCorpus},{loadSystemSource},{compileSharedBattleSource},{hash}]=await Promise.all(['corpus','system-source','battle','content'].map(load));
  const corpus=await loadCorpus(root),system=await loadSystemSource(root,corpus.manifest.parentSourceSetHash),source=await compileSharedBattleSource(root);assert.equal(source.parentSourceSetHash,system.manifest.parentSourceSetHash);assert.equal(system.sourceSetHash,corpus.sourceSetHash,'Owned capability system/corpus source identity differs');
  const names=catalogKeys.includes('equipmentStrongestMetadata')?masterNames:masterNames.slice(0,4),sourceTables=Object.fromEntries(names.map(name=>[name,Object.values(source.tables[name])])),tables=Object.fromEntries(names.map(name=>[name,sourceTables[name].map(row=>row.values)])),expected=api.compileSourceOwnedCapabilityEvidence(tables,system.sourceSetHash,catalogKeys),physicalSources=[];
  for(const row of Object.values(sourceTables).flat()){const matches=system.manifest.sources.filter(f=>f.file===row.source.file||f.file.endsWith('/'+row.source.file));assert.equal(matches.length,1,'Unbound owned capability source physical file');if(!physicalSources.some(f=>f.file===matches[0].file))physicalSources.push(structuredClone(matches[0]));}
  const compilers=await Promise.all(evidenceModules(catalogKeys).map(async name=>({module:'src/'+name+'.js',sha256:sha(await readFile(resolve(root,compiledDir,'src',name+'.js')))})));
  return {kind:'verified-source-owned-capability-evidence-v1',sourceSetHash:system.sourceSetHash,parentSourceSetHash:system.manifest.parentSourceSetHash,sourceDigest:hash(corpus),sourceTables,sourceTableHashes:Object.fromEntries(names.map(name=>[name,hash(sourceTables[name])])),expected,physicalSources,compilers};
 })();try{return structuredClone(await pending);}catch(error){pending=undefined;throw error;}};
}
export function ownedCapabilityCatalogAdditions(before,after,canonical){
 if(before.kind!=='narshe-battle-catalog'||after.kind!=='narshe-battle-catalog')return [];
 const added=[];for(const key of sourceOwnedCapabilityCatalogKeys){const a=sourceOwnedCapabilityProjection(before.gameState,key),b=sourceOwnedCapabilityProjection(after.gameState,key);if(a===undefined&&b===undefined)continue;assert(b!==undefined,'Owned capability catalog cannot be removed: '+key);if(a!==undefined)assert.equal(canonical(a),canonical(b),'Existing owned capability catalog cannot change: '+key);else added.push(key);}
 return added;
}
export async function auditSourceOwnedCapabilityAdditions({before,after,declaration,evidence,canonical,root=repository,compiledDir='dist'}){
 if(before.kind!=='narshe-battle-catalog'||after.kind!=='narshe-battle-catalog')return null;
 const added=ownedCapabilityCatalogAdditions(before,after,canonical);
 if(!added.length)return null;
 const proof=parseSourceOwnedCapabilityAddition(declaration);assert(proof&&typeof evidence==='function','Owned capability catalog addition requires explicit same-source declaration/evidence');assert(added.every(key=>proof.catalogKeys.includes(key)),'Undeclared owned capability catalog addition');
 const verified=await evidence();assert.equal(verified.kind,'verified-source-owned-capability-evidence-v1');for(const key of ['sourceSetHash','parentSourceSetHash'])assert.equal(verified[key],proof[key]);assert(digest.test(verified.sourceDigest),'Invalid owned capability source digest');
 const api=await compiler(root,compiledDir),tables={};
 const moduleNames=evidenceModules(proof.catalogKeys).map(name=>'src/'+name+'.js');assert(Array.isArray(verified.compilers)&&verified.compilers.length===moduleNames.length,'Incomplete owned capability compiler/native-fact pins');for(const module of moduleNames){const found=verified.compilers.filter(c=>c.module===module);assert.equal(found.length,1,'Ambiguous owned capability compiler module');assert.equal(found[0].sha256,sha(await readFile(resolve(root,compiledDir,module))),'Owned capability compiler/native-fact module changed');}
 for(const [name,rows]of Object.entries(verified.sourceTables)){assert(masterNames.includes(name)&&Array.isArray(rows),'Unknown owned capability master');assert.equal(sha(canonical(rows)),verified.sourceTableHashes[name],'Owned capability raw source rows changed: '+name);tables[name]=rows.map(row=>row.values);}
 assert(Array.isArray(verified.physicalSources)&&verified.physicalSources.length,'Missing owned capability physical sources');const physicalFiles=new Set();for(const file of verified.physicalSources){fields(file,['file','sha256','bytes'],'owned capability physical source');assert(typeof file.file==='string'&&file.file&&digest.test(file.sha256)&&Number.isInteger(file.bytes)&&file.bytes>=0&&!physicalFiles.has(file.file),'Invalid owned capability physical source identity');physicalFiles.add(file.file);}
 const expected=api.compileSourceOwnedCapabilityEvidence(tables,proof.sourceSetHash,added),catalogs={};
 for(const key of added){const fact=expected[key];assert.equal(canonical(fact),canonical(verified.expected[key]),'Owned capability expected catalog or raw dependency differs: '+key);const actual=sourceOwnedCapabilityProjection(after.gameState,key);
  if(key==='equipmentStrongestMetadata'){
   assert.equal(canonical({kind:actual.kind,definitions:actual.definitions}),canonical(fact.catalog),'Equipment metadata differs from complete recompiled raw domain');
   for(const[id,value]of Object.entries(actual.initialDefinitions))assert.equal(canonical(value),canonical(fact.catalog.definitions[id]),'Initial equipment metadata copy differs from complete raw domain');
  }else assert.equal(canonical(actual),canonical(fact.catalog),'Owned capability directory differs from recompiled raw master: '+key);
  const rows=fact.dependencies.map(dep=>{const found=verified.sourceTables[dep.table].filter(row=>String(row.values.id)===String(dep.id));assert.equal(found.length,1,'Missing or ambiguous owned capability raw row');const row=found[0];fields(row.source,['file','assetPath','serializedFile','objectId','rowId'],'owned capability raw row source');assert.equal(row.source.rowId,String(dep.id));assert(typeof row.source.assetPath==='string'&&(row.source.assetPath===dep.table||row.source.assetPath.endsWith('/'+dep.table))&&typeof row.source.serializedFile==='string'&&row.source.serializedFile&&typeof row.source.objectId==='string'&&/^-?(?:0|[1-9]\d*)$/.test(row.source.objectId)&&BigInt(row.source.objectId)>=-(1n<<63n)&&BigInt(row.source.objectId)<(1n<<63n),'Changed owned capability raw row identity');assert.equal(verified.physicalSources.filter(file=>file.file===row.source.file||file.file.endsWith('/'+row.source.file)).length,1,'Unbound or ambiguous owned capability raw source row');return {dependency:dep,...structuredClone(row)};});catalogs[key]={beforeCatalog:null,afterCatalog:structuredClone(fact.catalog),...(key==='equipmentStrongestMetadata'?{targetCopies:structuredClone(actual),globalDefinitions:Object.keys(actual.definitions).length,initialDefinitions:Object.keys(actual.initialDefinitions).length}:{}),rows,completeTables:fact.completeTables};}
 assert.equal(canonical(before.gameState),canonical(projectSourceOwnedCapabilityAdditions(after.gameState,added)),'Owned capability addition changed actual owned initialization or another capability');
 const outside=value=>{const {contentHash:_,gameState:__,...body}=value;return body;};assert.equal(canonical(outside(before)),canonical(outside(after)),'Owned capability addition changed same-input compiler baseline body');
 return {kind:proof.kind,compilerDigest:proof.compilerDigest,sourceSetHash:proof.sourceSetHash,parentSourceSetHash:proof.parentSourceSetHash,sourceDigest:verified.sourceDigest,catalogKeys:added,catalogs,physicalSources:verified.physicalSources,compilers:verified.compilers,sourceTableHashes:verified.sourceTableHashes,beforeGameStateHash:sha(canonical(before.gameState)),afterGameStateHash:sha(canonical(after.gameState)),comparedWholeBodyExceptRegisteredAdditions:true,actualOwnedInitializationUnchanged:true,grantsSourceAdmission:false,saveMigration:false};
}

/** Derive ordinary baselines through the existing batch compiler. Its old
 * catalog shape, independently from the parent seed, selects the pure inputs. */
export async function compileDerivedOwnedCapabilityBaselines({rootUrl,previousDerived,compileBattleAuditBaseline,derive,verifyContent,hash}){
 assert(['/game/source-catalog.json','/game/opening-playable.json'].includes(rootUrl),'Unknown owned capability baseline parent');
 assert.equal(previousDerived.kind,'narshe-battle-catalog');for(const fn of [compileBattleAuditBaseline,derive,verifyContent,hash])assert.equal(typeof fn,'function');
 const omittedCatalogs=sourceOwnedCapabilityOmissions(previousDerived.gameState);
 const [parent,feeParent]=await Promise.all([compileBattleAuditBaseline({url:rootUrl,omittedCatalogs}),compileBattleAuditBaseline({url:rootUrl,omittedCatalogs,omitMessageFees:true})]);
 const [audit,fee]=await Promise.all([derive(parent),derive(feeParent)]);assert(audit.catalog,'Ordinary owned capability audit baseline is blocked');assert(fee.catalog,'Ordinary fee audit baseline is blocked');
 await verifyContent(audit.catalog);await verifyContent(fee.catalog);assert.equal(hash(audit.catalog.gameState),hash(previousDerived.gameState),'Ordinary audit baseline changed actual owned initialization or existing catalog');assert.equal(hash(fee.catalog.gameState),hash(previousDerived.gameState),'Ordinary fee baseline changed actual owned initialization or existing catalog');assert.equal(fee.catalog.common.sourceMessageFees,undefined,'Ordinary fee baseline includes added message fees');
 return {baseline:audit.catalog,feeBaseline:fee.catalog,omittedCatalogs};
}
