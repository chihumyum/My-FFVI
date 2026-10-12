import test from "node:test";
import assert from "node:assert/strict";
import {
  compileEventScriptTransitionInstruction,
  compileEventScriptTransitionMetadata,
} from "../src/compiler/event-script-transition.js";

function instruction(target = "synthetic_followup", returnFlag = 0) {
  return {
    type: 1,
    mnemonic: "ChangeScript",
    operands: {
      iValues: [returnFlag, 0, 0, 0, 0, 0, 0, 0],
      rValues: Array<number>(8).fill(0),
      sValues: [target, "", "", "", "", "", "", ""],
    },
  };
}

test("ChangeScript selects replacement or one return hook from the source boolean", () => {
  for (const flag of [0, 1, -1, -2147483648, 2147483647]) {
    assert.deepEqual(compileEventScriptTransitionInstruction(instruction("next", flag)), {
      kind: "script-transition",
      targetScript: "next",
      returnToCaller: flag !== 0,
    });
  }
});

test("ChangeScript preserves the exact alias instead of resolving or normalizing it", () => {
  for (const name of ["sc_map_Synthetic", "Resident_alias", " exact alias "]) {
    assert.equal(compileEventScriptTransitionInstruction(instruction(name)).targetScript, name);
  }
  assert.throws(() => compileEventScriptTransitionInstruction(instruction("")), /target script/);
});

test("only the complete source instruction form is accepted", () => {
  for (const raw of [
    null,
    { ...instruction(), type: 0 },
    { ...instruction(), type: 2 },
    { ...instruction(), mnemonic: "Execute" },
    { ...instruction(), operands: null },
  ]) assert.throws(() => compileEventScriptTransitionInstruction(raw));
  for (const key of ["iValues", "rValues", "sValues"] as const) {
    for (const length of [0, 7, 9]) {
      const raw = instruction();
      raw.operands[key].length = length;
      assert.throws(() => compileEventScriptTransitionInstruction(raw));
    }
  }
});

test("unsupported operands cannot silently become a normal transition", () => {
  for (let index = 1; index < 8; index++) {
    const raw = instruction();
    raw.operands.iValues[index] = 1;
    assert.throws(() => compileEventScriptTransitionInstruction(raw), /reserved operands/);
    raw.operands.iValues[index] = 0;
    raw.operands.sValues[index] = "unsupported";
    assert.throws(() => compileEventScriptTransitionInstruction(raw), /reserved operands/);
  }
  for (let index = 0; index < 8; index++) {
    const raw = instruction();
    raw.operands.rValues[index] = 0.5;
    assert.throws(() => compileEventScriptTransitionInstruction(raw), /reserved operands/);
  }
});

test("numeric source values must remain finite and signed int32", () => {
  for (const value of [NaN, Infinity, 0.5, -2147483649, 2147483648]) {
    assert.throws(() => compileEventScriptTransitionInstruction(instruction("next", value)));
  }
  for (const value of [NaN, Infinity, -Infinity]) {
    const raw = instruction();
    raw.operands.rValues[0] = value;
    assert.throws(() => compileEventScriptTransitionInstruction(raw));
  }
});

test("an explicit empty custom animation list is a source capability", () => {
  assert.deepEqual(compileEventScriptTransitionMetadata({ Animations: [] }), {
    customAnimations: "none",
  });
});

test("missing, malformed or nonempty custom animations retain an explicit gate", () => {
  for (const raw of [null, {}, { Animations: null }, { Animations: {} }, { Animations: "" }]) {
    assert.throws(() => compileEventScriptTransitionMetadata(raw));
  }
  assert.throws(
    () => compileEventScriptTransitionMetadata({ Animations: [{ asset: "synthetic" }] }),
    /require a source provider/,
  );
});

test("decoding does not mutate source arrays or cache mutable returned metadata", () => {
  const raw = instruction(), before = structuredClone(raw);
  const op = compileEventScriptTransitionInstruction(raw);
  op.targetScript = "changed";
  assert.deepEqual(raw, before);
  assert.equal(compileEventScriptTransitionInstruction(raw).targetScript, "synthetic_followup");
  const first = compileEventScriptTransitionMetadata({ Animations: [] }),
    second = compileEventScriptTransitionMetadata({ Animations: [] });
  assert.notEqual(first, second);
});
