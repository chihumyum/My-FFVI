import {canonical} from '../core/canonical.js';
import {equivalentJobGrowth,validateCurrentJobCatalog,type CurrentJobCatalog} from '../core/current-job.js';
import type {GameStateContent} from '../core/game-state.js';
import type {BattleRow} from './battle.js';
import {compileCharacterGrowth} from './character-growth.js';
import {tableInteger as int} from './table.js';
type Tables=Record<string,Record<string,string>[]>;
type Reader={row(table:string,id:string|number):BattleRow;unique(table:string,key:string,value:string):BattleRow};
/** Every candidate is a real character/job curve binding. No CharacterStatus
 * rewrite and no inferred initial job for an unavailable source template. */
export function compileCurrentJobCatalog(reader:Reader,tables:Tables,owned:Pick<GameStateContent,
 'characterInitializations'|'characterGrowth'|'equipmentSystem'|'partyActors'>){
 const sources:BattleRow['source'][]=[],read=(table:string,id:string|number)=>{const r=reader.row(table,id);sources.push(r.source);return r.values;},
 rows=(table:string)=>{if(!Array.isArray(tables[table]))throw Error('Missing current job table '+table);return tables[table]!.map(r=>read(table,r.id!));},
 jobs=rows('job.csv'),curves=rows('intermediate_growth_curve.csv'),groups=rows('job_group.csv'),learning=rows('learning.csv'),
 catalog:CurrentJobCatalog={kind:'source-equivalent-current-jobs-v1',contexts:[]},diagnostics:{sourceId:number;jobId:number;initialJobId:number;reason:string}[]=[];
 const without=(r:Record<string,string>,keys:string[])=>Object.fromEntries(Object.entries(r).filter(([k])=>!keys.includes(k)));
 const system=owned.equipmentSystem;if(!system)throw Error('Current jobs require source equipment owner');
 for(const curve of curves){const sourceId=int(curve.character_id),jobId=int(curve.job_id),character=read('character_status.csv',sourceId),initialJobId=int(character.job_id);
  if(jobId===initialJobId)continue;
  try{
   const matches=Object.entries(owned.characterInitializations??{}).filter(([,t])=>t.initial.sourceId===sourceId);
   if(matches.length!==1)throw Error('Unavailable complete initial job template');const [id,template]=matches[0]!,base=owned.characterGrowth?.[id];
   if(!base)throw Error('Missing initial job growth');
   const initial=jobs.filter(j=>int(j.id)===initialJobId),target=jobs.filter(j=>int(j.id)===jobId),origin=curves.filter(r=>int(r.character_id)===sourceId&&int(r.job_id)===initialJobId);
   if(initial.length!==1||target.length!==1||origin.length!==1)throw Error('Missing unique source job/curve context');
   if(canonical(without(initial[0]!,['id']))!==canonical(without(target[0]!,['id']))||
    canonical(without(origin[0]!,['id','job_id']))!==canonical(without(curve,['id','job_id'])))throw Error('Non-equivalent full job master/curve');
   for(const type of [1,3]){const select=(job:number)=>learning.filter(r=>int(r.type_id)===type&&int(r.job_id)===job).map(r=>without(r,['id','job_id']));
    if(canonical(select(initialJobId))!==canonical(select(jobId)))throw Error('Non-equivalent ordered source learning');}
   for(const group of groups)if(group['job'+initialJobId+'_accept']!==group['job'+jobId+'_accept']||!['0','1'].includes(group['job'+jobId+'_accept']??''))throw Error('Non-equivalent full equipment job-group matrix');
   const compiled=compileCharacterGrowth(reader,tables,template,base.observedLearning,base.magicStones,
    {sourceId,initialJobId,jobId});sources.push(...compiled.sources);
   if(canonical(equivalentJobGrowth(base))!==canonical(equivalentJobGrowth(compiled.plan)))throw Error('Non-equivalent complete derived growth/ability/experience');
   catalog.contexts.push({sourceId,initialJobId,jobId,nameKey:template.nameKey,nameTag:template.nameTag,
    growth:compiled.plan,parameters:structuredClone(template.parameterContext),equipment:{...structuredClone(template.equipmentCharacter),jobId}});
   validateCurrentJobCatalog(catalog,{templates:owned.characterInitializations??{},growth:owned.characterGrowth??{},equipment:system.catalog,parameters:system.contexts,...(owned.partyActors?{partyActors:owned.partyActors}:{})});
  }catch(error){catalog.contexts=catalog.contexts.filter(c=>!(c.sourceId===sourceId&&c.jobId===jobId));diagnostics.push({sourceId,jobId,initialJobId,reason:String(error)});}
 }
 return{catalog,diagnostics,sources:[...new Map(sources.map(s=>[canonical(s),s])).values()]};
}
