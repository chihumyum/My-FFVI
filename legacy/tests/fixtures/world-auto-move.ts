import {worldAutoSessionFixture,worldAutoRaw} from './world-auto-tasks.js';
import {sealBatchContent} from './content-batch.js';
import {compileFrameworkNewGame} from '../../src/compiler/framework-new-game.js';
import {decodeFieldOp} from '../../src/compiler/field.js';
import {GameSession,type GameSessionRuntime} from '../../src/core/game-session.js';
import {WEB_FLAT_WORLD_AUTO_MOVE} from '../../src/core/field-world-auto-move.js';
import type {Op,Site} from '../../src/field/types.js';
type Instruction<T=Op>=T extends Site?Omit<T,keyof Site>:never;
export async function worldAutoMoveFixture(options:{policy?:boolean;declared?:boolean;entryMove?:boolean;lateFailure?:boolean}={}){
 const f=await worldAutoSessionFixture(),map=structuredClone(f.map),target=structuredClone(f.worldMap),world=structuredClone(f.world);
 for(const value of [map,target,world])if(options.declared!==false)value.developmentProfile!.worldAutoMove=WEB_FLAT_WORLD_AUTO_MOVE;
 const source={file:'authored-auto-move.bundle',assetPath:'authored/auto-move',objectId:'9007199254740995'},context=structuredClone(map.scriptPuppetContexts!['auto']!);
 const install=(m:typeof map,name:string,values:(Instruction|ReturnType<typeof worldAutoRaw>)[])=>{
  m.scripts[name]=values.map((op,index)=>'type'in op?decodeFieldOp(op,{script:name,index,source},{}):({...op,script:name,index,source}as Op));
  m.scriptPuppetContexts![name]=structuredClone(context);m.scriptSystemFlags![name]={keepBadStatusVisual:false};m.scriptLocals![name]={labels:[],values:[]};m.scriptTransitionMetadata![name]={customAnimations:'none'};
 };
 for(const m of [map,target]){
  install(m,'auto-move',[worldAutoRaw('AddAirShipMoveTask',[0],[.05,1,0]),worldAutoRaw('StartAirShipAutoManipulate'),{kind:'exit'}]);
  install(m,'auto-move-zero',[worldAutoRaw('AddAirShipMoveTask',[0],[0,1,0]),worldAutoRaw('AddAirShipMoveTask',[4],[-1,1,1]),worldAutoRaw('StartAirShipAutoManipulate'),{kind:'exit'}]);
  install(m,'auto-move-dummy-reset',[{kind:'field-camera',command:{target:'dummy'}},worldAutoRaw('AddAirShipMoveTask',[3],[.03,0,1]),worldAutoRaw('StartAirShipAutoManipulate'),{kind:'wait',seconds:.05},{kind:'exit'}]);
  install(m,'auto-move-long',[worldAutoRaw('AddAirShipMoveTask',[0],[.4,1,0]),worldAutoRaw('StartAirShipAutoManipulate'),{kind:'exit'}]);
  install(m,'auto-move-dummy',[{kind:'field-camera',command:{target:'dummy'}},worldAutoRaw('AddAirShipMoveTask',[3],[.03,0,1]),worldAutoRaw('StartAirShipAutoManipulate'),{kind:'wait',seconds:1.2},{kind:'exit'}]);
  install(m,'auto-move-combined',[{kind:'field-camera',command:{target:'player'}},worldAutoRaw('AddAirShipMoveTask',[0],[.4,1,0]),worldAutoRaw('StartAirShipAutoManipulate'),{kind:'wait',seconds:.03},worldAutoRaw('AddAirShipMoveTask',[0],[.05,0,1]),worldAutoRaw('StartAirShipAutoManipulate'),{kind:'exit'}]);
  m.scriptPuppetContexts!['auto-move-combined']!.skipInitialize=true;
  install(m,'auto-move-add',[worldAutoRaw('AddAirShipMoveTask',[0],[.05,0,1]),{kind:'exit'}]);
  install(m,'auto-move-battle',[worldAutoRaw('AddAirShipMoveTask',[0],[.05,1,0]),worldAutoRaw('StartAirShipAutoManipulate'),{kind:'encounter',party:f.encounterId,continuation:'auto-return'},{kind:'exit'}]);
 }
 const mapRequest=map.scripts['go-world']![0]!;if(mapRequest.kind!=='change-map')throw Error('Missing authored map request');
 install(map,'auto-move-map',[{kind:'field-camera',command:{target:'player'}},worldAutoRaw('AddAirShipMoveTask',[0],[.4,1,0]),worldAutoRaw('StartAirShipAutoManipulate'),{kind:'wait',seconds:.03},{kind:'change-map',request:structuredClone(mapRequest.request)}]);
 map.scriptPuppetContexts!['auto-move-map']!.skipInitialize=true;
 if(options.entryMove){const name=target.initializer!,original=target.scripts[name]!;
  install(target,name,[{kind:'puppet',slot:0,actor:'0',target:0},{kind:'exec-puppets',asynchronous:true},worldAutoRaw('AddAirShipMoveTask',[0],[.05,1,0]),worldAutoRaw('StartAirShipAutoManipulate'),...original.map(({script,index,source,...op})=>op),
   ...(options.lateFailure?[{kind:'blocked' as const,mnemonic:'AuthoredMoveLateFailure',reason:'Authored failure after movement enqueue'}]:[])]);
  if(options.lateFailure)target.scripts[name]!.splice(target.scripts[name]!.findIndex(op=>op.kind==='exit'),1);
  const body=target.scripts[name]!;if(body[0]!.kind!=='puppet')throw Error('Expected authored puppet');body[0]!.target=body.length;body.push({kind:'nop',script:name,index:body.length,source},{kind:'exit',script:name,index:body.length+1,source});
 }
 const sealedMap=sealBatchContent(map),sealedTarget=sealBatchContent(target);for(const m of [sealedMap,sealedTarget])world.maps[m.mapId]!.contentHash=m.contentHash;
 const catalog=sealBatchContent(world),content=await compileFrameworkNewGame({sourceEntry:f.sourceEntry,sourceBattle:f.sourceBattle,sourceMap:f.sourceMap,world:catalog,map:sealedMap,battle:f.battle,entrance:sealedMap.partyEntry!.pointIns[0]!.id});
 const runtime:GameSessionRuntime={...f.runtime,...(options.policy===false?{}:{worldAutoMove:WEB_FLAT_WORLD_AUTO_MOVE})};
 return {...f,map:sealedMap,worldMap:sealedTarget,world:catalog,content,runtime,make:()=>GameSession.prepareFrameworkNewGame(content,catalog,sealedMap,f.battle,runtime),
  restore:(saved:Parameters<typeof GameSession.restore>[0],ports=runtime)=>GameSession.restore(saved,undefined,f.battle,{catalog,map:saved.world.location?.mapId===sealedTarget.mapId?sealedTarget:sealedMap,initialized:{content,initialMap:sealedMap}},ports)};
}
/** Explicit authored collision-free precondition through the actual Field port;
 * not an original script assertion or an owned story flag mutation. */
export function prepareFlatAutoMovement(field:GameSession['field']){const port=field.options.puppetActors;if(!port)throw Error('No native collision owner');port.prepareCollision(false)();}
