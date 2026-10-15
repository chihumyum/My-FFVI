import assert from "node:assert/strict";
import test from "node:test";
import { compileSourceMessageSequenceDocument, compileSourceMessageSequenceInstruction } from "../src/compiler/source-message-sequence.js";
import { SourceMessageState } from "../src/core/source-message.js";
import { SOURCE_MESSAGE_SEQUENCE_PROFILE, prepareSourceMessageSequenceTiming, sourceMessageSequenceTextRuns,
  createSourceMessageTaskCursor, pollSourceMessageTask, type SourceMessageSequenceCommand,
  type SourceMessageSequenceContext } from "../src/core/source-message-sequence.js";
import { fieldMessageTemplateSource } from "../src/core/field-message-template.js";

const context: SourceMessageSequenceContext = { kind: SOURCE_MESSAGE_SEQUENCE_PROFILE, layout: "source-explicit-pages",
  integratorAutomatic: false, battleMessageSpeedFactor: 2 };
const raw = (duration = 0, window = 0, bypass = 0) => ({ type: 1, mnemonic: "Msg", operands: {
  iValues: [window, 2, bypass, 0, 0, 0, 0, 0], rValues: [duration, 0, 0, 0, 0, 0, 0, 0],
  sValues: ["synthetic", "", "", "", "", "", "", ""] } });
function command(text = "First<WAIT01>Second<P>Last", duration = 0, after = "Exit"): SourceMessageSequenceCommand {
  const result = compileSourceMessageSequenceInstruction(raw(duration), {
    story_mes_zhc: { synthetic: text }, story_cha_zhc: { synthetic: "Speaker" } }, { nextMnemonic: after });
  if (result.command.kind !== "sequence") throw new Error("Wrong test command");
  return result.command;
}
function open(value = command(), policy = context) {
  const state = new SourceMessageState(), tx = state.prepare({ kind: "source-message", command: value }, policy);
  tx.commit(); return { state, tx };
}

test("whole document preserves ordered controls and case-sensitive WAIT suffix meaning", () => {
  const doc = compileSourceMessageSequenceDocument("A<WAIT00>B<PRESS>C<P><CT>D<WAITff><AUTO_P>");
  assert.deepEqual(doc.tokens.map(token => token.kind), ["text", "wait", "text", "press", "text", "page", "center", "text", "wait", "page"]);
  assert.deepEqual(sourceMessageSequenceTextRuns(doc), ["A", "B", "C", "D"]);
  assert.equal(doc.alignment, "center");
  assert.deepEqual(doc.tokens[1], { kind: "wait", seconds: 1, suffix: "00" });
  assert.deepEqual(doc.tokens[8], { kind: "wait", seconds: 63.75, suffix: "ff" });
  for (const text of ["A<WAITFF>", "A<WAIT17>", "A<C1>B", "A<UNKNOWN>", "A<WAITzz>", "A<WAIT01", "A\\qB", "<P>A", "A<P><P>B"])
    assert.throws(() => compileSourceMessageSequenceDocument(text));
});

test("positive duration divides only P, and requires the actual prepared config factor", () => {
  const value = command("A<P>B<AUTO_P>", 12);
  assert.deepEqual(prepareSourceMessageSequenceTiming(value, context), { autoInput: true, pageSeconds: 3 });
  assert.throws(() => prepareSourceMessageSequenceTiming(value, { ...context, battleMessageSpeedFactor: null }), /factor owner/);
  assert.deepEqual(prepareSourceMessageSequenceTiming({ ...value, bypassSpeed: true }, { ...context, battleMessageSpeedFactor: null }),
    { autoInput: true, pageSeconds: 6 });
  assert.deepEqual(prepareSourceMessageSequenceTiming(value, { ...context, integratorAutomatic: true, battleMessageSpeedFactor: null }),
    { autoInput: true, pageSeconds: 6 });
  assert.equal(prepareSourceMessageSequenceTiming(command("A", 0), { ...context, integratorAutomatic: true }).autoInput, false);
  assert.equal(prepareSourceMessageSequenceTiming(command("A", -1), { ...context, integratorAutomatic: true }).autoInput, false);
  for (const factor of [0, -1, NaN, Infinity, .1])
    assert.throws(() => prepareSourceMessageSequenceTiming(value, { ...context, battleMessageSpeedFactor: factor }));
  assert.throws(() => open(value, { ...context, kind: "unknown" } as unknown as SourceMessageSequenceContext), /profile/);
});

test("the existing unique owner executes inline WAIT without losing text or spilling time", () => {
  const { state } = open();
  state.advance(.01); assert.equal(state.projection?.text, "First");
  state.advance(.01); assert.equal(state.projection?.phase, "time-wait");
  const before = state.snapshot(); assert.equal(state.confirm(), false); assert.deepEqual(state.snapshot(), before);
  state.advance(4); assert.equal(state.projection?.phase, "playing");
  assert.equal(state.projection?.text, "FirstSecond");
  assert.equal(state.snapshot().message?.elapsed, 0);
  state.advance(.01); assert.equal(state.projection?.phase, "page-wait");
  state.advance(20); assert.equal(state.projection?.phase, "new-page");
  assert.equal(state.projection?.text, "FirstSecond");
  assert.equal(state.confirm(), false); // same transition cannot consume an edge input
  state.advance(.01); assert.equal(state.confirm(), true);
  assert.equal(state.projection?.text, "");
  state.advance(.01); assert.equal(state.projection?.text, "Last");
});

test("PRESS resumes within the same page; final confirm differs from page/press input", () => {
  const { state } = open(command("Before<PRESS>After"));
  state.advance(.01); state.advance(.01); assert.equal(state.projection?.phase, "press-wait");
  assert.equal(state.projection?.text, "Before"); assert.equal(state.confirm(), false);
  state.advance(.01); assert.equal(state.confirm(), true); assert.equal(state.projection?.text, "BeforeAfter");
  state.advance(.01); assert.equal(state.projection?.phase, "input-wait");
  assert.equal(state.confirm(), false); state.advance(.3); assert.equal(state.projection?.phase, "end-wait");
  assert.equal(state.confirm(), false); state.advance(.01); assert.equal(state.confirm(), true);
  assert.equal(state.confirm(), false); assert.equal(state.endWaiting, true); assert.equal(state.active, true);
});

test("AUTO_P selects the entire ordinary controller automatic branch and retains final window", () => {
  const { state, tx } = open(command("A<P>B<AUTO_P>", -1));
  state.advance(.01); state.advance(.01); state.advance(.3); assert.equal(state.projection?.phase, "new-page");
  assert.equal(state.confirm(), false);
  state.advance(.01); state.advance(.01); assert.equal(state.projection?.text, "B");
  state.advance(.01); state.advance(.3);
  assert.deepEqual(state.sequenceStatus(tx.ticket), { ticket: tx.ticket, complete: true, endWaiting: true,
    newPageInputWaiting: false, playing: false });
  assert.equal(state.projection?.text, "B"); assert.equal(state.active, true);
  assert.throws(() => open(command("A<PRESS>B<AUTO_P>")), /external input/);
});

test("a trailing page tag causes no phantom page but keeps its P duration divisor", () => {
  const value = command("Only<P>", 8), { state, tx } = open(value);
  assert.equal(tx.timing?.pageSeconds, 2);
  state.advance(.01); state.advance(.01);
  assert.equal(state.projection?.phase, "input-wait"); assert.equal(state.projection?.text, "Only");
});

test("positive Msg uses a separate final-page clock and does not become a sleep from start", () => {
  const value = command("A<WAIT04>B", 4), { state, tx } = open(value);
  let cursor = createSourceMessageTaskCursor(value, tx.timing!, tx.ticket, 0)!;
  state.advance(.01); state.advance(.01);
  let p = pollSourceMessageTask(cursor, state.sequenceStatus(tx.ticket), 5000); cursor = p.cursor;
  assert.equal(p.flow, "wait"); assert.equal(cursor.anchorTime, 5000);
  state.advance(10); state.advance(.01); state.advance(.3);
  p = pollSourceMessageTask(cursor, state.sequenceStatus(tx.ticket), 10000); cursor = p.cursor;
  assert.equal(p.flow, "wait"); assert.equal(cursor.finalTimerStarted, true);
  p = pollSourceMessageTask(cursor, state.sequenceStatus(tx.ticket), 11999); assert.equal(p.flow, "wait");
  p = pollSourceMessageTask(cursor, state.sequenceStatus(tx.ticket), 12000);
  assert.equal(p.flow, "next"); assert.equal(p.action, "close");
  assert.equal(state.active, true); // close is prepared by FieldGame, not a hidden second state owner
});

test("wrapper page input invokes only an available callback, then resets its clock on playing", () => {
  const value = command("A<P>B", 1), { state, tx } = open(value);
  let cursor = createSourceMessageTaskCursor(value, tx.timing!, tx.ticket, 0)!;
  state.advance(.01); state.advance(.01);
  let p = pollSourceMessageTask(cursor, state.sequenceStatus(tx.ticket), 300); cursor = p.cursor;
  assert.equal(p.action, "page-input"); assert.equal(state.executePageInput(tx.ticket), false);
  state.advance(.3); assert.equal(state.executePageInput(tx.ticket), true);
  state.advance(.01);
  p = pollSourceMessageTask(cursor, state.sequenceStatus(tx.ticket), 400);
  assert.equal(p.cursor.anchorTime, 400); assert.equal(p.action, null);
});

test("next Select releases at complete text without waiting for final acknowledgement", () => {
  const value = command("Choose", 0, "Select"), { state, tx } = open(value);
  const cursor = createSourceMessageTaskCursor(value, tx.timing!, tx.ticket, 0)!;
  state.advance(.01); state.advance(.01); assert.equal(state.projection?.phase, "input-wait");
  const p = pollSourceMessageTask(cursor, state.sequenceStatus(tx.ticket), 20);
  assert.equal(p.flow, "next"); assert.equal(p.action, null); assert.equal(state.active, true);
  assert.equal(createSourceMessageTaskCursor(command("A", -1), { autoInput: false, pageSeconds: null }, tx.ticket, 20), null);
});

test("replacement, cancellation and candidate clocks cannot satisfy a stale task ticket", () => {
  const { state, tx } = open(command("Old", 0)), candidate = state.fork();
  const stale = state.prepare({ kind: "source-message", command: command("Replace") }, context);
  state.advance(.01); assert.throws(() => stale.commit(), /Stale/);
  const oldStatus = state.sequenceStatus(tx.ticket);
  const cursor = createSourceMessageTaskCursor(command("Old"), tx.timing!, tx.ticket, 0)!;
  const replacement = state.prepare({ kind: "source-message", command: command("New") }, context); replacement.commit();
  assert.throws(() => state.sequenceStatus(tx.ticket), /Stale/);
  assert.throws(() => pollSourceMessageTask(cursor, state.sequenceStatus(replacement.ticket), 100), /Stale/);
  assert.throws(() => pollSourceMessageTask(cursor, oldStatus, -1), /clock/);
  candidate.advance(.01); assert.equal(candidate.projection?.text, "Old"); assert.equal(state.projection?.text, "");
  state.prepare({ kind: "source-message", command: { kind: "close" } }).commit();
  assert.throws(() => state.executePageInput(replacement.ticket), /Stale/);
  assert.deepEqual(SourceMessageState.restore(state.snapshot()).snapshot(), state.snapshot());
});

test("unknown reserved/window operands, changed inline timing, unresolved names and active saves reject", () => {
  for (const window of [1, 2, 4]) assert.throws(() => compileSourceMessageSequenceInstruction(raw(0, window), {}, { nextMnemonic: "Exit" }), /window/);
  const changed = raw(); changed.operands.iValues[3] = 1;
  assert.throws(() => compileSourceMessageSequenceInstruction(changed, {}, { nextMnemonic: "Exit" }), /reserved/);
  const value = command(), wait = value.document.tokens.find(token => token.kind === "wait")!;
  if (wait.kind === "wait") wait.seconds = 2;
  assert.throws(() => open(value), /wait/);
  const live = open(); assert.throws(() => SourceMessageState.restore(live.state.snapshot()), /Active/);
  assert.throws(() => live.state.prepare({ kind: "source-message", command: command("A") }), /profile/);
  assert.throws(() => live.state.prepare({ kind: "source-message", command: { kind: "finish-wait" } }), /polls/);
});

test("owned-name binding spans speaker and all text runs once, and never defaults to lore", () => {
  const names = [{ id: "7", character_id: "3", tag_name: "NAME_A" }];
  const op = compileSourceMessageSequenceInstruction(raw(), { story_mes_zhc: { synthetic: "(NAME_A)<WAIT01>Next (NAME_A)" },
    story_cha_zhc: { synthetic: "(NAME_A)" } }, { nextMnemonic: "Msg" }, names);
  if (op.command.kind !== "sequence") throw new Error("Wrong test command");
  assert.equal(op.command.after, "message");
  assert.deepEqual(fieldMessageTemplateSource(op.command.template!), { pages: ["(NAME_A)", "Next (NAME_A)"], speaker: "(NAME_A)" });
  const compiledCommand = op.command;
  assert.throws(() => open(compiledCommand), /resolved/);
  assert.throws(() => compileSourceMessageSequenceInstruction(raw(), { story_mes_zhc: { synthetic: "(KINGAKU)<WAIT01>" },
    story_cha_zhc: { synthetic: "" } }, { nextMnemonic: "Exit" }, names), /KINGAKU/);
});

test("stable policy is explicit Web layout; old v1 short-page bound remains unchanged", () => {
  const { state } = open(command("Long line ".repeat(30) + "<WAIT01>End"));
  state.advance(.01); assert.equal(state.projection?.text, "Long line ".repeat(30));
  assert.equal(context.layout, "source-explicit-pages");
  const invalid = { ...command(), unrelated: true };
  assert.throws(() => open(invalid), /fields/);
});
