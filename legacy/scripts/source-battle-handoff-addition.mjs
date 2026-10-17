// Compatibility names delegate to the closed owned-capability audit.
import assert from 'node:assert/strict';
import {parseSourceOwnedCapabilityAddition,createSourceOwnedCapabilityEvidenceReader,auditSourceOwnedCapabilityAdditions} from './source-owned-capability-additions.mjs';
export function parseSourceBattleHandoffAddition(raw){
 if(raw===undefined)return null;
 assert(raw&&typeof raw==='object'&&!Array.isArray(raw));assert.deepEqual(Reflect.ownKeys(raw).sort(),['kind','compilerDigest','sourceSetHash','parentSourceSetHash'].sort(),'Invalid source handoff addition fields');
 assert(Object.values(Object.getOwnPropertyDescriptors(raw)).every(d=>d.enumerable&&Object.hasOwn(d,'value')),'Source handoff addition requires own data');assert.equal(raw.kind,'compiled-source-battle-handoff-addition-v1');
 parseSourceOwnedCapabilityAddition({...raw,kind:'compiled-source-owned-capability-additions-v1',catalogKeys:['sourceBattleHandoffs']});return structuredClone(raw);
}
export function sourceBattleHandoffAdditionOptions({declaration,evidence,baselines}){
 const proof=parseSourceBattleHandoffAddition(declaration);
 return {declaration:proof?{...proof,kind:'compiled-source-owned-capability-additions-v1',catalogKeys:['sourceBattleHandoffs']}:undefined,
  evidence:evidence===undefined?undefined:async()=>{const value=await evidence();return value.kind==='verified-source-owned-capability-evidence-v1'?value:value.ownedEvidence;},baselines:baselines===undefined?undefined:new Map([...baselines].map(([url,value])=>[url,{...value,omittedCatalogs:["sourceBattleHandoffs"]}]))};
}
export function createSourceBattleHandoffEvidenceReader(options){
 const read=createSourceOwnedCapabilityEvidenceReader({...options,catalogKeys:['sourceBattleHandoffs']});
 return async()=>{const ownedEvidence=await read(),item=ownedEvidence.expected.sourceBattleHandoffs;return {kind:'verified-source-battle-handoff-evidence-v1',sourceSetHash:ownedEvidence.sourceSetHash,parentSourceSetHash:ownedEvidence.parentSourceSetHash,sourceDigest:ownedEvidence.sourceDigest,catalog:item.catalog,rows:ownedEvidence.sourceTables['condition.csv'],physicalSources:ownedEvidence.physicalSources,compiler:ownedEvidence.compilers.find(c=>c.module==='src/compiler/source-battle-handoffs.js'),ownedEvidence};};
}
export function legacySourceBattleHandoffAudit(value){
 if(!value)return null;const item=value.catalogs.sourceBattleHandoffs;return {...value,kind:'compiled-source-battle-handoff-addition-v1',beforeCatalog:item.beforeCatalog,afterCatalog:item.afterCatalog,rows:item.rows,compiler:value.compilers.find(c=>c.module==='src/compiler/source-battle-handoffs.js'),comparedWholeBodyExceptAddedField:true};
}
export async function auditSourceBattleHandoffAddition({declaration,evidence,...options}){
 const adapted=sourceBattleHandoffAdditionOptions({declaration,evidence});return legacySourceBattleHandoffAudit(await auditSourceOwnedCapabilityAdditions({...options,declaration:adapted.declaration,evidence:adapted.evidence}));
}
