import { GameSession, type GameSessionRuntime } from "../../src/core/game-session.js";
import { compileFrameworkNewGame } from "../../src/compiler/framework-new-game.js";
import { WEB_RETAINED_WORLD_TRANSPORTATION } from "../../src/core/world-transportation-entry.js";
import type { Op, Site } from "../../src/field/types.js";
import { worldLoopSessionFixture } from "./world-loop-session.js";
import { sealBatchContent } from "./content-batch.js";
type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;

/** Authored mechanism lane. The synthetic source-style initializer declares
 * both transportation identities and their owned catalogs before launch.
 * Parking/boarding use actual shared source-command APIs before any map entry. */
export async function worldTransportSessionFixture(options: { armor?: boolean; policy?: boolean; initializationFailure?: boolean; nonperiodic?: boolean } = {}) {
  const f=await worldLoopSessionFixture({initializationFailure:options.initializationFailure??false}),
    map=structuredClone(f.map),worldMap=structuredClone(f.worldMap),world=structuredClone(f.world),battle=structuredClone(f.battle);
  const sourceBattle=structuredClone(f.sourceBattle),sourceEntry=structuredClone(f.sourceEntry);
  sourceBattle.gameState.sourceNewGame!.transportation.definitions.push({id:6,type:12,assetId:38,releaseFlag:905});
  sourceBattle.gameState.fieldConditions!.transportations.push({id:6,type:12});
  battle.gameState=structuredClone(sourceBattle.gameState);
  world.transportation=structuredClone(sourceBattle.gameState.sourceNewGame!.transportation);
  const sealedSourceBattle=sealBatchContent(sourceBattle);
  sourceEntry.battleCatalogHash=sealedSourceBattle.contentHash;
  const sealedSourceEntry=sealBatchContent(sourceEntry);
  const source={file:"tests/fixtures/world-transport-session.ts",assetPath:"authored/shared-retained-transport"};
  const ops=(script:string,values:Instruction<Op>[]):Op[]=>values.map((value,index)=>({...value,script,index,source}) as Op);
  const profile={...world.developmentProfile!,transportation:"walking-magitek-framework-v1" as const};
  world.developmentProfile=structuredClone(profile); map.developmentProfile=structuredClone(profile);worldMap.developmentProfile=structuredClone(profile);
  for(const character of Object.values(world.characters)) {
    for(const direction of ["B","L","R"]) character.animations["Ride"+direction]=structuredClone(character.animations["Walk"+direction]!);
  }
  for(const [id,character] of Object.entries(world.characters)) world.nativeAnimationKeys!.assets[id]!.keys=Object.keys(character.animations);
  if(options.nonperiodic){worldMap.partyEntry!.loopType=0;worldMap.entryView!.loopType=0;
    worldMap.cameraHost!.loop={horizontal:false,vertical:false}; delete worldMap.map!.topology;}
  const declaration=structuredClone(map.scriptPuppetContexts!["authored-initialize"]!);
  const install=(target:typeof map,name:string,values:Instruction<Op>[])=>{
    target.scripts[name]=ops(name,values); (target.scriptPuppetContexts??={})[name]=structuredClone(declaration);
    (target.scriptSystemFlags??={})[name]={keepBadStatusVisual:false};
  };
  install(map,"board",[
    {kind:"field-transportation",command:{kind:"place",transportationId:6,stayMapId:700003,
      position:{x:17,y:23},layer:{kind:"unity",value:9},direction:4}},
    {kind:"field-transportation",command:{kind:"change",transportationId:6,changeCollisionEnable:true,isBackground:false,viewType:0}},
    {kind:"exit"},
  ]);
  install(worldMap,"world-fight",[{kind:"encounter",party:f.encounterId,continuation:"world-after-fight"},{kind:"exit"}]);
  install(worldMap,"world-after-fight",[{kind:"calc",left:{category:"MapLocalVariable",index:2},operator:"＋",right:{kind:"immediate",value:1}},{kind:"exit"}]);
  const sealedMap=sealBatchContent(map),sealedWorldMap=sealBatchContent(worldMap);
  for(const value of [sealedMap,sealedWorldMap])world.maps[value.mapId]!.contentHash=value.contentHash;
  const sealedWorld=sealBatchContent(world),sealedBattle=sealBatchContent(battle);
  const content=await compileFrameworkNewGame({sourceEntry:sealedSourceEntry,sourceBattle:sealedSourceBattle,sourceMap:f.sourceMap,
    world:sealedWorld,map:sealedMap,battle:sealedBattle,entrance:sealedMap.partyEntry!.pointIns[0]!.id});
  const runtime:GameSessionRuntime={battleHandoff:"prepared",transportationTimestamp:()=>"638000000000000001",
    ...(options.policy===false?{}:{retainedWorldTransportation:WEB_RETAINED_WORLD_TRANSPORTATION})};
  const make=()=>GameSession.prepareFrameworkNewGame(content,sealedWorld,sealedMap,sealedBattle,runtime);
  return {...f,sourceEntry:sealedSourceEntry,sourceBattle:sealedSourceBattle,content,map:sealedMap,worldMap:sealedWorldMap,world:sealedWorld,battle:sealedBattle,runtime,make,armor:options.armor??true,
    maps:[sealedMap,sealedWorldMap],restore:(saved:Parameters<typeof GameSession.restore>[0],withPolicy=true)=>GameSession.restore(saved,undefined,sealedBattle,
      {catalog:sealedWorld,map:saved.world.location?.mapId===sealedWorldMap.mapId?sealedWorldMap:sealedMap,
        initialized:{content,initialMap:sealedMap}},withPolicy?runtime:{battleHandoff:"prepared"})};
}
