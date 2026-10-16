import {record} from './content.js';
import {tableId} from './table-id.js';
import {validateFieldVehicleAction,type FieldVehicleAction} from '../core/field-vehicle-action.js';
import type {FieldEntity} from '../field/types.js';
export function compileFieldVehicleAction(entity:FieldEntity,rawObject:Record<string,unknown>,properties:Record<string,unknown>,tables:Record<string,unknown>):FieldVehicleAction{
  const row=(table:string,id:unknown)=>{if(!Array.isArray(tables[table]))throw Error('Missing vehicle action table '+table);const found=(tables[table] as unknown[]).map(record).filter(r=>tableId(r.id)===tableId(id));if(found.length!==1)throw Error('Ambiguous vehicle action table '+table+':'+String(id));return structuredClone(found[0]!);};
  if(typeof properties.target_transportation_ids!=='string'||! /^[1-9]\d*(,[1-9]\d*)*$/.test(properties.target_transportation_ids))throw Error('Source vehicle target transportation list is unresolved');
  const d:FieldVehicleAction={kind:'source-transportation-event-action-v1',rawObject:structuredClone(rawObject),properties:structuredClone(properties),action:row('action.csv',properties.action_id),script:row('script.csv',properties.script_id),targets:properties.target_transportation_ids.split(',').map(id=>row('transportation.csv',id))};
  validateFieldVehicleAction({...entity,vehicleAction:d});return d;
}
