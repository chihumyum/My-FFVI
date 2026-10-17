import { canonical } from './canonical.js';
import { checkpointInteger,checkpointKeys } from './checkpoint-validation.js';
import { compileAssignedRouteProgram,createAssignedRouteCursor,settleAssignedRouteCursor,WEB_ASSIGNED_ROUTE_POLICY,type AssignedRouteCursor,type AssignedRouteProgram } from './field-assigned-route.js';
import { parseFieldNpcRouteCatalog,type FieldNpcRouteCatalog } from './field-npc-route.js';
import type { FieldScriptLerpProgress } from './field-script-motion.js';
import type { FieldNativeAssignedMotionBinding } from './field-native-checkpoint.js';
import type { FieldContent } from '../field/types.js';
export type AssignedRouteSavedRow={actorId:string;group:string;routeId:number;script:string;index:number;assignment:Extract<FieldContent['scripts'][string][number],{kind:'assign-npc-route'}>;
 cursor:AssignedRouteCursor;lerp:FieldScriptLerpProgress|null;moving:boolean};
export type AssignedRoutesCheckpoint={kind:'assigned-npc-routes-checkpoint-v1';policy:typeof WEB_ASSIGNED_ROUTE_POLICY;
 catalogHash:string;mapId:number;routes:AssignedRouteSavedRow[]};
export type RestoredAssignedRoute={row:AssignedRouteSavedRow;program:AssignedRouteProgram;definition:NonNullable<FieldContent['map']['entities'][number]['nativeNpc']>;
 site:Extract<FieldContent['scripts'][string][number],{kind:'assign-npc-route'}>};
function plain(value:unknown):asserts value is Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Reflect.ownKeys(value).some(k=>typeof k!=='string')||Object.values(Object.getOwnPropertyDescriptors(value)).some(d=>!d.enumerable||!('value'in d)))throw Error('Invalid assigned route checkpoint data');}
function layerBefore(program:AssignedRouteProgram,cursor:AssignedRouteCursor,initial:number):number{
 let layer=initial;
 const apply=(end:number)=>{for(let i=0;i<end;i++){const a=program.instructions[i]!.action!;if(a.kind==='move-lerp')layer=a.layer;}};
 if(cursor.cycles>0)apply(program.instructions.length);apply(cursor.index);return layer;
}
/** Metadata is source-correlated before native motion is restored. No saved
 * row supplies a definition, policy, actor factory or initializer authority. */
export function restoreAssignedRoutes(raw:unknown,content:FieldContent,activeEntities:readonly FieldContent['map']['entities'][number][],time:number,
 policy:unknown):{rows:RestoredAssignedRoute[];motions:Record<string,FieldNativeAssignedMotionBinding>}{
 if(policy!==WEB_ASSIGNED_ROUTE_POLICY||!content.npcRoutes)throw Error('Assigned route restore requires explicit live Web policy');
 const catalog=parseFieldNpcRouteCatalog(content.npcRoutes);plain(raw);checkpointKeys(raw,'kind,policy,catalogHash,mapId,routes');
 if(raw.kind!=='assigned-npc-routes-checkpoint-v1'||raw.policy!==policy||raw.catalogHash!==catalog.contentHash||raw.mapId!==content.map.identity?.mapId||catalog.mapId!==raw.mapId||catalog.sourceSetHash!==content.sourceSetHash||catalog.parentSourceSetHash!==content.parentSourceSetHash||!Array.isArray(raw.routes)||Object.getPrototypeOf(raw.routes)!==Array.prototype||Reflect.ownKeys(raw.routes).length!==raw.routes.length+1)throw Error('Assigned route checkpoint source/catalog mismatch');
 const ids=new Set<string>(),rows:RestoredAssignedRoute[]=[],motions:Record<string,FieldNativeAssignedMotionBinding>={};
 for(let i=0;i<raw.routes.length;i++){
  const descriptor=Object.getOwnPropertyDescriptor(raw.routes,String(i));if(!descriptor||!('value'in descriptor))throw Error('Invalid assigned route checkpoint array');
  const r=descriptor.value;plain(r);checkpointKeys(r,'actorId,group,routeId,script,index,assignment,cursor,lerp,moving');
  if(typeof r.actorId!=='string'||typeof r.group!=='string'||typeof r.script!=='string'||ids.has(r.actorId)||typeof r.moving!=='boolean')throw Error('Invalid assigned route checkpoint actor binding');ids.add(r.actorId);
  checkpointInteger(r.routeId as number,1,0x7fffffff);checkpointInteger(r.index as number,0,0x7fffffff);
  // script/index address the live Web namespace/array, not the evidence Site.
  // Full typed source opcode equality retains original physical script/PC/refs.
  plain(r.assignment);
  const site=content.scripts[r.script]?.[r.index as number],entities=activeEntities.filter(e=>e.id===r.actorId),definition=entities.length===1?entities[0]!.nativeNpc:undefined;
  if(!definition||definition.controller!=='wait'||definition.group!==r.group||site?.kind!=='assign-npc-route'||site.entityId!==definition.sourceEntityId||site.routeId!==r.routeId||canonical(site)!==canonical(r.assignment))throw Error('Assigned route checkpoint no longer matches its original source op/active Wait actor');
  const route=catalog.routes[String(r.routeId)];if(!route)throw Error('Missing saved source assigned route');const program=compileAssignedRouteProgram(route);createAssignedRouteCursor(program);
  plain(r.cursor);const cursor=r.cursor as unknown as AssignedRouteCursor;settleAssignedRouteCursor(program,cursor,false,site.loop);
  if(cursor.completed||!site.loop&&cursor.cycles!==0)throw Error('Saved assigned route is already complete or has impossible loop history');
  const action=program.instructions[cursor.index]!.action!,beforeLayer=layerBefore(program,cursor,definition.geometry.layer);
  if(r.moving){if(action.kind!=='move-to'||cursor.phase!=='update'||action.layer!==beforeLayer)throw Error('Saved assigned motion is not a current source MoveTo');
   motions[r.actorId]={kind:'assigned-npc-route-grid-v1',definitionHash:catalog.contentHash,commandId:cursor.index+1,
    secondsPerCell:[.24,.48,.12,.96,.06,1.92,.16][action.speedId]!,logicalLayer:beforeLayer,preserveDirection:action.animation!==''};}
  if(action.kind==='move-lerp'&&cursor.phase==='update'){
   plain(r.lerp);checkpointKeys(r.lerp,'start,startedAt,startLayer,targetLayer,movingLayer');plain(r.lerp.start);checkpointKeys(r.lerp.start,'x,y');
   const p=r.lerp as unknown as FieldScriptLerpProgress;
   if(![p.start.x,p.start.y,p.startedAt].every(v=>typeof v==='number'&&Number.isFinite(Math.fround(v)))||p.startedAt<0||p.startedAt>time/1000||time/1000-p.startedAt>=action.duration||p.startLayer!==beforeLayer+9||p.targetLayer!==action.layer+9||p.movingLayer!==Math.max(p.startLayer,p.targetLayer)||r.moving)throw Error('Invalid saved source assigned Lerp progress');
  }else if(r.lerp!==null)throw Error('Saved assigned route cannot invent Lerp registers');
  rows.push({row:structuredClone(r) as unknown as AssignedRouteSavedRow,program,definition,site});
 }
 return {rows,motions};
}
export function captureAssignedRoutes(catalog:FieldNpcRouteCatalog,rows:AssignedRouteSavedRow[]):AssignedRoutesCheckpoint{
 return {kind:'assigned-npc-routes-checkpoint-v1',policy:WEB_ASSIGNED_ROUTE_POLICY,catalogHash:catalog.contentHash,mapId:catalog.mapId,routes:structuredClone(rows)};
}
