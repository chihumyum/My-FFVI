import { birdViewActorsFixture, birdHost } from './bird-view-actors.js';
import { sealBatchContent } from './content-batch.js';
import { compileFrameworkNewGame } from '../../src/compiler/framework-new-game.js';
import { decodeFieldOp } from '../../src/compiler/field.js';
import { GameSession } from '../../src/core/game-session.js';
import { GameFlow } from '../../src/core/game-flow.js';
import { WEB_FLAT_MOB_COLOR_FILTER } from '../../src/core/field-mob-controls.js';
import type { Op } from '../../src/field/types.js';
export { birdHost as mobHost };
export function mobRaw(name: 'HideMob'|'RestoreMob', exemptions: number[]=[], duration=0) {
 return {type:1,mnemonic:name,operands:{iValues:[...exemptions,...Array(8-exemptions.length).fill(0)],rValues:[duration,...Array(7).fill(0)],sValues:Array(8).fill('')}};
}
export async function mobControlsFixture(options:{declared?:boolean;policy?:boolean}={}) {
 const f=await birdViewActorsFixture({contentPolicy:false}),maps=[structuredClone(f.map),structuredClone(f.worldMap)],source={file:'tests/fixtures/mob-controls.ts',assetPath:'authored/mob-controls'};
 for(const map of maps){if(options.declared!==false)map.developmentProfile!.mobColorFilter=WEB_FLAT_MOB_COLOR_FILTER;
  const context=structuredClone(Object.values(map.scriptPuppetContexts!)[0]!);
  const add=(name:string,raw:ReturnType<typeof mobRaw>)=>{
   const op=decodeFieldOp(raw,{script:name,index:0,source},{});if(op.kind!=='field-mob-control')throw new Error('Controlled Mob decode failed');
   map.scripts[name]=[op,{kind:'exit',script:name,index:1,source}] as Op[];
   map.scriptPuppetContexts![name]={...context,skipInitialize:true,keepPlayerPuppet:true,scriptHash:'c'.repeat(64)};
   (map.scriptLocals??={})[name]=null;(map.scriptSystemFlags??={})[name]={keepBadStatusVisual:false};
  };
  add('mob-hide',mobRaw('HideMob'));add('mob-restore',mobRaw('RestoreMob'));
  add('mob-darken',mobRaw('HideMob',[],.1));add('mob-lighten',mobRaw('RestoreMob',[],.1));
  add('mob-exempt',mobRaw('HideMob',[-1001]));add('mob-bad-selector',mobRaw('HideMob',[-100000]));
 }
 const [map,worldMap]=maps.map(sealBatchContent),world=structuredClone(f.world);if(options.declared!==false)world.developmentProfile!.mobColorFilter=WEB_FLAT_MOB_COLOR_FILTER;
 for(const m of [map!,worldMap!])world.maps[m.mapId]!.contentHash=m.contentHash;
 const catalog=sealBatchContent(world),content=await compileFrameworkNewGame({sourceEntry:f.sourceEntry,sourceBattle:f.sourceBattle,sourceMap:f.sourceMap,world:catalog,map:map!,battle:f.battle,entrance:map!.partyEntry!.pointIns[0]!.id});
 const runtime={...f.runtime,...(options.policy===false?{}:{mobColorFilter:WEB_FLAT_MOB_COLOR_FILTER})};
 const make=async()=>{const game=await GameSession.prepareFrameworkNewGame(content,catalog,map!,f.battle,runtime),flow=new GameFlow(game);flow.start(game);flow.observeHost(birdHost);flow.advance(10,birdHost);return {game,flow};};
 const restore=(saved:Parameters<typeof GameSession.restore>[0])=>GameSession.restore(saved,undefined,f.battle,{catalog,map:saved.world.location?.mapId===worldMap!.mapId?worldMap!:map!,initialized:{content,initialMap:map!}},runtime);
 return {...f,map:map!,worldMap:worldMap!,world:catalog,content,runtime,make,restore};
}
