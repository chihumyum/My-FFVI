import {sourceSpecialOwnedCatalog,type SourceSpecialOwnedCatalog,type SourceSpecialOwnedEventOp} from '../core/source-special-owned-members.js';
import {record} from './content.js';
import {tableId} from './table-id.js';
export const sourceSpecialOwnedSelectors=['メンバー加入：ゆうれい-１','メンバー加入：ゆうれい-２','メンバー加入：ガウ'] as const;
export function compileSourceSpecialOwnedCatalog(tables:Record<string,unknown>):{catalog:SourceSpecialOwnedCatalog;dependencies:{table:string;id:number}[]}{
 const catalog=sourceSpecialOwnedCatalog(),dependencies:{table:string;id:number}[]=[];
 const row=(table:string,id:number)=>{const rows=Array.isArray(tables[table])?(tables[table] as unknown[]).map(record):[],matches=rows.filter(r=>tableId(r.id)===id);
  if(matches.length!==1)throw Error('Missing or ambiguous special-owned source '+table+':'+id);dependencies.push({table,id});return matches[0]!;};
 for(const id of [catalog.gauSourceId,...catalog.ghostSourceIds]){const character=row('character_status.csv',id);row('job.csv',tableId(character.job_id));}
 const exp=row('exp_table.csv',1);if(tableId(exp.total_exp)!==catalog.ghostResetAdditionalExp)throw Error('Unsupported Ghost source reset experience row');
 return{catalog,dependencies:[...new Map(dependencies.map(d=>[d.table+':'+d.id,d])).values()]};
}
/** Caller owns exact SysCall type/eight-bank/unused-operand admission. */
export function compileSpecialOwnedEvent(selector:string,tables:Record<string,unknown>):SourceSpecialOwnedEventOp{
 const i=(sourceSpecialOwnedSelectors as readonly string[]).indexOf(selector);if(i<0)throw Error('Unknown special-owned selector');
 const {dependencies}=compileSourceSpecialOwnedCatalog(tables);return{kind:'special-owned-join',member:i===0?'ghost-1':i===1?'ghost-2':'gau',dependencies};
}
