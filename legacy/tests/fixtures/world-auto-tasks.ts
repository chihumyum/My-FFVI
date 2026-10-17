import { decodeFieldOp } from '../../src/compiler/field.js';
import { compileFrameworkNewGame } from '../../src/compiler/framework-new-game.js';
import { GameSession, type GameSessionRuntime } from '../../src/core/game-session.js';
import { WEB_FLAT_WORLD_AUTO_TASKS } from '../../src/core/field-world-auto-tasks.js';
import type { Op, Site } from '../../src/field/types.js';
import { worldLoopSessionFixture } from './world-loop-session.js';
import { sealBatchContent } from './content-batch.js';
export const worldAutoRaw=(mnemonic:string,ints:number[]=[],reals:number[]=[])=>({type:1,mnemonic,
  operands:{iValues:Array.from({length:8},(_,i)=>ints[i]??0),rValues:Array.from({length:8},(_,i)=>reals[i]??0),sValues:Array(8).fill('')as string[]}});
type Instruction<T=Op>=T extends Site?Omit<T,keyof Site>:never;
export async function worldAutoSessionFixture(options:{policy?:boolean;declared?:boolean;entryTasks?:boolean;lateFailure?:boolean}={}) {
  const f=await worldLoopSessionFixture(),map=structuredClone(f.map),target=structuredClone(f.worldMap),world=structuredClone(f.world);
  const profile={...world.developmentProfile!,...(options.declared===false?{}:{worldAutoTasks:WEB_FLAT_WORLD_AUTO_TASKS})};
  for(const value of [map,target,world])value.developmentProfile=structuredClone(profile);
  const declaration=structuredClone(map.scriptPuppetContexts!['authored-initialize']!),source={file:'authored-world-auto.bundle',assetPath:'authored/world-auto-tasks',objectId:'9007199254740993'};
  const install=(m:typeof map,name:string,values:(Instruction|ReturnType<typeof worldAutoRaw>)[])=>{
    m.scripts[name]=values.map((raw,index)=>'type'in raw?decodeFieldOp(raw,{script:name,index,source},{}):({...raw,script:name,index,source}as Op));
    (m.scriptPuppetContexts??={})[name]={...declaration,scriptHash:'a'.repeat(64)};
    (m.scriptSystemFlags??={})[name]={keepBadStatusVisual:false};(m.scriptLocals??={})[name]={labels:[],values:[]};
    (m.scriptTransitionMetadata??={})[name]={customAnimations:'none'};
  };
  for(const m of [map,target]){
    install(m,'auto',[worldAutoRaw('AddAirShipRotateChangeTask',[1],[.05,90,10]),worldAutoRaw('AddAirShipFlightAltitudeChangeTask',[1],[.05,1,0]),
      worldAutoRaw('AddAirshipUpDownMoveTask',[1],[.05,20,-10]),worldAutoRaw('StartAirShipAutoManipulate'),{kind:'exit'}]);
    install(m,'auto-add',[worldAutoRaw('AddAirShipRotateChangeTask',[],[.2,45]),{kind:'exit'}]);
    install(m,'auto-start',[worldAutoRaw('StartAirShipAutoManipulate'),{kind:'exit'}]);
    install(m,'auto-save-active',[worldAutoRaw('AddAirShipRotateChangeTask',[],[.2,45]),worldAutoRaw('StartAirShipAutoManipulate'),{kind:'event-save'},{kind:'exit'}]);
    install(m,'auto-fight',[{kind:'encounter',party:f.encounterId,continuation:'auto-return'},{kind:'exit'}]);
    install(m,'auto-return',[{kind:'exit'}]);
  }
  if(options.entryTasks){
    const original=target.scripts[target.initializer!]!;
    install(target,target.initializer!,[worldAutoRaw('AddAirshipUpDownMoveTask',[1],[.05,20,0]),worldAutoRaw('StartAirShipAutoManipulate'),
      ...original.map(({script,index,source,...op})=>op),
      ...(options.lateFailure?[{kind:'blocked' as const,mnemonic:'AuthoredAfterAutoTaskFailure',reason:'Authored initializer failed after queue preparation'}]:[])]);
    if(options.lateFailure){const body=target.scripts[target.initializer!]!;body.splice(body.findIndex(op=>op.kind==='exit'),1);}
  }
  const sealedMap=sealBatchContent(map),sealedTarget=sealBatchContent(target);
  for(const m of [sealedMap,sealedTarget])world.maps[m.mapId]!.contentHash=m.contentHash;
  const catalog=sealBatchContent(world),content=await compileFrameworkNewGame({sourceEntry:f.sourceEntry,sourceBattle:f.sourceBattle,sourceMap:f.sourceMap,
    world:catalog,map:sealedMap,battle:f.battle,entrance:sealedMap.partyEntry!.pointIns[0]!.id});
  const runtime:GameSessionRuntime={battleHandoff:'prepared',...(options.policy===false?{}:{worldAutoTasks:WEB_FLAT_WORLD_AUTO_TASKS})};
  return {...f,map:sealedMap,worldMap:sealedTarget,world:catalog,content,runtime,make:()=>GameSession.prepareFrameworkNewGame(content,catalog,sealedMap,f.battle,runtime),
    restore:(saved:Parameters<typeof GameSession.restore>[0],host:GameSessionRuntime=runtime)=>GameSession.restore(saved,undefined,f.battle,
      {catalog,map:saved.world.location?.mapId===sealedTarget.mapId?sealedTarget:sealedMap,initialized:{content,initialMap:sealedMap}},host)};
}
