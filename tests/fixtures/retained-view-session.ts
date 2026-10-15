import { worldTransportSessionFixture } from './world-transport-session.js';
import { compileFrameworkNewGame } from '../../src/compiler/framework-new-game.js';
import { decodeFieldOp } from '../../src/compiler/field.js';
import { GameSession, type GameSessionRuntime } from '../../src/core/game-session.js';
import { GameFlow } from '../../src/core/game-flow.js';
import { WEB_FLAT_RETAINED_FIELD_VIEW_CHANGE } from '../../src/core/field-view-change.js';
import { sealBatchContent } from './content-batch.js';
import type { Op } from '../../src/field/types.js';

export const retainedViewHost={visible:true,mediaReady:true,overlayOpen:false};
/** Authored mechanism fixture. Original game reachability is checked separately;
 * boarding and both view commands still execute through their shared VM APIs. */
export async function retainedViewFixture(options:{armor?:boolean;nonperiodic?:boolean;runtime?:GameSessionRuntime}={}){
  const f=await worldTransportSessionFixture(options),maps=[structuredClone(f.map),structuredClone(f.worldMap)],
    source={file:'tests/fixtures/retained-view-session.ts',assetPath:'authored/retained-ground-view'};
  for(const map of maps)for(const [name,request]of [['view-bird',1],['view-normal',0]] as const){
    const context=structuredClone(Object.values(map.scriptPuppetContexts!)[0]!);
    const command=decodeFieldOp({type:1,mnemonic:'ChangeView',operands:{iValues:[request,...Array(7).fill(0)],rValues:Array(8).fill(0),sValues:Array(8).fill('')}},
      {script:name,index:0,source},{});
    map.scripts[name]=[command,{kind:'exit',script:name,index:1,source}] as Op[];
    map.scriptPuppetContexts![name]=context;
    if(map.scriptLocals)map.scriptLocals[name]=null;
    (map.scriptSystemFlags??={})[name]={keepBadStatusVisual:false};
  }
  const [map,worldMap]=maps.map(sealBatchContent),world=structuredClone(f.world);
  for(const row of [map!,worldMap!])world.maps[row.mapId]!.contentHash=row.contentHash;
  const catalog=sealBatchContent(world),content=await compileFrameworkNewGame({sourceEntry:f.sourceEntry,sourceBattle:f.sourceBattle,
    sourceMap:f.sourceMap,world:catalog,map:map!,battle:f.battle,entrance:map!.partyEntry!.pointIns[0]!.id}),
    runtime:GameSessionRuntime={...f.runtime,viewChange:WEB_FLAT_RETAINED_FIELD_VIEW_CHANGE,...options.runtime};
  const restore=(saved:Parameters<typeof GameSession.restore>[0],ports:GameSessionRuntime=runtime)=>GameSession.restore(saved,undefined,f.battle,
    {catalog,map:saved.world.location?.mapId===worldMap!.mapId?worldMap!:map!,initialized:{content,initialMap:map!}},ports);
  const game=await GameSession.prepareFrameworkNewGame(content,catalog,map!,f.battle,runtime),flow=new GameFlow(game);
  flow.start(game);flow.observeHost(retainedViewHost);flow.advance(10,retainedViewHost);
  if(f.armor){if(!game.field.startEvent('board'))throw new Error('Authored boarding did not start');flow.advance(10,retainedViewHost);}
  return {...f,map:map!,worldMap:worldMap!,world:catalog,content,runtime,game,flow,restore};
}
export function enterRetainedViewWorld(h:Awaited<ReturnType<typeof retainedViewFixture>>){
  if(!h.game.field.startEvent('go-world'))throw new Error('Authored world entry did not start');h.flow.advance(10,retainedViewHost);
  const candidate=h.game.world.prepare(h.world,h.worldMap);
  if(!h.game.world.commit(candidate))throw new Error('Authored world entry did not commit');h.flow.advance(10,retainedViewHost);
}
