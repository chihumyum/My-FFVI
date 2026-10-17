import { worldAutoMoveFixture } from './world-auto-move.js';
import { compileFrameworkNewGame } from '../../src/compiler/framework-new-game.js';
import { decodeFieldOp } from '../../src/compiler/field.js';
import { GameSession } from '../../src/core/game-session.js';
import { GameFlow } from '../../src/core/game-flow.js';
import { WEB_FLAT_RETAINED_FIELD_VIEW_CHANGE } from '../../src/core/field-view-change.js';
import { sealBatchContent } from './content-batch.js';
import type { Op, Site } from '../../src/field/types.js';
type Instruction<T=Op> = T extends Site ? Omit<T,keyof Site> : never;
export const setposHost={visible:true,mediaReady:true,overlayOpen:false};
export const setposSource={file:'tests/fixtures/setpos-owner.ts',assetPath:'authored/setpos-owner'};
export function setposRaw(mode=1,reference=-1001,x=1,y=-1,layer=0,animation='') {
 return {type:2,mnemonic:'SetPos',operands:{iValues:[x,y,layer,mode,reference,0,0,0],rValues:Array(8).fill(0),sValues:[animation,...Array(7).fill('')]}};
}
export function setposOp(raw= setposRaw()):Op {return decodeFieldOp(raw,{script:'authored-setpos',index:0,source:setposSource},{});}
/** Original operands can be passed by the source checker; this envelope and its
 * initializer are authored protocol tests, never complete source execution. */
export async function setposOwnerFixture(options:{raw?:ReturnType<typeof setposRaw>;actor?:string;entryPosition?:boolean;lateFailure?:boolean}={}) {
 const f=await worldAutoMoveFixture(),map=structuredClone(f.map),target=structuredClone(f.worldMap),world=structuredClone(f.world),actor=options.actor??'0';
 const install=(m:typeof map,name:string,values:Instruction[])=>{
  m.scripts[name]=values.map((v,index)=>({...v,script:name,index,source:setposSource} as Op));
  m.scriptPuppetContexts![name]={...structuredClone(m.scriptPuppetContexts!.auto!),scriptHash:'b'.repeat(64)};
  m.scriptLocals![name]=null;m.scriptSystemFlags![name]={keepBadStatusVisual:false};m.scriptTransitionMetadata![name]={customAnimations:'none'};
 };
 for(const m of [map,target]) {
  install(m,'setpos',[{kind:'puppet',slot:0,actor,target:4},{kind:'exec-puppets',asynchronous:false},{kind:'finish-puppets'},{kind:'exit'},
   {kind:'wait',seconds:.02},setposOp(options.raw),{kind:'wait',seconds:.02},{kind:'exit'}]);
 }
 if(options.entryPosition){const original=target.scripts[target.initializer!]!.map(({script,index,source,...op})=>op),body:Instruction[]=[
  {kind:'puppet',slot:0,actor:'0',target:original.length+3+(options.lateFailure?1:0)},
  {kind:'exec-puppets',asynchronous:false},{kind:'finish-puppets'},
  ...(options.lateFailure?[{kind:'blocked' as const,mnemonic:'AuthoredAfterSetPosFailure',reason:'Authored failure after private SetPos'}]:[]),
  ...original,{kind:'nop'},setposOp(options.raw),{kind:'exit'}];
  install(target,target.initializer!,options.lateFailure?[setposOp(options.raw),{kind:'blocked',mnemonic:'AuthoredAfterSetPosFailure',reason:'Authored failure after private SetPos'},...original]:body);
 }
 const sealedMap=sealBatchContent(map),sealedTarget=sealBatchContent(target);for(const m of [sealedMap,sealedTarget])world.maps[m.mapId]!.contentHash=m.contentHash;
 const catalog=sealBatchContent(world),content=await compileFrameworkNewGame({sourceEntry:f.sourceEntry,sourceBattle:f.sourceBattle,sourceMap:f.sourceMap,world:catalog,map:sealedMap,battle:f.battle,entrance:sealedMap.partyEntry!.pointIns[0]!.id}),
 runtime={...f.runtime,viewChange:WEB_FLAT_RETAINED_FIELD_VIEW_CHANGE};
 const make=async()=>{const game=await GameSession.prepareFrameworkNewGame(content,catalog,sealedMap,f.battle,runtime),flow=new GameFlow(game);flow.start();flow.advance(10,setposHost);return{game,flow};};
 const restore=(saved:Parameters<typeof GameSession.restore>[0])=>GameSession.restore(saved,undefined,f.battle,{catalog,map:saved.world.location?.mapId===sealedTarget.mapId?sealedTarget:sealedMap,initialized:{content,initialMap:sealedMap}},runtime);
 return {...f,map:sealedMap,worldMap:sealedTarget,world:catalog,content,runtime,make,restore};
}
