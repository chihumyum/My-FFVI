import test from "node:test";
import assert from "node:assert/strict";
import { compileFieldEntryContext } from "../src/compiler/field-entry-context.js";
import { compileWorldTerrain } from "../src/compiler/world-terrain.js";
import { projectFieldEntryContext, validateFieldEntryTerrainBinding } from "../src/core/field-entry-context.js";
import { projectBattleFieldState } from "../src/core/field-battle-entry.js";
import { projectMapEntryView } from "../src/core/map-view.js";
import { FieldGame } from "../src/core/field.js";
import type { CorpusAsset } from "../src/compiler/corpus.js";
import type { FieldContent } from "../src/field/types.js";
import { worldTerrainFixture } from "./fixtures/world-terrain.js";
import { battleEntryFixture } from "./fixtures/battle-entry.js";

function fixture(types: "matched" | "absent" | "beast" = "matched") {
  const source = worldTerrainFixture(), tables = source.tables as Record<string, Record<string, string>[]>;
  tables["map.csv"]![0]!.monster_set_id = "0"; tables["monster_set.csv"] = [];
  if (types === "matched") {
    tables["foot_information.csv"]![0]!.type_id = "21";
    tables["foot_information.csv"]![1]!.type_id = "7";
  } else if (types === "beast") {
    Object.assign(tables["foot_information.csv"]![0]!, { id: "31", type_id: "32" });
    Object.assign(tables["foot_information.csv"]![1]!, { id: "32", type_id: "31" });
    const layer = source.assets[1]!.data as { layers: { data: number[] }[] };
    layer.layers[0]!.data = [31, 32, 31, 32, 31, 32];
  }
  const selected = (source.packageAsset.data as { map: Record<string, unknown>[] }).map[0]!;
  selected.entity_default = "Map_W/entity_default"; selected.entity = [];
  const group: CorpusAsset = { id: "group", kind: "data", data: { layers: [{ objects: [] }] },
    source: { ...source.packageAsset.source, assetPath: "Synthetic/Map/Map_W/entity_default.json" } as CorpusAsset["source"] };
  const assets: CorpusAsset[] = [...source.assets.map((asset, index) => ({ ...asset, id: `asset${index}`,
    kind: index === 0 ? "map-package" as const : "data" as const, source: asset.source as CorpusAsset["source"] })), group];
  source.assets = assets;
  const terrain = compileWorldTerrain(source), definition = compileFieldEntryContext(assets, tables, 40, terrain);
  const input = { mapId: 40, transportationId: 1, activeGroups: ["entity_default"], player: { x: 0, y: 0, layer: 0 },
    entrySynchronized: true, terrain, sourceSetHash: source.sourceSetHash, parentSourceSetHash: source.parentSourceSetHash };
  return { source, selected, assets, group, terrain, definition, input, tables };
}

test("qualification uses the native TypeId dictionary, independently of master row ID", () => {
  const { terrain, definition, input } = fixture();
  assert.equal(definition.foot.kind, "source-terrain-grid");
  if (definition.foot.kind !== "source-terrain-grid") throw new Error("Missing terrain qualification");
  assert.equal(definition.foot.typeRowIds["7"], 21);
  assert.equal(terrain.footRows["7"]!.typeId, 21);
  assert.equal(projectFieldEntryContext(definition, input).state.footAttributeType, 7);
  assert.equal(projectFieldEntryContext(definition, { ...input, player: { x: 1, y: 0, layer: 0 } }).state.footAttributeType, 21);
  assert.equal(projectFieldEntryContext(fixture("absent").definition, fixture("absent").input).state.footAttributeType, 0,
    "raw attribute that is absent from the native TypeId dictionary has absent nullable FootInfo");
});

test("a pending entry or missing trusted terrain cannot claim current foot qualification", () => {
  const { definition, input } = fixture();
  for (const ready of [false, null]) {
    const result = projectFieldEntryContext(definition, { ...input, entrySynchronized: ready });
    assert.equal(result.state.footAttributeType, null); assert.ok(result.diagnostics.some(reason => reason.includes("synchronization")));
  }
  const { terrain: _terrain, ...missing } = input;
  assert.equal(projectFieldEntryContext(definition, missing).state.footAttributeType, null);
  const { sourceSetHash: _hash, ...identityUnknown } = input;
  assert.equal(projectFieldEntryContext(definition, identityUnknown).state.footAttributeType, null);
});

test("source identities and the compact type dictionary are bound before any publication", () => {
  const { definition, input, terrain } = fixture(), before = structuredClone({ definition, input });
  for (const key of ["sourceSetHash", "parentSourceSetHash"] as const)
    assert.throws(() => projectFieldEntryContext(definition, { ...input, [key]: "f".repeat(64) }), /source identity mismatch/);
  const foreign = structuredClone(terrain); foreign.contentHash = "f".repeat(64);
  assert.throws(() => projectFieldEntryContext(definition, { ...input, terrain: foreign }), /source identity mismatch/);
  const bad = structuredClone(definition);
  if (bad.foot.kind !== "source-terrain-grid") throw new Error("Missing grid");
  bad.foot.typeRowIds["7"] = 7;
  assert.throws(() => validateFieldEntryTerrainBinding(bad, terrain, input), /dictionary mismatch/);
  assert.throws(() => projectFieldEntryContext(bad, input), /dictionary mismatch/);
  assert.deepEqual({ definition, input }, before);
});

test("content admission and current qualification reject the same malformed terrain-provider header", () => {
  const { definition, input, terrain } = fixture();
  for (const patch of [{ basis: "borrowed-grid" }, { monsterSetId: 1 }, { mapName: " Map_W" },
    { terrainHash: "bad" }, { typeRowIds: [] }, { unexpected: true }]) {
    const bad = structuredClone(definition);
    Object.assign(bad.foot, patch);
    assert.throws(() => validateFieldEntryTerrainBinding(bad, terrain, input));
    assert.throws(() => projectFieldEntryContext(bad, input));
  }
  const bad = structuredClone(definition); bad.foot.source.objectId = 9007199254740999 as unknown as string;
  assert.throws(() => validateFieldEntryTerrainBinding(bad, terrain, input), /source identity/);
});

test("non-encounter areas, unknown group objects and missing groups remain unresolved", () => {
  for (const type of [23, 99, undefined]) {
    const { assets, group, tables, terrain } = fixture();
    group.data = { layers: [{ objects: [{ properties: type === undefined ? [] : [{ name: "object_type", value: type }] }] }] };
    const definition = compileFieldEntryContext(assets, tables, 40, terrain);
    assert.equal(definition.foot.kind, "unresolved");
  }
  const { assets, tables, terrain } = fixture();
  assert.equal(compileFieldEntryContext(assets.filter(asset => asset.id !== "group"), tables, 40, terrain).foot.kind, "unresolved");
});

test("another package or attribute reference cannot borrow terrain qualification", () => {
  const { selected, assets, tables, terrain } = fixture();
  selected.attribute = "other/attribute";
  assert.throws(() => compileFieldEntryContext(assets, tables, 40, terrain), /package\/attribute mismatch/);
  const foreign = fixture(); foreign.assets[0]!.source.objectId = "42";
  assert.throws(() => compileFieldEntryContext(foreign.assets, foreign.tables, 40, foreign.terrain), /package\/attribute mismatch/);
  const ambiguous = fixture(); ambiguous.terrain.footRows["21"]!.typeId = ambiguous.terrain.footRows["7"]!.typeId;
  assert.throws(() => compileFieldEntryContext(ambiguous.assets, ambiguous.tables, 40, ambiguous.terrain), /Ambiguous/);
});

test("ordinary and beast-field qualification reuse the shared battle and menu exclusion projection", () => {
  const { catalog } = battleEntryFixture(); catalog.maps[0]!.id = 40;
  const ordinary = fixture();
  assert.deepEqual(projectBattleFieldState(catalog, projectFieldEntryContext(ordinary.definition, ordinary.input).state,
    [{ id: 1, type: 1 }]).invalidContentIds, [10001, 10005]);
  const beast = fixture("beast");
  assert.equal(projectFieldEntryContext(beast.definition, beast.input).state.footAttributeType, 31);
  assert.deepEqual(projectBattleFieldState(catalog, projectFieldEntryContext(beast.definition, beast.input).state,
    [{ id: 1, type: 1 }]).invalidContentIds, [10001]);
  assert.equal(projectBattleFieldState(catalog, projectFieldEntryContext(beast.definition,
    { ...beast.input, entrySynchronized: false }).state, [{ id: 1, type: 1 }]).invalidContentIds, null);
});

test("field movement, seams and restore derive current qualification without saving another foot cache", () => {
  const { terrain, definition, input, group } = fixture();
  const content: FieldContent = { formatVersion: 1, kind: "field-development", contentHash: "controlled-field-terrain-entry",
    sourceSetHash: input.sourceSetHash, parentSourceSetHash: input.parentSourceSetHash,
    map: { id: terrain.mapName, identity: { mapId: 40, areaId: 3 }, entryContext: definition, worldTerrain: terrain,
      width: terrain.width, height: terrain.height, tileSize: 16, layers: [], tilesets: [], textures: {}, collisions: {}, entities: [],
      groups: { entity_default: { name: "entity_default", source: group.source, entities: [], blockers: [] } }, initialGroups: ["entity_default"],
      topology: { range: { x: 0, y: 0, width: 3, height: 2 }, loop: { horizontal: true, vertical: true } }, source: group.source },
    characters: {}, scripts: {}, limitations: [], entry: { description: "controlled terrain qualification", evidence: [group.source],
      transportationId: 9, synchronization: { kind: "map-entry" },
      viewPlan: projectMapEntryView({ mapId: 40, isWorld: true, requestedViewType: 0, loopType: 3 }),
      player: { x: 0, y: 0, layer: 0, direction: "left", asset: "hero", mount: "" } } };
  const game = new FieldGame(content);
  assert.equal(game.battleEntryContext.state.footAttributeType, null);
  game.startMapEntry(null);
  assert.equal(game.battleEntryContext.state.footAttributeType, 7);
  assert.equal(game.move("left"), true); game.advance(240);
  assert.equal(game.player.x, 2); assert.equal(game.battleEntryContext.state.footAttributeType, 7);
  assert.equal(game.move("down"), false);
  const saved = game.checkpoint(); assert.equal(saved.kind, "idle-field-v11");
  assert.equal(Object.hasOwn(saved, "footAttributeType"), false);
  const restored = FieldGame.restore(content, saved);
  assert.equal(restored.battleEntryContext.state.footAttributeType, 7);
  assert.equal(restored.move("right"), true); restored.advance(240); assert.equal(restored.player.x, 0);
  assert.equal(restored.battleEntryContext.state.footAttributeType, 7);
});

test("current cell qualification does not scan unrelated cells or mutate its owner", () => {
  const { terrain, definition, input } = fixture();
  Object.defineProperty(terrain.cells, "5", { get() { throw new Error("unrequested cell scanned"); } });
  assert.equal(projectFieldEntryContext(definition, input).state.footAttributeType, 7);
});
