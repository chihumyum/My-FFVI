import test from "node:test";
import assert from "node:assert/strict";
import { createWebFieldMessageSequencePort } from "../src/core/source-message-sequence.js";

test("declared Web message policy prepares detached contexts without a configuration fallback", () => {
  const port = createWebFieldMessageSequencePort(), first = port.prepare();
  assert.deepEqual(first.context, { kind: "web-field-message-sequence-v1", layout: "source-explicit-pages",
    integratorAutomatic: false, battleMessageSpeedFactor: 1 });
  first.context.battleMessageSpeedFactor = 4;
  first.context.integratorAutomatic = true;
  assert.equal(port.prepare().context.battleMessageSpeedFactor, 1);
  assert.equal(port.prepare().context.integratorAutomatic, false);
  assert.notEqual(first.context, port.prepare().context);
  assert.doesNotThrow(() => first.validate());
});
