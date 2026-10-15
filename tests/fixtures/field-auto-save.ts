import assert from "node:assert/strict";
import { compileFieldAutoSaveInstruction } from "../../src/compiler/field-auto-save.js";
import { WEB_AUTO_SAVE_POLICY } from "../../src/core/field-auto-save.js";
import { GameSession } from "../../src/core/game-session.js";
import { GameFlow } from "../../src/core/game-flow.js";
import { gameEventSaveFixture, afterEventSave, eventSaveReadyHost } from "./game-event-save.js";

export const autoSaveRaw = () => ({ mnemonic: "AutoSave", type: 1, operands: {
  iValues: Array(8).fill(0), rValues: Array(8).fill(0), sValues: Array(8).fill("") } });
export const autoSaveSource = { file: "synthetic-autosave", assetPath: "test/AutoSave", objectId: "9223372036854775701" };
/** Synthetic source instruction + declared Web policy; no native/story oracle. */
export function sourceAutoSaveFixture(admitted = true) {
  const base = gameEventSaveFixture();
  base.field.scripts.saveFlow![1] = { ...compileFieldAutoSaveInstruction(autoSaveRaw()), script: "saveFlow", index: 1,
    source: autoSaveSource };
  if (admitted) base.field.developmentProfile = { kind: "framework-development-v1",
    policy: "omit-anonymous-environment-particles-v1", sourceContentHash: "a".repeat(64), omissions: [],
    autoSave: WEB_AUTO_SAVE_POLICY };
  const session = new GameSession(base.field, base.battle, 314), flow = new GameFlow(session);
  session.field.eventState.write(afterEventSave, 0); flow.start(); flow.advance(0, eventSaveReadyHost);
  return { ...base, session, flow,
    itemCount(owner = session) { return owner.state.snapshot().items.find(item => item.id === 10)?.count ?? 0; },
    start() {
      assert.equal(session.field.startEvent("saveFlow"), true);
      assert.equal(session.eventSaveRequest, null, "first source clock yields before requesting persistence");
      session.advance(10); assert.equal(session.field.stop, null);
      assert.ok(session.eventSaveRequest); return session.eventSaveRequest!;
    } };
}
