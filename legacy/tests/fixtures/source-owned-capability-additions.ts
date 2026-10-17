import {readFile} from 'node:fs/promises';import {resolve} from 'node:path';import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {canonical,hash} from '../../src/compiler/content.js';
import {compileSourceOwnedCapabilityEvidence,type SourceOwnedCapabilityCatalogKey} from '../../src/compiler/source-owned-capability-catalogs.js';
const compiledDir=fileURLToPath(new URL('../../',import.meta.url));
export function ownedCapabilitySourceFixture(keys:SourceOwnedCapabilityCatalogKey[]=['sourceBattleHandoffs','sourceSpecialOwnedMembers']){
 const values:Record<string,Record<string,string>[]>= {'condition.csv':[{id:'305',condition_type:'5',until_type:'3'}],
  'character_status.csv':[12,17,18].map(id=>({id:String(id),job_id:String(id)})),
  'job.csv':[12,17,18].map(id=>({id:String(id)})),'exp_table.csv':[{id:'1',total_exp:'0'}]};
 if(keys.includes('equipmentStrongestMetadata'))Object.assign(values,{'content.csv':[{id:'100',type_id:'2',type_value:'1'},{id:'101',type_id:'2',type_value:'2'},{id:'200',type_id:'3',type_value:'1'}],'weapon.csv':[{id:'1',sort_id:'20',category_type:'1',two_handed_flag:'0'},{id:'2',sort_id:'30',category_type:'3',two_handed_flag:'1'}],'armor.csv':[{id:'1',sort_id:'10'}]});
 const sourceTables=Object.fromEntries(Object.entries(values).map(([table,rows])=>[table,rows.map(values=>({values,source:{file:'controlled.bundle',assetPath:'Assets/Master/'+table,serializedFile:'controlled',objectId:'90071992547409939',rowId:values.id}}))]));
 const expected=compileSourceOwnedCapabilityEvidence(values,'a'.repeat(64),keys);
 const evidence=async()=>({kind:'verified-source-owned-capability-evidence-v1',sourceSetHash:'a'.repeat(64),parentSourceSetHash:'b'.repeat(64),sourceDigest:'c'.repeat(64),sourceTables:structuredClone(sourceTables),sourceTableHashes:Object.fromEntries(Object.entries(sourceTables).map(([name,rows])=>[name,hash(rows)])),expected:structuredClone(expected),physicalSources:[{file:'controlled.bundle',sha256:'d'.repeat(64),bytes:123}],compilers:await Promise.all(['compiler/source-owned-capability-catalogs','compiler/source-battle-handoffs','compiler/source-special-owned-members','core/source-special-owned-members',...(keys.includes('equipmentStrongestMetadata')?['compiler/equipment']:[])].map(async name=>({module:'src/'+name+'.js',sha256:createHash('sha256').update(await readFile(resolve(compiledDir,'src',name+'.js'))).digest('hex')})))});
 return {values,sourceTables,expected,evidence,canonical,hash};
}
