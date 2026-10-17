import { checkpointInteger, checkpointKeys } from './checkpoint-validation.js';
import { categories, validVariable, type VariableRef } from './event-state.js';
import { parseFieldNpcRouteRawInstruction, type FieldNpcRouteDefinition, type FieldNpcRouteSource } from './field-npc-route.js';
import type { Point } from '../field/types.js';

/** Deliberate Web controller: fixed 10ms, bounded four-neighbour collision grid,
 * flat registered Wait NPCs. It is not native MapRouteSearcher/raycast parity. */
export const WEB_ASSIGNED_ROUTE_POLICY = 'web-assigned-npc-route-grid-v1' as const;
export type WebAssignedRoutePolicy = typeof WEB_ASSIGNED_ROUTE_POLICY;
export type FieldAssignedRouteOp = { kind: 'assign-npc-route'; entityId: number; routeId: number; loop: boolean };
export type AssignedRouteAction =
 | { kind:'move-to'; x:number; y:number; layer:number; speedId:number; animation:string }
 | { kind:'move-lerp'; x:number; y:number; layer:number; duration:number; jumpHeight:number; animation:string }
 | { kind:'delay'; seconds:number }
 | { kind:'play-animation'; animation:string; speed:number; loops:number; delay:number }
 | { kind:'cue-animation'; animation:string; frame:number }
 | { kind:'show'|'hide'; duration:number; delay:number }
 | { kind:'play-se'; soundId:number; fade:number; seek:number; pan:number }
 | { kind:'set-variable'|'compare-variable'; ref:VariableRef; value:number };
export type AssignedRouteProgram = { routeId:number; source:FieldNpcRouteSource;
 instructions:{index:number; source:FieldNpcRouteSource; raw:ReturnType<typeof parseFieldNpcRouteRawInstruction>;
 action:AssignedRouteAction|null; blockers:string[]}[] };
const f=Math.fround;
/** Keep absent JSON fields in raw; the consumed numeric defaults are the zeroed
 * RouteMoveInstructionData fields, never defaults for a missing route/entity. */
export function compileAssignedRouteProgram(route:FieldNpcRouteDefinition):AssignedRouteProgram {
 return {routeId:route.id,source:structuredClone(route.source),instructions:route.instructions.map(i=>{
  const raw=parseFieldNpcRouteRawInstruction(i.raw), n=(key:keyof typeof raw)=>{
   const v=raw[key]??0;if(typeof v!=='number'||!Number.isFinite(f(v)))throw Error('Invalid route numeric '+key);return ['speed_id','cellx','celly','layer','loop_cnt','se_id','category','index','value'].includes(key)?v:f(v);
  }, text=()=>{const v=raw.animation_key??'';if(typeof v!=='string')throw Error('Invalid route animation');return v;};
  let action:AssignedRouteAction|null=null;const blockers:string[]=[];
  try{switch(raw.instruction_type){
   case 1: action={kind:'move-to',x:n('cellx'),y:n('celly'),layer:n('layer'),speedId:n('speed_id'),animation:text()};
    checkpointInteger(action.layer,0,2);checkpointInteger(action.speedId,0,6);break;
   case 2:action={kind:'delay',seconds:n('delay_sec')};break;
   case 3:action={kind:'play-animation',animation:text(),speed:n('speed_scale'),loops:n('loop_cnt'),delay:n('delay_sec')};
    if(action.speed<=0)throw Error('Assigned route animation requires positive playback scale');break;
   case 4:action={kind:'cue-animation',animation:text(),frame:n('frame')};break;
   case 5:case 6:action={kind:raw.instruction_type===5?'show':'hide',duration:n('duration'),delay:n('delay_sec')};
    if(action.duration<0)throw Error('Negative assigned route fade is outside Web policy');break;
   case 7:action={kind:'move-lerp',x:n('cellx'),y:n('celly'),layer:n('layer'),duration:n('duration'),jumpHeight:n('jump_height'),animation:text()};
    checkpointInteger(action.layer,0,2);if(action.duration<=0)throw Error('Assigned route Lerp requires positive duration');
    if(action.jumpHeight!==0)throw Error('Assigned route arc requires source animation-offset owner');break;
   case 8:action={kind:'play-se',soundId:n('se_id'),fade:n('duration'),seek:n('seek_time'),pan:n('position')};
    checkpointInteger(action.soundId,1,0x7fffffff);if(action.fade<0||action.seek<0||Math.abs(action.pan)>1)throw Error('Unsupported assigned route sound parameters');break;
   case 9:case 10:{const category=categories[n('category')];const ref={category:category!,index:n('index')};
    if(!category||!validVariable(ref))throw Error('Unsupported assigned route DataStorage reference');
    action={kind:raw.instruction_type===9?'set-variable':'compare-variable',ref,value:n('value')};break;}
   default:throw Error('Unknown assigned route instruction type '+raw.instruction_type);
  }}catch(e){blockers.push(e instanceof Error?e.message:String(e));action=null;}
  return {index:i.index,source:structuredClone(i.source),raw,action,blockers};
 })};
}
export type AssignedRouteCursor={kind:'assigned-npc-route-cursor-v1';index:number;phase:'execute'|'update';elapsed:number;loops:number;cycles:number;completed:boolean};
export function createAssignedRouteCursor(program:AssignedRouteProgram):AssignedRouteCursor{
 if(!program.instructions.length)throw Error('Empty assigned route cannot create a controller');
 const bad=program.instructions.find(i=>!i.action||i.blockers.length);if(bad)throw Error('Assigned route '+program.routeId+' instruction '+bad.index+': '+bad.blockers.join(';'));
 return {kind:'assigned-npc-route-cursor-v1',index:0,phase:'execute',elapsed:0,loops:0,cycles:0,completed:false};
}
/** One phase per update. Completing Execute cannot also execute Update or the
 * next instruction. Compare's Execute is true; only Update polls DataStorage. */
export function settleAssignedRouteCursor(program:AssignedRouteProgram,cursor:AssignedRouteCursor,complete:boolean,loop:boolean):AssignedRouteCursor{
 checkpointKeys(cursor,'kind,index,phase,elapsed,loops,cycles,completed');checkpointInteger(cursor.index,0,program.instructions.length-1);
 if(cursor.kind!=='assigned-npc-route-cursor-v1'||!['execute','update'].includes(cursor.phase)||!Number.isFinite(cursor.elapsed)||cursor.elapsed<0||!Number.isInteger(cursor.loops)||cursor.loops<0||!Number.isSafeInteger(cursor.cycles)||cursor.cycles<0||typeof cursor.completed!=='boolean')throw Error('Invalid assigned route cursor');
 const next={...cursor};if(cursor.completed||!complete)return next;
 if(cursor.phase==='execute'){next.phase='update';return next;}
 if(cursor.index+1===program.instructions.length&&!loop){next.completed=true;return next;}
 if(cursor.index+1===program.instructions.length)next.cycles++;
 next.index=(cursor.index+1)%program.instructions.length;next.phase='execute';next.elapsed=0;next.loops=0;return next;
}
/** Explicit Web BFS, same source collision masks supplied by FieldGame. No
 * teleport, diagonal shortcut, wrapping, guessed layer or absent-cell fallback.
 * null means currently no path and permits a later controller retry. */
export function searchAssignedRouteGrid(from:Point,to:Point,range:Point&{width:number;height:number},canStep:(from:Point,to:Point)=>boolean):Point[]|null{
 for(const p of [from,to])if(!Number.isInteger(p.x)||!Number.isInteger(p.y))throw Error('Assigned route needs settled integer cells');
 if(![range.x,range.y,range.width,range.height].every(Number.isInteger)||range.width<=0||range.height<=0||range.width*range.height>1048576)throw Error('Unsupported assigned route grid range');
 const inside=(p:Point)=>p.x>=range.x&&p.y>=range.y&&p.x<range.x+range.width&&p.y<range.y+range.height;
 if(!inside(from)||!inside(to))throw Error('Assigned route target outside supported map range');
 if(from.x===to.x&&from.y===to.y)return [];
 const key=(p:Point)=>p.x+','+p.y,queue=[{...from}],parents=new Map<string,Point|null>([[key(from),null]]);
 for(let head=0;head<queue.length;head++){
  const p=queue[head]!;
  for(const d of [{x:0,y:-1},{x:1,y:0},{x:0,y:1},{x:-1,y:0}]){
   const q={x:p.x+d.x,y:p.y+d.y};if(!inside(q)||parents.has(key(q))||!canStep(p,q))continue;
   parents.set(key(q),p);if(q.x===to.x&&q.y===to.y){const path:Point[]=[q];let prev=parents.get(key(q));while(prev&&(prev.x!==from.x||prev.y!==from.y)){path.unshift(prev);prev=parents.get(key(prev));}return path;}
   queue.push(q);
  }
 }
 return null;
}

/** Conservative supercover for the Web direct Lerp. A diagonal corner must be
 * clear on both cardinal sides; a bent BFS path is never treated as a clear
 * straight segment. */
export function assignedRouteLineClear(from:Point,to:Point,canStep:(from:Point,to:Point)=>boolean):boolean{
 if(![from.x,from.y,to.x,to.y].every(Number.isInteger))throw Error('Assigned Lerp requires integer cell endpoints');
 const nx=Math.abs(to.x-from.x),ny=Math.abs(to.y-from.y),sx=Math.sign(to.x-from.x),sy=Math.sign(to.y-from.y);
 let x=from.x,y=from.y,ix=0,iy=0;
 while(ix<nx||iy<ny){const p={x,y},a=(1+2*ix)*ny,b=(1+2*iy)*nx;
  if(a===b){const h={x:x+sx,y},v={x,y:y+sy},q={x:x+sx,y:y+sy};if(!canStep(p,h)||!canStep(p,v)||!canStep(h,q)||!canStep(v,q))return false;x=q.x;y=q.y;ix++;iy++;}
  else if(a<b){const q={x:x+sx,y};if(!canStep(p,q))return false;x=q.x;ix++;}
  else{const q={x,y:y+sy};if(!canStep(p,q))return false;y=q.y;iy++;}
 }
 return true;
}
