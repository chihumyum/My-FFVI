import assert from "node:assert/strict";
import test from "node:test";
import { compileFieldSoundInstruction as compile } from "../src/compiler/field-sound.js";

function raw(mnemonic: string, ints: number[] = [], reals: number[] = [], type = 1) {
  return { type, mnemonic, operands: {
    iValues: Array.from({ length: 8 }, (_, i) => ints[i] ?? 0),
    rValues: Array.from({ length: 8 }, (_, i) => reals[i] ?? 0),
    sValues: Array(8).fill("") as string[],
  } };
}
test("SE play separates source sound identity, async flag, and local handle slot", () => {
  assert.deepEqual(compile(raw("PlaySE", [101, 1, 4], [], 2)), { kind: "field-sound", command: {
    kind: "play", soundId: 101, asynchronous: true, handleSlot: 4, fadeSeconds: 0, seekSeconds: 0, pan: 0,
  } });
  assert.equal(compile(raw("PlaySE", [101, 0, 2])).command.kind, "play");
  assert.deepEqual(compile(raw("PlaySE", [101, 0, 2])), { kind: "field-sound", command: {
    kind: "play", soundId: 101, asynchronous: false, handleSlot: 2, fadeSeconds: 0, seekSeconds: 0, pan: 0,
  } });
});
test("all negative play slot values mean no handle publication; nonzero async is source truth", () => {
  for (const slot of [-1, -2147483648]) {
    const op = compile(raw("PlaySE", [1, -2, slot]));
    assert.equal(op.command.kind, "play");
    if (op.command.kind === "play") { assert.equal(op.command.handleSlot, null); assert.equal(op.command.asynchronous, true); }
  }
});
test("Stop and Sync address a script-local slot without inventing a static channel", () => {
  assert.deepEqual(compile(raw("StopSE", [3], [0.35])), { kind: "field-sound", command: {
    kind: "stop", handleSlot: 3, fadeSeconds: Math.fround(0.35),
  } });
  assert.deepEqual(compile(raw("SyncSE", [123])), { kind: "field-sound", command: { kind: "sync", handleSlot: 123 } });
  assert.deepEqual(compile(raw("ReadySE", [101])), { kind: "field-sound", command: { kind: "ready", soundId: 101 } });
});
test("control parameters use native Single conversion without altering IDs", () => {
  const op = compile(raw("PlaySE", [16777217, 1, 16777217], [0.1, 1.3, -0.2]));
  assert.deepEqual(op.command, { kind: "play", soundId: 16777217, asynchronous: true, handleSlot: 16777217,
    fadeSeconds: Math.fround(0.1), seekSeconds: Math.fround(1.3), pan: Math.fround(-0.2) });
});
for (const mnemonic of ["PlaySE", "StopSE", "SyncSE", "ReadySE"]) {
  test(`${mnemonic} rejects nonempty reserved arrays without changing the input`, () => {
    for (const key of ["iValues", "rValues", "sValues"] as const) {
      const r = raw(mnemonic, [1]);
      if (key === "sValues") r.operands[key][7] = "extra"; else r.operands[key][7] = 1;
      const before = structuredClone(r); assert.throws(() => compile(r), /reserved/); assert.deepEqual(r, before);
    }
  });
}
test("source short arrays are diagnosed, not silently padded", () => {
  const r = raw("PlaySE", [38, 1, -1]); r.operands.iValues = [38, 1, -1];
  assert.throws(() => compile(r));
  const missing = structuredClone(raw("ReadySE", [1])) as any; delete missing.operands.sValues;
  assert.throws(() => compile(missing));
});
test("unknown mnemonics/types/identities/slot forms remain unavailable", () => {
  for (const r of [raw("LoadSE", [1]), raw("PlaySE", [1], [], 0), raw("PlaySE", [0]),
    raw("ReadySE", [-1]), raw("StopSE", [-1]), raw("SyncSE", [-1]), raw("PlaySE", [1.5]),
    raw("PlaySE", [2147483648]), raw("StopSE", [0], [-1]), raw("PlaySE", [1], [Infinity])])
    assert.throws(() => compile(r));
  assert.throws(() => compile({ ...raw("PlaySE", [1]), mnemonic: ["PlaySE"] }));
});
test("decoder is pure and does not invent media or loop capability", () => {
  const r = raw("PlaySE", [101, 1, 0]), before = structuredClone(r), op = compile(r);
  assert.deepEqual(r, before); assert.equal("loop" in op.command, false); assert.equal("media" in op.command, false);
});
