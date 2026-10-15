import assert from "node:assert/strict";
import test from "node:test";
import { SourceMessageState, sourceMessageUpdateMask, type SourceMessageOp } from "../src/core/source-message.js";
import { compileSourceMessageDocument, compileSourceMessageInstruction } from "../src/compiler/source-message.js";

const raw = (mnemonic = "Msg", seconds = -1) => ({ type: 1, mnemonic, operands: {
  iValues: [mnemonic === "Msg" ? 3 : 0, 0, 0, 0, 0, 0, 0, 0],
  rValues: [mnemonic === "Msg" ? seconds : 0, 0, 0, 0, 0, 0, 0, 0],
  sValues: [mnemonic === "Msg" ? "controlled" : "", "", "", "", "", "", "", ""],
} });
const messages = (text = "<CT>First line\\n<CT>Second line<WAIT04><AUTO_P>") => ({
  story_mes_zhc: { controlled: text }, story_cha_zhc: { controlled: "" },
});
const op = (text?: string): SourceMessageOp => compileSourceMessageInstruction(raw(), messages(text));
const close: SourceMessageOp = { kind: "source-message", command: { kind: "close" } };

test("source message group selects field actors separately from camera and map animation", () => {
  const message = sourceMessageUpdateMask(8), field = sourceMessageUpdateMask(12);
  assert.equal(message, 9); assert.equal(field, 3);
  for (const attribute of [1, 10, 42]) {
    assert.ok((message & attribute) > 0); assert.ok((field & attribute) > 0);
  }
  assert.equal(message & 2, 0); assert.equal(field & 2, 2);
  assert.equal(message & 64, 0); assert.equal(field & 64, 0);
  assert.throws(() => sourceMessageUpdateMask(1 as 8), /Unknown/);
});

test("negative Msg prepares an asynchronous global window and an explicit message entity group", () => {
  const state = new SourceMessageState(), before = state.snapshot(), prepared = state.prepare(op());
  assert.equal(prepared.flow, "next");
  assert.deepEqual(prepared.effects, [{ kind: "entity-update-group", group: 8, invokeCallback: false }]);
  assert.deepEqual(state.snapshot(), before);
  prepared.commit();
  assert.equal(state.active, true);
  assert.equal(state.projection?.phase, "play");
  assert.equal(state.projection?.text, "");
  assert.throws(() => prepared.commit(), /Stale/);
});

test("the first manager Update reveals the one-page text up to its tail wait", () => {
  const state = new SourceMessageState(); state.prepare(op()).commit();
  state.advance(.01);
  assert.deepEqual(state.projection, { key: "controlled", speaker: "", text: "First line\nSecond line",
    alignment: "center", window: "none", anchor: "top", phase: "playing", acceptsInput: false });
  state.advance(.01);
  assert.equal(state.projection?.phase, "time-wait");
  assert.equal(state.snapshot().message?.elapsed, 0);
  for (let i = 0; i < 30; i++) assert.equal(state.confirm(), false);
  assert.equal(state.projection?.phase, "time-wait");
});

test("inline wait uses float32 accumulation without spilling time into following states", () => {
  const state = new SourceMessageState(); state.prepare(op()).commit();
  state.advance(0); state.advance(0); state.advance(.25);
  assert.equal(state.snapshot().message?.elapsed, Math.fround(.25));
  state.advance(5);
  assert.equal(state.projection?.phase, "playing");
  assert.equal(state.snapshot().message?.elapsed, 0);
  state.advance(0);
  assert.equal(state.projection?.phase, "input-wait");
  state.advance(.3);
  assert.equal(state.projection?.phase, "finished");
  assert.equal(state.active, true);
  assert.equal(state.projection?.text, "First line\nSecond line");
});

test("MsgClose stops waiting and restores event group independently from native text completion", () => {
  const state = new SourceMessageState(); state.prepare(op("Opening<WAITff><AUTO_P>")).commit();
  state.advance(.01); state.advance(.01); state.advance(10.3);
  assert.equal(state.projection?.phase, "time-wait");
  const tx = state.prepare(close);
  assert.deepEqual(tx.effects, [{ kind: "entity-update-group", group: 12, invokeCallback: false }]);
  assert.equal(state.active, true); tx.commit();
  for (let i = 0; i < 20; i++) state.advance(10);
  assert.equal(state.active, false); assert.equal(state.projection, null);
  assert.deepEqual(SourceMessageState.restore(state.snapshot()).snapshot(), state.snapshot());
});

test("message replacement cancels the old wait, and completed text does not silently close", () => {
  const state = new SourceMessageState(); state.prepare(op()).commit();
  state.advance(.01); state.advance(.01); state.advance(.5);
  state.prepare(op("New text<AUTO_P>")).commit();
  state.advance(.01); state.advance(.01); state.advance(1);
  assert.equal(state.projection?.text, "New text"); assert.equal(state.projection?.phase, "finished");
  assert.throws(() => SourceMessageState.restore(state.snapshot()), /Active/);
});

test("candidate forks, snapshots, op inputs and projections cannot mutate the live owner", () => {
  const state = new SourceMessageState(), value = op(), tx = state.prepare(value);
  if (value.command.kind === "play") value.command.document.text = "tamper";
  tx.commit(); state.advance(.01);
  const candidate = state.fork(), snapshot = state.snapshot(), projection = state.projection!;
  candidate.prepare(close).commit(); if (snapshot.message!.command.kind === "play") snapshot.message!.command.document.text = "snapshot"; projection.text = "view";
  assert.equal(state.projection?.text, "First line\nSecond line"); assert.equal(candidate.active, false);
});

test("elapsed clock or replacement invalidates a prepared transaction before publication", () => {
  const state = new SourceMessageState(); state.prepare(op()).commit();
  const stale = state.prepare(close); state.advance(.01);
  assert.throws(() => stale.commit(), /Stale/); assert.equal(state.active, true);
  const other = state.prepare(close); state.prepare(op()).commit();
  assert.throws(() => other.commit(), /Stale/);
});

test("invalid clock or command leaves the existing message untouched", () => {
  const state = new SourceMessageState(); state.prepare(op()).commit(); const before = state.snapshot();
  for (const delta of [-1, NaN, Infinity, Number.MAX_VALUE, "1"])
    assert.throws(() => state.advance(delta as number), /delta/);
  const invalid = op(); if (invalid.command.kind === "play") invalid.command.seconds = 0;
  assert.throws(() => state.prepare(invalid), /timing/);
  assert.deepEqual(state.snapshot(), before);
});

test("source controls have exact semantics and known WAIT suffixes are not general hex times", () => {
  assert.equal(compileSourceMessageDocument("<ct>Text<waitff><auto_p>").tailWaitSeconds, 63.75);
  assert.equal(compileSourceMessageDocument("Text<WAIT00><AUTO_P>").tailWaitSeconds, 1);
  assert.equal(compileSourceMessageDocument("Text<WAIT><AUTO_P>").tailWaitSeconds, 1);
  assert.equal(compileSourceMessageDocument("Text<WAIT04><AUTO_P>").tailWaitSeconds, 1);
  for (const text of ["Text<WAITFF><AUTO_P>", "Text<WAIT17><AUTO_P>", "a<WAIT04>b<AUTO_P>",
    "a<P>b<AUTO_P>", "a<PRESS><AUTO_P>", "<NAME_A><AUTO_P>", "<C1>a<C0><AUTO_P>", "Text"])
    assert.throws(() => compileSourceMessageDocument(text), /Unsupported|requires/);
});

test("decoder distinguishes missing resources, speaker media, layout and synchronous Msg", () => {
  for (const seconds of [0, 1, NaN, Infinity]) assert.throws(() => compileSourceMessageInstruction(raw("Msg", seconds), messages()));
  for (const window of [0, 1, 2, 4]) { const value = raw(); value.operands.iValues[0] = window;
    assert.throws(() => compileSourceMessageInstruction(value, messages()), /window/); }
  const missing = messages(); delete (missing.story_cha_zhc as Record<string, string>).controlled;
  assert.throws(() => compileSourceMessageInstruction(raw(), missing), /Missing/);
  const speaker = messages(); speaker.story_cha_zhc.controlled = "Actor";
  assert.throws(() => compileSourceMessageInstruction(raw(), speaker), /speaker/);
  assert.throws(() => op("a\\nb\\nc\\nd\\ne<AUTO_P>"), /page layout/);
});

test("the Web one-page capability refuses auto-wrap and unsupported glyph layout dependencies", () => {
  assert.doesNotThrow(() => op("字".repeat(20) + "<AUTO_P>"));
  assert.throws(() => op("字".repeat(21) + "<AUTO_P>"), /page layout/);
  for (const text of ["a\tb", "a\u0000b", "e\u0301", "\u{1f600}", "a\u200bb"])
    assert.throws(() => op(text + "<AUTO_P>"), /page layout/);
  const state = new SourceMessageState(); state.prepare(op()).commit(); const before = state.snapshot();
  const forged = op(); if (forged.command.kind === "play") forged.command.document.text = "字".repeat(21);
  assert.throws(() => state.prepare(forged), /page layout/); assert.deepEqual(state.snapshot(), before);
});

test("MsgClose has a strict form and a retained window is not required to restore event update group", () => {
  assert.deepEqual(compileSourceMessageInstruction(raw("MsgClose"), {}), close);
  const invalid = raw("MsgClose"); invalid.operands.iValues[0] = 1;
  assert.throws(() => compileSourceMessageInstruction(invalid, {}), /operand/);
  const state = new SourceMessageState(); state.prepare(close).commit(); assert.equal(state.active, false);
  for (const saved of [null, [], { kind: "source-message-v1" }, { kind: "source-message-v2", message: null },
    { kind: "source-message-v1", message: null, ready: true }])
    assert.throws(() => SourceMessageState.restore(saved as never));
});
