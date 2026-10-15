import { frameworkNewGameFixture } from "./framework-new-game.js";
import { sealBatchContent } from "./content-batch.js";
import { compileFrameworkNewGame } from "../../src/compiler/framework-new-game.js";
import { GameSession } from "../../src/core/game-session.js";
import { GameFlow } from "../../src/core/game-flow.js";
import { GameContentRepository } from "../../src/core/game-content.js";
import type { FrontierHost } from "../../src/tools/reachable-frontiers.js";
import type { Op, Site, FieldEntity } from "../../src/field/types.js";
import type { WorldMapContent } from "../../src/field/world.js";
import { choiceDefinition } from "./field-choice.js";
import { battleMessageProgram, messageRaw } from "./battle-event-message.js";
import { WEB_BATTLE_EVENT_CONTROLS } from "../../src/core/battle-controls.js";
type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;

/** Three authored maps reached only by contact, choice, real battle, event
 * save and a talk input. All resources exist before the shared initializer. */
export async function reachableFrontierFixture(options: { forcedBattle?: boolean; standaloneTiming?: boolean } = {}) {
  const f = await frameworkNewGameFixture(), ids = [900001,900002,900003] as const;
  const source = { file:"tests/fixtures/reachable-frontiers.ts",assetPath:"authored-three-map-loop",objectId:"9223372036854775807" };
  const point = f.map.partyEntry!.pointIns[0]!, x=point.x,y=point.y;
  const ops=(name:string,commands:Instruction<Op>[]):Op[]=>commands.map((op,index)=>({...op,script:name,index,source}) as Op);
  const travel=(mapId:number):Instruction<Op>=>({kind:"change-map",request:{mapId,entrance:point.id,continuation:null,birdview:false,skipFade:true,skipBgm:true,origin:"script"}});
  const maps:WorldMapContent[]=ids.map((id,index)=>{
    const map=structuredClone(f.map);map.mapId=id;map.areaId=index+1;
    map.map!.identity={mapId:id,areaId:map.areaId};map.map!.entryContext!.mapId=id;map.partyEntry!.mapId=id;
    const layer=map.partyEntry!.pointIns[0]!.layer;
    map.map!.collisions[layer]=Array(map.map!.width*map.map!.height).fill(1);
    for(const cx of [x-1,x,x+1])map.map!.collisions[layer]![y*map.map!.width+cx]=0;
    map.map!.entities=map.map!.entities.filter(e=>e.kind===0);map.map!.groups!.entity_default!.entities=structuredClone(map.map!.entities);
    map.scripts={init:ops("init",[{kind:"exit"}])};map.initializer="init";
    map.scriptPuppetContexts={init:structuredClone(f.map.scriptPuppetContexts!["authored-initialize"]!)};
    map.scriptSystemFlags={init:{keepBadStatusVisual:false}};map.scriptLocals={};return map;
  });
  const install=(map:WorldMapContent,name:string,commands:Instruction<Op>[])=>{
    map.scripts[name]=ops(name,commands);map.scriptPuppetContexts![name]=structuredClone(map.scriptPuppetContexts!.init!);
    map.scriptSystemFlags![name]={keepBadStatusVisual:false};
  };
  const entity=(map:WorldMapContent,id:string,dx:number,script:string,kind=2):FieldEntity=>({
    ...structuredClone(map.map!.entities[0]!),id,objectId:100+dx,kind,x:x+dx,y,script,source,
  });
  const add=(map:WorldMapContent,e:FieldEntity)=>{map.map!.entities.push(e);map.map!.groups!.entity_default!.entities.push(structuredClone(e));};
  install(maps[0]!,"choice-gate",[choiceDefinition(),
    {kind:"branch",left:{category:"MessageSelection",index:0},operator:"＝",right:{kind:"immediate",value:0},target:4},
    {kind:"blocked",mnemonic:"ControlledFamilyGate",reason:"Authored shared choice capability frontier"},{kind:"exit"},travel(ids[1])]);
  add(maps[0]!,entity(maps[0]!,"choice-contact",1,"choice-gate"));
  const timing:Instruction<Op>[] = options.standaloneTiming ? [
    {kind:"calc",left:{category:"MapLocalVariable",index:7},operator:"←",right:{kind:"immediate",value:35}},
    {kind:"standalone-wait"}] : [];
  install(maps[1]!,"fight",[...timing,{kind:"encounter",party:f.encounterId,continuation:"after-fight"}]);
  install(maps[1]!,"after-fight",[...timing,{kind:"event-save"},...timing,travel(ids[2])]);
  add(maps[1]!,entity(maps[1]!,"battle-contact",1,"fight"));
  install(maps[2]!,"loop",[travel(ids[0])]);add(maps[2]!,entity(maps[2]!,"return-contact",-1,"loop"));
  install(maps[2]!,"talk",[{kind:"message",key:"AUDIT_TALK",speaker:"Guide",text:"A real nearby interaction."},
    {kind:"blocked",mnemonic:"ControlledFamilyGate",reason:"Authored shared interaction capability frontier"}]);
  const npc=entity(maps[2]!,"talk-object",1,"talk",5);npc.mapObject={collision:true,acceptDirection:15,talkMounts:[""],soundId:0,
    interaction:{kind:"script",script:"talk"}};add(maps[2]!,npc);
  const sealedMaps=maps.map(sealBatchContent),worldDraft=structuredClone(f.world),battleDraft=structuredClone(f.battle);
  worldDraft.transportation=structuredClone(f.battle.gameState.sourceNewGame!.transportation);
  worldDraft.maps=Object.fromEntries(sealedMaps.map(map=>[map.mapId,{url:"/authored/frontiers/"+map.mapId+".json",contentHash:map.contentHash,
    name:map.name,areaId:map.areaId,geometryReady:true,defaultGroupReady:true,blockers:[]}]));
  const qualification=battleDraft.common.battleEntry!.maps.find(m=>m.id===ids[0])!;
  for(const id of ids.slice(1))battleDraft.common.battleEntry!.maps.push({...structuredClone(qualification),id});
  if (options.forcedBattle) {
    battleDraft.encounters[f.encounterId]!.lifecycle = { kind: "battle-lifecycle-v1", mode: "script", scriptId: 9000,
      program: battleMessageProgram([messageRaw("BattleForceExit"), messageRaw("Wait", .1), messageRaw("Exit")]) };
    battleDraft.common.battleEvents = { conditions: battleDraft.common.conditions.rules.definitions.map(({ id, type }) =>
      ({ id, type, attackTarget: type === 5 ? 1 : 0, gameOverTarget: type === 5 ? 1 : 0 })) };
  }
  const world=sealBatchContent(worldDraft),battle=sealBatchContent(battleDraft);
  const content=await compileFrameworkNewGame({sourceEntry:f.sourceEntry,sourceBattle:f.sourceBattle,sourceMap:f.sourceMap,
    world,map:sealedMaps[0]!,battle,entrance:point.id});
  const runtime={battleHandoff:"prepared" as const, ...(options.forcedBattle ? {battleEventControls:WEB_BATTLE_EVENT_CONTROLS} : {})};
  const files=new Map<string,unknown>([["/framework/world/catalog.json",world],...sealedMaps.map(m=>[world.maps[m.mapId]!.url,m] as [string,unknown])]);
  const read=async(url:string)=>{if(!files.has(url))throw Error("Missing controlled dependency "+url);return structuredClone(files.get(url));};
  let creates=0,restores=0;const seenSessions:GameSession[]=[];
  const bundle=(game:GameSession)=>{const flow=new GameFlow(game);flow.start();flow.advance(0,{visible:true,mediaReady:true,overlayOpen:false});seenSessions.push(game);
    return{game,flow,contents:new GameContentRepository(read,"framework")};};
  const host:FrontierHost={origin:"authored-mechanism",create:async()=>{creates++;return bundle(await GameSession.prepareFrameworkNewGame(content,world,sealedMaps[0]!,battle,runtime));},
    restore:async(checkpoint)=>{restores++;const map=sealedMaps.find(m=>m.mapId===(checkpoint.world.location?.mapId??ids[0]))!;
      return bundle(GameSession.restore(checkpoint,undefined,battle,{catalog:world,map,initialized:{content,initialMap:sealedMaps[0]!}},runtime));}};
  return{host,ids,files,world,battle,content,maps:sealedMaps,seenSessions,counts:()=>({creates,restores})};
}
