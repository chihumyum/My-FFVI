import { GameSession } from "../../src/core/game-session.js";
import { compileFrameworkNewGame } from "../../src/compiler/framework-new-game.js";
import type { Op, Site } from "../../src/field/types.js";
import type { WorldMapContent } from "../../src/field/world.js";
import type { MapViewType } from "../../src/core/map-view.js";
import { frameworkNewGameFixture } from "./framework-new-game.js";
import { sealBatchContent } from "./content-batch.js";

type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;
export const worldLoopInitializer = { category: "MapLocalVariable" as const, index: 1 };

/** Authored two-map mechanism fixture. Geometry/collision and uniform-zero
 * foot inputs are controlled, not the original world's terrain or story. The
 * shared GameState and native actors come from the real initialization API. */
export async function worldLoopSessionFixture(options: { requestedViewType?: 0 | 1; initializationFailure?: boolean } = {}) {
  const f = await frameworkNewGameFixture(), requestedViewType: MapViewType = options.requestedViewType ?? 0;
  const source = { file: "tests/fixtures/world-loop-session.ts", assetPath: "authored/world-loop-session" };
  const ops = (script: string, values: Instruction<Op>[]): Op[] => values.map((value, index) =>
    ({ ...value, script, index, source }) as Op);
  const initial = structuredClone(f.map), target = structuredClone(f.map);
  const profile = { ...structuredClone(f.world.developmentProfile!), worldMap: "framework-world-map-flat-v1" as const };
  const viewSources = (mapId: number, areaId: number) => ({
    map: { file: source.file, assetPath: "authored/world-loop/map.csv", pointer: "/id/" + mapId },
    area: { file: source.file, assetPath: "authored/world-loop/area.csv", pointer: "/id/" + areaId },
  });
  initial.developmentProfile = structuredClone(profile);
  initial.entryView = { mapId: initial.mapId, isWorld: false, loopType: 0, sources: viewSources(initial.mapId, initial.areaId) };
  const start = initial.partyEntry!.pointIns[0]!;
  initial.scripts["go-world"] = ops("go-world", [{ kind: "change-map", request: {
    mapId: 900002, entrance: start.id, continuation: null, birdview: requestedViewType === 1,
    skipFade: true, skipBgm: true, origin: "script",
  } }]);
  initial.scriptPuppetContexts!["go-world"] = { ...structuredClone(initial.scriptPuppetContexts!["authored-initialize"]!),
    scriptHash: "5".repeat(64) };
  const trigger = { ...structuredClone(initial.map!.groups!.entity_default!.entities[0]!),
    id: "authored-go-world", kind: 2, objectId: 9100, x: start.x + 1, y: start.y,
    script: "go-world", source };
  initial.map!.entities.push(trigger); initial.map!.groups!.entity_default!.entities.push(structuredClone(trigger));

  target.mapId = 900002; target.areaId = 2; target.name = "Controlled cyclic world map";
  target.developmentProfile = structuredClone(profile);
  target.map!.identity!.mapId = target.mapId; target.map!.identity!.areaId = target.areaId;
  target.map!.entryContext!.mapId = target.mapId;
  target.partyEntry!.mapId = target.mapId; target.partyEntry!.loopType = 3;
  target.cameraHost!.loop = { horizontal: true, vertical: true };
  target.map!.topology = { range: structuredClone(target.partyEntry!.mapRange), loop: { horizontal: true, vertical: true } };
  target.entryView = { mapId: target.mapId, isWorld: true, loopType: 3, sources: viewSources(target.mapId, target.areaId) };
  const point = target.partyEntry!.pointIns[0]!;
  point.x = target.map!.width - 1; point.y = target.map!.height - 1; point.direction = "right";
  const pointEntity = { ...structuredClone(target.map!.groups!.entity_default!.entities[0]!),
    x: point.x, y: point.y, direction: point.direction, source: structuredClone(point.source) };
  target.map!.entities = [pointEntity];
  target.map!.groups!.entity_default!.entities = [structuredClone(pointEntity)];
  const init: Instruction<Op>[] = [
    { kind: "inventory", command: { kind: "grant-item", id: 701, count: 1 }, result: null, dependencies: [] },
    { kind: "calc", left: worldLoopInitializer, operator: "＋", right: { kind: "immediate", value: 1 } },
    ...(options.initializationFailure ? [{ kind: "blocked" as const, mnemonic: "AuthoredLateEntryFailure",
      reason: "Controlled world initializer failed after private inventory preparation" }] : []),
    { kind: "exit" },
  ];
  target.scripts = {
    "world-initialize": ops("world-initialize", init),
    "world-return": ops("world-return", [{ kind: "change-map", request: { mapId: initial.mapId,
      entrance: start.id, continuation: null, birdview: false, skipFade: true, skipBgm: true, origin: "script" } }]),
    "world-save": ops("world-save", [
      { kind: "inventory", command: { kind: "grant-item", id: 701, count: 1 }, result: null, dependencies: [] },
      { kind: "event-save" },
      { kind: "inventory", command: { kind: "grant-item", id: 701, count: 1 }, result: null, dependencies: [] },
      { kind: "exit" },
    ]),
  };
  target.scriptPuppetContexts = Object.fromEntries(["world-initialize", "world-return", "world-save"].map((name, index) => [name,
    { ...structuredClone(f.map.scriptPuppetContexts!["authored-initialize"]!), scriptHash: String(index + 6).repeat(64) }]));
  target.initializer = "world-initialize";
  const back = { ...structuredClone(pointEntity), id: "authored-return-town", kind: 2, objectId: 9101,
    x: 1, y: 1, script: "world-return", source };
  target.map!.entities.push(back); target.map!.groups!.entity_default!.entities.push(structuredClone(back));
  const save = { ...structuredClone(pointEntity), id: "authored-save-world", kind: 2, objectId: 9102,
    x: 2, y: 0, script: "world-save", source };
  target.map!.entities.push(save); target.map!.groups!.entity_default!.entities.push(structuredClone(save));
  const map = sealBatchContent(initial), worldMap = sealBatchContent(target);
  const world = structuredClone(f.world);
  world.developmentProfile = structuredClone(profile);
  world.transportation = structuredClone(f.battle.gameState.sourceNewGame!.transportation);
  world.maps = Object.fromEntries([map, worldMap].map(value => [value.mapId, { url: "/authored/world-loop/" + value.mapId + ".json",
    contentHash: value.contentHash, name: value.name, areaId: value.areaId,
    geometryReady: true, defaultGroupReady: true, blockers: [] }]));
  const catalog = sealBatchContent(world);
  const battle = structuredClone(f.battle);
  const qualification = battle.common.battleEntry!.maps.find(value => value.id === map.mapId)!;
  battle.common.battleEntry!.maps.push({ ...structuredClone(qualification), id: worldMap.mapId });
  const sealedBattle = sealBatchContent(battle);
  const content = await compileFrameworkNewGame({ sourceEntry: f.sourceEntry, sourceBattle: f.sourceBattle,
    sourceMap: f.sourceMap, world: catalog, map, battle: sealedBattle, entrance: start.id });
  const make = () => GameSession.prepareFrameworkNewGame(content, catalog, map, sealedBattle, { battleHandoff: "prepared" });
  return { ...f, content, world: catalog, map, worldMap, battle: sealedBattle, make,
    source, requestedViewType, initializerRef: worldLoopInitializer, maps: [map, worldMap] as WorldMapContent[] };
}
