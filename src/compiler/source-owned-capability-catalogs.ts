import {checkpointKeys} from '../core/checkpoint-validation.js';
import {compileSourceBattleHandoffCatalog} from './source-battle-handoffs.js';
import {compileSourceSpecialOwnedCatalog} from './source-special-owned-members.js';
import type {GameStateContent} from '../core/game-state.js';
import {compileStrongestEquipmentMetadata} from './equipment.js';
import {tableId} from './table-id.js';

/** Closed reviewed registry. Unknown gameState additions have no fallback. */
export const sourceOwnedCapabilityTopLevelCatalogKeys=['sourceBattleHandoffs','sourceSpecialOwnedMembers'] as const;
export const sourceOwnedCapabilityCatalogKeys=[...sourceOwnedCapabilityTopLevelCatalogKeys,'equipmentStrongestMetadata'] as const;
export type SourceOwnedCapabilityCatalogKey=typeof sourceOwnedCapabilityCatalogKeys[number];
export type SourceOwnedCapabilityAdditionAudit={kind:'omit-source-owned-capability-catalogs-for-addition-audit-v1';omit:readonly SourceOwnedCapabilityCatalogKey[]};
export function parseSourceOwnedCapabilityAdditionAudit(raw:unknown):SourceOwnedCapabilityAdditionAudit{
 checkpointKeys(raw,'kind,omit');const a=raw as SourceOwnedCapabilityAdditionAudit;
 if(a.kind!=='omit-source-owned-capability-catalogs-for-addition-audit-v1'||!Array.isArray(a.omit)||!a.omit.length||Reflect.ownKeys(a.omit).length!==a.omit.length+1)throw Error('Unknown owned capability catalog audit omission');
 const keys:SourceOwnedCapabilityCatalogKey[]=[];
 for(let i=0;i<a.omit.length;i++){const p=Object.getOwnPropertyDescriptor(a.omit,i);if(!p?.enumerable||!Object.hasOwn(p,'value')||!(sourceOwnedCapabilityCatalogKeys as readonly unknown[]).includes(p.value)||keys.includes(p.value))throw Error('Unknown owned capability catalog audit omission');keys.push(p.value);}
 return {kind:a.kind,omit:sourceOwnedCapabilityCatalogKeys.filter(key=>a.omit.includes(key))};
}
export function compileSourceOwnedCapabilityCatalogs(tables:Record<string,unknown>,sourceSetHash:string,audit?:SourceOwnedCapabilityAdditionAudit):Pick<GameStateContent,typeof sourceOwnedCapabilityTopLevelCatalogKeys[number]>{
 const omit=audit===undefined?[]:parseSourceOwnedCapabilityAdditionAudit(audit).omit;
 return {...(!omit.includes('sourceBattleHandoffs')?{sourceBattleHandoffs:compileSourceBattleHandoffCatalog(tables,sourceSetHash)}:{}),
  ...(!omit.includes('sourceSpecialOwnedMembers')?{sourceSpecialOwnedMembers:compileSourceSpecialOwnedCatalog(tables).catalog}:{})};
}
/** Recompile every expected catalog from source rows. The caller supplies the
 * complete named masters; candidate gameState is deliberately not an input. */
export type SourceOwnedCapabilityCatalogEvidence={catalog:unknown;dependencies:{table:string;id:number}[];completeTables:string[]};
export function compileSourceOwnedCapabilityEvidence(tables:Record<string,unknown>,sourceSetHash:string,keys:readonly SourceOwnedCapabilityCatalogKey[]):Record<string,SourceOwnedCapabilityCatalogEvidence>{
 if(!Array.isArray(keys)||keys.some(key=>!(sourceOwnedCapabilityCatalogKeys as readonly string[]).includes(key))||new Set(keys).size!==keys.length)throw Error('Unknown owned capability evidence key');
 return Object.fromEntries(keys.map(key=>{
  if(key==='sourceBattleHandoffs'){
   const rows=tables['condition.csv'];if(!Array.isArray(rows))throw Error('Missing complete condition master');
   return [key,{catalog:compileSourceBattleHandoffCatalog(tables,sourceSetHash),dependencies:rows.map(row=>({table:'condition.csv',id:tableId((row as Record<string,unknown>).id)})),completeTables:['condition.csv']}];
  }
  if(key==='equipmentStrongestMetadata')return [key,compileSourceEquipmentStrongestMetadata(tables)];
  const compiled=compileSourceSpecialOwnedCatalog(tables);return [key,{...compiled,completeTables:['character_status.csv','job.csv','exp_table.csv']}];
 }));
}

/** Full equipment identity domain comes from raw content -> weapon/armor rows,
 * never the candidate's definitions. All initial-subset copies are checked by
 * the same metadata projection and independent compileNewGame audit baseline. */
export function compileSourceEquipmentStrongestMetadata(tables:Record<string,unknown>):SourceOwnedCapabilityCatalogEvidence {
 const rows=(name:string)=>{const raw=tables[name];if(!Array.isArray(raw))throw Error('Missing complete equipment metadata master: '+name);
  const values=raw as Record<string,string>[];if(new Set(values.map(r=>tableId(r.id))).size!==values.length)throw Error('Duplicate equipment metadata raw row');return values;};
 const content=rows('content.csv'),weapon=rows('weapon.csv'),armor=rows('armor.csv'),dependencies:{table:string;id:number}[]=[],definitions:Record<string,unknown>={},used=new Set<string>();
 for(const c of content.filter(c=>['2','3'].includes(c.type_id!))){const table=c.type_id==='2'?'weapon.csv':'armor.csv',id=tableId(c.id),rowId=tableId(c.type_value),found=(table==='weapon.csv'?weapon:armor).filter(r=>tableId(r.id)===rowId);
  if(found.length!==1||used.has(table+':'+rowId))throw Error('Missing or repeated equipment metadata content binding');used.add(table+':'+rowId);
  definitions[id]=compileStrongestEquipmentMetadata(found[0]!,c.type_id==='2'?'weapon':'armor');dependencies.push({table:'content.csv',id},{table,id:rowId});}
 if(!Object.keys(definitions).length||used.size!==weapon.length+armor.length)throw Error('Complete weapon/armor equipment metadata domain required');
 return {catalog:{kind:'source-equipment-strongest-metadata-v1',definitions},dependencies,completeTables:['content.csv','weapon.csv','armor.csv']};
}
