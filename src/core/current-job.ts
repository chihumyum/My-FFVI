import {canonical} from './canonical.js';
import {checkpointKeys} from './checkpoint-validation.js';
import type {CharacterGrowthPlan} from './character-growth.js';
import type {EquipmentCatalog,EquipmentCharacter,EquipmentParameterContext} from './equipment.js';
import type {OwnedCharacterInitializationTemplate} from './owned-character.js';
import type {PartyActorCatalog} from './party-actors.js';
import {partyMemberFieldAsset} from './party-actors.js';
import type {RosterMember} from './roster.js';

/** Trusted compiled source content, never accepted from a save. This batch is
 * deliberately limited to equivalent FF6 contexts, not arbitrary job changes. */
export type CurrentJobContext = {
  sourceId:number; initialJobId:number; jobId:number;
  nameKey:string; nameTag:string|null;
  growth:CharacterGrowthPlan; parameters:EquipmentParameterContext;
  equipment:EquipmentCharacter;
};
export type CurrentJobCatalog = {kind:'source-equivalent-current-jobs-v1';contexts:CurrentJobContext[]};
export type JobCommand = {kind:'release'|'unrelease';jobId:number}|{kind:'switch';ownedId:number;jobId:number};
function positive(v:number){if(!Number.isSafeInteger(v)||v<1||v>0x7fffffff)throw Error('Invalid current job identity');return v;}
/** Receipts contain semantic ability IDs, not source Learning row IDs. */
export function equivalentJobGrowth(plan:CharacterGrowthPlan):unknown {
  const {jobId:_,learning,...rest}=plan;
  return {...rest,learning:learning.map(({id:__,...row})=>row)};
}
export function validateCurrentJobCatalog(catalog:CurrentJobCatalog,base:{
  templates:Record<string,OwnedCharacterInitializationTemplate>;growth:Record<string,CharacterGrowthPlan>;
  equipment:EquipmentCatalog;parameters:Record<string,EquipmentParameterContext>;partyActors?:PartyActorCatalog;
}):void {
  checkpointKeys(catalog,'kind,contexts');
  if(catalog.kind!=='source-equivalent-current-jobs-v1'||!Array.isArray(catalog.contexts))throw Error('Unknown current job catalog');
  const seen=new Set<string>();
  for(const c of catalog.contexts){checkpointKeys(c,'sourceId,initialJobId,jobId,nameKey,nameTag,growth,parameters,equipment');
    [c.sourceId,c.initialJobId,c.jobId].forEach(positive);
    if(!Array.isArray(c.growth.learning)||new Set(c.growth.learning.map(r=>r.id)).size!==c.growth.learning.length)throw Error('Invalid current job learning identity');
    c.growth.learning.forEach(r=>positive(r.id));
    const key=c.sourceId+'/'+c.jobId;if(seen.has(key)||c.initialJobId===c.jobId)throw Error('Duplicate or initial current job context');seen.add(key);
    const entries=Object.entries(base.templates).filter(([,t])=>t.initial.sourceId===c.sourceId);
    if(entries.length!==1)throw Error('Missing actual current job source template');
    const [id,t]=entries[0]!,plan=base.growth[id];
    if(t.initial.jobId!==c.initialJobId||!plan||plan.jobId!==c.initialJobId||c.growth.jobId!==c.jobId||
      c.nameKey!==t.nameKey||c.nameTag!==t.nameTag||
      canonical(equivalentJobGrowth(plan))!==canonical(equivalentJobGrowth(c.growth))||
      canonical(c.parameters)!==canonical(base.parameters[id])||canonical(c.parameters)!==canonical(t.parameterContext)||
      canonical({...c.equipment,jobId:c.initialJobId})!==canonical(base.equipment.characters[c.sourceId])||
      canonical({...c.equipment,jobId:c.initialJobId})!==canonical(t.equipmentCharacter)||c.equipment.jobId!==c.jobId)
      throw Error('Non-equivalent current job context');
    for(const item of Object.values(base.equipment.definitions))
      if(item.jobIds.includes(c.initialJobId)!==item.jobIds.includes(c.jobId))throw Error('Changed current job equipment eligibility');
    if(base.partyActors&&canonical(partyMemberFieldAsset(base.partyActors,{sourceId:c.sourceId,jobId:c.initialJobId}))!==
      canonical(partyMemberFieldAsset(base.partyActors,{sourceId:c.sourceId,jobId:c.jobId})))throw Error('Changed current job party asset');
  }
}
export function currentJobContext(catalog:CurrentJobCatalog|undefined,sourceId:number,initialJobId:number,jobId:number):CurrentJobContext|null {
  if(jobId===initialJobId)return null;
  const found=catalog?.contexts.filter(c=>c.sourceId===sourceId&&c.initialJobId===initialJobId&&c.jobId===jobId);
  if(found?.length!==1)throw Error('Unresolved source current job context');
  return found[0]!;
}
/** AddReleaseJob and RemoveReleaseJob share the existing persistent arrays. */
export function setReleasedJob<T extends RosterMember>(state:{roster:T[];releasedJobIds:number[]},jobIds:readonly number[],jobId:number,released:boolean):void {
  if(!jobIds.includes(positive(jobId)))throw Error('Unknown source job master');
  if(released){if(!state.releasedJobIds.includes(jobId))state.releasedJobIds.push(jobId);
    for(const owner of state.roster)if(!owner.ownedJobs.some(j=>j.id===jobId))owner.ownedJobs.push({id:jobId,level:1,proficiency:0});
  }else state.releasedJobIds=state.releasedJobIds.filter(id=>id!==jobId);
}
export function projectCurrentJob<T extends RosterMember>(state:{roster:T[];releasedJobIds:number[]},jobIds:readonly number[],command:JobCommand,
  admit:(member:T,jobId:number)=>void):void {
  const keys=command.kind==='switch'?'kind,ownedId,jobId':'kind,jobId';checkpointKeys(command,keys);
  if(!jobIds.includes(positive(command.jobId)))throw Error('Unknown source job master');
  if(command.kind==='release'||command.kind==='unrelease'){setReleasedJob(state,jobIds,command.jobId,command.kind==='release');return;}
  if(command.kind!=='switch')throw Error('Unknown source job command');
  positive(command.ownedId);
  // Native SwitchJob validates master then returns before actual-owner lookup.
  if(!state.releasedJobIds.includes(command.jobId))return;
  const owners=state.roster.filter(m=>m.ownedId===command.ownedId);
  if(owners.length!==1)throw Error('Missing actual owned job target');
  const member=owners[0]!;admit(member,command.jobId);
  if(!member.ownedJobs.some(j=>j.id===command.jobId))throw Error('Current job was not personally released');
  member.jobId=command.jobId;
  // FF6 inherits empty ChangeParameter and NameReplace slots. No reset/grant.
}
