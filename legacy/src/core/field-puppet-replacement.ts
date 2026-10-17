import { checkpointInteger, checkpointKeys } from './checkpoint-validation.js';
export type FieldPuppetReplacementCommand =
 | {kind:'reset'} | {kind:'slot';slot:1|2;selection:'all'|'leader'|'except-leader'}
 | {kind:'leaders'} | {kind:'battle-party'};
export type FieldPuppetReplacementOp={kind:'field-puppet-replacement';command:FieldPuppetReplacementCommand};
export type FieldPuppetReplacementRoster={selectedSlot:0|1|2;slots:number[][];owned:{ownedId:number;sourceId:number}[]};
export type FieldPuppetReplacementState={kind:'field-puppet-replacement-v1';sourceSetHash:string;parentSourceSetHash:string;miscHash:string;selectors:number[]};
export function validatePuppetReplacementRoster(r:FieldPuppetReplacementRoster):void{
 checkpointKeys(r,'selectedSlot,slots,owned');checkpointInteger(r.selectedSlot,0,2);
 if(!Array.isArray(r.slots)||r.slots.length!==3||!Array.isArray(r.owned))throw Error('Missing full three-by-four Puppet replacement Corps owner');
 const ids=new Set<number>();for(const o of r.owned){checkpointKeys(o,'ownedId,sourceId');checkpointInteger(o.ownedId,1,0x7fffffff);checkpointInteger(o.sourceId,1,0x7fffffff);if(ids.has(o.ownedId))throw Error('Duplicate Puppet replacement owned identity');ids.add(o.ownedId);}
 for(const cells of r.slots){if(!Array.isArray(cells)||cells.length!==4)throw Error('Puppet replacement requires all four source cells');const occupied=new Set<number>();for(const id of cells){checkpointInteger(id,0,0x7fffffff);if(id&&(!ids.has(id)||occupied.has(id)))throw Error('Unbound or repeated Puppet replacement Corps owner');if(id)occupied.add(id);}}
}
export function parsePuppetReplacementState(raw:FieldPuppetReplacementState,source:{sourceSetHash:string;parentSourceSetHash:string;miscHash:string}):FieldPuppetReplacementState{
 checkpointKeys(raw,'kind,sourceSetHash,parentSourceSetHash,miscHash,selectors');if(raw.kind!=='field-puppet-replacement-v1'||raw.sourceSetHash!==source.sourceSetHash||raw.parentSourceSetHash!==source.parentSourceSetHash||raw.miscHash!==source.miscHash||!/^[a-f0-9]{64}$/.test(raw.miscHash)||!Array.isArray(raw.selectors)||![1,2,4].includes(raw.selectors.length))throw Error('Unbound source Puppet replacement checkpoint');
 if(Reflect.ownKeys(raw.selectors).length!==raw.selectors.length+1||Array.from(raw.selectors).some(v=>v===undefined))throw Error('Sparse or extended Puppet replacement list');
 for(const selector of raw.selectors){checkpointInteger(selector,-0x80000000,0);if(selector!==0&&!(selector>=-999&&selector<=-1)&&!(raw.selectors.length===1&&[-1030,-1031,-1032].includes(selector)))throw Error('Unknown saved Puppet replacement selector domain');}
 return structuredClone(raw);
}
/** The source publishes an integer callback list. It does not mutate Corps,
 * roster enabled bits, resident actors or the current transport/party owner. */
export function projectPuppetReplacement(command:FieldPuppetReplacementCommand,previous:readonly number[]|null,r:FieldPuppetReplacementRoster,currentRtsSlot?:number):number[]|null{
 validatePuppetReplacementRoster(r);if(!command)throw Error('Missing Puppet replacement command');
 const convert=(id:number)=>id===0?0:-r.owned.find(o=>o.ownedId===id)!.sourceId;
 const cells=(slot:1|2)=>r.slots[slot]!.map(convert),leader=(slot:1|2)=>cells(slot).find(id=>id!==0)??0;
 switch(command.kind){
  case'reset':checkpointKeys(command,'kind');return null;
  case'slot':{checkpointKeys(command,'kind,slot,selection');if(![1,2].includes(command.slot)||!['all','leader','except-leader'].includes(command.selection))throw Error('Unknown Puppet replacement slot command');const first=leader(command.slot);return command.selection==='leader'?[first]:cells(command.slot).map(id=>command.selection==='except-leader'&&id===first?0:id);}
  case'leaders':checkpointKeys(command,'kind');return[leader(1),leader(2)];
  case'battle-party':checkpointKeys(command,'kind');if(currentRtsSlot===undefined)throw Error('Puppet battle-party requires known ScenarioVariable[4]');checkpointInteger(currentRtsSlot,-0x80000000,0x7fffffff);return currentRtsSlot===r.selectedSlot?(previous===null?null:[...previous]):[-1030-r.selectedSlot];
  default:throw Error('Unknown Puppet replacement command');
 }
}
