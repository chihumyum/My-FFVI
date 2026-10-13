import { createNewGame } from "../../src/core/new-game.js";
import { compileFrameworkNewGame } from "../../src/compiler/framework-new-game.js";
import type { Op, Site } from "../../src/field/types.js";
import { sealBatchContent } from "./content-batch.js";
import { magicStonesSessionFixture } from "./magic-stones-session.js";
import { sourceNewGameFixture } from "./source-new-game.js";

type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;
export const frameworkInitializerFlag = { category: "MapLocalVariable" as const, index: 0 };

/** Redistributable authored data. The source-style inputs are controlled
 * mechanism fixtures, not original assets or source-story reachability. A real
 * NewGameDefinition creates the owned/native domains; no snapshot is patched. */
export async function frameworkNewGameFixture() {
  const ordinary = sourceNewGameFixture(), systems = magicStonesSessionFixture();
  // Declare a separate source-style catalog with the ordinary fixture's
  // non-development encounters. Its owned catalogs remain exactly the shared
  // systems initializer used by the derived framework battle package.
  const sourceBattle = sealBatchContent({ ...structuredClone(systems.battle),
    encounters: structuredClone(ordinary.battle.encounters) });
  const sourceMap = sealBatchContent(ordinary.map);
  const sourceWorld = structuredClone(ordinary.world);
  sourceWorld.maps[String(sourceMap.mapId)]!.contentHash = sourceMap.contentHash;
  const sealedSourceWorld = sealBatchContent(sourceWorld);
  const sourceEntry = sealBatchContent({ ...structuredClone(ordinary.content),
    battleCatalogHash: sourceBattle.contentHash, worldCatalogHash: sealedSourceWorld.contentHash,
    mapContentHash: sourceMap.contentHash });

  const source = { file: "tests/fixtures/framework-new-game.ts", assetPath: "authored/framework-entry" };
  const map = structuredClone(sourceMap), mapId = 900001;
  map.mapId = mapId; map.name = "Authored initialized systems map";
  map.map!.identity!.mapId = mapId;
  map.map!.entryContext!.mapId = mapId;
  map.partyEntry!.mapId = mapId;
  const point = map.partyEntry!.pointIns[0]!;
  // Both typed PointIn projections name the same controlled source object.
  for (const entity of map.map!.groups!.entity_default!.entities)
    if (entity.kind === 0 && entity.objectId === point.id) entity.source = structuredClone(point.source);
  map.map!.entities = structuredClone(map.map!.groups!.entity_default!.entities);
  const ops = (script: string, instructions: Instruction<Op>[]): Op[] => instructions.map((instruction, index) =>
    ({ ...instruction, script, index, source }) as Op);
  map.scripts = {
    "authored-initialize": ops("authored-initialize", [
      { kind: "inventory", command: { kind: "grant-item", id: 701, count: 1 }, result: null, dependencies: [] },
      { kind: "calc", left: frameworkInitializerFlag, operator: "←", right: { kind: "immediate", value: 1 } }, { kind: "exit" },
    ]),
    "stone-battle": structuredClone(systems.map.scripts["stone-battle"]!),
    "after-stone-battle": structuredClone(systems.map.scripts["after-stone-battle"]!),
  };
  map.scriptPuppetContexts = {
    "authored-initialize": { ...structuredClone(ordinary.map.scriptPuppetContexts!.reserved!), scriptHash: "4".repeat(64) },
    "stone-battle": structuredClone(systems.map.scriptPuppetContexts!["stone-battle"]!),
    "after-stone-battle": structuredClone(systems.map.scriptPuppetContexts!["after-stone-battle"]!),
  };
  map.initializer = "authored-initialize";
  const profile = { kind: "framework-development-v1" as const, policy: "omit-anonymous-environment-particles-v1" as const,
    sourceContentHash: sourceMap.contentHash, omissions: [] };
  map.developmentProfile = structuredClone(profile);
  const sealedMap = sealBatchContent(map);
  const world = structuredClone(sealedSourceWorld);
  world.developmentProfile = structuredClone(profile);
  world.maps = { [mapId]: { contentHash: sealedMap.contentHash, url: "/authored/framework-map.json",
    name: sealedMap.name, areaId: sealedMap.areaId, geometryReady: true, defaultGroupReady: true, blockers: [] } };
  const sealedWorld = sealBatchContent(world);
  const battle = structuredClone(systems.battle);
  const originalQualification = battle.common.battleEntry!.maps.find(entry => entry.id === sourceMap.mapId)!;
  battle.common.battleEntry!.maps.push({ ...structuredClone(originalQualification), id: mapId });
  const sealedBattle = sealBatchContent(battle);
  const content = await compileFrameworkNewGame({ sourceEntry, sourceBattle, sourceMap,
    world: sealedWorld, map: sealedMap, battle: sealedBattle, entrance: point.id });
  return { content, battle: sealedBattle, world: sealedWorld, map: sealedMap,
    sourceEntry, sourceBattle, sourceMap, sourceWorld: sealedSourceWorld, source,
    playerIds: systems.playerIds, stoneIds: systems.stoneIds, abilityId: systems.abilityId,
    encounterId: systems.encounterId, initializerFlag: frameworkInitializerFlag,
    plan: createNewGame(sourceBattle.gameState.sourceNewGame!) };
}
