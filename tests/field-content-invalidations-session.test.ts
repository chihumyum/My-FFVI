import assert from "node:assert/strict";
import test from "node:test";
import { GameSession, type GameCheckpoint } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameCommands } from "../src/core/game-commands.js";
import { GameEntryLoader } from "../src/core/game-entry-loader.js";
import { GameMapLoader } from "../src/core/game-map-loader.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";
import { GameEventSaveCoordinator } from "../src/core/game-event-save.js";
import { GameContentRepository } from "../src/core/game-content.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { decodeFieldOp } from "../src/compiler/field.js";
import type { Op, Site } from "../src/field/types.js";
import { frameworkNewGameFixture } from "./fixtures/framework-new-game.js";
import { sealBatchContent as seal } from "./fixtures/content-batch.js";

type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;
const host = { visible: true, mediaReady: true, overlayOpen: false };
const source = { file: "tests/field-content-invalidations-session.test.ts", assetPath: "authored/field-permissions" };
function memory() {
  const rows = new Map<string, string>();
  return { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); } };
}
function deferred<T>() {
  let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve };
}
async function fixture() {
  const f = await frameworkNewGameFixture(), map = structuredClone(f.map), battle = structuredClone(f.battle), targetId = map.mapId + 1;
  const emit = (script: string, values: Instruction<Op>[]): Op[] => values.map((op, index) => ({ ...op, script, index, source }) as Op);
  const denial = decodeFieldOp({ mnemonic: "InvalidateTelepo", type: 1, operands: {
    iValues: [1, 0, 0, 0, 0, 0, 0, 0], rValues: Array(8).fill(0), sValues: Array(8).fill("") } },
  { script: "original-physical-name", index: 40, source }, {});
  if (denial.kind !== "field-content-invalidation") throw new Error("Expected typed source permission");
  const { script: _, index: __, source: ___, ...instruction } = denial;
  const context = structuredClone(map.scriptPuppetContexts![map.initializer!]!);
  const add = (name: string, ops: Instruction<Op>[]) => {
    map.scripts[name] = emit(name, ops); map.scriptLocals![name] = null;
    map.scriptPuppetContexts![name] = { ...context, scriptHash: "9".repeat(64) };
  };
  add("deny", [instruction, { kind: "exit" }]);
  add("deny-save", [instruction, { kind: "event-save" }, { kind: "exit" }]);
  add("travel", [{ kind: "change-map", request: { mapId: targetId, entrance: map.partyEntry!.pointIns[0]!.id,
    continuation: null, birdview: false, skipFade: true, skipBgm: true, origin: "script" } }]);
  // A held authored ability has an executable field definition. Its content is
  // an invented moving constant so the test checks real menu exclusion, not IDs.
  const fieldSpell = structuredClone(battle.gameState.fieldAbilities!.abilities[102]!);
  Object.assign(fieldSpell, { id: 220, contentId: 601, typeId: 604 });
  battle.gameState.fieldAbilities!.abilities[220] = fieldSpell;
  battle.common.battleEntry!.movingContents = [{ id: 601, value2: 0 }, { id: 606, value2: 1 }];
  battle.common.battleEntry!.maps.push({ id: targetId, movingAvailability: 1, sleepingAvailability: 1 });
  const target = structuredClone(map); target.mapId = targetId; target.map!.identity!.mapId = targetId;
  target.map!.entryContext!.mapId = targetId; target.partyEntry!.mapId = targetId;
  target.initializer = "arrive"; target.scripts.arrive = emit("arrive", [{ kind: "exit" }]);
  target.scriptLocals!.arrive = null; target.scriptPuppetContexts!.arrive = { ...context, scriptHash: "8".repeat(64) };
  const sealedMap = seal(map), sealedTarget = seal(target), catalog = structuredClone(f.world);
  catalog.transportation = structuredClone(battle.gameState.sourceNewGame!.transportation);
  catalog.maps[String(map.mapId)]!.contentHash = sealedMap.contentHash;
  catalog.maps[String(targetId)] = { ...catalog.maps[String(map.mapId)]!, contentHash: sealedTarget.contentHash,
    url: "/authored/permission-target.json", name: "Authored permission reset" };
  const world = seal(catalog), sealedBattle = seal(battle), content = seal({ ...f.content,
    mapContentHash: sealedMap.contentHash, worldCatalogHash: world.contentHash, battleCatalogHash: sealedBattle.contentHash });
  const files = new Map<string, unknown>([["/framework/world/catalog.json", world], ["/authored/permission-target.json", sealedTarget]]);
  const repository = new GameContentRepository(async url => { if (!files.has(url)) throw new Error("Unknown authored file " + url); return files.get(url); }, "framework");
  const runtime = { battleHandoff: "prepared" as const }, dependencies = { catalog: world, map: sealedMap,
    initialized: { content, initialMap: sealedMap } };
  return { ...f, content, map: sealedMap, target: sealedTarget, world, battle: sealedBattle, repository, targetId,
    start: () => GameSession.prepareFrameworkNewGame(content, world, sealedMap, sealedBattle, runtime, 314),
    restore: (saved: GameCheckpoint) => GameSession.restore(saved, undefined, sealedBattle, dependencies, runtime) };
}
function settle(flow: GameFlow, done: () => boolean, label: string) {
  for (let i = 0; i < 1000; i++) { if (done()) return; assert.notEqual(flow.session.field.stop?.kind, "unsupported", flow.session.field.stop?.message); flow.advance(10, host); }
  assert.fail("Timeout " + label);
}
async function start(f: Awaited<ReturnType<typeof fixture>>) {
  const game = await f.start(), flow = new GameFlow(); flow.start(game); flow.advance(0, host);
  settle(flow, () => game.checkpointReady, "fresh native field"); return { game, flow };
}
const exclusions = (game: GameSession) => game.field.projectBattleInvalidContents(game.battleCatalog.common.battleEntry!,
  game.battleCatalog.gameState.fieldConditions!.transportations).invalidContentIds!;

test("current menu exclusion is a Field mutation, survives Storage restore, and does not alter source map/owned data", async () => {
  const f = await fixture(), { game, flow } = await start(f), field = game.field, native = field.player.native!.entity;
  const owned = game.state.snapshot(), initial = game.checkpoint(); assert.equal(initial.world.field.kind, "idle-field-v10");
  assert.equal(Object.hasOwn(initial.world.field, "contentInvalidations"), false);
  assert.equal(exclusions(game).includes(601), false);
  assert.equal(game.menuAbilities(f.playerIds[0]).find(row => row.abilityId === 220)!.blockers.includes("Field content excludes this ability"), false);
  field.startEvent("deny"); settle(flow, () => game.checkpointReady, "deny completion");
  assert.equal(exclusions(game).includes(601), true); assert.equal(exclusions(game).includes(606), false);
  assert.deepEqual(game.menuAbilities(f.playerIds[0]).find(row => row.abilityId === 220)!.blockers, ["Field content excludes this ability"]);
  assert.deepEqual(game.state.snapshot(), owned); assert.equal(field.player.native!.entity, native);
  assert.equal(f.battle.common.battleEntry!.maps.find(row => row.id === f.map.mapId)!.movingAvailability, 1);
  const saved = game.checkpoint(); assert.equal(saved.world.field.kind, "idle-field-v15");
  const store = new CheckpointStorage(memory(), "source", "authored-field-permissions"); await store.save(saved, 1);
  const loaded = (await store.load())!, restored = f.restore(loaded.checkpoint), oldCommands = new GameCommands(flow, game);
  const entries = new GameEntryLoader(flow, { discard: (_: null) => {} });
  assert.equal(entries.begin("load").commit({ session: restored, presentation: null }).status, "committed");
  flow.advance(0, host); assert.equal(oldCommands.menuReady, false);
  assert.deepEqual(restored.checkpoint(), saved); assert.equal(exclusions(restored).includes(601), true);
  restored.field.startEvent("deny"); settle(flow, () => restored.checkpointReady, "idempotent source re-execution");
  assert.deepEqual(restored.field.contentInvalidationsSnapshot, field.contentInvalidationsSnapshot);
  assert.deepEqual(restored.state.snapshot(), owned);
});

test("event barrier persists the current Field permission, resumes after ACK, and legacy saves remain unchanged", async () => {
  const f = await fixture(), { game, flow } = await start(f), owned = game.state.snapshot(), legacy = game.checkpoint();
  const restoredLegacy = f.restore(legacy); assert.deepEqual(restoredLegacy.checkpoint(), legacy);
  game.field.startEvent("deny-save"); settle(flow, () => game.eventSaveRequest !== null, "event barrier");
  const request = game.eventSaveRequest, store = new CheckpointStorage(memory(), "source", "authored-permission-event");
  const coordinator = new GameEventSaveCoordinator(flow, store);
  assert.equal((await coordinator.save(2)).status, "committed"); assert.equal(game.eventSaveRequest, null);
  const saved = (await store.load())!.checkpoint; assert.equal(saved.world.field.kind, "event-field-v6");
  const next = f.restore(saved); assert.equal(next.eventSaveRequest, null); assert.equal(exclusions(next).includes(601), true);
  next.advance(10); game.advance(10); assert.equal(next.checkpointReady, true);
  assert.deepEqual(next.state.snapshot(), owned); assert.deepEqual(game.state.snapshot(), owned);
  assert.deepEqual(next.checkpoint(), game.checkpoint()); assert.throws(() => game.prepareEventSave(request!), /Stale|pending/);
});

test("forged dynamic permission cannot change the catalog, source binding, mode, or checkpoint version", async () => {
  const f = await fixture(), { game, flow } = await start(f); game.field.startEvent("deny"); settle(flow, () => game.checkpointReady, "deny");
  const saved = game.checkpoint(); if (saved.world.field.kind !== "idle-field-v15") assert.fail("Expected executed permission codec");
  const before = game.checkpoint();
  for (const mutate of [
    (s: typeof saved) => { if (s.world.field.kind === "idle-field-v15") s.world.field.contentInvalidations.catalogHash = "f".repeat(64); },
    (s: typeof saved) => { if (s.world.field.kind === "idle-field-v15") s.world.field.contentInvalidations.commands[0]!.webPc = 1; },
    (s: typeof saved) => { if (s.world.field.kind === "idle-field-v15") s.world.field.contentInvalidations.commands[0]!.instruction.command.invalidType = 0; },
    (s: typeof saved) => { (s.world.field as { kind: string }).kind = "idle-field-v10"; },
  ]) { const bad = structuredClone(saved); mutate(bad); assert.throws(() => f.restore(bad)); assert.deepEqual(game.checkpoint(), before); }
});

test("failed and cancelled map preparations retain current permissions; only one committed replacement rebuilds them", async () => {
  const f = await fixture(), { game, flow } = await start(f), field = game.field;
  field.startEvent("deny"); settle(flow, () => game.checkpointReady, "deny");
  const native = field.player.native!.entity, owned = game.state.snapshot(), snapshot = field.contentInvalidationsSnapshot;
  field.startEvent("travel"); assert.equal(field.stop?.kind, "map-transition"); const request = field.stop;
  let mode: "fail" | "wait" | "success" = "fail"; const entered = deferred<typeof field>(), media = deferred<typeof field>();
  const loader = new GameMapLoader(flow, f.repository, { prepare: async next => {
    assert.equal(next.contentInvalidationsSnapshot, null);
    if (mode === "fail") throw new Error("Authored missing map media");
    if (mode === "wait") { entered.resolve(next); return media.promise; } return next;
  }, discard: () => {} });
  const failed = await loader.load(); assert.equal(failed.status, "failed");
  if (failed.status !== "failed") assert.fail("Expected private map failure");
  assert.match(String(failed.error), /Authored missing map media/); assert.equal(game.field, field); assert.equal(field.stop, request);
  assert.equal(field.player.native!.entity, native); assert.deepEqual(field.contentInvalidationsSnapshot, snapshot);
  mode = "wait"; const pending = loader.load();
  const abandoned = await Promise.race([entered.promise, pending.then(result => { throw new Error("Map preparation ended before media: " +
    (result.status === "failed" ? String(result.error) : result.status)); })]);
  loader.cancel(); media.resolve(abandoned);
  assert.equal((await pending).status, "cancelled"); assert.equal(game.field, field); assert.deepEqual(field.contentInvalidationsSnapshot, snapshot);
  assert.deepEqual(game.state.snapshot(), owned);
  // A host may inspect a private candidate; making it execute another source
  // command before publication must invalidate that candidate, not the old Field.
  const stale = game.world.prepare(f.world, f.target); stale.field.startEvent("deny"); stale.field.advance(10);
  assert.equal(game.world.commit(stale), false); assert.equal(game.field, field); assert.equal(field.stop, request);
  mode = "success"; assert.equal((await loader.load()).status, "committed");
  settle(flow, () => game.checkpointReady, "committed target"); assert.notEqual(game.field, field);
  assert.equal(game.field.contentInvalidationsSnapshot, null); assert.equal(exclusions(game).includes(601), false);
  assert.deepEqual(field.contentInvalidationsSnapshot, snapshot); assert.deepEqual(game.state.snapshot(), owned);
});

test("failed battle media and retry do not clear Field permissions, and victory returns once to the same Field register", async () => {
  const f = await fixture(), { game, flow } = await start(f), field = game.field;
  field.startEvent("deny"); settle(flow, () => game.checkpointReady, "deny");
  const owned = game.state.snapshot(), snapshot = field.contentInvalidationsSnapshot;
  field.startEvent("stone-battle"); assert.equal(field.stop?.kind, "encounter"); const request = field.stop;
  let failed = false; const handoff = new GameBattleHandoff(flow, {
    prepareStart: async () => { if (!failed) { failed = true; throw new Error("Authored missing battle media"); } return null; },
    prepareReturn: async () => null, discard: () => {},
  });
  assert.equal((await handoff.start()).status, "failed"); assert.equal(game.battle, null); assert.equal(field.stop, request);
  assert.deepEqual(field.contentInvalidationsSnapshot, snapshot); assert.deepEqual(game.state.snapshot(), owned);
  assert.equal((await handoff.start()).status, "committed"); const battle = game.battle!;
  assert.equal(battle.content.qualificationContext!.invalidContentIds!.includes(601), true);
  for (let i = 0; battle.phase === "active" && i < 3000; i++) {
    for (const actor of battle.ready) assert.equal(battle.command(actor.id, 10, battle.enemies[0]!.id, 100), true);
    flow.advance(10, host);
  }
  assert.equal(battle.phase, "victory"); assert.equal((await handoff.return()).status, "committed");
  settle(flow, () => game.checkpointReady, "battle return"); assert.equal(game.field, field);
  assert.deepEqual(field.contentInvalidationsSnapshot, snapshot); assert.equal(exclusions(game).includes(601), true);
  const after = game.state.snapshot(); assert.equal(after.completedBattles.length, 1);
  await assert.rejects(handoff.return(), /pending encounter/); assert.deepEqual(game.state.snapshot(), after);
});
