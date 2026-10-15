import assert from "node:assert/strict";
import test from "node:test";
import { compileFieldInternalClockInstruction } from "../src/compiler/field-internal-clock.js";
import { decodeFieldOp } from "../src/compiler/field.js";
import { GameSession } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameEventSaveCoordinator } from "../src/core/game-event-save.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import type { Op } from "../src/field/types.js";
import { transitionFixture, set, mapVar, exit, label } from "./fixtures/event-script-transition.js";
import { gameEventSaveFixture, eventSaveReadyHost, afterEventSave } from "./fixtures/game-event-save.js";

const source = { file: "authored-clock-batch", assetPath: "Fixtures/InternalClock", objectId: "9223372036854775700" };
const blank = { kind: "blank" } as const;

test("only exact source Nop and Blank domains ignore their unconsumed editor operands", () => {
  for (const type of [1, 2]) for (const mnemonic of ["Nop", "Blank"]) {
    for (const operands of [undefined, { iValues: [6], rValues: [-420, 0.5], sValues: ["disabled editor data"] }]) {
      const raw = { mnemonic, type, ...(operands ? { operands } : {}) };
      const site = { script: "main", index: 0, source };
      assert.equal(decodeFieldOp(raw, site, {}).kind, mnemonic === "Nop" ? "nop" : "blank");
      assert.equal(decodeFieldOp(raw, site, {}).source.objectId, source.objectId);
    }
  }
  for (const raw of [{ mnemonic: "Nop", type: 0 }, { mnemonic: "Blank", type: 3 },
    { mnemonic: "Unknown", type: 1 }, { mnemonic: "Blank ", type: 2 }, { mnemonic: "Blank" }])
    assert.throws(() => compileFieldInternalClockInstruction(raw));
});

test("consecutive Blank instructions suspend the same task once each and zero-time pumps cannot drain them", () => {
  const f = transitionFixture({ main: [set(mapVar(), 1), blank, set(mapVar(), 2), blank, set(mapVar(), 3), exit] });
  const field = f.create(); field.startEvent("main");
  assert.equal(f.state.read(mapVar()), 1); assert.equal(field.checkpointReady, false);
  assert.throws(() => field.checkpoint()); field.advance(0); assert.equal(f.state.read(mapVar()), 1);
  field.advance(10); assert.equal(f.state.read(mapVar()), 2); assert.equal(field.checkpointReady, false);
  field.advance(0); assert.equal(f.state.read(mapVar()), 2);
  field.advance(10); assert.equal(f.state.read(mapVar()), 3); assert.equal(field.checkpointReady, true);
  field.advance(500); assert.equal(f.state.read(mapVar()), 3); assert.equal(field.stop, null);
});

test("a source puppet Blank yields without losing its slot or letting the main outrun synchronous completion", () => {
  const f = transitionFixture({ main: [{ kind: "puppet", slot: 0, actor: "npc", target: 4 },
    { kind: "exec-puppets", asynchronous: false }, set(mapVar(1), 1), exit,
    label, blank, set(mapVar(), 1), exit] });
  const field = f.create(); field.startEvent("main");
  assert.equal(f.state.read(mapVar()), 0); assert.equal(f.state.read(mapVar(1)), 0);
  field.advance(0); assert.equal(f.state.read(mapVar()), 0);
  field.advance(10); assert.equal(f.state.read(mapVar()), 1); assert.equal(f.state.read(mapVar(1)), 0);
  field.advance(10); assert.equal(f.state.read(mapVar(1)), 1);
  assert.equal(field.checkpointReady, true); assert.equal(field.stop, null);
});

test("Blank across a durable event barrier restores through the same session and never repeats earlier grants", async () => {
  const f = gameEventSaveFixture(), original = f.field.scripts.saveFlow!;
  const instructions = [original[0]!, blank, original[1]!, blank, ...original.slice(2)];
  f.field.scripts.saveFlow = instructions.map((op, index) => ({ ...op, script: "saveFlow", index, source } as Op));
  const session = new GameSession(f.field, f.battle, 314), flow = new GameFlow(session);
  flow.start(); flow.advance(0, eventSaveReadyHost); session.field.eventState.write(afterEventSave, 0);
  const memory = new Map<string, string>(), storage = new CheckpointStorage({
    getItem: key => memory.get(key) ?? null, setItem: (key, value) => { memory.set(key, value); } });
  assert.equal(session.field.startEvent("saveFlow"), true); assert.equal(f.itemCount(session), 2);
  assert.equal(session.eventSaveRequest, null); session.advance(0); assert.equal(session.eventSaveRequest, null);
  session.advance(10); assert.ok(session.eventSaveRequest);
  assert.equal((await new GameEventSaveCoordinator(flow, storage).save(1)).status, "committed");
  const saved = (await storage.load())!, restored = GameSession.restore(saved.checkpoint, f.field, f.battle);
  for (const owner of [session, restored]) {
    owner.advance(10); assert.equal(f.itemCount(owner), 2); assert.equal(owner.checkpointReady, false);
    owner.advance(0); assert.equal(f.itemCount(owner), 2);
    owner.advance(10); assert.equal(f.itemCount(owner), 5); assert.equal(owner.field.eventState.read(afterEventSave), 1);
    assert.equal(owner.checkpointReady, true);
  }
  assert.deepEqual(restored.checkpoint(), session.checkpoint());
});
