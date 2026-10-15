import test from "node:test";
import assert from "node:assert/strict";
import { SourceMessageState } from "../src/core/source-message.js";
import { createWebFieldMessageSequencePort, type SourceMessageSequenceCommand } from "../src/core/source-message-sequence.js";
const command: SourceMessageSequenceCommand = { kind: "sequence", key: "AUTHORED_FRAME", speaker: "",
  layout: { window: "frame", anchor: "bottom" }, document: { kind: "source-message-sequence-v1", alignment: "left", tokens: [{ kind: "text", text: "Authored frame message." }] },
  seconds: 0, bypassSpeed: false, after: "close" };
const opened = () => { const owner = new SourceMessageState(); owner.prepare({kind:"source-message",command}, createWebFieldMessageSequencePort().prepare().context).commit();return owner; };
test("a failed shared message frame preserves the exact active window and permits the original pending write after discard", () => {
  const owner=opened(), before=owner.snapshot(), close=owner.prepare({kind:"source-message",command:{kind:"close"}}),frame=owner.prepareFrame();
  frame.state.advance(.01);frame.state.confirm();assert.notDeepEqual(frame.state.snapshot(),before);assert.deepEqual(owner.snapshot(),before);
  assert.throws(()=>close.commit(),/reserved/);assert.throws(()=>owner.confirm(),/reserved/);assert.throws(()=>owner.advance(.01),/reserved/);
  frame.discard();assert.deepEqual(owner.snapshot(),before);close.commit();assert.equal(owner.active,false);
});
test("successful publication uses the same owner and invalidates old writes; a changed prepared draft never publishes", () => {
  const owner=opened(), stale=owner.prepare({kind:"source-message",command:{kind:"close"}}),frame=owner.prepareFrame();frame.state.advance(.01);
  const expected=frame.state.snapshot(),prepared=frame.prepareCommit();prepared.validate();prepared.commit();assert.deepEqual(owner.snapshot(),expected);assert.throws(()=>stale.commit(),/Stale/);assert.throws(()=>prepared.commit(),/Stale/);
  const before=owner.snapshot(),other=owner.prepareFrame(),changed=other.prepareCommit();other.state.advance(.01);assert.throws(()=>changed.commit(),/candidate changed/);other.discard();assert.deepEqual(owner.snapshot(),before);
});
