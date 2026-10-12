import test from "node:test";
import assert from "node:assert/strict";
import { compileFieldScriptMotionInstruction } from "../src/compiler/field-script-motion.js";

function instruction(mnemonic = "Move") {
  return { type: 2, mnemonic, operands: {
    iValues: [2, 1, 1, 0, 0, 0, 0, 0],
    rValues: Array<number>(8).fill(0),
    sValues: ["Default", "", "", "", "", "", "", ""],
  } };
}

test("Move preserves all four directions and explicit animation keys", () => {
  for (const [id, direction] of ["up", "right", "down", "left"].entries()) {
    const raw = instruction(); raw.operands.iValues[0] = id;
    for (const animation of ["", "Default", "WalkR", " Custom_演出 "]) {
      raw.operands.sValues[0] = animation;
      assert.deepEqual(compileFieldScriptMotionInstruction(raw), {
        kind: "field-script-motion", command: { kind: "move", direction, steps: 1, speedId: 1, animation },
      });
    }
  }
});

test("Move uses the actual seven source speed selectors and nullable defaults", () => {
  for (const selector of [-2147483648, -2, -1, 0, 1, 2, 3, 4, 5, 6]) {
    const raw = instruction(); raw.operands.iValues[2] = selector;
    const op = compileFieldScriptMotionInstruction(raw);
    assert.equal(op.command.kind, "move");
    if (op.command.kind === "move") assert.equal(op.command.speedId, selector < 0 ? null : selector);
  }
  for (const selector of [7, 8, 9, 2147483647]) {
    const raw = instruction(); raw.operands.iValues[2] = selector;
    assert.throws(() => compileFieldScriptMotionInstruction(raw), /speed selector/);
  }
});

test("Move retains zero and multiple steps without translating them into one duration", () => {
  for (const steps of [0, 1, 43, 2147483647]) {
    const raw = instruction(); raw.operands.iValues[1] = steps;
    const op = compileFieldScriptMotionInstruction(raw);
    assert.equal(op.command.kind, "move");
    if (op.command.kind === "move") assert.equal(op.command.steps, steps);
  }
  const raw = instruction(); raw.operands.iValues[1] = -1;
  assert.throws(() => compileFieldScriptMotionInstruction(raw), /Negative source Move steps/);
});

test("Lerp keeps absolute negative coordinates, layer, arc, animation and seconds", () => {
  const raw = instruction("Lerp");
  raw.operands.iValues = [-4, -2, 3, 0, 0, 0, 0, 0];
  raw.operands.rValues[0] = 0.5; raw.operands.rValues[1] = -2.5;
  raw.operands.sValues[0] = "WalkR";
  assert.deepEqual(compileFieldScriptMotionInstruction(raw), {
    kind: "field-script-motion", command: {
      kind: "lerp", x: -4, y: -2, layer: 3, duration: 0.5, arcHeight: -2.5, animation: "WalkR",
    },
  });
  assert.ok(!("actor" in compileFieldScriptMotionInstruction(raw)));
});

test("Lerp admits zero duration and all known layers but never reinterprets negative time", () => {
  for (const layer of [0, 1, 2, 3]) {
    const raw = instruction("Lerp"); raw.operands.iValues[2] = layer;
    const op = compileFieldScriptMotionInstruction(raw);
    assert.equal(op.command.kind, "lerp");
    if (op.command.kind === "lerp") { assert.equal(op.command.layer, layer); assert.equal(op.command.duration, 0); }
  }
  for (const layer of [-1, 4, 2147483647]) {
    const raw = instruction("Lerp"); raw.operands.iValues[2] = layer;
    assert.throws(() => compileFieldScriptMotionInstruction(raw), /layer request/);
  }
  const raw = instruction("Lerp"); raw.operands.rValues[0] = -0.5;
  assert.throws(() => compileFieldScriptMotionInstruction(raw), /Negative source Lerp duration/);
});

test("incomplete legacy arrays cannot fall back to a less strict Move decoder", () => {
  for (const mnemonic of ["Move", "Lerp"]) {
    for (const key of ["iValues", "rValues", "sValues"] as const) {
      for (const length of [0, 3, 7, 9]) {
        const raw = instruction(mnemonic); raw.operands[key].length = length;
        assert.throws(() => compileFieldScriptMotionInstruction(raw));
      }
    }
  }
  assert.throws(() => compileFieldScriptMotionInstruction({ type: 2, mnemonic: "Move", operands: {
    iValues: [2, 1, 1], sValues: ["Default"],
  } }));
});

test("wrong instruction kinds and nonempty reserved fields remain explicit blockers", () => {
  for (const raw of [null, {}, { ...instruction(), type: 1 }, { ...instruction(), mnemonic: "MoveTo" }])
    assert.throws(() => compileFieldScriptMotionInstruction(raw));
  for (const mnemonic of ["Move", "Lerp"]) {
    for (let index = 3; index < 8; index++) {
      const raw = instruction(mnemonic); raw.operands.iValues[index] = 1;
      assert.throws(() => compileFieldScriptMotionInstruction(raw), /reserved operands/);
    }
    for (let index = mnemonic === "Move" ? 0 : 2; index < 8; index++) {
      const raw = instruction(mnemonic); raw.operands.rValues[index] = 0.25;
      assert.throws(() => compileFieldScriptMotionInstruction(raw), /reserved operands/);
    }
    for (let index = 1; index < 8; index++) {
      const raw = instruction(mnemonic); raw.operands.sValues[index] = "unresolved";
      assert.throws(() => compileFieldScriptMotionInstruction(raw), /reserved operands/);
    }
  }
  for (const direction of [-1, 4]) {
    const raw = instruction(); raw.operands.iValues[0] = direction;
    assert.throws(() => compileFieldScriptMotionInstruction(raw), /direction/);
  }
});

test("source numeric types remain finite and integral where required", () => {
  for (const value of [NaN, Infinity, -Infinity, 0.5, -2147483649, 2147483648]) {
    const raw = instruction(); raw.operands.iValues[1] = value;
    assert.throws(() => compileFieldScriptMotionInstruction(raw));
  }
  for (const value of [NaN, Infinity, -Infinity]) {
    const raw = instruction("Lerp"); raw.operands.rValues[1] = value;
    assert.throws(() => compileFieldScriptMotionInstruction(raw));
  }
});

test("decoder has no actor selection or mutable source ownership", () => {
  const raw = instruction(), before = structuredClone(raw), first = compileFieldScriptMotionInstruction(raw);
  first.command.animation = "changed";
  assert.deepEqual(raw, before);
  assert.equal(compileFieldScriptMotionInstruction(raw).command.animation, "Default");
  assert.ok(!("script" in first), "Site.script remains the caller's provenance");
});
