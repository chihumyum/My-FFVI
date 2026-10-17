import test from "node:test";
import assert from "node:assert/strict";
import { contentBatchProgramFixture } from "./fixtures/content-batch-program.js";
import { sealBatchContent } from "./fixtures/content-batch.js";
import { compileDevelopmentMapEntry } from "../src/compiler/development-map-entry.js";
import { assertGameDevelopmentEntry, gameDevelopmentEntryBaseline, parseGameDevelopmentEntry,
  prepareGameDevelopmentEntry, validateGameDevelopmentEntryBindings } from "../src/core/game-development-entry.js";
import { GameSession } from "../src/core/game-session.js";
import { GameEntryLoader } from "../src/core/game-entry-loader.js";
import { GameFlow } from "../src/core/game-flow.js";
import type { FieldContent } from "../src/field/types.js";

function input() {
  const f = contentBatchProgramFixture(), { developmentProfile, ...field } = structuredClone(f.packages.entry);
  const baseField = { ...field, contentHash: developmentProfile!.sourceContentHash } as FieldContent;
  return { baseField, baseBattle: f.packages.battle, catalog: f.packages.catalog,
    map: f.packages.maps[1]!, entrance: 1 };
}
const host = { visible: true, mediaReady: true, overlayOpen: false };

test("development relocation carries the catalog runtime policies without changing its raw baseline", async () => {
  const raw = input(), baseline = structuredClone(raw.baseField);
  Object.assign(raw.catalog.developmentProfile!, { storyRuntime: "web-field-story-runtime-v1",
    autoSave: "web-field-autosave-barrier-v1" });
  Object.assign(raw.map.developmentProfile!, { storyRuntime: "web-field-story-runtime-v1",
    autoSave: "web-field-autosave-barrier-v1" });
  raw.map = sealBatchContent(raw.map);
  raw.catalog.maps[String(raw.map.mapId)]!.contentHash = raw.map.contentHash;
  raw.catalog = sealBatchContent(raw.catalog);
  const field = await compileDevelopmentMapEntry(raw);
  assert.equal(field.developmentProfile!.storyRuntime, "web-field-story-runtime-v1");
  assert.equal(field.developmentProfile!.autoSave, "web-field-autosave-barrier-v1");
  assert.deepEqual(gameDevelopmentEntryBaseline(field, raw.catalog), baseline);
  const missing = structuredClone(field);
  delete missing.developmentProfile!.autoSave;
  assert.throws(() => gameDevelopmentEntryBaseline(missing, raw.catalog), /profile/);
});

test("development entry is a detached derivation preserving the complete original baseline", async () => {
  const raw = input(), before = structuredClone(raw), field = await compileDevelopmentMapEntry(raw);
  assert.deepEqual(raw, before);
  assert.notEqual(field.contentHash, raw.baseField.contentHash);
  assert.equal(field.sourceSetHash, raw.baseField.sourceSetHash);
  assert.equal(field.developmentEntry!.startMap, 2);
  assert.equal(field.map.identity!.mapId, 1, "The baseline is not silently rewritten into the destination");
  assert.deepEqual(gameDevelopmentEntryBaseline(field, raw.catalog), raw.baseField);
  assert.deepEqual(field.entry.initialEventValues, raw.baseField.entry.initialEventValues);
  assert.deepEqual(field.developmentEntry!.provenance, { kind: "controlled-development-baseline-v1",
    state: "preserve-baseline", relocation: "source-point-in", storyReachability: "unverified" });
  const view = parseGameDevelopmentEntry(field.developmentEntry); view.pointIn.source.file = "changed";
  assert.notEqual(view.pointIn.source.file, field.developmentEntry!.pointIn.source.file);
  field.map.entities.length = 0;
  assert.deepEqual(raw, before);
});

test("metadata rejects unsupported provenance, malformed identity and accessor fields without evaluating them", async () => {
  const raw = input(), field = await compileDevelopmentMapEntry(raw), descriptor = field.developmentEntry!;
  for (const value of [
    { ...descriptor, extra: true }, { ...descriptor, entrance: -1 }, { ...descriptor, worldHash: "bad" },
    { ...descriptor, pointIn: { ...descriptor.pointIn, id: 2 } },
    { ...descriptor, pointIn: { ...descriptor.pointIn, x: 1.5 } },
    { ...descriptor, provenance: { ...descriptor.provenance, storyReachability: "verified" } },
  ]) assert.throws(() => parseGameDevelopmentEntry(value));
  let reads = 0;
  const accessor = { ...descriptor };
  Object.defineProperty(accessor, "worldHash", { enumerable: true, get: () => { reads++; return descriptor.worldHash; } });
  assert.throws(() => parseGameDevelopmentEntry(accessor), /fields/); assert.equal(reads, 0);
});

test("same original data must satisfy all pins, source domains and the exact source PointIn", async () => {
  const raw = input(), field = await compileDevelopmentMapEntry(raw), before = structuredClone(raw);
  assert.deepEqual(validateGameDevelopmentEntryBindings(field, raw.baseBattle, raw.catalog, raw.map), field.developmentEntry);
  for (const key of ["baseFieldHash", "battleHash", "worldHash", "mapHash"] as const) {
    const bad = structuredClone(field); bad.developmentEntry![key] = "0".repeat(64);
    await assert.rejects(assertGameDevelopmentEntry(sealBatchContent(bad), raw.baseBattle, raw.catalog, raw.map));
  }
  const moved = structuredClone(field); moved.developmentEntry!.pointIn.x++;
  await assert.rejects(assertGameDevelopmentEntry(sealBatchContent(moved), raw.baseBattle, raw.catalog, raw.map), /PointIn/);
  const otherSource = structuredClone(raw.map); otherSource.parentSourceSetHash = "another-source";
  assert.throws(() => validateGameDevelopmentEntryBindings(field, raw.baseBattle, raw.catalog, otherSource), /source identity/);
  assert.deepEqual(raw, before);
});

test("rehashed baseline changes and arbitrary development omissions cannot borrow the original seed identity", async () => {
  const raw = input(), field = await compileDevelopmentMapEntry(raw);
  const changed = structuredClone(field); changed.entry.initialEventValues![0]!.value = 1;
  await assert.rejects(assertGameDevelopmentEntry(sealBatchContent(changed), raw.baseBattle, raw.catalog, raw.map), /payload changed/);
  const marker = structuredClone(field); marker.developmentProfile!.sourceContentHash = "0".repeat(64);
  await assert.rejects(assertGameDevelopmentEntry(sealBatchContent(marker), raw.baseBattle, raw.catalog, raw.map), /baseline/);
  const omission = structuredClone(field); omission.developmentProfile!.omissions.push({
    kind: "field-effect", mapId: 2, group: "entity_default", entityId: "x",
    source: { file: "synthetic", assetPath: "effect" }, sourceMapContentHash: raw.map.contentHash, reason: "unrelated override",
  });
  await assert.rejects(assertGameDevelopmentEntry(sealBatchContent(omission), raw.baseBattle, raw.catalog, raw.map), /baseline/);
});

test("compiler refuses nesting or source-profile destinations rather than relabelling source entry", async () => {
  const raw = input(), field = await compileDevelopmentMapEntry(raw);
  await assert.rejects(compileDevelopmentMapEntry({ ...raw, baseField: field }), /raw development baseline/);
  const { developmentProfile: _worldProfile, ...noProfile } = structuredClone(raw.catalog);
  await assert.rejects(compileDevelopmentMapEntry({ ...raw, catalog: sealBatchContent(noProfile) }), /framework/);
  const { developmentProfile: _mapProfile, ...noMapProfile } = structuredClone(raw.map);
  const map = sealBatchContent(noMapProfile), catalog = structuredClone(raw.catalog);
  catalog.maps[2]!.contentHash = map.contentHash;
  await assert.rejects(compileDevelopmentMapEntry({ ...raw, map, catalog: sealBatchContent(catalog) }), /profile/);
});

test("private relocation executes the original initializer without a clock shim and restores it once", async () => {
  const raw = input(), field = await compileDevelopmentMapEntry(raw), flow = new GameFlow(), entries = new GameEntryLoader(flow, { discard() {} });
  const game = await prepareGameDevelopmentEntry(field, raw.baseBattle, raw.catalog, raw.map, { battleHandoff: "prepared" }, 314);
  assert.equal(flow.hasSession, false);
  assert.equal(game.field.content.map.identity!.mapId, 2);
  assert.deepEqual([game.field.player.x, game.field.player.y, game.field.player.layer], [1, 1, 1]);
  assert.equal(game.state.snapshot().completedBattles.length, 0);
  assert.equal(game.field.eventState.read({ category: "ScenarioFlag1", index: 9 }), 1);
  assert.equal(game.field.time, 0, "The existing entry VM pumps immediate commands without extra elapsed");
  assert.equal(game.field.entrySynchronized, true); assert.equal(game.checkpointReady, true);
  assert.equal(entries.begin("new-game").commit({ session: game, presentation: null }).status, "committed");
  flow.advance(10, host);
  assert.equal(game.field.eventState.read({ category: "ScenarioFlag1", index: 9 }), 1);
  assert.deepEqual(game.state.snapshot().items, [{ id: 10, count: 1 }]);
  assert.equal(game.checkpointReady, true); assert.equal(game.menuReady, true);
  const checkpoint = game.checkpoint();
  assert.deepEqual(checkpoint.origin, { kind: "development-checkpoint" });
  assert.equal(checkpoint.world.initialHash, field.contentHash);
  assert.equal(checkpoint.world.location!.catalogHash, raw.catalog.contentHash);
  const restored = GameSession.restore(checkpoint, field, raw.baseBattle, { catalog: raw.catalog, map: raw.map }, { battleHandoff: "prepared" });
  assert.deepEqual(restored.checkpoint(), checkpoint);
  restored.advance(10);
  assert.deepEqual(restored.state.snapshot().items, [{ id: 10, count: 1 }]);
  assert.equal(restored.field.eventState.read({ category: "ScenarioFlag1", index: 9 }), 1);
});

test("concurrent caller changes cannot redirect the captured private relocation or initial owners", async () => {
  const raw = input(), field = await compileDevelopmentMapEntry(raw);
  const pending = prepareGameDevelopmentEntry(field, raw.baseBattle, raw.catalog, raw.map, { battleHandoff: "prepared" }, 314);
  field.developmentEntry!.startMap = 1;
  raw.baseBattle.gameState.initialGil = 0;
  raw.map.partyEntry!.pointIns[0]!.x = 3;
  raw.catalog.contentHash = "0".repeat(64);
  const game = await pending;
  assert.equal(game.field.content.map.identity!.mapId, 2);
  assert.equal(game.field.player.x, 1);
  assert.equal(game.state.gil, 90);
  assert.equal(game.checkpoint().world.location!.mapId, 2);
});

test("missing original initializer fails private preparation without touching the caller's baseline", async () => {
  const raw = input(), map = structuredClone(raw.map);
  delete map.scripts.init;
  const nextMap = sealBatchContent(map), catalog = structuredClone(raw.catalog);
  catalog.maps[2]!.contentHash = nextMap.contentHash;
  const changed = { ...raw, map: nextMap, catalog: sealBatchContent(catalog) }, before = structuredClone(changed);
  const field = await compileDevelopmentMapEntry(changed);
  await assert.rejects(prepareGameDevelopmentEntry(field, changed.baseBattle, changed.catalog, changed.map), /script|脚本/i);
  assert.deepEqual(changed, before);
});
