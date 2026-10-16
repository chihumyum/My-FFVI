import { checkpointInteger, checkpointKeys } from './checkpoint-validation.js';
import { type OwnedTransportation, validateOwnedTransportations } from './transportation-state.js';
import { Transportations, type TransportationCatalog } from './transportation.js';
import type { DevelopmentProfile } from './development-profile.js';
import { fieldCameraWorldToCell, type FieldCameraMapRange } from './field-camera.js';

export const WEB_SOURCE_TRANSPORT_PARKING_UPLOAD='web-source-transport-parking-upload-v1' as const;
export type WebSourceTransportParkingUpload=typeof WEB_SOURCE_TRANSPORT_PARKING_UPLOAD;
export type TransportationParkingObservation={id:number;info:null|{stayMapId:number;pose:null|{position:{x:number;y:number;z:number};direction:number}}};
export type TransportationParkingUpload={before:OwnedTransportation[];after:OwnedTransportation[]};
export type FieldTransportationParkingTransaction=TransportationParkingUpload & {validate():void;commit():void;commitWith(publish:()=>void):void};
export function fieldTransportationParkingBinding(content:{developmentProfile?:DevelopmentProfile},runtime:unknown):WebSourceTransportParkingUpload|undefined{
 const declared=content.developmentProfile?.transportationParkingUpload;
 if(runtime!==undefined&&runtime!==WEB_SOURCE_TRANSPORT_PARKING_UPLOAD)throw Error('Unknown transportation parking upload runtime');
 if(declared===undefined)return undefined;
 if(declared!==WEB_SOURCE_TRANSPORT_PARKING_UPLOAD||runtime!==declared||content.developmentProfile?.vehicleLifecycle!=='web-source-vehicle-lifecycle-v1'||
    content.developmentProfile.transportation!=='walking-magitek-framework-v1')throw Error('Transportation parking upload requires its exact content/runtime and vehicle owners');
 return declared;
}
/** Source b29480 tests signs independently; diagonals are bit combinations. */
export function transportationDirectionMask(x:number,y:number):number{
 if(!Number.isFinite(x)||!Number.isFinite(y))throw Error('Unknown actual transportation direction');
 return(y>0?1:0)|(x>0?2:0)|(y<0?4:0)|(x<0?8:0);
}
/** Source slot4 copies native floored cell XY, then restores actual world Z.
 * No decompiler integer reinterpretation, modulo, map-range-origin or sentinel. */
export function transportationStoredPosition(map:FieldCameraMapRange,position:{x:number;y:number;z:number}){
 checkpointKeys(position,'x,y,z');for(const n of Object.values(position))if(typeof n!=="number"||!Number.isFinite(n)||Math.fround(n)!==n)throw Error('Unknown actual transportation position');
 const cell=fieldCameraWorldToCell(map,{x:position.x,y:position.y});for(const n of Object.values(cell))checkpointInteger(n,-0x80000000,0x7fffffff);
 return{x:Math.fround(cell.x),y:Math.fround(cell.y),z:position.z};
}
/** Complete typed observations, never a save-provided registry or permission.
 * Prepare every row before publication: an invalid second pose changes none. */
export function projectTransportationParkingUpload(catalog:TransportationCatalog,records:readonly OwnedTransportation[],observations:readonly TransportationParkingObservation[]):TransportationParkingUpload{
 const ids=catalog.definitions.map(r=>r.id);new Transportations(catalog);validateOwnedTransportations(records,ids);
 if(!Array.isArray(observations)||observations.length!==ids.length||observations.some((r,i)=>r?.id!==ids[i]))throw Error('Incomplete or reordered actual transportation registry');
 const before=structuredClone(records) as OwnedTransportation[],after=structuredClone(before);
 for(const [i,row]of observations.entries()){
  checkpointKeys(row,'id,info');if(row.info===null)continue;checkpointKeys(row.info,'stayMapId,pose');checkpointInteger(row.info.stayMapId,-0x80000000,0x7fffffff);
  const next=after[i]!;next.mapId=row.info.stayMapId;if(row.info.pose===null)continue;
  checkpointKeys(row.info.pose,'position,direction');checkpointKeys(row.info.pose.position,'x,y,z');
  for(const n of Object.values(row.info.pose.position))if(typeof n!=="number"||!Number.isFinite(n)||Math.fround(n)!==n)throw Error('Invalid actual transportation stored coordinate');
  checkpointInteger(row.info.pose.direction,0,15);next.position={...row.info.pose.position};next.direction=row.info.pose.direction;
 }
 validateOwnedTransportations(after,ids);return{before,after};
}
