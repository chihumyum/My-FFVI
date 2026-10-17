import {canonical}from './content.js';
import {fieldVehicleActionAdmitted}from '../core/field-vehicle-action.js';
import type{WorldMapContent}from '../field/world.js';
/** Strict source remains unchanged. Only the one known class-admission
 * diagnostic is projected under the explicit Web lifecycle declaration. */
export function projectFrameworkVehicleActions(source:WorldMapContent):WorldMapContent{
 const map=structuredClone(source),entities=Object.values(map.map?.groups??{}).flatMap(g=>g.entities),admitted=(b:WorldMapContent['blockers'][number])=>b.reason==='Unsupported entity kind 21'&&entities.some(e=>canonical(e.source)===canonical(b.source)&&fieldVehicleActionAdmitted(e));
 map.blockers=map.blockers.filter(b=>!admitted(b));if(map.map)for(const group of Object.values(map.map.groups??{}))group.blockers=group.blockers.filter(b=>!admitted(b));return map;
}
