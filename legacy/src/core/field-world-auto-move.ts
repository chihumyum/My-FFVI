import type {FieldContent,Point,Direction} from '../field/types.js';
import {checkpointKeys,checkpointInteger} from './checkpoint-validation.js';
import type {FieldActorMotion} from './field-script-motion.js';
export const WEB_FLAT_WORLD_AUTO_MOVE='web-flat-world-auto-move-v1' as const;
export type WebFlatWorldAutoMove=typeof WEB_FLAT_WORLD_AUTO_MOVE;
export type WorldAutoMoveCommand={kind:'add-movement';seconds:number;axis:Point;speedId:number};
export type FieldWorldAutoMoveOp={kind:'field-world-auto-move';command:WorldAutoMoveCommand};
export function validateWorldAutoMovePolicy(raw:unknown):asserts raw is WebFlatWorldAutoMove|undefined{
 if(raw!==undefined&&raw!==WEB_FLAT_WORLD_AUTO_MOVE)throw Error('Unknown Web world auto-movement policy');
}
const f=Math.fround;
function number(n:number){if(typeof n!=='number'||!Number.isFinite(n)||f(n)!==n)throw Error('Invalid world auto-movement float32');return n;}
export function parseWorldAutoMoveCommand(raw:WorldAutoMoveCommand):WorldAutoMoveCommand{
 checkpointKeys(raw,'kind,seconds,axis,speedId');checkpointKeys(raw.axis,'x,y');
 if(raw.kind!=='add-movement')throw Error('Expected world auto movement');checkpointInteger(raw.speedId,0,8);
 return {kind:raw.kind,seconds:number(raw.seconds),axis:{x:number(raw.axis.x),y:number(raw.axis.y)},speedId:raw.speedId};
}
export function assertWorldAutoMoveContent(content:FieldContent,policy:WebFlatWorldAutoMove|undefined):void{
 validateWorldAutoMovePolicy(policy);
 if(policy!==WEB_FLAT_WORLD_AUTO_MOVE||content.developmentProfile?.worldAutoMove!==policy||content.developmentProfile.worldAutoTasks!=='web-flat-world-auto-tasks-v1')
  throw Error('World auto movement requires both current runtime and trusted content policies');
}
/** Exact current content identity used by both the runtime and versioned
 * profile derivation. A saved position never supplies this binding. */
export function worldAutoMoveBinding(content:FieldContent,policy:WebFlatWorldAutoMove|undefined){
 assertWorldAutoMoveContent(content,policy);const mapId=content.map.identity?.mapId;
 if(!content.cameraHost||mapId===undefined||!/^[a-f0-9]{64}$/.test(content.contentHash))throw Error('World auto movement lacks current field/camera identity');
 checkpointInteger(mapId,1);return {policy:WEB_FLAT_WORLD_AUTO_MOVE,mapId,fieldContentHash:content.contentHash};
}
/** Source MoveTo uses one speed-table duration per request, not distance. Axis
 * length is preserved and only the original two-nonzero axis case adds sqrt2.
 * Flat Web magnification is explicitly 1; Unity player-state callbacks differ. */
export function prepareFlatWorldAutoSegment(command:WorldAutoMoveCommand,rotation:number,from:Point,range:{x:number;y:number;width:number;height:number},loop:{horizontal:boolean;vertical:boolean}):{motion:FieldActorMotion;direction:Direction}|null{
 const c=parseWorldAutoMoveCommand(command);number(rotation);number(from.x);number(from.y);
 if(c.axis.x===0&&c.axis.y===0)return null;
 const rad=(rotation%360)*Math.PI/180,cos=f(Math.cos(rad)),sin=f(Math.sin(rad));
 const dx=f(f(c.axis.x*cos)-f(c.axis.y*sin)),dy=f(f(c.axis.x*sin)+f(c.axis.y*cos));
 const to={x:f(from.x+dx),y:f(from.y-dy)};
 if(!loop.horizontal)to.x=f(Math.max(range.x,Math.min(range.x+range.width-1,to.x)));
 if(!loop.vertical)to.y=f(Math.max(range.y,Math.min(range.y+range.height-1,to.y)));
 number(to.x);number(to.y);if(to.x===from.x&&to.y===from.y)return null;
 const base=f([.24,.48,.12,.96,.06,1.92,.16,.096,.08][c.speedId]!);
 const duration=f(base*(c.axis.x!==0&&c.axis.y!==0?f(Math.SQRT2):1))*1000;
 if(!Number.isFinite(duration)||duration<=0)throw Error('Invalid world auto-movement duration');
 const direction:Direction=Math.abs(c.axis.x)>Math.abs(c.axis.y)?c.axis.x>0?'right':'left':c.axis.y>0?'up':'down';
 return {motion:{from:{...from},to,elapsed:0,duration,manual:false},direction};
}
