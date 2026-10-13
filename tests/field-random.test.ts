import test from "node:test";
import assert from "node:assert/strict";
import { createFieldRandom, drawFieldRandom, validateFieldRandom } from "../src/core/field-random.js";

test("field random continuation survives serialization and abandoned candidates do not advance its owner", () => {
  const owner = createFieldRandom(0x71f6c0de), before = structuredClone(owner), abandoned = structuredClone(owner);
  for (let i = 0; i < 12; i++) drawFieldRandom(abandoned, 0, 31);
  assert.deepEqual(owner, before);
  for (let i = 0; i < 7; i++) drawFieldRandom(owner, 0, 31);
  const resumed = JSON.parse(JSON.stringify(owner)) as typeof owner;
  assert.deepEqual(Array.from({ length: 20 }, () => drawFieldRandom(owner, 0, 31)),
    Array.from({ length: 20 }, () => drawFieldRandom(resumed, 0, 31)));
  assert.deepEqual(owner, resumed); assert.equal(owner.draws, 27);
});

test("invalid field random state and ranges fail without consuming a draw", () => {
  for (const seed of [0, -1, 1.5, 0x100000000, NaN]) assert.throws(() => createFieldRandom(seed));
  const stream = createFieldRandom(1), before = structuredClone(stream);
  for (const [min, max] of [[2, 1], [-1, 31], [0, 1.5], [0, 0x80000000]])
    assert.throws(() => drawFieldRandom(stream, min!, max!));
  assert.deepEqual(stream, before);
  assert.throws(() => validateFieldRandom({ ...stream, draws: -1 }));
  const exhausted = { ...stream, draws: Number.MAX_SAFE_INTEGER };
  assert.throws(() => drawFieldRandom(exhausted, 0, 31));
  assert.equal(exhausted.draws, Number.MAX_SAFE_INTEGER);
  const values = Array.from({ length: 512 }, () => drawFieldRandom(stream, 0, 31));
  assert.equal(new Set(values).size, 32); assert.ok(values.every(value => value >= 0 && value <= 31));
});
