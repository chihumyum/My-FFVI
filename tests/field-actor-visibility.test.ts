import test from "node:test";
import assert from "node:assert/strict";
import { compileFieldActorVisibilityInstruction, fieldActorVisibilityMnemonics } from "../src/compiler/field-actor-visibility.js";
import { decodeFieldOp } from "../src/compiler/field.js";

function raw(mnemonic: "Show" | "Hide" = "Show") {
  return { type: 2, mnemonic, label: "", comment: "", operands: {
    iValues: Array<number>(8).fill(0), rValues: Array<number>(8).fill(0), sValues: Array<string>(8).fill(""),
  } };
}

test("immediate Puppet visibility decodes without choosing an actor or editing its source operands", () => {
  assert.deepEqual(fieldActorVisibilityMnemonics, ["Show", "Hide"]);
  for (const mnemonic of fieldActorVisibilityMnemonics) {
    const input = raw(mnemonic), before = structuredClone(input);
    const op = compileFieldActorVisibilityInstruction(input);
    assert.deepEqual(op, { kind: "actor-visibility", visible: mnemonic === "Show" });
    assert.deepEqual(input, before);
    input.operands.iValues[0] = 123;
    assert.deepEqual(op, { kind: "actor-visibility", visible: mnemonic === "Show" });
  }
});

test("MainCore and player wrappers do not become Puppet actor visibility aliases", () => {
  const site = { script: "authored-visibility-namespace", index: 0,
    source: { file: "tests/field-actor-visibility.test.ts", assetPath: "authored/visibility" } };
  for (const type of [0, 1, 3, "2", undefined, null])
    for (const mnemonic of fieldActorVisibilityMnemonics) {
      assert.throws(() => compileFieldActorVisibilityInstruction({ ...raw(mnemonic), type }), /Expected source Puppet/);
      assert.equal(decodeFieldOp({ ...raw(mnemonic), type }, site, {}).kind, "blocked",
        "The complete decoder cannot admit another explicit namespace through its legacy Hide branch");
    }
  for (const mnemonic of ["ShowPlayer", "HidePlayer", "show", "hide", "HideMob", "RestoreMob"])
    assert.throws(() => compileFieldActorVisibilityInstruction({ ...raw(), mnemonic }), /Expected source Puppet/);
  const { type: _, ...legacyHide } = raw("Hide");
  assert.equal(decodeFieldOp(legacyHide, site, {}).kind, "hide",
    "The explicitly untyped authored legacy fixture retains its previous contract");
  const { type: __, ...untypedShow } = raw("Show");
  assert.equal(decodeFieldOp(untypedShow, site, {}).kind, "blocked");
});

test("duration, delay and every reserved operand remain explicit blockers", () => {
  for (const mnemonic of fieldActorVisibilityMnemonics) {
    for (let index = 0; index < 8; index++) {
      const integer = raw(mnemonic); integer.operands.iValues[index] = 1;
      const real = raw(mnemonic); real.operands.rValues[index] = index === 1 ? .1 : .7;
      const string = raw(mnemonic); string.operands.sValues[index] = "source-unknown";
      for (const input of [integer, real, string]) {
        const before = structuredClone(input);
        assert.throws(() => compileFieldActorVisibilityInstruction(input), /duration, delay or reserved/);
        assert.deepEqual(input, before);
      }
    }
    const negative = raw(mnemonic); negative.operands.rValues[0] = -.1;
    assert.throws(() => compileFieldActorVisibilityInstruction(negative), /duration, delay or reserved/);
  }
});

test("the complete eight-slot source ABI rejects malformed and sparse arrays", () => {
  for (const key of ["iValues", "rValues", "sValues"] as const) {
    for (const length of [0, 7, 9]) {
      const input = raw(); input.operands[key].length = length;
      assert.throws(() => compileFieldActorVisibilityInstruction(input));
    }
    const sparse = raw(); delete sparse.operands[key][7];
    assert.throws(() => compileFieldActorVisibilityInstruction(sparse));
  }
  for (const value of [.5, 2147483648, -2147483649, NaN, "0", false, null]) {
    const input = raw(); (input.operands.iValues as unknown[])[7] = value;
    assert.throws(() => compileFieldActorVisibilityInstruction(input));
  }
  for (const value of [NaN, Infinity, -Infinity, "0", null]) {
    const input = raw(); (input.operands.rValues as unknown[])[7] = value;
    assert.throws(() => compileFieldActorVisibilityInstruction(input));
  }
  for (const value of [0, null, false]) {
    const input = raw(); (input.operands.sValues as unknown[])[7] = value;
    assert.throws(() => compileFieldActorVisibilityInstruction(input));
  }
});

test("missing or additional operand fields cannot silently extend the admitted source form", () => {
  const input = raw();
  assert.throws(() => compileFieldActorVisibilityInstruction({ ...input, operands: { ...input.operands, duration: 1 } }));
  const { sValues: _, ...missing } = input.operands;
  assert.throws(() => compileFieldActorVisibilityInstruction({ ...input, operands: missing }));
  for (const invalid of [undefined, null, 0, [], { type: 2, mnemonic: "Show" }])
    assert.throws(() => compileFieldActorVisibilityInstruction(invalid));
});
