import test from "node:test";
import { DEVELOPMENT_TRANSPARENT_FADE } from "../src/core/field-fade.js";
import assert from "node:assert/strict";
import { compileFieldEntryContext } from "../src/compiler/field-entry-context.js";
import { projectFieldEntryContext, type FieldEntryContextDefinition } from "../src/core/field-entry-context.js";
import { projectBattleFieldState } from "../src/core/field-battle-entry.js";
import { FieldGame } from "../src/core/field.js";
import { WorldSession } from "../src/core/world-session.js";
import { EventState } from "../src/core/event-state.js";
import type { CorpusAsset } from "../src/compiler/corpus.js";
import type { FieldContent, Op, Site } from "../src/field/types.js";
import { battleEntryFixture } from "./fixtures/battle-entry.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

const source = { file: "synthetic", serializedFile: "synthetic", objectId: "9007199254741001",
  assetPath: "Room/package.json", sha256: "a".repeat(64) };
const site: Site = { script: "init", index: 0, source };
type WithoutSite<T> = T extends Site ? Omit<T, keyof Site> : never;
const ops = (...values: WithoutSite<Op>[]): Op[] => values.map((value, index) => ({ ...value, ...site, index }) as Op);
function sourceFixture() {
  const map = { name: "Room", attribute: "", entity_default: "entities/default", entity: [{ name: "event", asset: "entities/event" }] };
  const tables = { "map.csv": [{ id: "100", asset_name: "Package", map_name: "Room", monster_set_id: "0" }],
    "monster_set.csv": [{ id: "5" }] };
  const assets: CorpusAsset[] = [
    { id: "package", kind: "map-package", source, data: { asset_group_name: "Package", map: [map] } },
    ...["default", "event"].map((name): CorpusAsset => ({ id: name, kind: "data",
      source: { ...source, assetPath: `Room/entities/${name}.json` },
      data: { layers: [{ objects: [{ properties: [{ name: "object_type", value: name === "default" ? 0 : 9 }] }] }] } })),
  ];
  return { map, tables, assets };
}
function definition(mapId = 100): FieldEntryContextDefinition {
  return { kind: "field-entry-context-v1", mapId, beastFieldController: "source-singleton",
    foot: { kind: "uniform-zero", basis: "no-attribute-asset", monsterSetId: 0, source },
    groups: { entity_default: { savePointCount: 0, reason: null, source } } };
}
const input = () => ({ mapId: 100, transportationId: 1, activeGroups: ["entity_default"],
  player: { x: 1, y: 1, layer: 1 }, entrySynchronized: true });
function content(mapEntry = true): FieldContent {
  return { formatVersion: 1, kind: "field-development", sourceSetHash: "fixture", parentSourceSetHash: "fixture", contentHash: "fixture",
    map: { id: "fixture", identity: { mapId: 100, areaId: 1 }, entryContext: definition(),
      width: 5, height: 5, tileSize: 16, layers: [], tilesets: [], textures: {}, collisions: { 1: Array(25).fill(0) },
      entities: [], groups: { entity_default: { name: "entity_default", source, entities: [], blockers: [] } }, initialGroups: ["entity_default"], source },
    characters: {}, scripts: { init: ops({ kind: "exit" }) },
    entry: { ...(mapEntry ? { synchronization: { kind: "map-entry" as const } } : {}), transportationId: 1,
      player: { x: 1, y: 1, layer: 1, direction: "right", asset: "hero", mount: "" }, evidence: [source], description: "synthetic" }, limitations: [] };
}

test("source package foot provider distinguishes default tables, missing attributes and unresolved attribute grids", () => {
  const { map, tables, assets } = sourceFixture();
  let d = compileFieldEntryContext(assets, tables, 100);
  assert.equal(d.foot.kind, "uniform-zero");
  assert.equal(d.groups.event!.savePointCount, 1, "unsupported kind 9 must survive provider inspection");
  assert.equal(d.foot.source.pointer, "/map/0");
  map.attribute = "terrain";
  d = compileFieldEntryContext(assets, tables, 100);
  assert.equal(d.foot.kind, "unresolved");
  tables["map.csv"][0]!.monster_set_id = "5";
  d = compileFieldEntryContext(assets, tables, 100);
  assert.equal(d.foot.kind, "uniform-zero");
  if (d.foot.kind === "uniform-zero") assert.equal(d.foot.basis, "default-monster-set");
  tables["map.csv"][0]!.monster_set_id = "999";
  assert.equal(compileFieldEntryContext(assets, tables, 100).foot.kind, "unresolved");
});

test("missing or ambiguous group data cannot become an empty save-point list", () => {
  const { tables, assets, map } = sourceFixture();
  const missing = compileFieldEntryContext(assets.filter((a) => a.id !== "event"), tables, 100);
  assert.equal(missing.groups.event!.savePointCount, null);
  const ambiguous = compileFieldEntryContext([...assets, structuredClone(assets[2]!)], tables, 100);
  assert.equal(ambiguous.groups.event!.savePointCount, null);
  map.entity.push({ name: "event", asset: "entities/other" });
  assert.throws(() => compileFieldEntryContext(assets, tables, 100), /Duplicate/);
  map.entity.pop();
  map.entity[0]!.asset = "../elsewhere";
  assert.throws(() => compileFieldEntryContext(assets, tables, 100), /Unsafe/);
  assert.throws(() => compileFieldEntryContext(assets, tables, 101), /master/);
});

test("walking qualification uses current entry synchronization and preserves mounted lazy dependency rules", () => {
  const { catalog } = battleEntryFixture(), transports = [{ id: 1, type: 1 }, { id: 6, type: 12 }];
  for (const ready of [null, false, true]) {
    const context = projectFieldEntryContext(definition(), { ...input(), entrySynchronized: ready });
    assert.equal(context.state.beastFieldController, true);
    assert.equal(context.state.isSavePoint, false);
    assert.equal(context.state.footAttributeType, ready ? 0 : null);
    const entry = projectBattleFieldState(catalog, context.state, transports);
    assert.deepEqual(entry.invalidContentIds, ready ? [10001, 10005] : null);
    const mounted = projectFieldEntryContext(definition(), { ...input(), transportationId: 6, entrySynchronized: ready });
    assert.deepEqual(projectBattleFieldState(catalog, mounted.state, transports).invalidContentIds, [10001, 10002, 10003, 10004, 10005]);
  }
});

test("source save points and unknown active groups remain unknown regardless of coordinates or hiding", () => {
  const d = definition();
  d.groups.save = { savePointCount: 1, reason: null, source };
  d.groups.missing = { savePointCount: null, reason: "Missing source group", source };
  for (const groups of [[], ["save"], ["entity_default", "save"], ["missing"], ["unknown"]]) {
    const result = projectFieldEntryContext(d, { ...input(), activeGroups: groups });
    assert.equal(result.state.isSavePoint, null);
    assert.ok(result.diagnostics.length);
  }
  assert.equal(projectFieldEntryContext(undefined, input()).state.beastFieldController, null);
  assert.throws(() => projectFieldEntryContext(d, { ...input(), mapId: 101 }), /identity/);
  assert.throws(() => projectFieldEntryContext(d, { ...input(), activeGroups: ["save", "save"] }), /groups/);
});

test("a fixed bootstrap and ordinary events cannot invent completed map initialization", () => {
  const c = content(false), g = new FieldGame(c);
  assert.equal(g.entrySynchronized, null);
  assert.throws(() => g.startMapEntry("init"), /pending source/);
  assert.equal(g.startEvent("init"), true);
  g.advance(20);
  assert.equal(g.entrySynchronized, null);
  assert.equal(g.battleEntryContext.state.footAttributeType, null);
  const saved = g.checkpoint();
  assert.equal(saved.entrySynchronized, null);
  assert.equal(FieldGame.restore(c, saved).entrySynchronized, null);
  saved.entrySynchronized = true;
  assert.throws(() => FieldGame.restore(c, saved), /synchronization mismatch/);
});

test("map entry has an explicit no-script completion and strict checkpoint binding", () => {
  const c = content(), g = new FieldGame(c);
  assert.equal(g.entrySynchronized, false);
  assert.equal(g.checkpointReady, false);
  assert.throws(() => g.checkpoint(), /Cannot save/);
  g.startMapEntry(null);
  assert.equal(g.entrySynchronized, true);
  assert.equal(g.battleEntryContext.state.footAttributeType, 0);
  assert.throws(() => g.startMapEntry(null), /pending source/);
  const saved = g.checkpoint();
  assert.equal(saved.kind, "idle-field-v8");
  assert.equal(FieldGame.restore(c, saved).entrySynchronized, true);
  for (const proof of [null, false, 1, undefined]) {
    const bad = { ...saved, entrySynchronized: proof };
    assert.throws(() => FieldGame.restore(c, bad as typeof saved), /synchronization mismatch/);
  }
  assert.throws(() => FieldGame.restore(c, { ...saved, kind: "idle-field-v4" } as unknown as typeof saved), /version mismatch/);
});

test("initializer battle stops retain unknown current foot context until their continuation actually ends", () => {
  const c = content();
  c.scripts.init = ops({ kind: "encounter", party: 1, continuation: "after" });
  c.scripts.after = ops({ kind: "wait", seconds: 0.1 }, { kind: "exit" });
  const g = new FieldGame(c);
  g.startMapEntry("init");
  assert.equal(g.stop?.kind, "encounter");
  g.advance(500);
  assert.equal(g.entrySynchronized, false);
  assert.equal(g.battleEntryContext.state.footAttributeType, null);
  const commit = g.prepareEncounterReturn(1);
  commit();
  assert.equal(g.entrySynchronized, false, "publication schedules but does not execute the continuation");
  g.advance(100);
  assert.equal(g.entrySynchronized, false);
  g.advance(10);
  assert.equal(g.entrySynchronized, true);
  assert.equal(g.checkpointReady, true);
});

test("initializer synchronization waits for puppet movement, dialogue and fade completion", () => {
  const c = content();
  c.entry.fade = { ...structuredClone(DEVELOPMENT_TRANSPARENT_FADE), rendererColor: { r: 1, g: 1, b: 1, a: 1 } };
  c.map.entities.push({ id: "npc", kind: 6, x: 3, y: 1, layer: 1, width: 1, height: 1, asset: "npc", direction: "down", script: null, collision: null, destinationLayer: null, source });
  c.scripts.init = ops(
    { kind: "puppet", slot: 0, actor: "npc", target: 6 }, { kind: "join" },
    { kind: "message", key: "synthetic", text: "ready", speaker: "" },
    { kind: "field-fade", direction: "in", seconds: 0.1, color: null }, { kind: "exit" }, { kind: "nop" },
    { kind: "move", direction: "down", steps: 1, secondsPerCell: 0.12 }, { kind: "exit" },
  );
  const g = new FieldGame(c);
  g.startMapEntry("init");
  g.advance(110);
  assert.equal(g.entrySynchronized, false);
  assert.equal(g.dialogue, null);
  g.advance(20); // main observes the completed puppet on the following clock
  assert.equal((g.dialogue as { text: string } | null)?.text, "ready");
  assert.equal(g.entrySynchronized, false);
  g.confirm();
  g.advance(90);
  assert.equal(g.entrySynchronized, false);
  g.advance(30); // float32 final sample and coroutine completion are distinct
  assert.equal(g.entrySynchronized, true);
  assert.equal(g.actors.npc!.y, 2);
});

test("failed initialization does not acquire proof and ordinary movement retains a completed uniform provider", () => {
  const c = content();
  c.scripts.init = ops({ kind: "blocked", mnemonic: "Unknown", reason: "unresolved source" });
  const failed = new FieldGame(c);
  failed.startMapEntry("init");
  assert.equal(failed.entrySynchronized, false);
  assert.equal(failed.checkpointReady, false);
  const g = new FieldGame(content());
  g.startMapEntry("init");
  g.move("down");
  g.advance(240);
  assert.equal(g.entrySynchronized, true);
  assert.equal(g.battleEntryContext.state.footAttributeType, 0);
  assert.equal(g.player.y, 2);
});

test("WorldSession owns entry synchronization across candidates, publication and restore without replay", () => {
  const { field, world: catalog, target } = checkpointFixture();
  field.map.entryContext = definition(1);
  target.map!.entryContext = definition(2);
  target.scripts.init = ops({ kind: "wait", seconds: 0.1 }, { kind: "flag", ref: { category: "ScenarioFlag1", index: 8 }, operation: "flip" }, { kind: "exit" });
  const world = new WorldSession(field, EventState.initialized());
  world.field.previewMap(2, 1);
  const prepared = world.prepare(catalog, target);
  assert.equal(world.field.entrySynchronized, null);
  assert.equal(prepared.field.entrySynchronized, false);
  assert.equal(world.commit(prepared), true);
  assert.equal(world.field.battleEntryContext.state.footAttributeType, null);
  assert.throws(() => world.checkpoint(), /Cannot save/);
  world.field.advance(100);
  assert.equal(world.field.entrySynchronized, true);
  const checkpoint = world.checkpoint();
  assert.equal(checkpoint.kind, "idle-world-v8");
  const restored = new WorldSession(field);
  restored.restore(checkpoint, catalog, target);
  assert.equal(restored.field.entrySynchronized, true);
  assert.equal(restored.field.battleEntryContext.state.footAttributeType, 0);
  assert.equal(restored.field.eventState.read({ category: "ScenarioFlag1", index: 8 }), 1);
  restored.field.advance(500);
  assert.equal(restored.field.eventState.read({ category: "ScenarioFlag1", index: 8 }), 1);
  checkpoint.field.entrySynchronized = null;
  assert.throws(() => restored.restore(checkpoint, catalog, target), /synchronization mismatch/);
});
