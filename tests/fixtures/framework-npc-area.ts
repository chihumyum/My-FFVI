import { fieldNpcSessionFixture } from "./field-npc-session.js";
import { GameSession, type GameCheckpoint, type GameSessionRuntime } from "../../src/core/game-session.js";
import { NewGameFieldEntry } from "../../src/core/new-game-field-entry.js";
import { compileFrameworkContent, type FrameworkContent } from "../../src/compiler/framework-content.js";
import { assessFrameworkNpcAreaWorld } from "../../src/compiler/framework-npc-area.js";
import { compileFieldMapAnimation } from "../../src/compiler/field-map-animation.js";
import { WEB_FIELD_MAP_ANIMATION, NATIVE_MAP_ANIMATION_HOST } from "../../src/core/field-map-animation.js";
import { fieldNpcRouteInstructionKind, type FieldNpcRouteCatalog, type FieldNpcRouteRawInstruction } from "../../src/core/field-npc-route.js";
import type { FieldEntity, Op } from "../../src/field/types.js";
import { fieldMoveToSessionFixture } from "./field-move-to-session.js";
import { hash } from "../../src/compiler/content.js";
import type { FrameworkNpcAreaTemplate } from "../../src/compiler/framework-npc-area.js";
function seal<T extends { contentHash: string }>(value: T): T {
  const { contentHash: _, ...body } = value; return { ...body, contentHash: hash(body) } as T;
}

/** Authored two-map source-style corpus before any live session. It keeps the
 * existing real initializer/actor metadata; no original story fact is claimed. */
export async function frameworkNpcAreaFixture(options: Parameters<typeof fieldNpcSessionFixture>[0] & { presentationFamilies?: boolean } = {}) {
  const { presentationFamilies, ...npcOptions } = options;
  const original = await fieldNpcSessionFixture(npcOptions), corpus = structuredClone(original.sourceCorpus),
    maps = Object.values(original.maps).map(raw => {
      const map = structuredClone(raw); delete map.developmentProfile; delete map.frameworkNpcActivity; return seal(map);
    }), catalog = structuredClone(original.world), { developmentProfile: _, ...entry } = structuredClone(original.content);
  delete catalog.developmentProfile;
  if (presentationFamilies) {
    const media = structuredClone(catalog.characters["controlled-npc"]!);
    media.animations.Default!.mode = 1; catalog.characters["controlled-area-animation"] = media;
    for (let i = 0; i < maps.length; i++) {
      const map = maps[i]!, group = map.map!.groups!.entity_default!, source = { ...group.source, pointer: "/layers/0/objects/9" },
        properties = { object_type: 10, entity_id: 750, asset_id: 188, direction: 15, action_id: 0, script_id: 0,
          birdview_puppet: false, affected: false, collision: false, front: false, split: false, building: false,
          play_on_awake: true, zoffset: 0, link_object_id: 0, flight_altitude_ratio: 1 },
        compiled = compileFieldMapAnimation({group:"entity_default", object:{x:160,y:160,width:16,height:16},
          entity:{id:"750",kind:10,layer:0,source},properties,tables:{"mapobject.csv":[{id:"188",asset_name:"controlled-area-animation"}]}});
      if (!compiled.definition || compiled.blockers.length) throw new Error("Controlled combined map animation did not compile");
      const entity: FieldEntity = {id:"750",objectId:750,kind:10,x:10,y:9,width:1,height:1,layer:0,direction:null,
        asset:"controlled-area-animation",script:null,collision:null,destinationLayer:null,source,
        mapAnimation:compiled.definition,mapAnimationBlockers:[]};
      group.entities.push(entity); map.map!.entities.push(structuredClone(entity)); map.characterAssets.push(entity.asset!);
      group.blockers.push({reason:NATIVE_MAP_ANIMATION_HOST,source});
      const routeSource = {...source,objectId:source.objectId!,serializedFile:"npc-session-assets",sha256:"a".repeat(64),
          assetPath:"controlled-global-area/routes.json",pointer:"/route_instruction/0"},
        raw: FieldNpcRouteRawInstruction[] = [{instruction_type:2,delay_sec:.05},
          {instruction_type:1,cellx:8,celly:5,layer:0,speed_id:0}],
        route = {id:1,alias:"route_instruction_1",source:routeSource,aliasSource:{...routeSource,pointer:"/map/0/route_instruction/0"},
          instructions:raw.map((raw,index)=>({index,kind:fieldNpcRouteInstructionKind(raw.instruction_type),raw,
            source:{...routeSource,pointer:"/instruction_list/"+index}}))},
        body = {kind:"field-npc-route-catalog-v1" as const,sourceSetHash:map.sourceSetHash,parentSourceSetHash:map.parentSourceSetHash,
          mapId:map.mapId,mapName:map.name,packageSource:routeSource,routes:{1:route},executionSupport:"none" as const,migrationReady:false as const};
      map.npcRoutes = {...body,contentHash:hash(body)} satisfies FieldNpcRouteCatalog;
      const name = "combined-families", programSource = {file:"tests/fixtures/framework-npc-area.ts",assetPath:"controlled-combination"};
      map.scripts[name] = [
        {kind:"field-shake",command:{kind:"play",axis:2,strength:1,intervalScale:0,reexecute:1}},
        {kind:"assign-npc-route",entityId:602,routeId:1,loop:false},{kind:"exit"},
      ].map((op,index)=>({...op,script:"physical-combined-body",index:index+99,source:programSource}) as Op);
      map.scriptLocals[name] = null; map.scriptPuppetContexts![name] = {...map.scriptPuppetContexts!.reserved!,scriptHash:"7".repeat(64)};
      (map.scriptSystemFlags??={})[name] = {keepBadStatusVisual:false};
      (map.scriptTransitionMetadata??={})[name] = {customAnimations:"none"};
      maps[i] = seal(map);
    }
  }
  for (const map of maps) catalog.maps[String(map.mapId)]!.contentHash = map.contentHash;
  Object.assign(catalog, seal(catalog)); entry.worldCatalogHash = catalog.contentHash;
  entry.mapContentHash = maps.find(map => map.mapId === entry.entry.mapId)!.contentHash;
  Object.assign(entry, seal(entry));
  const template: FrameworkNpcAreaTemplate = { kind: "framework-npc-area-template-v1", policy: "framework-npc-area-v1",
    missingFirstInterval: "source-ctor-true", random: "web-xorshift32-v1", collision: "actor-grid-reservations-v1",
    schedule: "fixed-step-source-order-v1", takeover: "pause-autonomous-motion-v1", reason: "Authored complete two-map Area production fixture" };
  // The launch/restore closures consume this newly assessed global derivative,
  // never the old per-recipe host retained in the input fixture.
  const assessments = assessFrameworkNpcAreaWorld(corpus, catalog, maps, template),
    derived = compileFrameworkContent(catalog, maps, entry, { npcAreaAssessments: assessments,
      ...(presentationFamilies ? {mapAnimatedEntities:WEB_FIELD_MAP_ANIMATION} : {}) }),
    dependencies = Object.fromEntries(derived.maps.map(map => [map.mapId, map])),
    ports = await fieldMoveToSessionFixture(), runtime = { battleHandoff: "prepared" as const };
  const make = (selected: FrameworkContent = derived, extraRuntime: GameSessionRuntime = {}) => {
    const selectedMaps = Object.fromEntries(selected.maps.map(map => [map.mapId, map]));
    const initializer = new NewGameFieldEntry(selected.entry.entry, ports.presentation),
      start = initializer.prepareStart(ports.fade, { active: true, callbacks: "absent" }); start.commit();
    let fade = start.fade; fade.advance(0.5);
    for (let i = 0; i < 3; i++) { const next = initializer.prepareResume(fade, true)!; next.commit(); fade = next.fade; }
    const game = GameSession.prepareNewGame(selected.entry, selected.catalog, selectedMaps[original.firstMap]!, original.battle,
      fade, ports.presentation, { ...runtime, ...extraRuntime }), launch = initializer.prepareLaunch(fade, game.newGamePreparation(true));
    game.launchNewGame(launch.launch); launch.commit(); game.advance(10); return game;
  };
  const restore = (saved: GameCheckpoint, extraRuntime: GameSessionRuntime = {}) => GameSession.restore(saved, undefined, original.battle, {
    catalog: derived.catalog, map: dependencies[saved.world.location?.mapId ?? original.firstMap]!,
    source: { content: derived.entry, initialMap: dependencies[original.firstMap]! },
  }, { ...runtime, ...extraRuntime });
  return { ...original, corpus, maps, catalog, entry, template, assessments, derived,
    derivedMaps: dependencies, make, restore };

}
