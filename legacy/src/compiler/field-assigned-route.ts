import { record } from './content.js';
import type { FieldAssignedRouteOp } from '../core/field-assigned-route.js';
import { int32 } from '../core/event-state.js';
function data(raw:unknown):Record<string,unknown>{const v=record(raw);if(![Object.prototype,null].includes(Object.getPrototypeOf(v))||Reflect.ownKeys(v).some(k=>typeof k!=='string')||Object.values(Object.getOwnPropertyDescriptors(v)).some(d=>!d.enumerable||!('value'in d)))throw Error('Assigned route requires plain operand data');return v;}
function dense(raw:unknown):unknown[]{if(!Array.isArray(raw)||Object.getPrototypeOf(raw)!==Array.prototype||raw.length!==8||Reflect.ownKeys(raw).length!==9)throw Error('Invalid assigned route operand arrays');return Array.from({length:8},(_,i)=>{const d=Object.getOwnPropertyDescriptor(raw,String(i));if(!d||!d.enumerable||!('value'in d))throw Error('Assigned route requires dense operand data');return d.value;});}
/** Exact External input domain; catalog/active target/controller admission are
 * separate. Puppet Route has a different path-search and wait protocol. */
export function compileFieldAssignedRouteInstruction(raw:unknown):FieldAssignedRouteOp{
 const v=data(raw),o=data(v.operands);
 if(Object.keys(o).sort().join(',')!=='iValues,rValues,sValues')throw Error('Unsupported assigned route operand fields');
 if(v.mnemonic!=='AssignMoveRoute'||v.type!==1)throw Error('Expected External AssignMoveRoute');
 const i=dense(o.iValues).map(int32),r=dense(o.rValues),strings=dense(o.sValues);
 if(i[0]!<=0||i[1]!<=0||![0,1].includes(i[2]!)||i.slice(3).some(n=>n!==0)||r.some(n=>n!==0)||strings.some(n=>n!==''))throw Error('Unsupported assigned route selector/loop/reserved operands');
 return {kind:'assign-npc-route',entityId:i[0]!,routeId:i[1]!,loop:i[2]===1};
}
