import assert from "node:assert/strict";
import test from "node:test";
import { compileManualMessageInstruction } from "../src/compiler/message.js";
import { decodeFieldOp } from "../src/compiler/field.js";
import { FieldGame, type FieldGameOptions } from "../src/core/field.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameSession } from "../src/core/game-session.js";
import { choiceFixture, choiceAssign, choiceExit, choiceDefinition, choiceVariable, selection,
  type ChoiceInstruction } from "./fixtures/field-choice.js";

const raw = (window = 0, anchor = 0, seconds = 0) => ({ type: 1, mnemonic: "Msg", operands: {
  iValues: [window, anchor, 0, 0, 0, 0, 0, 0], rValues: [seconds, 0, 0, 0, 0, 0, 0, 0],
  sValues: ["TEXT", "", "", "", "", "", "", ""],
} });
const messages = (text = "First<P>Second", speaker = "Guide") => ({
  story_mes_zhc: { TEXT: text }, story_cha_zhc: { TEXT: speaker },
});
const manual = (text = "First<P>Second", nextMnemonic = "Exit", window = 0, anchor = 0) =>
  compileManualMessageInstruction(raw(window, anchor), messages(text), { nextMnemonic });
const fixture = (ops: ChoiceInstruction[], options: FieldGameOptions = {}) => choiceFixture(ops, options);
const next = (game: FieldGame) => { game.advance(10); game.confirm(); };

test("ordinary Msg compiles explicit pages, static speaker, source windows and all three anchors", () => {
  for (const window of [0, 3]) for (const [anchor, name] of ["top", "middle", "bottom"].entries()) {
    const op = manual("First\\nline<p>Second", "Exit", window, anchor);
    assert.equal(op.manual.window, window === 0 ? "frame" : "none");
    assert.equal(op.manual.anchor, name); assert.equal(op.speaker, "Guide");
    assert.deepEqual(op.manual.pages, ["First\nline", "Second"]);
    assert.equal(op.text, "First\nline"); assert.equal(op.manual.after, "close");
  }
  assert.equal(manual("Prompt", "Select").manual.after, "choice");
  assert.equal(manual("Prompt", "Msg").manual.after, "message");
  assert.equal(manual("Prompt", "Nop").manual.after, "close", "only the immediate raw successor retains the window");
});

test("manual compiler preserves gates for dynamic text, timing, other message families and missing context", () => {
  for (const text of ["a<WAIT01>b", "<AUTO_P>", "a<PRESS>b", "<NAME_A>", "<P>a", "a<P>", "a<P><P>b", "", "a\\p"])
    assert.throws(() => manual(text), /control|empty/);
  for (const window of [1, 2, 4]) assert.throws(() => compileManualMessageInstruction(raw(window), messages(), { nextMnemonic: "Exit" }));
  for (const seconds of [-1, .01]) assert.throws(() => compileManualMessageInstruction(raw(0, 0, seconds), messages(), { nextMnemonic: "Exit" }));
  assert.throws(() => compileManualMessageInstruction(raw(), messages()), /following source mnemonic/);
  assert.throws(() => compileManualMessageInstruction(raw(), messages("Static", "<NAME_A>"), { nextMnemonic: "Exit" }));
  const op = decodeFieldOp(raw(3, 1), { script: "manual", index: 0, source: { file: "synthetic", assetPath: "dialogue" } },
    messages(), {}, { nextMnemonic: "Exit" });
  assert.equal(op.kind, "message");
});

test("one accepted confirm advances one explicit page; completion closes mask and permits stable saving", () => {
  const { field, state } = fixture([manual("First<P>Second<P>Third"), choiceAssign(19), choiceExit]);
  field.startEvent("choice"); assert.equal(field.updateAttributeMask, 9);
  assert.equal(field.menuReady, false); assert.equal(field.move("down"), false);
  assert.throws(() => field.checkpoint(), /Cannot save/);
  assert.throws(() => field.previewMap(2, 1), /during an event/);
  field.confirm(); assert.equal(field.dialogue?.text, "First", "start has its own host clock");
  next(field); assert.equal(field.dialogue?.text, "Second");
  field.confirm(); assert.equal(field.dialogue?.text, "Second");
  next(field); assert.equal(field.dialogue?.text, "Third");
  assert.equal(state.read(choiceVariable()), 0); assert.equal(field.updateAttributeMask, 9);
  next(field); assert.equal(field.dialogue, null); assert.equal(field.messageWindow, null);
  assert.equal(state.read(choiceVariable()), 19); assert.equal(field.updateAttributeMask, 3);
  assert.equal(field.checkpointReady, true);
  const restored = FieldGame.restore(field.content, field.checkpoint());
  assert.equal(restored.eventState.read(choiceVariable()), 19); assert.equal(restored.messageWindow, null);
});

test("same-task consecutive Msg transfers the retained window without a close or duplicate input", () => {
  const groups: number[] = [];
  const { field } = fixture([manual("First", "Msg", 3, 1), manual("Second", "Exit", 0, 2), choiceExit],
    { sourceMessageEffects: { prepare: effects => () => { groups.push(effects[0]!.group); } } });
  field.startEvent("choice"); next(field);
  assert.equal(field.dialogue?.text, "Second"); assert.equal(field.dialogue?.manual?.anchor, "bottom");
  assert.deepEqual(groups, [8, 8]); field.confirm(); assert.equal(field.dialogue?.text, "Second");
  next(field); assert.deepEqual(groups, [8, 8, 12]); assert.equal(field.busy, false);
});

test("last-page confirmation enters yes/no without choosing an answer and preserves its request token", () => {
  const { field, state } = fixture([manual("First<P>Choose", "Select"),
    choiceDefinition({ presentation: "yes-no", anchor: "bottom-right", initialIndex: 1 }), choiceAssign(31), choiceExit]);
  field.startEvent("choice"); next(field); next(field);
  const request = field.choice!; assert.ok(request); assert.equal(field.dialogue, null);
  assert.equal(field.messageWindow?.text, "Choose"); assert.equal(state.read(selection), 9);
  field.confirm(); assert.equal(field.choice?.id, request.id); assert.equal(state.read(selection), 9);
  assert.equal(field.choose(request.id, 1), true); assert.equal(field.choose(request.id, 0), false);
  field.advance(10); assert.equal(field.messageWindow, null); assert.equal(field.updateAttributeMask, 3);
  assert.equal(state.read(selection), 1); assert.equal(state.read(choiceVariable()), 31);
});

test("a retained manual window atomically hands off to the existing automatic subtitle owner", () => {
  const groups: number[] = [];
  const auto: ChoiceInstruction = { kind: "source-message", command: { kind: "play", key: "AUTO", speaker: "",
    layout: { window: "none", anchor: "top" }, seconds: -1,
    document: { kind: "source-message-document-v1", text: "Automatic", alignment: "left", autoPage: true, tailWaitSeconds: null } } };
  const { field, state } = fixture([manual("Manual", "Msg"), auto, { kind: "wait", seconds: .1 },
    { kind: "source-message", command: { kind: "close" } }, choiceAssign(42), choiceExit],
    { sourceMessageEffects: { prepare: effects => () => { groups.push(effects[0]!.group); } } });
  field.startEvent("choice"); next(field);
  assert.equal(field.stop, null); assert.equal(field.messageWindow, null); assert.equal(field.sourceMessage.active, true);
  field.advance(200); assert.equal(field.sourceMessage.active, false); assert.equal(state.read(choiceVariable()), 42);
  assert.deepEqual(groups, [8, 8, 12]); assert.equal(field.checkpointReady, true);
});

test("missing or failing start/close effects never partially replace the current dialogue", () => {
  const start = fixture([manual("Start"), choiceAssign(10), choiceExit], {
    sourceMessageEffects: { prepare: () => { throw new Error("provider unavailable"); } },
  });
  const before = start.state.snapshot(); start.field.startEvent("choice");
  assert.match(start.field.stop?.message ?? "", /provider unavailable/);
  assert.equal(start.field.dialogue, null); assert.deepEqual(start.state.snapshot(), before);
  assert.equal(start.field.updateAttributeMask, 3);
  const close = fixture([manual("Stay"), choiceAssign(10), choiceExit], {
    sourceMessageEffects: { prepare: effects => {
      if (effects[0]!.group === 12) throw new Error("close unavailable");
      return () => {};
    } },
  });
  close.field.startEvent("choice"); const window = close.field.dialogue;
  next(close.field); assert.match(close.field.stop?.message ?? "", /close unavailable/);
  assert.equal(close.field.dialogue, window); assert.equal(close.state.read(choiceVariable()), 0);
});

test("a failed manual-to-automatic transfer retains the first owner's message", () => {
  const { field } = fixture([manual("Keep", "Msg"), { kind: "source-message", command: { kind: "close" } }, choiceExit]);
  field.startEvent("choice"); next(field);
  assert.match(field.stop?.message ?? "", /entity-update host/);
  assert.equal(field.messageWindow?.text, "Keep"); assert.equal(field.sourceMessage.active, false);
});

test("Select retaining a manual prompt can transfer that same window to a following automatic Msg", () => {
  const { field, state } = fixture([manual("Prompt", "Select"), choiceDefinition({ retainMessage: true }),
    { kind: "source-message", command: { kind: "play", key: "AUTO", speaker: "",
      layout: { window: "none", anchor: "top" }, seconds: -1,
      document: { kind: "source-message-document-v1", text: "Automatic", alignment: "left", autoPage: true, tailWaitSeconds: null } } },
    { kind: "wait", seconds: .01 }, { kind: "source-message", command: { kind: "close" } }, choiceAssign(55), choiceExit],
    { sourceMessageEffects: { prepare: () => () => {} } });
  field.startEvent("choice"); next(field); field.choose(field.choice!.id, 0); field.advance(10);
  assert.equal(field.stop, null); assert.equal(field.messageWindow, null); assert.equal(field.sourceMessage.active, true);
  field.advance(20); assert.equal(field.sourceMessage.active, false); assert.equal(state.read(choiceVariable()), 55);
});

test("main completion cannot cancel a puppet that still owns a manual message", () => {
  const { field, state } = fixture([
    { kind: "puppet", slot: 0, actor: "npc", target: 4 }, { kind: "exec-puppets", asynchronous: true },
    { kind: "wait", seconds: .01 }, choiceExit, manual("Puppet"), choiceExit,
  ]);
  field.startEvent("choice"); field.advance(10);
  assert.match(field.stop?.message ?? "", /ended with an unfinished ordinary message/);
  assert.equal(field.dialogue?.text, "Puppet"); assert.equal(state.read(choiceVariable()), 0);
  field.confirm(); assert.equal(field.dialogue?.text, "Puppet");
});

for (const transition of [
  { kind: "change-map", request: { mapId: 2, entrance: 1, continuation: null, birdview: false,
    skipFade: false, skipBgm: false, origin: "script" } },
  { kind: "encounter", party: 1000, continuation: "after" },
] satisfies ChoiceInstruction[]) test(`a concurrent ${transition.kind} cannot escape a manual message owner`, () => {
  const { field, state } = fixture([
    { kind: "puppet", slot: 0, actor: "npc", target: 4 }, { kind: "exec-puppets", asynchronous: true },
    manual("Wait"), choiceExit, transition, choiceExit,
  ]);
  field.startEvent("choice"); assert.match(field.stop?.message ?? "", /unfinished ordinary message/);
  assert.equal(field.messageWindow?.text, "Wait"); assert.equal(state.read(choiceVariable()), 0);
});

test("GameFlow pauses and gates manual confirm while hidden or media are not ready", () => {
  const f = fixture([manual("One<P>Two"), choiceAssign(20), choiceExit]);
  const game = new GameSession(f.content, f.battle, 1), flow = new GameFlow(game),
    ready = { visible: true, mediaReady: true, overlayOpen: false };
  flow.start(); flow.advance(0, ready); game.field.startEvent("choice"); flow.advance(10, ready);
  assert.equal(flow.phase, "dialogue"); flow.pause(true); flow.confirm();
  assert.equal(game.field.dialogue?.text, "One"); flow.pause(false);
  flow.advance(10, { ...ready, visible: false }); flow.confirm();
  assert.equal(game.field.dialogue?.text, "One");
  flow.advance(10, { ...ready, mediaReady: false }); flow.confirm();
  assert.equal(game.field.dialogue?.text, "One");
  flow.advance(10, ready); flow.confirm(); assert.equal(game.field.dialogue?.text, "Two");
  flow.confirm(); assert.equal(game.field.dialogue?.text, "Two");
  flow.advance(10, ready); flow.confirm(); assert.equal(flow.phase, "exploration");
  assert.equal(game.field.eventState.read(choiceVariable()), 20);
});
