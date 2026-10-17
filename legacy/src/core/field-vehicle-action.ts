import { canonical } from './canonical.js';
import { checkpointKeys, checkpointInteger } from './checkpoint-validation.js';
import type { FieldEntity } from '../field/types.js';
/** The source property/action/table binding. Web confirmation uses an explicit
 * same-cell observer. It does not supply native flight, landing or boarding. */
export type FieldVehicleAction = {
  kind:'source-transportation-event-action-v1';
  rawObject:Record<string,unknown>;
  properties:Record<string,unknown>;
  action:Record<string,unknown>;
  script:Record<string,unknown>;
  targets:Record<string,unknown>[];
};
const integer=(v:unknown,min=0)=>{if(typeof v!=='number')throw Error('Vehicle action integer is missing');checkpointInteger(v,min,0x7fffffff);return v;};
const tableInteger=(v:unknown,min=0)=>{if(typeof v!=='string'||! /^(0|[1-9]\d*)$/.test(v))throw Error('Vehicle action source table identity is invalid');return integer(Number(v),min);};
export function validateFieldVehicleAction(entity:FieldEntity):FieldVehicleAction {
  const d=entity.vehicleAction;if(!d)throw Error('Source transportation event action binding is unavailable');
  checkpointKeys(d,'action,kind,properties,rawObject,script,targets');
  if(d.kind!=='source-transportation-event-action-v1'||entity.kind!==21)throw Error('Unknown transportation event action kind');
  const p=d.properties,o=d.rawObject;
  checkpointKeys(p,'action_id,direction,entity_id,gimmick,interactive_icon_type,link_object_id,object_id,object_type,script_id,target_transportation_ids');
  checkpointKeys(o,'gid,height,id,name,properties,rotation,type,visible,width,x,y');
  if(p.object_type!==21||p.gimmick!==false||p.link_object_id!==0||p.object_id!==0||p.direction!==0||p.interactive_icon_type!==3||
    o.visible!==true||o.rotation!==0||o.type!==''||typeof o.name!=='string'||integer(o.gid,1)<1||integer(o.id,1)<1||
    o.width!==16||o.height!==16||![o.x,o.y].every(v=>typeof v==='number'&&Number.isInteger(v)&&v%16===0))throw Error('Transportation event action parameters or geometry are not implemented');
  if(entity.objectId!==0||entity.id!==String(integer(p.entity_id,1))||entity.width!==1||entity.height!==1||entity.x!==Number(o.x)/16||entity.y!==Number(o.y)/16-1||
    entity.asset!==null||entity.collision!==null||entity.destinationLayer!==null||entity.direction!=='down')throw Error('Transportation event action actual entity differs from source');
  if(!Array.isArray(o.properties)||o.properties.length!==Object.keys(p).length)throw Error('Transportation event action raw properties are incomplete');
  const rawProperties:Record<string,unknown>={};
  for(const raw of o.properties){if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid vehicle action raw property');
    checkpointKeys(raw,'name,type,value');const r=raw as Record<string,unknown>;if(typeof r.name!=='string'||Object.hasOwn(rawProperties,r.name)||
      r.type!==(typeof r.value==='boolean'?'bool':typeof r.value==='number'?'int':'string'))throw Error('Unknown vehicle action raw property type');rawProperties[r.name]=r.value;}
  if(canonical(rawProperties)!==canonical(p))throw Error('Vehicle action raw property binding changed');
  const actionId=integer(p.action_id,1),scriptId=integer(p.script_id,1);
  if(tableInteger(d.action.id,1)!==actionId||d.action.action_name!=='RunScript'||tableInteger(d.script.id,1)!==scriptId||
    typeof d.script.script_name!=='string'||d.script.script_name!==entity.script||!entity.script)throw Error('Source vehicle action/script table binding is unresolved');
  if(typeof p.target_transportation_ids!=='string'||! /^[1-9]\d*(,[1-9]\d*)*$/.test(p.target_transportation_ids))throw Error('Source vehicle action target transportation list is unresolved');
  const ids=p.target_transportation_ids.split(',').map(Number);if(new Set(ids).size!==ids.length||!Array.isArray(d.targets)||d.targets.length!==ids.length)throw Error('Source vehicle action target transportation bindings are incomplete');
  d.targets.forEach((r,i)=>{if(tableInteger(r.id,1)!==ids[i])throw Error('Source vehicle action target identity changed');tableInteger(r.type_id,1);});
  return d;
}
/** Exact blocker projection shared by the compiler and the source comparison.
 * Entity/raw/table values remain byte-for-byte equal in both profiles. */
export function fieldVehicleActionAdmitted(entity:FieldEntity):boolean{try{validateFieldVehicleAction(entity);return true;}catch{return false;}}
