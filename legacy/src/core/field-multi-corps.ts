import {validatePartyState,type PartyState,type PartyRosterEntry,type PartySlotIndex} from './party.js';
import {fieldCameraCellToWorld,fieldCameraLayerFromLogical,type FieldCameraMapRange} from './field-camera.js';
import type {MapPartyEntryDefinition} from './map-party-entry.js';

export type MultiCorpsCommand = 'deploy-terra-defense'|'deploy-esper-defense'|'deploy-tower'|'deploy-phoenix'|'dream-separate'|'dream-rejoin-first'|'dream-rejoin-second';
export type MultiCorpsOp = {kind:'multi-corps';command:MultiCorpsCommand};
type Preset = {mapId:number;count:2|3;positions:readonly (readonly [number,number])[];cue:'Dying'|null};
// Wrapper constants are source parameters. They never dispatch by current map,
// script, skill or PC. The same placement owner consumes every preset.
const presets = {
 'deploy-esper-defense':{mapId:19,count:3,positions:[[18,9],[22,9]],cue:null},
 'deploy-terra-defense':{mapId:318,count:3,positions:[[12,13],[14,13]],cue:null},
 'deploy-tower':{mapId:542,count:3,positions:[[43,21],[56,22]],cue:null},
 'deploy-phoenix':{mapId:497,count:2,positions:[[12,6]],cue:'Dying'},
} as const satisfies Record<string,Preset>;
export function validateMultiCorpsCommand(command:unknown):asserts command is MultiCorpsCommand {
 if(typeof command!=='string'||!Object.hasOwn(presets,command)&&!['dream-separate','dream-rejoin-first','dream-rejoin-second'].includes(command))throw Error('Unknown source multi-Corps command');
}
export function multiCorpsPreset(command:MultiCorpsCommand):Preset|null {
 validateMultiCorpsCommand(command);return Object.hasOwn(presets,command)?structuredClone(presets[command as keyof typeof presets]):null;
}
/** Corps.CharacterId names an owned identity, while Corps.Id is Front1/Back2.
 * These wrappers pass both values through; they do not use ordinary authored
 * organization's source-master lookup or its constant front-row argument. */
export function projectMultiCorpsParty(current:PartyState,roster:readonly PartyRosterEntry[],command:MultiCorpsCommand):PartyState {
 validateMultiCorpsCommand(command);validatePartyState(current,roster);
 let next=structuredClone(current);
 if(multiCorpsPreset(command))return next;
 const original=structuredClone(current.slots[current.selectedSlot]);
 const set=(slot:PartySlotIndex,index:number,cell:PartyState['slots'][0][0]|null)=>{
  if(cell===null)next.slots[slot][index]!.id=null;
  else{if(!roster.some(r=>r.id===cell.id))throw Error('Source Corps.CharacterId has no existing owned character');
   next.slots[slot][index]={...cell};}
 };
 if(command==='dream-separate') {
  let selected=0;
  for(let index=0;index<original.length;index++) {
   set(1,index,null);set(2,index,null);
   const id=original[index]!.id;
   if(id!==null&&selected<2){selected++;set(selected as 1|2,index,original[index]!);set(current.selectedSlot,index,null);}
  }
 } else {
  const slot=command==='dream-rejoin-first'?1:2,index=current.slots[slot].findIndex(cell=>cell.id!==null);
  if(index>=0){const destination=original[index]!.id===null?index:original.findIndex(cell=>cell.id===null);
   if(destination>=0)set(current.selectedSlot,destination,current.slots[slot][index]!);
   // Native clears the source even when the current Corps has no free cell.
   set(slot,index,null);
  }
 }
 validatePartyState(next,roster);return next;
}
export function multiCorpsPlacement(command:MultiCorpsCommand,definition:MapPartyEntryDefinition|undefined,map:FieldCameraMapRange) {
 const preset=multiCorpsPreset(command);if(!preset)throw Error('Dream command is not a placement preset');
 if(!definition||definition.kind!=='map-party-entry'||definition.formatVersion!==1||definition.width!==map.width||definition.height!==map.height)
  throw Error('Source multi-Corps PointIn layer provider is unavailable');
 const points=definition.pointIns.filter(p=>p.id===1);
 if(points.length!==1||points[0]!.linkObject!==0)throw Error('Source multi-Corps PointIn(1) is missing, linked or ambiguous');
 const point=points[0]!,{layer,layerZ}=fieldCameraLayerFromLogical(point.layer);
 if(!point.source?.file||!point.source.assetPath)throw Error('Unbound source multi-Corps PointIn');
 const positions=preset.positions.map(([x,y],index)=>({slot:index+1 as 1|2,position:fieldCameraCellToWorld(map,{x,y},point.layer),layer,direction:'down' as const}));
 return {preset,positions:[...positions,{slot:0 as const,position:{x:0,y:-1000,z:layerZ},layer,direction:null}]};
}
