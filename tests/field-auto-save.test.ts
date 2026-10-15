import assert from "node:assert/strict";
import test from "node:test";
import { compileFieldAutoSaveInstruction } from "../src/compiler/field-auto-save.js";
import { decodeFieldOp } from "../src/compiler/field.js";
import { SOURCE_AUTO_SAVE, WEB_AUTO_SAVE_POLICY, assertFieldEventSaveAdmission } from "../src/core/field-auto-save.js";
import { FieldGame } from "../src/core/field.js";
import { GameSession } from "../src/core/game-session.js";
import { GameEventSaveCoordinator } from "../src/core/game-event-save.js";
import { CheckpointStorage, type PreparedSave } from "../src/core/saved-game.js";
import type { Op } from "../src/field/types.js";
import { gameEventSaveFixture, afterEventSave } from "./fixtures/game-event-save.js";
import { autoSaveRaw as raw, autoSaveSource as source, sourceAutoSaveFixture } from "./fixtures/field-auto-save.js";
import { transitionFixture, exit, label } from "./fixtures/event-script-transition.js";

function memoryStorage() {
  const values = new Map<string, string>(); let writes = 0, fail = false;
  return { values, get writes() { return writes; }, set fail(value: boolean) { fail = value; },
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { if (fail) throw new Error("controlled quota"); writes++; values.set(key, value); } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve };
}

test("source AutoSave decodes all complete slots and retains large source IDs; malformed forms block", () => {
  const site = { script: "saveFlow", index: 1, source };
  const op = decodeFieldOp(raw(), site, {});
  assert.deepEqual(op, { ...site, kind: "event-save", sourceAutoSave: SOURCE_AUTO_SAVE });
  for (const bank of ["iValues", "rValues", "sValues"] as const) for (let index = 0; index < 8; index++) {
    const changed = raw(); changed.operands[bank][index] = bank === "sValues" ? "unknown" : 1;
    assert.throws(() => compileFieldAutoSaveInstruction(changed));
    assert.equal(decodeFieldOp(changed, site, {}).kind, "blocked");
  }
  for (const changed of [{ ...raw(), type: 0 }, { ...raw(), operands: { ...raw().operands, iValues: [0] } },
    { ...raw(), operands: { ...raw().operands, unknown: 0 } }])
    assert.throws(() => compileFieldAutoSaveInstruction(changed));
});

test("source first clock yields, leaves existing owners intact, then shares the ordinary save request", () => {
  const f = sourceAutoSaveFixture(), field = f.session.field, world = f.session.world, owned = f.session.state;
  const position = { x: field.player.x, y: field.player.y, layer: field.player.layer, direction: field.player.direction };
  assert.equal(field.startEvent("saveFlow"), true);
  assert.equal(f.itemCount(), 2); assert.equal(f.session.eventSaveRequest, null);
  assert.equal(field.checkpointReady, false); assert.throws(() => field.checkpoint(), /save during field movement or an event/i);
  field.advance(0); assert.equal(field.eventSaveRequest, null);
  field.advance(10); const request = field.eventSaveRequest!; assert.ok(request);
  assert.equal(request.site.source.objectId, source.objectId);
  assert.deepEqual({ x: field.player.x, y: field.player.y, layer: field.player.layer, direction: field.player.direction }, position);
  assert.equal(f.session.field, field); assert.equal(f.session.world, world); assert.equal(f.session.state, owned);
  assert.equal(f.itemCount(), 2); assert.equal(field.eventState.read(afterEventSave), 0);
  field.advance(10000); assert.equal(field.eventSaveRequest, request); assert.equal(f.itemCount(), 2);
  const legacy = gameEventSaveFixture(); assert.ok(legacy.start(), "authored old barriers keep their first-clock behavior");
});

test("unencoded parallel owners reject AutoSave before its first yield rather than completing them for storage", () => {
  const f = transitionFixture({ main: [{ kind: "puppet", slot: 0, actor: "npc", target: 3 },
    compileFieldAutoSaveInstruction(raw()), exit, label, { kind: "wait", seconds: 5 }, exit] });
  f.content.developmentProfile = { kind: "framework-development-v1", policy: "omit-anonymous-environment-particles-v1",
    sourceContentHash: "a".repeat(64), omissions: [], autoSave: WEB_AUTO_SAVE_POLICY };
  const field = f.create(); field.startEvent("main");
  assert.equal(field.stop?.kind, "unsupported"); assert.match(field.stop!.message, /quiescent main task/);
  assert.equal(field.eventSaveRequest, null);
});

test("strict source and malformed policy cannot execute or restore source AutoSave", () => {
  const strict = sourceAutoSaveFixture(false); strict.session.field.startEvent("saveFlow");
  assert.equal(strict.session.field.stop?.kind, "unsupported"); assert.match(strict.session.field.stop!.message, /explicit Web/);
  assert.equal(strict.session.eventSaveRequest, null); assert.equal(strict.itemCount(), 2);
  const f = sourceAutoSaveFixture(), request = f.start(), checkpoint = f.session.field.eventCheckpoint(request);
  const untrusted = structuredClone(f.field); delete untrusted.developmentProfile;
  assert.throws(() => FieldGame.restore(untrusted, checkpoint), /explicit Web.*policy/);
  const forged = structuredClone(f.field.scripts.saveFlow![1]!) as Extract<Op, { kind: "event-save" }>;
  forged.source.assetPath = "another-source";
  assert.throws(() => assertFieldEventSaveAdmission(f.field, forged), /trusted program/);
  const bad = structuredClone(f.field); bad.developmentProfile!.autoSave = "unknown" as typeof WEB_AUTO_SAVE_POLICY;
  assert.throws(() => FieldGame.restore(bad, checkpoint), /explicit Web.*policy/);
  assert.equal(f.session.eventSaveRequest, request);
});

test("source AutoSave quota failure preserves slots and request; retry/restore do not replay grants or initialization", async () => {
  const f = sourceAutoSaveFixture(), memory = memoryStorage(), storage = new CheckpointStorage(memory);
  await storage.save(f.session.checkpoint(), 1); const previousBytes = [...memory.values];
  const request = f.start(), coordinator = new GameEventSaveCoordinator(f.flow, storage);
  const field = f.session.field, owned = f.session.state; memory.fail = true;
  assert.equal((await coordinator.save(2)).status, "failed");
  assert.deepEqual([...memory.values], previousBytes); assert.equal(f.session.eventSaveRequest, request);
  assert.equal(f.itemCount(), 2); memory.fail = false;
  assert.equal((await coordinator.save(3)).status, "committed");
  assert.equal(memory.writes, 2); assert.equal(f.itemCount(), 2); assert.equal(f.session.eventSaveRequest, null);
  assert.equal(f.session.field, field); assert.equal(f.session.state, owned);
  const saved = (await storage.load())!, restored = GameSession.restore(saved.checkpoint, f.field, f.battle);
  assert.equal(restored.eventSaveRequest, null); assert.equal(f.itemCount(restored), 2);
  restored.advance(0); assert.equal(f.itemCount(restored), 2);
  f.session.advance(10); restored.advance(10);
  assert.equal(f.itemCount(), 5); assert.equal(f.itemCount(restored), 5);
  assert.equal(restored.field.eventState.read(afterEventSave), 1);
  assert.deepEqual(restored.checkpoint(), f.session.checkpoint());
  restored.advance(1000); assert.equal(f.itemCount(restored), 5); assert.equal(memory.writes, 2);
});

test("cancelled source save encoding cannot ACK or write; fresh retry keeps the same owner", async () => {
  const f = sourceAutoSaveFixture(), memory = memoryStorage(), storage = new CheckpointStorage(memory);
  const ready = deferred<void>(), entered = deferred<void>(); let discarded = 0;
  const coordinator = new GameEventSaveCoordinator(f.flow, { prepareSave: async (...args) => {
    const candidate: PreparedSave = await storage.prepareSave(...args); entered.resolve(); await ready.promise;
    return { ...candidate, discard() { discarded++; candidate.discard(); } };
  } });
  const request = f.start(), pending = coordinator.save(5); await entered.promise;
  coordinator.cancel(); ready.resolve();
  assert.equal((await pending).status, "cancelled"); assert.equal(discarded, 1); assert.equal(memory.writes, 0);
  assert.equal(f.session.eventSaveRequest, request); assert.equal(f.itemCount(), 2);
  assert.equal((await new GameEventSaveCoordinator(f.flow, storage).save(6)).status, "committed");
  f.session.advance(10); assert.equal(f.itemCount(), 5); assert.equal(memory.writes, 1);
});
