import { fixture as battleFixture } from "./battle-content.js";
import { sourceNativeStateFixture } from "./source-native-state.js";
import { fieldActorFactoryFixture } from "./field-actor-factory.js";
import { FieldFadeState } from "../../src/core/field-fade.js";
import { createSourcePresentationContext } from "../../src/core/source-presentation.js";
import type { SourceNewGameContent } from "../../src/core/source-new-game.js";
import type { FieldPuppetScriptContext } from "../../src/core/field-puppet-actors.js";
import type { BattleCatalog } from "../../src/core/battle-content.js";
import type { WorldCatalog, WorldMapContent } from "../../src/field/world.js";
import type { FieldEntity, Op, Site } from "../../src/field/types.js";

type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;
export const reservedFlag = { category: "ScenarioFlag1" as const, index: 20 };
export const fallbackFlag = { category: "ScenarioFlag1" as const, index: 21 };

/** A controlled source initializer and ordinary factory, with unrelated map
 * identity and test scripts. No source asset or reachable story state is granted.
 * Battle actions remain the explicitly synthetic fixture; this exercises entry. */
export function sourceNewGameFixture() {
  const owner = sourceNativeStateFixture(), actor = fieldActorFactoryFixture(), rawBattle = battleFixture();
  const { encounterId, formation, enemies, background, contentHash: _, ...common } = rawBattle;
  common.players = [owner.player];
  common.conditions = owner.conditions;
  const battle: BattleCatalog = {
    kind: "narshe-battle-catalog", contentHash: "controlled-fresh-battle", common,
    encounters: { [encounterId]: { encounterId, formation, enemies, background } },
    gameState: { ...owner.content, partyActors: actor.partyCatalog },
  };
  const source = { file: "synthetic", assetPath: "source-new-game-integration" };
  const ops = (script: string, values: Instruction<Op>[]): Op[] => values.map((value, index) =>
    ({ ...value, script, index, source }) as Op);
  const scriptContext: FieldPuppetScriptContext = { skipInitialize: false, keepPlayerPuppet: false,
    keepBadStatusVisual: false, ridingVehicle: false, characteristics: true,
    scriptHash: "a".repeat(64), miscHash: "b".repeat(64) };
  const point = actor.map.pointIns[0]!;
  const entities: FieldEntity[] = [{ id: "100", kind: 0, objectId: point.id,
    x: point.x, y: point.y, width: 1, height: 1, layer: point.layer, direction: point.direction,
    asset: null, script: null, collision: null, destinationLayer: null, source }];
  const map: WorldMapContent = {
    formatVersion: 1, kind: "world-map-development", sourceSetHash: "controlled-corpus",
    parentSourceSetHash: "controlled-parent", mediaSourceSetHash: "controlled-media",
    contentHash: "controlled-first-map", mapId: actor.map.mapId, areaId: 1, name: "Controlled entry",
    map: { id: "controlled", identity: { mapId: actor.map.mapId, areaId: 1 },
      width: actor.map.width, height: actor.map.height, tileSize: 16, layers: [], tilesets: [], textures: {},
      collisions: { 0: Array(actor.map.width * actor.map.height).fill(0) }, entities, source,
      groups: { entity_default: { name: "entity_default", entities, blockers: [], source } },
      entryContext: { kind: "field-entry-context-v1", mapId: actor.map.mapId, beastFieldController: "source-singleton",
        foot: { kind: "uniform-zero", basis: "no-attribute-asset", monsterSetId: 0, source },
        groups: { entity_default: { savePointCount: 0, reason: null, source } } } },
    scripts: {
      reserved: ops("reserved", [{ kind: "flag", ref: reservedFlag, operation: "set" },
        { kind: "wait", seconds: 0 }, { kind: "exit" }]),
      fallback: ops("fallback", [{ kind: "flag", ref: fallbackFlag, operation: "set" }, { kind: "exit" }]),
    },
    scriptLocals: {}, scriptPuppetContexts: { reserved: scriptContext,
      fallback: { ...scriptContext, scriptHash: "c".repeat(64) } }, initializer: "fallback", characterAssets: [],
    partyEntry: actor.map, partyEntryBlockers: [],
    cameraHost: { kind: "source-field-camera-host-v1", mapRange: actor.map.mapRange,
      loop: { horizontal: false, vertical: false }, playerVisualOffset: { x: 0, y: -6 },
      callbacks: "fresh-normal-field-v1", sources: actor.sources.map((s) => ({ ...s })) },
    cameraHostBlockers: [], blockers: [], limitations: [],
  };
  const world: WorldCatalog = { formatVersion: 1, kind: "world-development",
    sourceSetHash: map.sourceSetHash, parentSourceSetHash: map.parentSourceSetHash,
    mediaSourceSetHash: map.mediaSourceSetHash, contentHash: "controlled-world",
    maps: { [map.mapId]: { contentHash: map.contentHash, url: "/controlled-map.json", name: map.name,
      areaId: map.areaId, geometryReady: true, defaultGroupReady: true, blockers: [] } },
    characters: actor.characters, characterIssues: {}, limitations: [] };
  const content: SourceNewGameContent = {
    kind: "source-new-game-content-v1", contentHash: "controlled-fresh-content",
    sourceSetHash: map.sourceSetHash, parentSourceSetHash: map.parentSourceSetHash,
    battleCatalogHash: battle.contentHash, worldCatalogHash: world.contentHash, mapContentHash: map.contentHash,
    entry: { kind: "source-new-game-field-entry-v1", mapId: map.mapId, entrance: point.id,
      reservedScript: { id: owner.plan.entry.scriptId, name: "reserved", contentHash: scriptContext.scriptHash },
      fallbackScript: { id: 23, name: "fallback" } },
    factory: actor.factory, puppetCatalog: { kind: "field-puppet-actors-v1", memberCount: 4,
      characteristics: true, corpsOrder: [0, 1, 2, 3], residents: [], conditionChanges: [], miscHash: scriptContext.miscHash },
    view: actor.view,
  };
  const presentation = createSourcePresentationContext({ kind: "title-new-game",
    titleCleanupComplete: true, openingCallbackStarted: false });
  const fade = new FieldFadeState({ imageColor: { r: 0, g: 0, b: 0, a: 1 },
    rendererColor: { r: 1, g: 1, b: 1, a: 0 }, raycastTarget: false });
  return { content, world, map, battle, presentation, fade, plan: owner.plan, source };
}
