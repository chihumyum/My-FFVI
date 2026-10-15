import assert from "node:assert/strict";
import test from "node:test";
import { compileSourceMessageSequenceInstruction } from "../src/compiler/source-message-sequence.js";
import { compileManualMessageInstruction } from "../src/compiler/message.js";
import { SOURCE_MESSAGE_SEQUENCE_PROFILE } from "../src/core/source-message-sequence.js";
import { choiceFixture, choiceAssign, choiceExit, choiceDefinition, choiceVariable,
  type ChoiceInstruction } from "./fixtures/field-choice.js";
import type { FieldGameOptions } from "../src/core/field.js";
import { GameSession } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { sourceNativeStateFixture } from "./fixtures/source-native-state.js";

const raw = (duration = 0) => ({ type: 1, mnemonic: "Msg", operands: {
  iValues: [0, 2, 0, 0, 0, 0, 0, 0], rValues: [duration, 0, 0, 0, 0, 0, 0, 0],
  sValues: ["SYNTHETIC", "", "", "", "", "", "", ""] } });
const messages = (text: string) => ({ story_mes_zhc: { SYNTHETIC: text }, story_cha_zhc: { SYNTHETIC: "Guide" } });
const sequence = (text: string, duration = 0, nextMnemonic = "Exit") =>
  compileSourceMessageSequenceInstruction(raw(duration), messages(text), { nextMnemonic });
const context = { kind: SOURCE_MESSAGE_SEQUENCE_PROFILE, layout: "source-explicit-pages" as const,
  integratorAutomatic: false, battleMessageSpeedFactor: 1 };
const options = (groups: number[] = []): FieldGameOptions => ({
  sourceMessageSequence: { prepare: () => ({ context: { ...context }, validate() {} }) },
  sourceMessageEffects: { prepare: effects => () => { groups.push(effects[0]!.group); } },
});
function drive(field: ReturnType<typeof choiceFixture>["field"], ticks = 1000) {
  for (let i = 0; i < ticks && field.busy && !field.stop; i++) {
    field.advance(10);
    if (field.sourceMessage.projection?.acceptsInput || field.dialogue) field.confirm();
  }
}

test("actual FieldGame suspends only the message task through mixed WAIT/PRESS/page and closes once", () => {
  const groups: number[] = [], { field, state } = choiceFixture([
    sequence("First<WAIT01>Second<PRESS>Third<P>Last"), choiceAssign(19), choiceExit ], options(groups));
  field.startEvent("choice"); assert.equal(state.read(choiceVariable()), 0);
  drive(field);
  assert.equal(field.stop, null); assert.equal(field.busy, false); assert.equal(state.read(choiceVariable()), 19);
  assert.equal(field.sourceMessage.active, false); assert.deepEqual(groups, [8, 12]);
  assert.equal(field.checkpointReady, true);
});

test("source synchronous window hands off to legacy ordinary Msg without a group12 gap", () => {
  const groups: number[] = [], ordinary = compileManualMessageInstruction(raw(), messages("Plain next"), { nextMnemonic: "Exit" });
  const { field, state } = choiceFixture([sequence("Inline<WAIT01>tail", 0, "Msg"), ordinary, choiceAssign(22), choiceExit], options(groups));
  field.startEvent("choice"); drive(field);
  assert.equal(field.stop, null); assert.equal(state.read(choiceVariable()), 22);
  assert.deepEqual(groups, [8, 8, 12]); assert.equal(field.sourceMessage.active, false);
});

test("Select releases at text complete and does not reuse confirm as a choice answer", () => {
  const groups: number[] = [], { field, state } = choiceFixture([
    sequence("Prompt<WAIT01>Choose", 0, "Select"), choiceDefinition({ presentation: "yes-no", anchor: "bottom-right" }), choiceAssign(31), choiceExit ], options(groups));
  field.startEvent("choice");
  for (let i = 0; i < 100 && !field.choice && !field.stop; i++) field.advance(10);
  assert.equal(field.stop, null); assert.ok(field.choice);
  const request = field.choice!; field.confirm(); assert.equal(field.choice?.id, request.id);
  assert.equal(field.choose(request.id, 1), true); field.advance(10);
  assert.equal(state.read(choiceVariable()), 31); assert.equal(field.sourceMessage.active, false); assert.deepEqual(groups, [8, 12]);
});

test("Select retaining the prompt transfers to the next ordinary message under one owner", () => {
  const groups: number[] = [], ordinary = compileManualMessageInstruction(raw(), messages("After choice"), { nextMnemonic: "Exit" });
  const { field } = choiceFixture([sequence("Prompt<WAIT01>Choose", 0, "Select"), choiceDefinition({ retainMessage: true }), ordinary, choiceExit], options(groups));
  field.startEvent("choice");
  for (let i = 0; i < 100 && !field.choice && !field.stop; i++) field.advance(10);
  assert.equal(field.choose(field.choice!.id, 0), true); field.advance(10);
  assert.equal(field.dialogue?.text, "After choice"); assert.equal(field.sourceMessage.active, false);
  drive(field); assert.equal(field.stop, null); assert.deepEqual(groups, [8, 8, 12]);
});

test("positive wrapper completes through actual VM without treating duration as a start sleep", () => {
  const groups: number[] = [], { field, state } = choiceFixture([
    sequence("First<WAIT04>Last", .2), choiceAssign(41), choiceExit], options(groups));
  field.startEvent("choice"); field.advance(500); assert.equal(state.read(choiceVariable()), 0);
  drive(field); assert.equal(field.stop, null); assert.equal(state.read(choiceVariable()), 41);
  assert.ok(field.time >= 1500); assert.deepEqual(groups, [8, 12]);
});

test("negative Msg does not block VM, and MsgFinishWait polls rather than republishes the window", () => {
  const groups: number[] = [], { field, state } = choiceFixture([
    sequence("Automatic<WAIT01><AUTO_P>", -1), choiceAssign(1),
    { kind: "source-message", command: { kind: "finish-wait" } }, choiceAssign(2),
    { kind: "source-message", command: { kind: "close" } }, choiceExit ], options(groups));
  field.startEvent("choice"); assert.equal(state.read(choiceVariable()), 1);
  drive(field); assert.equal(field.stop, null); assert.equal(state.read(choiceVariable()), 2);
  assert.deepEqual(groups, [8, 12]); assert.equal(field.sourceMessage.active, false);
});

test("missing or stale timing owner fails before group effect/window/source writes", () => {
  const groups: number[] = [], badOptions = options(groups);
  badOptions.sourceMessageSequence = { prepare: () => ({ context: { ...context }, validate() { throw new Error("stale timing owner"); } }) };
  const stale = choiceFixture([sequence("Text<WAIT01>tail"), choiceAssign(100), choiceExit], badOptions);
  stale.field.startEvent("choice"); assert.match(stale.field.stop?.message ?? "", /stale timing/);
  assert.equal(stale.field.sourceMessage.active, false); assert.equal(stale.state.read(choiceVariable()), 0); assert.deepEqual(groups, []);
  const missingOptions = options(); delete missingOptions.sourceMessageSequence;
  const missing = choiceFixture([sequence("Text<WAIT01>tail"), choiceExit], missingOptions);
  missing.field.startEvent("choice"); assert.match(missing.field.stop?.message ?? "", /profile\/timing owner/);
});

test("a main Exit cannot discard a suspended puppet message or permit stable save", () => {
  const { field } = choiceFixture([
    { kind: "puppet", slot: 0, actor: "npc", target: 4 }, { kind: "exec-puppets", asynchronous: true },
    { kind: "wait", seconds: .01 }, choiceExit, sequence("Puppet<WAIT04>Waiting"), choiceExit,
  ] satisfies ChoiceInstruction[], options());
  field.startEvent("choice"); field.advance(10);
  assert.match(field.stop?.message ?? "", /unfinished source message task/);
  assert.throws(() => field.checkpoint(), /Cannot save/);
});

test("the same session/Flow freezes sequence clocks and input during pause, hidden media or operations", () => {
  const f = choiceFixture([sequence("Before<PRESS>After"), choiceAssign(57), choiceExit]);
  const session = new GameSession(f.content, f.battle, 1, {
    sourceMessageSequence: { prepare: () => ({ context: { ...context }, validate() {} }) },
  }), flow = new GameFlow(session), ready = { visible: true, mediaReady: true, overlayOpen: false };
  flow.start(); flow.advance(0, ready); session.field.startEvent("choice"); flow.advance(30, ready);
  assert.equal(flow.phase, "dialogue"); const snapshot = session.field.sourceMessage.snapshot();
  flow.pause(true); flow.advance(2000, ready); assert.equal(flow.confirm(), false);
  assert.deepEqual(session.field.sourceMessage.snapshot(), snapshot); flow.pause(false);
  flow.advance(2000, { ...ready, visible: false }); assert.equal(flow.confirm(), false);
  assert.deepEqual(session.field.sourceMessage.snapshot(), snapshot);
  flow.advance(2000, { ...ready, mediaReady: false }); assert.equal(flow.confirm(), false);
  assert.deepEqual(session.field.sourceMessage.snapshot(), snapshot);
  flow.advance(10, ready); assert.equal(flow.confirm(), true); assert.equal(session.field.sourceMessage.projection?.text, "BeforeAfter");
  flow.advance(400, ready); flow.confirm(); flow.advance(10, ready);
  assert.equal(session.field.eventState.read(choiceVariable()), 57); assert.equal(flow.phase, "exploration");
});

test("source sequence uses one real GameState owned-name snapshot across all text controls", () => {
  const owner = sourceNativeStateFixture().fresh();
  const op = compileSourceMessageSequenceInstruction(raw(), {
    story_mes_zhc: { SYNTHETIC: "(OWNER_TAG)<WAIT01>Later (OWNER_TAG)<PRESS>End (OWNER_TAG)" },
    story_cha_zhc: { SYNTHETIC: "(OWNER_TAG)" },
  }, { nextMnemonic: "Exit" }, [{ id: "1", character_id: "2", tag_name: "OWNER_TAG" }]);
  const { field } = choiceFixture([op, choiceExit], { ...options(), messageNames: owner.fieldMessageNames });
  field.startEvent("choice"); field.advance(10);
  assert.equal(field.sourceMessage.projection?.text, "SYNTHETIC_OWNER");
  const saved = owner.snapshot(); saved.roster[0]!.name = "Renamed"; saved.characterNames.OWNER_TAG = "Renamed"; owner.restore(saved);
  field.advance(300);
  assert.equal(field.sourceMessage.projection?.text, "SYNTHETIC_OWNERLater SYNTHETIC_OWNER");
  assert.equal(field.sourceMessage.projection?.speaker, "SYNTHETIC_OWNER");
  drive(field); assert.equal(field.stop, null);
  field.startEvent("choice"); field.advance(10); assert.equal(field.sourceMessage.projection?.text, "Renamed");
});

test("prepared context survives real world publication and stable restore without gaining authority from a save", () => {
  const f = choiceFixture([choiceExit]), runtime = {
    sourceMessageSequence: { prepare: () => ({ context: { ...context }, validate() {} }) },
  };
  f.target.scripts.read = [sequence("Target<WAIT01>Message"), choiceExit].map((op, index) => ({
    ...op, script: "read", index, source: { file: "synthetic", assetPath: "sequence-world-target" },
  }));
  const session = new GameSession(f.content, f.battle, 1, runtime);
  session.field.eventState.write({ category: "ScenarioFlag1", index: 8 }, 0);
  session.field.previewMap(2, 1); const next = session.world.prepare(f.world, f.target);
  assert.equal(session.world.commit(next), true);
  assert.equal(session.field.options.sourceMessageSequence, runtime.sourceMessageSequence);
  session.field.startEvent("read"); drive(session.field); assert.equal(session.field.stop, null);
  const save = session.checkpoint(), restored = GameSession.restore(save, f.content, f.battle,
    { catalog: f.world, map: f.target }, runtime);
  assert.equal(restored.field.options.sourceMessageSequence, runtime.sourceMessageSequence);
  restored.field.startEvent("read"); drive(restored.field); assert.equal(restored.field.stop, null);
  const absent = GameSession.restore(save, f.content, f.battle, { catalog: f.world, map: f.target });
  absent.field.startEvent("read"); assert.match(absent.field.stop?.message ?? "", /profile\/timing owner/);
  assert.equal(absent.field.sourceMessage.active, false);
});
