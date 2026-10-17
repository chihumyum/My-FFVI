import test from "node:test";
import assert from "node:assert/strict";
import { initialFieldCoreRegisters, parseFieldCoreRegisters, projectFieldCoreI0,
  projectFieldCoreSlots } from "../src/core/field-core-registers.js";

test("Core.Reset data is distinct from operands and script-local banks, and string slots are null", () => {
  const a = initialFieldCoreRegisters(), b = initialFieldCoreRegisters();
  assert.notEqual(a, b); assert.notEqual(a.i, b.i);
  assert.deepEqual(a, { kind: "field-core-registers-v1", i: Array(8).fill(0), r: Array(4).fill(0), s: Array(4).fill(null) });
  const changed = projectFieldCoreSlots(a, { i: { 0: 53, 7: -8 }, r: { 1: .25 } });
  assert.equal(changed.i[0], 53); assert.equal(changed.i[7], -8); assert.equal(changed.r[1], .25);
  assert.deepEqual(a, b); assert.deepEqual(initialFieldCoreRegisters(), b);
});

test("ordered row writes retain a prior register on no iterations and leave the final retained row observable", () => {
  const before = projectFieldCoreSlots(initialFieldCoreRegisters(), { i: { 0: -17, 1: 8 }, r: { 1: 4.5 } });
  assert.deepEqual(projectFieldCoreI0(before, []), before);
  const after = projectFieldCoreI0(before, [5, 6, 53, 79]);
  assert.equal(after.i[0], 79); assert.equal(after.i[1], 8); assert.equal(after.r[1], 4.5);
  assert.equal(before.i[0], -17); assert.throws(() => (after.i as number[])[0] = 999);
});

test("versioned restore rejects sparse, accessor, extra-bank, numeric and source-shape corruption", () => {
  const valid = structuredClone(initialFieldCoreRegisters());
  for (const mutate of [
    (x: any) => x.kind = "operands-v1", (x: any) => x.i.push(0), (x: any) => delete x.i[0],
    (x: any) => x.r.push(0), (x: any) => x.s[0] = 0, (x: any) => x.i[0] = 2 ** 31,
    (x: any) => x.r[1] = Infinity, (x: any) => x.locals = [],
    (x: any) => Object.defineProperty(x, "i", { get() { throw new Error("getter must not run"); }, enumerable: true }),
  ]) {
    const raw = structuredClone(valid); mutate(raw); assert.throws(() => parseFieldCoreRegisters(raw));
  }
  assert.throws(() => projectFieldCoreI0(valid, Array(1)), /Sparse/);
  const loaded = parseFieldCoreRegisters(JSON.parse(JSON.stringify(valid)));
  assert.deepEqual(loaded, valid); assert.notEqual(loaded.i, valid.i);
});
