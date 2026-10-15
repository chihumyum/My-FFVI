import { worldLoopSessionFixture } from "./world-loop-session.js";
import { logicalEffectCatalog } from "./logical-field-effects.js";
import { compileFrameworkNewGame } from "../../src/compiler/framework-new-game.js";
import { GameSession, type GameSessionRuntime } from "../../src/core/game-session.js";
import { WEB_SOURCE_ENCOUNTER_POLICY } from "../../src/core/source-encounter-entry.js";
import { createWebLogicalFieldEffectsHost, WEB_LOGICAL_FIELD_EFFECTS } from "../../src/core/field-logical-effects.js";
import { sealBatchContent } from "./content-batch.js";
import type { FieldEntity, Op, Site } from "../../src/field/types.js";

type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;
export async function logicalWorldEffectsFixture(options: { initializationFailure?: boolean; emptyTarget?: boolean; unboundTarget?: "profile" | "catalog"; renderLayer?: boolean; sourceEncounter?: boolean } = {}) {
  const f = await worldLoopSessionFixture({ initializationFailure: options.initializationFailure ?? false });
  const fx = logicalEffectCatalog(f.map.sourceSetHash, f.map.parentSourceSetHash);
  const source = { file: "synthetic", assetPath: "logical-world-effects" };
  const site = (name: string, ops: Instruction<Op>[]): Op[] => ops.map((op, index) => ({ ...op, script: name, index, source } as Op));
  const maps = [f.map, f.worldMap].map((input, index) => {
    const map = structuredClone(input), evidence = { ...source, pointer: "/board/900" };
    map.developmentProfile!.logicalFieldEffects = WEB_LOGICAL_FIELD_EFFECTS;
    map.fieldEffects = structuredClone(fx.catalog);
    if (options.renderLayer) map.map!.layers.push({ name: "BottomLayer", width: map.map!.width, height: map.map!.height, opacity: 1, data: Array(map.map!.width * map.map!.height).fill(0) });
    if (!options.emptyTarget || index === 0) {
      const entity: FieldEntity = { id: "900", kind: 11, objectId: 0, layer: 0, x: 2, y: 2, width: 1, height: 1,
        direction: "down", asset: null, script: null, collision: null, destinationLayer: null, source: evidence,
        effect: { ...structuredClone(fx.definition), source: evidence } };
      map.map!.entities.push(entity); map.map!.groups!.entity_default!.entities.push(structuredClone(entity));
    }
    const extras: Record<string, Instruction<Op>[]> = {
      "fx-play": [{ kind: "puppet", slot: 0, actor: "900", target: 4 }, { kind: "exec-puppets", asynchronous: false },
        { kind: "wait", seconds: 0 }, { kind: "exit" }, { kind: "actor-visibility", visible: false },
        { kind: "animation-play", animation: "ignored-effect-key", speed: 1, loop: false }, { kind: "exit" }],
      "fx-battle": [options.sourceEncounter ? { kind: "source-encounter", command: { kind: "source-encounter",
        slots: [f.encounterId, 0, 0, 0], effectId: 7, continuation: "fx-return", footCapture: "before-player-sync" } }
        : { kind: "encounter", party: f.encounterId, continuation: "fx-return" }],
      "fx-return": [{ kind: "exit" }],
    };
    const context = structuredClone(Object.values(map.scriptPuppetContexts!)[0]!);
    for (const [name, ops] of Object.entries(extras)) {
      map.scripts[name] = site(name, ops);
      map.scriptPuppetContexts![name] = { ...context, scriptHash: "d".repeat(64) };
      (map.scriptSystemFlags ??= {})[name] = { keepBadStatusVisual: false };
      (map.scriptLocals ??= {})[name] = null;
    }
    if (index === 1 && options.unboundTarget === "profile") delete map.developmentProfile!.logicalFieldEffects;
    if (index === 1 && options.unboundTarget === "catalog") delete map.fieldEffects;
    return sealBatchContent(map);
  });
  const [map, target] = maps, rawWorld = structuredClone(f.world);
  rawWorld.developmentProfile!.logicalFieldEffects = WEB_LOGICAL_FIELD_EFFECTS;
  for (const current of maps) rawWorld.maps[current!.mapId]!.contentHash = current!.contentHash;
  const world = sealBatchContent(rawWorld), content = await compileFrameworkNewGame({ sourceEntry: f.sourceEntry,
    sourceBattle: f.sourceBattle, sourceMap: f.sourceMap, world, map: map!, battle: f.battle,
    entrance: map!.partyEntry!.pointIns[0]!.id });
  const runtime: GameSessionRuntime = { fieldEffects: createWebLogicalFieldEffectsHost(), battleHandoff: "prepared",
    ...(options.sourceEncounter ? { sourceEncounterPolicy: WEB_SOURCE_ENCOUNTER_POLICY } : {}) };
  const make = () => GameSession.prepareFrameworkNewGame(content, world, map!, f.battle, runtime);
  const restore = (checkpoint: Parameters<typeof GameSession.restore>[0]) => GameSession.restore(checkpoint, undefined,
    f.battle, { catalog: world, map: checkpoint.world.location ? maps.find(m => m!.mapId === checkpoint.world.location!.mapId)! : map!,
      initialized: { content, initialMap: map! } }, runtime);
  return { ...f, map: map!, worldMap: target!, maps: maps as NonNullable<typeof map>[], world, content, fx, source, make, restore, runtime };
}
