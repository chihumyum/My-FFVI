import { frameworkNewGameFixture } from "./framework-new-game.js";
import { sealBatchContent } from "./content-batch.js";
import { compileFieldEventActivation } from "../../src/compiler/field-event-activation.js";
import { GameSession, type GameCheckpoint } from "../../src/core/game-session.js";
import { GameFlow } from "../../src/core/game-flow.js";
import { GameCommands } from "../../src/core/game-commands.js";
import type { FieldEntity, Op, Site } from "../../src/field/types.js";

type Body<T = Op> = T extends Site ? Omit<T, keyof Site> : never;
export const eventActivationReady = { visible: true, mediaReady: true, overlayOpen: false };

/** All declarations precede construction. A real owned initializer and native
 * factory supply the actor; this authored trigger is not an original map. */
export async function fieldEventActivationFixture(battle = false) {
  const f = await frameworkNewGameFixture(), point = f.map.partyEntry!.pointIns[0]!,
    bodies: Record<string, Body[]> = {
      "gimmick-main": battle ? [{ kind: "encounter", party: f.encounterId, continuation: "gimmick-after" }]
        : [{ kind: "inventory", command: { kind: "grant-item", id: 701, count: 2 }, result: null, dependencies: [] },
          { kind: "event-save" }, { kind: "wait", seconds: 0.02 },
          { kind: "inventory", command: { kind: "grant-item", id: 701, count: 3 }, result: null, dependencies: [] },
          { kind: "exit" }],
      "gimmick-after": [{ kind: "event-save" }, { kind: "exit" }],
      "second-initialize": [{ kind: "exit" }],
    }, source = { file: "synthetic", assetPath: "source-style/gimmick-trigger", pointer: "/objects/0" };
  for (const [name, body] of Object.entries(bodies)) {
    f.map.scripts[name] = body.map((op, index) => ({ ...op, script: "physical-" + name,
      index: index + 100, source } as Op));
    (f.map.scriptLocals ??= {})[name] = null;
    (f.map.scriptSystemFlags ??= {})[name] = { keepBadStatusVisual: false };
    (f.map.scriptTransitionMetadata ??= {})[name] = { customAnimations: "none" };
    f.map.scriptPuppetContexts![name] = { ...structuredClone(f.map.scriptPuppetContexts!["authored-initialize"]!),
      scriptHash: "9".repeat(64) };
  }
  const properties = { object_type: 2, action_id: 2, script_id: 2, gimmick: true,
    direction: 0, ignore_route_link_object_id: -1, link_object_id: 0 },
    trigger: FieldEntity = { id: "gimmick-source-trigger", objectId: 0, kind: 2, layer: point.layer,
      x: point.x + 1, y: point.y, width: 1, height: 1, direction: "down", asset: null,
      script: "gimmick-main", collision: null, destinationLayer: null, source,
      eventActivation: compileFieldEventActivation("entity_default", properties, "gimmick-main", source)! };
  f.map.map!.groups!.entity_default!.entities.push(trigger);
  f.map.map!.entities = structuredClone(f.map.map!.groups!.entity_default!.entities);
  f.map = sealBatchContent(f.map);
  const second = structuredClone(f.map); second.mapId++; second.name = "Second controlled activation map";
  second.map!.identity!.mapId = second.mapId; second.map!.entryContext!.mapId = second.mapId;
  second.partyEntry!.mapId = second.mapId; second.initializer = "second-initialize";
  if (second.entryView) second.entryView.mapId = second.mapId;
  const secondMap = sealBatchContent(second);
  f.world.transportation = structuredClone(f.battle.gameState.sourceNewGame!.transportation);
  f.world.maps[f.map.mapId]!.contentHash = f.map.contentHash;
  f.world.maps[secondMap.mapId] = { ...structuredClone(f.world.maps[f.map.mapId]!),
    contentHash: secondMap.contentHash, name: secondMap.name, url: "/authored/second-activation-map.json" };
  f.world = sealBatchContent(f.world);
  const entry = f.battle.common.battleEntry!.maps.find(row => row.id === f.map.mapId)!;
  f.battle.common.battleEntry!.maps.push({ ...structuredClone(entry), id: secondMap.mapId });
  f.battle = sealBatchContent(f.battle);
  Object.assign(f.content, { mapContentHash: f.map.contentHash, worldCatalogHash: f.world.contentHash,
    battleCatalogHash: f.battle.contentHash }); f.content = sealBatchContent(f.content);
  const runtime = { battleHandoff: "prepared" as const };
  const make = async () => {
    const game = await GameSession.prepareFrameworkNewGame(f.content, f.world, f.map, f.battle, runtime, 314),
      flow = new GameFlow(game); flow.start(); flow.advance(10, eventActivationReady);
    return { game, flow, commands: new GameCommands(flow, game) };
  };
  const restore = (checkpoint: GameCheckpoint, map = f.map) => GameSession.restore(checkpoint, undefined, f.battle,
    { catalog: f.world, map, initialized: { content: f.content, initialMap: f.map } }, runtime);
  return { ...f, trigger, secondMap, runtime, make, restore };
}
