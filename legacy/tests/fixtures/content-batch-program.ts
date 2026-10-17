import type { FieldEntity, Op } from "../../src/field/types.js";
import type { WorldMapContent } from "../../src/field/world.js";
import type { ContentBatchManifest } from "../../src/compiler/content-batch.js";
import type { DevelopmentProfile } from "../../src/core/development-profile.js";
import { compileBattleEncounterRuntime } from "../../src/compiler/battle-encounter-runtime.js";
import { compileTargetRule } from "../../src/compiler/battle-targets.js";
import { checkpointFixture } from "./checkpoint-game.js";
import { partyMenuFixture } from "./party-menu.js";
import { encounterRuntimeFixture } from "./battle-encounter-runtime.js";
import { sealBatchContent } from "./content-batch.js";

/** Entirely authored mechanism data. No original region, flags, character
 * story or dialogue is reconstructed. Enemy damage and every menu effect run
 * through the actual game owners; the driver never changes HP or starts a VM. */
export function contentBatchProgramFixture() {
  const base = checkpointFixture(), party = partyMenuFixture(), equipment = { field: party.field, catalog: party.battle };
  const source = { file: "synthetic", assetPath: "content-batch-program" };
  const script = (name: string, commands: Record<string, unknown>[]): Op[] =>
    commands.map((command, index) => ({ ...command, script: name, index, source }) as Op);
  const pointIn: FieldEntity = { ...base.target.map!.entities.find(entity => entity.kind === 0)!, source };
  const trigger = (id: string, x: number, name: string): FieldEntity => ({
    ...pointIn, id, objectId: x + 10, kind: 2, x, script: name,
  });
  const field = structuredClone(equipment.field);
  // This fixture declares only its walking two-character actor inventory.
  // Menu sorting and destination entry therefore use the same appearance
  // owner, without importing unrelated riding or condition substitutions.
  const actors = equipment.catalog.gameState.partyActors!;
  actors.assets = { 1: actors.assets[1]!, 2: actors.assets[2]! };
  actors.residents = [{ characterId: 1, fieldAssetId: 1 }, { characterId: 2, fieldAssetId: 2 }];
  actors.conditionChanges = []; actors.transportations = [{ id: 1, typeId: 1, fieldAssetId: 0 }];
  field.entry.partyActors!.context.conditionResidents = [];
  field.map.entities = [pointIn, trigger("first-battle", 2, "first"), trigger("map-exit", 3, "travel")];
  field.map.groups = { entity_default: { name: "entity_default", entities: field.map.entities, blockers: [], source } };
  field.entry.initialEventValues = [8, 9, 10].map(index => ({ ref: { category: "ScenarioFlag1", index }, value: 0 }));
  field.entry.initialEventValues.push({ ref: { category: "ScenarioFlag3", index: 45 }, value: 0 },
    { ref: { category: "TreasureFlag1", index: 0 }, value: 1 });
  field.scripts = {
    first: script("first", [
      { kind: "inventory", command: { kind: "grant-item", id: 10, count: 2 }, result: null, dependencies: [] },
      { kind: "event-save" }, { kind: "encounter", party: 1000, continuation: "after-first" },
    ]),
    "after-first": script("after-first", [
      { kind: "flag", ref: { category: "ScenarioFlag1", index: 8 }, operation: "flip" }, { kind: "exit" },
    ]),
    travel: script("travel", [{ kind: "change-map", request: {
      mapId: 2, entrance: 1, continuation: null, birdview: false, skipFade: true, skipBgm: true, origin: "script",
    } }]),
  };
  const mapA: WorldMapContent = { ...structuredClone(base.target), mapId: 1, name: "Synthetic program start",
    map: structuredClone(field.map), scripts: structuredClone(field.scripts), initializer: null };
  const mapB = structuredClone(base.target);
  mapB.name = "Synthetic program destination";
  mapB.partyEntry = { formatVersion: 1, kind: "map-party-entry", mapId: 2, width: 6, height: 4,
    mapRange: { x: 0, y: 0, width: 6, height: 4 }, loopType: 0,
    pointIns: [{ id: 1, x: 1, y: 1, layer: 1, direction: "right", linkObject: 0, source }], conditionColliders: [] };
  mapB.map!.entities = [pointIn, trigger("second-battle", 2, "second")];
  mapB.map!.groups = { entity_default: { name: "entity_default", entities: mapB.map!.entities, blockers: [], source } };
  mapB.scripts = {
    init: script("init", [
      { kind: "flag", ref: { category: "ScenarioFlag1", index: 9 }, operation: "flip" },
      { kind: "inventory", command: { kind: "grant-item", id: 10, count: 1 }, result: null, dependencies: [] },
      { kind: "exit" },
    ]),
    second: script("second", [{ kind: "encounter", party: 1001, continuation: "after-second" }]),
    "after-second": script("after-second", [
      { kind: "flag", ref: { category: "ScenarioFlag1", index: 10 }, operation: "flip" }, { kind: "exit" },
    ]),
  };
  const variant = <T extends { contentHash: string }>(raw: T): T & { developmentProfile: DevelopmentProfile } => {
    const sealed = sealBatchContent(raw);
    return sealBatchContent({ ...sealed, developmentProfile: {
      kind: "framework-development-v1", policy: "omit-anonymous-environment-particles-v1",
      sourceContentHash: sealed.contentHash, omissions: [],
    } });
  };
  const maps = [mapA, mapB].map(variant), world = structuredClone(base.world);
  world.characters = structuredClone(field.characters);
  world.transportation = { definitions: [{ id: 1, type: 1, assetId: 0, releaseFlag: 0 }],
    newGame: { mapId: 1, entrance: 1, scriptId: 0, transportationId: 1 } };
  world.maps = Object.fromEntries(maps.map(map => [map.mapId, {
    url: `/synthetic/program/maps/${map.mapId}.json`, contentHash: map.contentHash,
    name: map.name, areaId: map.areaId, geometryReady: true, defaultGroupReady: true, blockers: [],
  }]));
  const enemies = encounterRuntimeFixture();
  enemies.tables["battle_background_asset.csv"] = [{ id: "1" }];
  enemies.tables["monster_party.csv"] = [1000, 1001].map(id => ({ id: String(id),
    battle_background_asset_id: "1", battle_bgm_asset_id: "0", appearance_production: "0", not_escape: "0" }));
  Object.assign(enemies.tables["monster.csv"]![0]!, { hp: "10", exp: "9", gill: "7" });
  enemies.input.encounters = [enemies.encounter(1000), enemies.encounter(1001)];
  enemies.input.requestedPartyIds = [1000, 1001];
  // Both players are injured by an ordinary scheduled group attack before
  // their authored initial empty meters fill. This makes potion use observable
  // without any driver-side health edit or forced battle result.
  const enemyAbility = structuredClone(equipment.catalog.common.abilities[13]!);
  enemyAbility.program.range = 4; enemyAbility.plan!.targeting = compileTargetRule(4, 3)!;
  enemies.input.abilities = { ...equipment.catalog.common.abilities, 13: enemyAbility };
  enemies.input.handoff = { policy: { kind: "framework-battle-handoff-v1",
    id: "synthetic-content-batch-program-v1", audio: "retain-field", introduction: "omit" } };
  const compiled = compileBattleEncounterRuntime(enemies.reader(), enemies.input);
  const battle = sealBatchContent({ ...equipment.catalog, common: { ...equipment.catalog.common,
    abilities: enemies.input.abilities,
    initialAtb: { player: [0, 0] as [number, number], enemy: [100, 100] as [number, number] },
    sprites: { ...equipment.catalog.common.sprites, ...enemies.input.sprites,
      synthetic: { file: "/synthetic/program/player.png", width: 16, height: 16 } }, drops: compiled.drops },
    encounters: compiled.encounters, encounterDiagnostics: compiled.diagnostics, encounterReport: compiled.report });
  const manifest: ContentBatchManifest = { kind: "content-batch-manifest-v1", id: "synthetic-declared-input-program",
    profile: "framework", mapIds: [1, 2], roots: [{ kind: "entry", mapId: 1, entrance: 1, continuation: null }],
    routes: [{ id: "menu-restore-travel-battle", entry: "controlled-fixture", expectedMapId: 2,
      requiredMapIds: [1, 2], requiredEncounterIds: [1000, 1001], maxTicks: 30000,
      inputs: [
        { kind: "move", direction: "right" },
        { kind: "menu", command: { kind: "use-item", itemId: 10, targetId: "a" } },
        { kind: "menu", command: { kind: "change-equipment", playerId: "a", slot: 1, contentId: 1 } },
        { kind: "menu", command: { kind: "set-preferences", preferences: { mode: "wait", speedIndex: 3 } } },
        { kind: "save-restore" },
        { kind: "menu", command: { kind: "change-party", change: { kind: "set-row", position: 0, row: "back" } } },
        { kind: "move", direction: "right" },
        { kind: "move", direction: "right" },
      ], choiceAnswers: [], battleAbilityIds: [10] }] };
  return { manifest, packages: { entry: variant(field), catalog: variant(world), maps, battle } };
}
