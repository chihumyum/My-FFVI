import test from "node:test";
import assert from "node:assert/strict";
import { nonEncounterSessionFixture } from "./fixtures/non-encounter-area-session.js";
import { encounterReady } from "./fixtures/source-encounter-session.js";
import { sealBatchContent } from "./fixtures/content-batch.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";
import { GameEventSaveCoordinator } from "../src/core/game-event-save.js";
import { WEB_SOURCE_FIELD_UI, type FieldUiCommand } from "../src/core/field-ui.js";
import type { Op } from "../src/field/types.js";
import { compileFieldAutoSaveInstruction } from "../src/compiler/field-auto-save.js";
import { WEB_AUTO_SAVE_POLICY } from "../src/core/field-auto-save.js";
import { autoSaveRaw } from "./fixtures/field-auto-save.js";
const command = (kind: "event" | "all" | "minimap"): FieldUiCommand => ({ kind });
const first: FieldUiCommand = { kind: "title", location: { areaId: "AREA_A", locationId: "LOC_A" }, area: "Region", title: "Town" };
const second: FieldUiCommand = { kind: "title", location: { areaId: "", locationId: "LOC_B" }, area: "", title: "Cave" };
function fixture(runtime = true, initializer = false, autoSave = false) {
  const f = nonEncounterSessionFixture();
  const commands: Record<string, Record<string, unknown>[]> = {
    "ui-title": [{ kind: "source-field-ui", command: first }, { kind: "exit" }],
    "ui-second": [{ kind: "source-field-ui", command: second }, { kind: "exit" }],
    "ui-minimap": [{ kind: "source-field-ui", command: command("minimap") }, { kind: "exit" }],
    "ui-event": [{ kind: "source-field-ui", command: command("event") }, { kind: "exit" }],
    "ui-all": [{ kind: "source-field-ui", command: command("all") }, { kind: "exit" }],
    "ui-checkpoint": [{ kind: "source-field-ui", command: command("minimap") }, { kind: "event-save" },
      { kind: "source-field-ui", command: command("all") }, { kind: "exit" }],
    "ui-title-save": [{ kind: "source-field-ui", command: first }, compileFieldAutoSaveInstruction(autoSaveRaw()),
      { kind: "source-field-ui", command: second }, { kind: "exit" }],
  };
  if (autoSave) for (const content of [f.map, f.world, f.content]) {
    content.developmentProfile ??= { kind: "framework-development-v1", policy: "omit-anonymous-environment-particles-v1",
      sourceContentHash: content.contentHash, omissions: [] };
    content.developmentProfile.autoSave = WEB_AUTO_SAVE_POLICY;
  }
  for (const [name, values] of Object.entries(commands)) {
    f.map.scripts[name] = values.map((value, index) => ({ ...value, script: name, index, source: f.source }) as Op);
    f.map.scriptPuppetContexts![name] = { ...f.map.scriptPuppetContexts!.reserved!, scriptHash: "7".repeat(64) };
    f.map.scriptLocals![name] = null; f.map.scriptTransitionMetadata![name] = { customAnimations: "none" };
    f.map.scriptSystemFlags![name] = { keepBadStatusVisual: false };
  }
  if (initializer) f.map.initializer = "ui-second";
  Object.assign(f.map, sealBatchContent(f.map)); f.world.maps[f.map.mapId]!.contentHash = f.map.contentHash;
  Object.assign(f.world, sealBatchContent(f.world)); f.content.mapContentHash = f.map.contentHash;
  f.content.worldCatalogHash = f.world.contentHash; Object.assign(f.content, sealBatchContent(f.content));
  if (runtime) f.runtime.sourceFieldUi = WEB_SOURCE_FIELD_UI;
  return f;
}
type Live = ReturnType<ReturnType<typeof fixture>["make"]>;
function run(live: Live, name: string) {
  assert.equal(live.game.field.startEvent(name), true);
  for (let i = 0; i < 20 && live.game.field.busy && !live.game.field.stop; i++) live.flow.advance(10, encounterReady);
  assert.equal(live.game.field.stop, null, live.game.field.stop?.message);
}
function stable(live: Live) {
  for (let i = 0; i < 300 && !live.game.checkpointReady; i++) live.flow.advance(10, encounterReady);
  assert.equal(live.game.checkpointReady, true, live.game.field.stop?.message);
}
test("actual Session/Flow keeps title nonblocking, persists one location owner, pauses its existing clock, and restores via Storage", async () => {
  const f = fixture(), live = f.make(); run(live, "ui-title");
  assert.deepEqual(live.game.state.fieldLocation.read(), first.location);
  assert.equal(live.game.state.snapshot().formatVersion, 16);
  assert.ok(live.game.field.sourceFieldUiSnapshot?.title); assert.equal(live.game.checkpointReady, true);
  assert.equal(live.flow.move("up"), true, "a nonblocking map title does not suspend player movement");
  live.flow.advance(240, encounterReady);
  const before = live.game.field.sourceFieldUiSnapshot;
  assert.equal(live.flow.pause(true), true); live.flow.advance(3000, encounterReady);
  assert.deepEqual(live.game.field.sourceFieldUiSnapshot, before); assert.equal(live.flow.pause(false), true);
  stable(live); run(live, "ui-minimap"); run(live, "ui-event"); run(live, "ui-all"); stable(live);
  assert.deepEqual([live.game.field.sourceFieldUiSnapshot?.mainGameState, live.game.field.sourceFieldUiSnapshot?.view], [12, "all"]);
  const bytes = new Map<string, string>(), storage = new CheckpointStorage({ getItem: key => bytes.get(key) ?? null, setItem: (key, value) => { bytes.set(key, value); } }, "framework", "field-ui");
  const checkpoint = live.game.checkpoint(); assert.equal(checkpoint.world.field.kind, "idle-field-v18");
  await storage.save(checkpoint, 10); const saved = (await storage.load())!.checkpoint, restored = f.restore(saved);
  assert.deepEqual(restored.checkpoint(), saved); assert.deepEqual(restored.state.fieldLocation.read(), first.location);
  assert.equal(restored.field.startEvent("ui-second"), true); restored.advance(10);
  assert.deepEqual(restored.state.fieldLocation.read(), second.location);
  delete f.runtime.sourceFieldUi; assert.throws(() => f.restore(saved), /runtime authority/);
});
test("map failure/cancel/stale candidate cannot publish draft location; committed map carries source UI and retires old mutations", () => {
  const f = fixture(), live = f.make(); run(live, "ui-title"); stable(live); run(live, "ui-minimap");
  const old = live.game.field, state = live.game.state.snapshot();
  assert.equal(old.startEvent("region-travel"), true);
  const cancelled = live.game.world.prepare(f.world, f.map); assert.deepEqual(cancelled.field.sourceFieldUiSnapshot, old.sourceFieldUiSnapshot);
  live.game.world.discard(cancelled); assert.deepEqual(live.game.state.snapshot(), state);
  assert.equal(cancelled.field.startEvent("ui-second"), true); assert.equal(cancelled.field.stop?.kind, "unsupported");
  assert.deepEqual(live.game.state.snapshot(), state);
  const stale = live.game.world.prepare(f.world, f.map), current = live.game.world.prepare(f.world, f.map);
  assert.equal(live.game.world.commit(current), true); assert.equal(live.game.world.commit(stale), false);
  assert.deepEqual(live.game.field.sourceFieldUiSnapshot?.view, "navi"); stable(live);
  assert.equal(old.startEvent("ui-second"), false); assert.equal(old.stop?.kind, "map-transition");
  assert.deepEqual(live.game.state.snapshot().sourceLocation, state.sourceLocation);
  run(live, "ui-second"); assert.deepEqual(live.game.state.fieldLocation.read(), second.location);
});
test("actual battle return preserves UI state and location without borrowing another persistent owner", async () => {
  const f = fixture(), live = f.make(); run(live, "ui-title"); stable(live); run(live, "ui-minimap"); run(live, "ui-title");
  assert.equal(live.game.field.startEvent("source-fight"), true);
  for (let i = 0; i < 100 && !live.game.field.stop; i++) live.flow.advance(10, encounterReady);
  const before = live.game.field.sourceFieldUiSnapshot;
  const handoff = new GameBattleHandoff(live.flow, { prepareStart: async () => ({}), prepareReturn: async () => ({}), discard() {} });
  assert.equal((await handoff.start()).status, "committed");
  const battle = live.game.battle!;
  for (let i = 0; i < 2500 && battle.phase === "active"; i++) {
    for (const actor of battle.ready) { const enemy = battle.enemies.find(unit => unit.hp > 0); if (enemy) live.commands.command(battle, actor.id, 10, { kind: "single", id: enemy.id }, 100); }
    live.flow.advance(20, encounterReady);
  }
  assert.equal(battle.phase, "victory"); assert.equal(live.game.field.sourceFieldUiSnapshot?.title, null, "real Session battle ticks close the current title");
  assert.equal((await handoff.return()).status, "committed"); stable(live);
  assert.deepEqual(live.game.state.fieldLocation.read(), first.location);
  assert.equal(live.game.field.sourceFieldUiSnapshot?.mainGameState, before?.mainGameState);
  assert.equal(live.game.field.sourceFieldUiSnapshot?.view, before?.view); assert.equal(live.game.state.completedEncounters.length, 1);
});
test("missing runtime and failed publication retain original durable values and no title", () => {
  const f = fixture(false), live = f.make(), before = live.game.state.snapshot();
  assert.equal(live.game.field.startEvent("ui-title"), true); assert.equal(live.game.field.stop?.kind, "unsupported");
  assert.deepEqual(live.game.state.snapshot(), before); assert.equal(live.game.field.sourceFieldUiSnapshot, null);
  const location = live.game.state.fieldLocation.prepare(first.location);
  assert.throws(() => location.commitWith(() => { throw new Error("host failed"); }), /host failed/);
  assert.deepEqual(live.game.state.snapshot(), before);
});

test("event barrier Storage resumes after UI state without replaying it or upgrading an old untouched save", async () => {
  const f = fixture(), live = f.make(), legacy = live.game.checkpoint();
  const initialProjection = live.game.field.sourceFieldUiSnapshot; assert.equal(initialProjection, null);
  assert.deepEqual(f.restore(legacy).checkpoint(), legacy, "enabling a runtime cannot fill an old UI or location state");
  run(live, "ui-title"); stable(live); assert.equal(live.game.field.startEvent("ui-checkpoint"), true);
  assert.ok(live.game.eventSaveRequest);
  const bytes = new Map<string, string>(), storage = new CheckpointStorage({ getItem: key => bytes.get(key) ?? null,
    setItem: (key, value) => { bytes.set(key, value); } }, "framework", "ui-event");
  const coordinator = new GameEventSaveCoordinator(live.flow, storage);
  assert.equal((await coordinator.save(25)).status, "committed");
  const saved = (await storage.load())!.checkpoint; assert.equal(saved.world.field.kind, "event-field-v9");
  const restored = f.restore(saved); assert.equal(restored.field.sourceFieldUiSnapshot?.view, "navi");
  live.flow.advance(10, encounterReady); restored.advance(10);
  assert.equal(live.game.field.sourceFieldUiSnapshot?.view, "all"); assert.equal(restored.field.sourceFieldUiSnapshot?.view, "all");
  assert.equal(restored.field.sourceFieldUiSnapshot?.mainGameState, 11, "ShowAll does not change MainGame state");
  assert.deepEqual(restored.checkpoint(), live.game.checkpoint());
});


test("a real destination initializer writes only its existing owned draft until the winning map is committed", () => {
  const f = fixture(true, true), live = f.make(); run(live, "ui-title"); stable(live);
  assert.equal(live.game.field.startEvent("region-travel"), true);
  const owned = live.game.state.snapshot(), cancelled = live.game.world.prepare(f.world, f.map);
  assert.equal(cancelled.field.sourceFieldUiSnapshot?.title?.title, "Cave");
  assert.deepEqual(live.game.state.snapshot(), owned); live.game.world.discard(cancelled);
  assert.deepEqual(live.game.state.snapshot(), owned);
  const stale = live.game.world.prepare(f.world, f.map), winner = live.game.world.prepare(f.world, f.map);
  assert.deepEqual(live.game.state.snapshot(), owned); assert.equal(live.game.world.commit(winner), true);
  assert.deepEqual(live.game.state.fieldLocation.read(), second.location);
  assert.equal(live.game.world.commit(stale), false); assert.deepEqual(live.game.state.fieldLocation.read(), second.location);
  stable(live); const saved = live.game.checkpoint(); assert.deepEqual(f.restore(saved).checkpoint(), saved);
});

test("source title→AutoSave persists the active callback queue; quota failure, cancellation and retry cannot close or replay it", async () => {
  const f = fixture(true, false, true), live = f.make(); run(live, "ui-title");
  live.flow.advance(1000, encounterReady);
  assert.equal(live.game.field.startEvent("ui-title-save"), true);
  assert.equal(live.game.eventSaveRequest, null, "source AutoSave keeps its first-clock yield");
  live.flow.advance(10, encounterReady);
  const request = live.game.eventSaveRequest!, ui = live.game.field.sourceFieldUiSnapshot!;
  assert.ok(request); assert.equal(ui.closeTimers.length, 2); assert.equal(ui.title?.title, "Town");
  const owner = live.game.state, field = live.game.field, bytes = new Map<string, string>(); let fail = true, writes = 0;
  const storage = new CheckpointStorage({ getItem: key => bytes.get(key) ?? null, setItem: (key, value) => {
    if (fail) throw new Error("controlled quota"); writes++; bytes.set(key, value);
  } }, "framework", "active-ui");
  const coordinator = new GameEventSaveCoordinator(live.flow, storage);
  assert.equal((await coordinator.save(1)).status, "failed"); assert.equal(writes, 0);
  assert.equal(live.game.eventSaveRequest, request); assert.deepEqual(field.sourceFieldUiSnapshot, ui);
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>(yes => { entered = yes; }), ready = new Promise<void>(yes => { release = yes; });
  const cancelled = new GameEventSaveCoordinator(live.flow, { prepareSave: async (...args) => {
    const prepared = await storage.prepareSave(...args); entered(); await ready; return prepared;
  } });
  const pending = cancelled.save(2); await waiting;
  live.flow.advance(3000, encounterReady); assert.deepEqual(field.sourceFieldUiSnapshot, ui, "preparation freezes the existing clock");
  cancelled.cancel(); release(); assert.equal((await pending).status, "cancelled"); assert.equal(writes, 0);
  assert.equal(live.game.eventSaveRequest, request); assert.deepEqual(field.sourceFieldUiSnapshot, ui);
  fail = false; assert.equal((await coordinator.save(3)).status, "committed"); assert.equal(writes, 1);
  assert.equal(live.game.state, owner); assert.equal(live.game.field, field);
  const saved = (await storage.load())!.checkpoint; assert.equal(saved.world.field.kind, "event-field-v9");
  const restored = f.restore(saved); assert.deepEqual(restored.field.sourceFieldUiSnapshot, ui);
  live.flow.advance(10, encounterReady); restored.advance(10);
  assert.equal(restored.field.sourceFieldUiSnapshot?.title?.title, "Cave");
  assert.equal(restored.field.sourceFieldUiSnapshot?.closeTimers.length, 3, "post-save title runs once without replaying the first two");
  assert.deepEqual(restored.checkpoint(), live.game.checkpoint());
  const at = restored.field.sourceFieldUiSnapshot!.clockMs;
  live.flow.advance(2000 - at, encounterReady); restored.advance(2000 - at);
  assert.equal(restored.field.sourceFieldUiSnapshot?.title, null, "the earlier callback closes the later title after restore");
  assert.deepEqual(restored.checkpoint(), live.game.checkpoint());
  assert.equal(restored.state.fieldLocation.read()?.locationId, second.location.locationId);
});

test("active idle UI round-trips without advancing time or granting a missing runtime; malformed and foreign queues reject", async () => {
  const f = fixture(), live = f.make(); run(live, "ui-title"); live.flow.advance(170, encounterReady);
  const ui = live.game.field.sourceFieldUiSnapshot!; assert.ok(ui.title); assert.equal(live.game.checkpointReady, true);
  const saved = live.game.checkpoint(), restored = f.restore(saved);
  assert.deepEqual(restored.checkpoint(), saved); assert.deepEqual(restored.field.sourceFieldUiSnapshot, ui);
  for (const change of ["foreign", "no-callback", "later-deadline"] as const) {
    const forged = structuredClone(saved), state = (forged.world.field as { sourceUi: typeof ui }).sourceUi;
    if (change === "foreign") state.sourceSetHash = "foreign";
    else if (change === "no-callback") state.closeTimers = [];
    else state.closeTimers.push(state.clockMs + 9000);
    assert.throws(() => f.restore(forged));
  }
  delete f.runtime.sourceFieldUi; assert.throws(() => f.restore(saved), /runtime authority/);
  assert.deepEqual(live.game.field.sourceFieldUiSnapshot, ui);
});
