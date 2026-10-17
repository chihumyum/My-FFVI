import test from "node:test";
import assert from "node:assert/strict";
import { compileFieldScriptMotionInstruction } from "../src/compiler/field-script-motion.js";
import { decodeFieldOp } from "../src/compiler/field.js";

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
  for (const raw of [null, {}, { ...instruction(), type: 1 }, { ...instruction(), mnemonic: "MoveBirdView" }])
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

function moveTo(axis: number, mode: number, value: number, parameter: number, speed = 1) {
  const raw = instruction("MoveTo");
  raw.operands.iValues = [axis, mode, value, parameter, speed, 0, 0, 0];
  return raw;
}

test("MoveTo preserves one selected axis and the direct layer request without resolving a destination", () => {
  for (const [id, axis] of ["x", "y"].entries()) for (const layer of [0, 1, 2, 3]) {
    const raw = moveTo(id, 0, -2, layer);
    assert.deepEqual(compileFieldScriptMotionInstruction(raw), {
      kind: "field-script-motion", command: { kind: "move-to", axis,
        target: { kind: "direct", value: -2, layer }, speedId: 1, animation: "Default" },
    });
  }
});

test("MoveTo entity selector is a target reference, with signed cell offset and independent speed", () => {
  for (const selector of [-1001, -5, 230]) for (const offset of [-1, 0, 1]) {
    const raw = moveTo(1, 1, selector, offset, -1); raw.operands.sValues[0] = "";
    const op = compileFieldScriptMotionInstruction(raw);
    assert.deepEqual(op, { kind: "field-script-motion", command: { kind: "move-to", axis: "y",
      target: { kind: "entity", selector, offset }, speedId: null, animation: "" } });
    assert.ok(!("actorId" in op.command), "The compiler must not select the movement owner from the target operand");
  }
  for (const speed of [-2147483648, -2, -1, 0, 1, 2, 3, 4, 5, 6]) {
    const op = compileFieldScriptMotionInstruction(moveTo(0, 0, 12, 0, speed));
    assert.equal(op.command.kind, "move-to");
    if (op.command.kind === "move-to") assert.equal(op.command.speedId, speed < 0 ? null : speed);
  }
  assert.throws(() => compileFieldScriptMotionInstruction(moveTo(0, 0, 12, 0, 7)), /speed selector/);
});

test("MoveTo keeps unsupported axes, layers and unobserved empty-target mode blocked", () => {
  for (const axis of [-1, 2]) assert.throws(() => compileFieldScriptMotionInstruction(moveTo(axis, 0, 1, 0)), /axis/);
  for (const mode of [-1, 2, 3]) assert.throws(() => compileFieldScriptMotionInstruction(moveTo(0, mode, 1, 0)), /target mode/);
  for (const layer of [-1, 4]) assert.throws(() => compileFieldScriptMotionInstruction(moveTo(0, 0, 1, layer)), /layer request/);
});

test("MoveTo cannot silently pad sandbox arrays or reinterpret unknown path flags", () => {
  for (const key of ["iValues", "rValues", "sValues"] as const) {
    const raw = moveTo(0, 0, 1, 0); raw.operands[key].length = 7;
    assert.throws(() => compileFieldScriptMotionInstruction(raw));
  }
  assert.throws(() => compileFieldScriptMotionInstruction({ type: 2, mnemonic: "MoveTo",
    operands: { iValues: [1, 0, 43, 0, 2], sValues: [""] } }));
  for (let index = 5; index < 8; index++) {
    const raw = moveTo(0, 0, 1, 0); raw.operands.iValues[index] = 1;
    assert.throws(() => compileFieldScriptMotionInstruction(raw), /reserved operands/);
  }
  for (let index = 0; index < 8; index++) {
    const raw = moveTo(0, 0, 1, 0); raw.operands.rValues[index] = 0.5;
    assert.throws(() => compileFieldScriptMotionInstruction(raw), /reserved operands/);
  }
  for (let index = 1; index < 8; index++) {
    const raw = moveTo(0, 0, 1, 0); raw.operands.sValues[index] = "unknown";
    assert.throws(() => compileFieldScriptMotionInstruction(raw), /reserved operands/);
  }
});

test("MoveTo source integer domains and target data stay detached", () => {
  for (const index of [0, 1, 2, 3, 4]) for (const value of [NaN, Infinity, 0.5, -2147483649, 2147483648]) {
    const raw = moveTo(0, 0, 1, 0); raw.operands.iValues[index] = value;
    assert.throws(() => compileFieldScriptMotionInstruction(raw));
  }
  const raw = moveTo(0, 1, -1001, -1), before = structuredClone(raw), first = compileFieldScriptMotionInstruction(raw);
  assert.equal(first.command.kind, "move-to");
  if (first.command.kind === "move-to" && first.command.target.kind === "entity") first.command.target.offset = 9;
  assert.deepEqual(raw, before);
  assert.deepEqual(compileFieldScriptMotionInstruction(raw).command, {
    kind: "move-to", axis: "x", target: { kind: "entity", selector: -1001, offset: -1 }, speedId: 1, animation: "Default",
  });
});

test("field decoder routes MoveTo through the common compiler and preserves exact source site", () => {
  const site = { script: "source-motion", index: 58, source: {
    file: "controlled.bundle", assetPath: "controlled/script.json", objectId: "-7100474102474677432", pointer: "/Mnemonics/58",
  } };
  const raw = moveTo(0, 1, -1001, 0), before = structuredClone(raw);
  assert.deepEqual(decodeFieldOp(raw, site, {}), { ...site, ...compileFieldScriptMotionInstruction(raw) });
  assert.deepEqual(raw, before);
  const malformed = { type: 2, mnemonic: "MoveTo", operands: { iValues: [1, 0, 43, 0, 2], sValues: [""] } };
  const blocked = decodeFieldOp(malformed, site, {});
  assert.equal(blocked.kind, "blocked");
  assert.deepEqual(blocked.source, site.source);
  if (blocked.kind === "blocked") assert.equal(blocked.mnemonic, "MoveTo");
});
