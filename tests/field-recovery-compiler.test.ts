import test from "node:test";
import assert from "node:assert/strict";
import { compileFieldRecoveryInstruction } from "../src/compiler/field-recovery.js";

const raw = (mnemonic = "RecoveryHP", amount = 0, target = 0) => ({ type: 1, mnemonic,
  operands: { iValues: [amount, 1, 1, mnemonic === "RecoveryMP" ? 1 : 0, target, 0, 0, 0],
    rValues: Array(8).fill(0), sValues: Array(8).fill("") } });
const tables = () => ({ "condition.csv": [{ id: "4", condition_type: "4" }, { id: "5", condition_type: "5" },
  { id: "100", condition_type: "5" }, { id: "11", condition_type: "11" }],
  "character_status.csv": [{ id: "12" }] });

test("field recovery uses selector slot four and retains separate source condition identities", () => {
  const op = compileFieldRecoveryInstruction(raw("RecoveryHP", -3, 12), tables());
  assert.deepEqual(op, { kind: "field-recovery", command: { kind: "recover-hp", amount: -3, target: 12,
    allowUnableFight: true, allowMineralization: true }, dependencies: [
    { table: "condition.csv", id: 4 }, { table: "condition.csv", id: 5 }, { table: "condition.csv", id: 100 },
    { table: "character_status.csv", id: 12 }] });
  for (const selector of [0, -1]) assert.equal(compileFieldRecoveryInstruction(raw("RecoveryMP", 0, selector), {}).command.target, selector);
});

test("eligibility predicates bind exact type references without admitting their effects", () => {
  const source = raw("RecoveryMP", 7, -1); source.operands.iValues[1] = 0; source.operands.iValues[2] = 0;
  assert.deepEqual(compileFieldRecoveryInstruction(source, tables()).dependencies, [
    { table: "condition.csv", id: 5 }, { table: "condition.csv", id: 100 }, { table: "condition.csv", id: 11 }]);
  const missing = tables(); missing["condition.csv"] = missing["condition.csv"].filter(row => row.condition_type !== "11");
  assert.throws(() => compileFieldRecoveryInstruction(source, missing), /Missing.*type reference/);
  const duplicate = tables(); duplicate["condition.csv"].push({ id: "5", condition_type: "5" });
  assert.throws(() => compileFieldRecoveryInstruction(source, duplicate), /Ambiguous.*identity/);
});

test("count MP recovery remains a separate unsupported provider", () => {
  const source = raw("RecoveryMP"); source.operands.iValues[3] = 0;
  assert.throws(() => compileFieldRecoveryInstruction(source, tables()), /MP count recovery provider/);
  source.operands.iValues[3] = 2;
  assert.throws(() => compileFieldRecoveryInstruction(source, tables()), /MP count recovery provider/);
  const hp = raw(); hp.operands.iValues[3] = 1;
  assert.throws(() => compileFieldRecoveryInstruction(hp, tables()), /HP recovery resource mode/);
});

test("complete operand banks reject flags, extra data, nonintegers and missing slots", () => {
  for (const index of [1, 2, 5, 6, 7]) {
    const source = raw(); source.operands.iValues[index] = 2;
    assert.throws(() => compileFieldRecoveryInstruction(source, tables()), /operand shape/);
  }
  for (const mutate of [(source: ReturnType<typeof raw>) => { source.operands.iValues.pop(); },
    (source: ReturnType<typeof raw>) => { source.operands.iValues[0] = 0.5; },
    (source: ReturnType<typeof raw>) => { source.operands.rValues[2] = 0.5; },
    (source: ReturnType<typeof raw>) => { source.operands.sValues[7] = "extra"; }]) {
    const source = raw(); mutate(source);
    assert.throws(() => compileFieldRecoveryInstruction(source, tables()));
  }
  assert.throws(() => compileFieldRecoveryInstruction({ ...raw(), type: 2 }, tables()), /Expected/);
});

test("numeric and selector admission boundaries fail before owned context exists", () => {
  assert.throws(() => compileFieldRecoveryInstruction(raw("RecoveryHP", -0x80000000), tables()), /overflow/);
  assert.throws(() => compileFieldRecoveryInstruction(raw("RecoveryHP", 0, -2), tables()), /selector/);
  assert.throws(() => compileFieldRecoveryInstruction(raw("RecoveryHP", 0, 11), tables()), /source reference/);
  const duplicate = tables(); duplicate["character_status.csv"].push({ id: "12" });
  assert.throws(() => compileFieldRecoveryInstruction(raw("RecoveryHP", 0, 12), duplicate), /source reference/);
});

test("condition dependencies reject invalid or cross-type duplicate IDs and include HP Dying provider", () => {
  for (const id of ["0", "-1", "5"]) {
    const invalid = tables(); invalid["condition.csv"].find(row => row.condition_type === "11")!.id = id;
    assert.throws(() => compileFieldRecoveryInstruction(raw(), invalid), /condition identity/);
  }
  const missing = tables(); missing["condition.csv"] = missing["condition.csv"].filter(row => row.condition_type !== "4");
  assert.throws(() => compileFieldRecoveryInstruction(raw(), missing), /type reference: 4/);
});
