import { sourceRosterGroupCatalog, type SourceRosterGroupCatalog, type RosterGroupEventOp } from '../core/roster-groups.js';
import { record } from './content.js';
import { tableId } from './table-id.js';

export const rosterGroupSelectors = ['メンバー加入：モーグリたち','メンバー離脱：モーグリたち'] as const;
export function compileSourceRosterGroups(tables: Record<string,unknown>): {
  catalog: SourceRosterGroupCatalog; dependencies: {table:string;id:number}[];
} {
  const catalog=sourceRosterGroupCatalog(),dependencies:{table:string;id:number}[]=[];
  for(const id of catalog.group.sourceIds) {
    const rows=Array.isArray(tables['character_status.csv'])?tables['character_status.csv'] as unknown[]:[];
    const matches=rows.map(record).filter(r=>Number(r.id)===id);
    if(matches.length!==1)throw new Error('Missing or ambiguous group source character '+id);
    const job=tableId(matches[0]!.job_id), jobs=Array.isArray(tables['job.csv'])?tables['job.csv'] as unknown[]:[];
    if(jobs.map(record).filter(r=>Number(r.id)===job).length!==1)
      throw new Error('Missing or ambiguous group source job '+job);
    dependencies.push({table:'character_status.csv',id},{table:'job.csv',id:job});
  }
  return {catalog,dependencies:[...new Map(dependencies.map(d=>[d.table+':'+d.id,d])).values()]};
}
/** Field decoder owns the full SysCall type/eight operands/unused-slot check. */
export function compileRosterGroupEvent(selector:string,tables:Record<string,unknown>):RosterGroupEventOp {
  if(!(rosterGroupSelectors as readonly string[]).includes(selector))throw new Error('Unknown source roster group selector');
  const {dependencies}=compileSourceRosterGroups(tables);
  return {kind:'roster-group',command:{kind:selector===rosterGroupSelectors[0]?'join':'secede',group:'moogles'},dependencies};
}
