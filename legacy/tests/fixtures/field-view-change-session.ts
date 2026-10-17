import { worldLoopSessionFixture } from './world-loop-session.js';
import { sealBatchContent } from './content-batch.js';
import { compileFrameworkNewGame } from '../../src/compiler/framework-new-game.js';
import { decodeFieldOp } from '../../src/compiler/field.js';
import { GameSession } from '../../src/core/game-session.js';
import { GameFlow } from '../../src/core/game-flow.js';
import { WEB_FLAT_FIELD_VIEW_CHANGE } from '../../src/core/field-view-change.js';
import type { Op,Site } from '../../src/field/types.js';

export const viewHost={visible:true,mediaReady:true,overlayOpen:false};
export const viewReached={category:'MapLocalVariable' as const,index:4};
export async function fieldViewChangeFixture() {
  const f=await worldLoopSessionFixture(),maps=[structuredClone(f.map),structuredClone(f.worldMap)],source={file:'tests/fixtures/field-view-change-session.ts',assetPath:'controlled/view-change'};
  const command=(request:0|1,rate=0):Op=>decodeFieldOp({type:1,mnemonic:'ChangeView',operands:{iValues:[request,...Array(7).fill(0)],rValues:[rate,...Array(7).fill(0)],sValues:Array(8).fill('')}},{script:'decode-view',index:0,source},{});
  for(const map of maps){
    for(const name of ['stone-battle','after-stone-battle']) {
      map.scripts[name]=structuredClone(f.map.scripts[name]!);
      map.scriptPuppetContexts![name]=structuredClone(f.map.scriptPuppetContexts![name]!);
      if(map.scriptLocals)map.scriptLocals[name]=null;
    }

    const context=structuredClone(Object.values(map.scriptPuppetContexts!)[0]!);
    for(const [name,request,rate]of [['view-bird',1,0],['view-normal',0,0],['view-slow',1,.016],['view-async',1,-.016]] as const){
      const values=[command(request,rate),{kind:'calc',left:viewReached,operator:'＋',right:{kind:'immediate',value:1}},{kind:'exit'}];
      map.scripts[name]=values.map((op,index)=>({...op,script:name,index,source})) as Op[];
      map.scriptPuppetContexts![name]={...context,scriptHash: String(request+1).repeat(64)};
      if(map.scriptLocals)map.scriptLocals[name]=null;
    }
  }
  const [map,worldMap]=maps.map(sealBatchContent),world=structuredClone(f.world);
  for(const m of [map!,worldMap!])world.maps[m.mapId]!.contentHash=m.contentHash;
  const catalog=sealBatchContent(world),content=await compileFrameworkNewGame({sourceEntry:f.sourceEntry,sourceBattle:f.sourceBattle,sourceMap:f.sourceMap,world:catalog,map:map!,battle:f.battle,entrance:map!.partyEntry!.pointIns[0]!.id});
  const runtime={viewChange:WEB_FLAT_FIELD_VIEW_CHANGE,battleHandoff:'prepared' as const};
  const make=async()=>{const game=await GameSession.prepareFrameworkNewGame(content,catalog,map!,f.battle,runtime),flow=new GameFlow(game);flow.start(game);flow.observeHost(viewHost);flow.advance(10,viewHost);return{game,flow};};
  return {...f,map:map!,worldMap:worldMap!,world:catalog,content,runtime,make};
}
export async function enterViewWorld(f:Awaited<ReturnType<typeof fieldViewChangeFixture>>,game:GameSession,flow:GameFlow){
  if(!flow.move('right'))throw new Error('Controlled world entry direction failed');flow.advance(240,viewHost);
  const candidate=game.world.prepare(f.world,f.worldMap);if(!game.world.commit(candidate))throw new Error('Controlled world entry commit failed');flow.advance(10,viewHost);
}
