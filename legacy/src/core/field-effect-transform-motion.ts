import {checkpointInteger,checkpointKeys} from './checkpoint-validation.js';
import {fieldCameraCellToWorld,fieldSetPositionToWorld,sourcePuppetLerpCoordinates,type FieldCameraMapRange} from './field-camera.js';
import type {FieldEffectPoint} from './field-effects.js';
import type {FieldNativePosition} from './field-native-position.js';
import type {FieldScriptLerp} from './field-script-motion.js';
const f=Math.fround,layers=[349,249,149,49];
export type FieldBoardLerpProgress={start:{x:number;y:number};startedAt:number;layer:9|10|11|12};
function point(p:FieldEffectPoint):void{checkpointKeys(p,'x,y,z');if(!Object.values(p).every(v=>Number.isFinite(v)&&Math.fround(v)===v))throw Error('Invalid actual board transform');}
/** The source board's generic Transform path. Layer changes/animation/callback
 * providers are independent and remain hard; this never invokes Sprite logic. */
export function projectFieldBoardSetPosition(position:FieldEffectPoint,command:FieldNativePosition,map:FieldCameraMapRange,reference?:FieldEffectPoint):FieldEffectPoint{
 point(position);checkpointKeys(command,command.mode===1?'mode,referenceEntityId,x,y,layer,animation':'x,y,layer,animation');
 checkpointInteger(command.x,-0x80000000,0x7fffffff);checkpointInteger(command.y,-0x80000000,0x7fffffff);
 if(command.layer!==0||command.animation!=='')throw Error('Board SetPos layer/animation callback provider is unavailable');
 if(!layers.includes(position.z))throw Error('Board SetPos conflicts with unfinished transform or unknown source layer');
 if(command.mode===1){checkpointInteger(command.referenceEntityId,-0x80000000,0x7fffffff);if(!reference)throw Error('Board SetPos actual reference transform is unavailable');point(reference);}
 else if(reference!==undefined)throw Error('Absolute board SetPos cannot borrow a reference');
 const next=fieldSetPositionToWorld(map,position,command,reference);point(next);return next;
}
export function projectFieldBoardLerp(position:FieldEffectPoint,command:FieldScriptLerp,map:FieldCameraMapRange,previous:FieldBoardLerpProgress|null,timeSeconds:number):{
 position:FieldEffectPoint;progress:FieldBoardLerpProgress;flow:'next'|'wait'}{
 point(position);checkpointKeys(command,'kind,x,y,layer,duration,arcHeight,animation');
 checkpointInteger(command.x,-0x80000000,0x7fffffff);checkpointInteger(command.y,-0x80000000,0x7fffffff);checkpointInteger(command.layer,0,3);
 if(command.kind!=='lerp'||command.animation!==''||!Number.isFinite(command.duration)||!Number.isFinite(f(command.duration))||!Number.isFinite(command.arcHeight)||!Number.isFinite(f(command.arcHeight))||command.duration<0||!Number.isFinite(timeSeconds)||!Number.isFinite(f(timeSeconds))||timeSeconds<0)throw Error('Board Lerp animation, duration or coordinate provider is unavailable');
 const time=f(timeSeconds),layer=previous?.layer??(layers.indexOf(position.z)+9),progress:FieldBoardLerpProgress=previous?structuredClone(previous):{start:{x:position.x,y:position.y},startedAt:time,layer:layer as FieldBoardLerpProgress['layer']};
 checkpointKeys(progress,'start,startedAt,layer');checkpointKeys(progress.start,'x,y');
 if(![9,10,11,12].includes(progress.layer)||!Object.values(progress.start).every(v=>Number.isFinite(v)&&f(v)===v)||!Number.isFinite(progress.startedAt)||f(progress.startedAt)!==progress.startedAt||progress.startedAt<0||time<progress.startedAt||
  command.layer!==0&&command.layer+8!==progress.layer)throw Error('Board Lerp layer transition or instruction registers are unavailable');
 if(position.z!==layers[progress.layer-9]&&(!previous||position.z!==layers[progress.layer-9]!-5))throw Error('Board Lerp lost its actual source layer');
 const ratio=command.duration===0?1:Math.min(1,(time-progress.startedAt)/command.duration),target=fieldCameraCellToWorld(map,{x:(command.x-map.x)|0,y:(command.y-map.y)|0},0),coordinates=sourcePuppetLerpCoordinates(progress.start,target,ratio,command.arcHeight),next={...coordinates,z:layers[progress.layer-9]!-(ratio===1?0:5)};
 point(next);return{position:next,progress,flow:ratio===1?'next':'wait'};
}
