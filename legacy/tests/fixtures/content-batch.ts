import type { Op } from "../../src/field/types.js";
import type { ContentBatchManifest } from "../../src/compiler/content-batch.js";
import { hash } from "../../src/compiler/content.js";
import { compileBattleEncounterRuntime } from "../../src/compiler/battle-encounter-runtime.js";
import { checkpointFixture } from "./checkpoint-game.js";
import { encounterRuntimeFixture } from "./battle-encounter-runtime.js";

export function sealBatchContent<T extends { contentHash: string }>(raw: T): T {
  const { contentHash: _, ...payload } = structuredClone(raw);
  return { ...payload, contentHash: hash(payload) } as T;
}

/** Authored records using the real content compiler and runtime. The route
 * enters its event by walking onto a trigger; the driver has no VM backdoor. */
export function contentBatchFixture() {
  const f = checkpointFixture(), source = { file: "synthetic", assetPath: "content-batch" };
  const script = (name: string, commands: Record<string, unknown>[]): Op[] =>
    commands.map((command, index) => ({ ...command, script: name, index, source }) as Op);
  const pointIn = { ...f.target.map!.entities.find(e => e.kind === 0)!, source };
  const trigger = { ...pointIn, id: "start-route", objectId: 2, kind: 2, x: 2, script: "journey" };
  const field = structuredClone(f.field);
  field.map.entities = [pointIn, trigger];
  field.map.groups = { entity_default: { name: "entity_default", entities: field.map.entities, blockers: [], source } };
  field.entry.initialEventValues = [{ ref: { category: "ScenarioFlag1", index: 8 }, value: 0 }];
  field.scripts = {
    journey: script("journey", [
      { kind: "inventory", command: { kind: "grant-item", id: 10, count: 2 }, result: null, dependencies: [] },
      { kind: "event-save" }, { kind: "encounter", party: 1000, continuation: "after" },
    ]),
    after: script("after", [{ kind: "change-map", request: {
      mapId: 2, entrance: 1, continuation: null, birdview: false, skipFade: true, skipBgm: true, origin: "script",
    } }]),
  };
  const mapA = structuredClone(f.target);
  mapA.mapId = 1; mapA.name = "Synthetic start"; mapA.map = structuredClone(field.map);
  mapA.scripts = structuredClone(field.scripts); mapA.initializer = null;
  const mapB = structuredClone(f.target);
  mapB.map!.entities = [pointIn];
  mapB.map!.groups = { entity_default: { name: "entity_default", entities: [pointIn], blockers: [], source } };
  mapB.scripts = { init: script("init", [
    { kind: "flag", ref: { category: "ScenarioFlag1", index: 8 }, operation: "flip" }, { kind: "exit" },
  ]) };
  const maps = [mapA, mapB].map(sealBatchContent);
  const world = structuredClone(f.world);
  world.maps = Object.fromEntries(maps.map(m => [m.mapId, { url: `/world/maps/${m.mapId}.json`, contentHash: m.contentHash,
    name: m.name, areaId: m.areaId, geometryReady: true, defaultGroupReady: true, blockers: [] }]));
  const encounters = encounterRuntimeFixture(), party = encounters.encounter(1000);
  party.enemies.push({ ...structuredClone(party.enemies[0]!), slot: 9 });
  encounters.input.encounters = [party]; encounters.input.requestedPartyIds = [1000];
  Object.assign(encounters.tables["monster.csv"]![0]!, { hp: "10", exp: "9", gill: "7" });
  const compiled = compileBattleEncounterRuntime(encounters.reader(), encounters.input);
  const battle = { ...f.battle, common: { ...f.battle.common,
    sprites: { ...f.battle.common.sprites, ...encounters.input.sprites }, drops: compiled.drops },
    encounters: compiled.encounters, encounterDiagnostics: compiled.diagnostics, encounterReport: compiled.report };
  const manifest: ContentBatchManifest = { kind: "content-batch-manifest-v1", id: "synthetic-continuous-loop",
    profile: "source", mapIds: [1, 2], roots: [{ kind: "entry", mapId: 1, entrance: 1, continuation: null }],
    routes: [{ id: "trigger-battle-map-save", entry: "controlled-fixture", expectedMapId: 2,
      requiredMapIds: [1, 2], requiredEncounterIds: [1000], maxTicks: 30000,
      inputs: [{ kind: "move", direction: "right" }], choiceAnswers: [], battleAbilityIds: [10] }] };
  return { manifest, packages: { entry: sealBatchContent(field), battle: sealBatchContent(battle),
    maps, catalog: sealBatchContent(world) } };
}
