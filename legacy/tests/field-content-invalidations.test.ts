import test from "node:test";
import assert from "node:assert/strict";
import { compileFieldContentInvalidationInstruction } from "../src/compiler/field-content-invalidations.js";
import { decodeFieldOp } from "../src/compiler/field.js";
import { FieldContentInvalidations, movingContentInvalidationIds } from "../src/core/field-content-invalidations.js";
import { projectBattleFieldState } from "../src/core/field-battle-entry.js";
import { battleUseInvalidContents } from "../src/core/battle-entry.js";
import type { Op } from "../src/field/types.js";
import { battleEntryFixture } from "./fixtures/battle-entry.js";

const source = { file: "synthetic", assetPath: "authored/field-invalidations", objectId: "9007199254740999" };
const raw = (value = 1) => ({ type: 1, mnemonic: "InvalidateTelepo", operands: {
  iValues: [value, 0, 0, 0, 0, 0, 0, 0], rValues: Array(8).fill(0), sValues: Array(8).fill("") } });
function fixture() {
  const { catalog } = battleEntryFixture(), instruction = { ...compileFieldContentInvalidationInstruction(raw()),
    script: "physical-source-name", index: 99, source } as Op;
  const content = { contentHash: "a".repeat(64), scripts: { installed: [instruction] } };
  const context = { catalogHash: "b".repeat(64), catalog };
  return { content, context, state: new FieldContentInvalidations(content, context) };
}
const field = { mapId: 100, transportationId: 1, isSavePoint: false, beastFieldController: false, footAttributeType: 0 };
const transportations = [{ id: 1, type: 1 }, { id: 2, type: 6 }];

test("InvalidateTelepo uses the wrapper's boolean-to-0/2 mapping and exact namespace/reserved operands", () => {
  for (const value of [1, -1, 2, -2147483648, 2147483647])
    assert.deepEqual(compileFieldContentInvalidationInstruction(raw(value)),
      { kind: "field-content-invalidation", command: { kind: "add-moving", invalidType: 2 } });
  assert.equal(compileFieldContentInvalidationInstruction(raw(0)).command.invalidType, 0);
  for (const type of [0, 2, 3]) assert.equal(decodeFieldOp({ ...raw(), type }, { script: "s", index: 0, source }, {}).kind, "blocked");
  for (let index = 1; index < 8; index++) {
    const value = raw(); value.operands.iValues[index] = 1;
    assert.throws(() => compileFieldContentInvalidationInstruction(value), /reserved/);
  }
  for (const key of ["rValues", "sValues"] as const) {
    const value = raw(); if (key === "rValues") value.operands.rValues[0] = 1; else value.operands.sValues[0] = "unexpected";
    assert.throws(() => compileFieldContentInvalidationInstruction(value), /reserved/);
  }
  for (const mnemonic of ["CastTelepo", "RemoveTelepoCache", "AddTelepoCache"])
    assert.equal(decodeFieldOp({ ...raw(), mnemonic }, { script: "s", index: 0, source }, {}).kind, "blocked");
  let reads = 0; const bad = raw();
  Object.defineProperty(bad.operands.iValues, "0", { enumerable: true, get: () => { reads++; return 1; } });
  assert.throws(() => compileFieldContentInvalidationInstruction(bad), /accessor/); assert.equal(reads, 0);
  const sparse = raw(); delete sparse.operands.iValues[1];
  assert.throws(() => compileFieldContentInvalidationInstruction(sparse), /shape/);
});

test("moving mutations affect both walking lists and retain the separate transportation/battle-use consumers", () => {
  const { catalog } = battleEntryFixture(), before = structuredClone(catalog);
  assert.deepEqual(projectBattleFieldState(catalog, field, transportations, [2]).invalidContentIds, [10001, 10005, 10002]);
  assert.deepEqual(projectBattleFieldState(catalog, { ...field, isSavePoint: true }, transportations, [2]).invalidContentIds, [10005, 10002]);
  assert.deepEqual(projectBattleFieldState(catalog, field, transportations, [0, 2, 0]).invalidContentIds,
    [10001, 10005, 10002, 10003]);
  assert.deepEqual(projectBattleFieldState(catalog, { ...field, transportationId: 2 }, transportations, [2]).invalidContentIds,
    [10001, 10002, 10003, 10004, 10005]);
  assert.deepEqual(catalog, before); assert.deepEqual(battleUseInvalidContents([23, 412, 1309]), [1309]);
  catalog.beastFieldContents.push(10002);
  assert.throws(() => movingContentInvalidationIds(catalog, 2), /update order/);
});

test("the Field register binds installed Web PC and exact source command and rejects forged saves without publishing", () => {
  const f = fixture(); assert.equal(f.state.snapshot(), null);
  f.state.execute("installed", 0); f.state.execute("installed", 0);
  const saved = f.state.snapshot()!; assert.equal(saved.commands.length, 1);
  assert.equal(saved.commands[0]!.instruction.index, 99); assert.equal(saved.commands[0]!.webPc, 0);
  for (const mutate of [
    (s: typeof saved) => { s.catalogHash = "c".repeat(64); },
    (s: typeof saved) => { s.commands[0]!.webPc = 99; },
    (s: typeof saved) => { s.commands[0]!.instruction.command.invalidType = 0; },
    (s: typeof saved) => { s.commands[0]!.instruction.source.objectId = "9007199254740998"; },
    (s: typeof saved) => { s.commands.push(structuredClone(s.commands[0]!)); },
    (s: typeof saved) => { s.commands = []; },
  ]) {
    const target = new FieldContentInvalidations(f.content, f.context), bad = structuredClone(saved); mutate(bad);
    assert.throws(() => target.restore(bad)); assert.equal(target.snapshot(), null);
  }
  let getterReads = 0; const malicious = structuredClone(saved);
  Object.defineProperty(malicious.commands[0]!.instruction.source, "assetPath", { enumerable: true,
    get: () => { getterReads++; return source.assetPath; } });
  assert.throws(() => new FieldContentInvalidations(f.content, f.context).restore(malicious), /data fields/);
  assert.equal(getterReads, 0);
  const restored = new FieldContentInvalidations(f.content, f.context); restored.restore(saved);
  assert.deepEqual(restored.snapshot(), saved); saved.commands[0]!.script = "foreign";
  assert.deepEqual(restored.invalidTypes(f.context.catalog), [2]);
  f.context.catalog.movingContents[0]!.value2 = 1;
  assert.throws(() => restored.snapshot(), /bound battle catalog/);
});

test("no source catalog is an explicit reached provider failure and an unused field retains its legacy state", () => {
  const f = fixture(), missing = new FieldContentInvalidations(f.content);
  assert.equal(missing.snapshot(), null); assert.deepEqual(missing.invalidTypes(f.context.catalog), []);
  assert.throws(() => missing.execute("installed", 0), /bound battle catalog/);
  assert.equal(missing.snapshot(), null);
  assert.deepEqual(f.state.invalidTypes(f.context.catalog), []);
  const mutated = fixture();
  (mutated.content.scripts.installed![0]! as Extract<Op, { kind: "field-content-invalidation" }>).command.invalidType = 0;
  assert.throws(() => mutated.state.execute("installed", 0), /source instruction changed/); assert.equal(mutated.state.snapshot(), null);
  const switchedOwner = fixture(); switchedOwner.context.catalogHash = "c".repeat(64);
  assert.throws(() => switchedOwner.state.execute("installed", 0), /bound battle catalog/);
  const changed = structuredClone(f.content); changed.scripts.installed![0]!.kind = "exit";
  const next = new FieldContentInvalidations(changed, f.context);
  f.state.execute("installed", 0); assert.throws(() => next.restore(f.state.snapshot()), /source instruction/);
});
