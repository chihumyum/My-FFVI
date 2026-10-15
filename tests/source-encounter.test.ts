import test from "node:test";
import assert from "node:assert/strict";
import { compileSourceEncounterInstruction, sourceEncounterLiteralCandidates } from "../src/compiler/source-encounter.js";
import { decodeFieldOp } from "../src/compiler/field.js";
import { parseSourceEncounterCommand, selectSourceEncounterSlot, sourceEncounterCandidates,
  WEB_SOURCE_ENCOUNTER_UNIFORM_SLOTS, type SourceEncounterCommand } from "../src/core/source-encounter.js";

const source = { file: "controlled.bundle", assetPath: "Controlled/event.json", objectId: "9223372036854775807" };
function raw(slots: number[] = [63, 63, 63, 47], effectId = 7) {
  return { type: 1, mnemonic: "Encount", operands: { iValues: [...slots, effectId, 0, 0, 0],
    rValues: Array<number>(8).fill(0), sValues: ["exact-local-continuation", "", "", "", "", "", "", ""] } };
}
const command = () => compileSourceEncounterInstruction(raw()).command;
const select = (value: SourceEncounterCommand, drawIndex: number) => selectSourceEncounterSlot(value,
  { policy: WEB_SOURCE_ENCOUNTER_UNIFORM_SLOTS, drawIndex });

test("all four original slots retain duplicate probability weight and the captured source command", () => {
  const op = compileSourceEncounterInstruction(raw()), before = structuredClone(op);
  assert.equal(op.kind, "source-encounter"); assert.deepEqual(op.command.slots, [63, 63, 63, 47]);
  assert.deepEqual(sourceEncounterCandidates(op.command), [
    { slotIndex: 0, partyId: 63 }, { slotIndex: 1, partyId: 63 }, { slotIndex: 2, partyId: 63 }, { slotIndex: 3, partyId: 47 }]);
  const results = [0, 1, 2, 3].map(index => select(op.command, index));
  assert.deepEqual(results.map(row => row.partyId), [63, 63, 63, 47]);
  assert.deepEqual(results.map(row => row.slotIndex), [0, 1, 2, 3]);
  for (const result of results) {
    assert.equal(result.effectId, 7); assert.equal(result.continuation, "exact-local-continuation");
    assert.equal(result.footCapture, "before-player-sync");
  }
  assert.deepEqual(op, before);
});

test("one through four nonzero slots retain zeros and every observed effect identifier", () => {
  for (const count of [1, 2, 3, 4]) for (const effect of [0, 6, 7, 8]) {
    const slots = [11, 12, 13, 14].map((id, index) => index < count ? id : 0);
    const op = compileSourceEncounterInstruction(raw(slots, effect));
    assert.deepEqual(op.command.slots, slots); assert.equal(op.command.effectId, effect);
    assert.equal(sourceEncounterCandidates(op.command).length, count);
    assert.equal(select(op.command, count - 1).partyId, slots[count - 1]);
    assert.throws(() => select(op.command, count), /Invalid prepared/);
  }
});

test("gapped slots, ZeroEncount and negative identities cannot become compressed or default lotteries", () => {
  for (const slots of [[0, 0, 0, 0], [0, 12, 0, 0], [11, 0, 13, 0], [11, -1, 0, 0]])
    assert.throws(() => compileSourceEncounterInstruction(raw(slots)), /ZeroEncount|gaps|party slot/);
  assert.throws(() => compileSourceEncounterInstruction(raw([11, 0, 0, 0], -1)), /command/);
});

test("selection always requires a named policy and a valid prepared draw, even for one party", () => {
  const value = compileSourceEncounterInstruction(raw([11, 0, 0, 0], 0)).command;
  for (const input of [undefined, {}, { policy: WEB_SOURCE_ENCOUNTER_UNIFORM_SLOTS },
    { policy: "native-by-default", drawIndex: 0 }, { policy: WEB_SOURCE_ENCOUNTER_UNIFORM_SLOTS, drawIndex: -1 },
    { policy: WEB_SOURCE_ENCOUNTER_UNIFORM_SLOTS, drawIndex: .5 },
    { policy: WEB_SOURCE_ENCOUNTER_UNIFORM_SLOTS, drawIndex: NaN }])
    assert.throws(() => selectSourceEncounterSlot(value, input as Parameters<typeof selectSourceEncounterSlot>[1]),
      /checkpoint|explicit Web|Invalid prepared/);
});

test("reserved i5..7, r-values, extra strings and non-field category remain blocked with original PC", () => {
  for (const kind of ["integer", "real", "string", "type", "continuation", "length"] as const) {
    const value = raw();
    if (kind === "integer") value.operands.iValues[5] = 99;
    if (kind === "real") value.operands.rValues[0] = .1;
    if (kind === "string") value.operands.sValues[1] = "unknown";
    if (kind === "type") value.type = 2;
    if (kind === "continuation") value.operands.sValues[0] = "";
    if (kind === "length") value.operands.iValues.pop();
    const op = decodeFieldOp(value, { source, script: "controlled", index: 91 }, {});
    assert.equal(op.kind, "blocked"); assert.equal(op.index, 91); assert.equal(op.source.objectId, source.objectId);
    const next = decodeFieldOp({ type: 1, mnemonic: "Exit", operands: { iValues: Array(8).fill(0),
      rValues: Array(8).fill(0), sValues: Array(8).fill("") } }, { source, script: "controlled", index: 92 }, {});
    assert.equal(next.kind, "exit"); assert.equal(next.index, 92);
  }
});

test("literal discovery retains all source-proven candidates while excluding the separate effect/reserved fields", () => {
  const value = raw(); value.operands.iValues[5] = 999;
  assert.deepEqual(sourceEncounterLiteralCandidates(value), [
    { slotIndex: 0, partyId: 63 }, { slotIndex: 1, partyId: 63 }, { slotIndex: 2, partyId: 63 }, { slotIndex: 3, partyId: 47 }]);
  value.type = 2; assert.deepEqual(sourceEncounterLiteralCandidates(value), []);
});

test("source decode uses the new host contract while older authored encounter fixtures retain theirs", () => {
  const value = raw([63, 0, 0, 0], 0), site = { source, script: "controlled", index: 30 };
  assert.equal(decodeFieldOp(value, site, {}).kind, "source-encounter");
  const { type: _, ...authored } = value;
  assert.deepEqual(decodeFieldOp(authored, site, {}), { ...site, kind: "encounter", party: 63, continuation: "exact-local-continuation" });
});

test("caller edits, invented foot timing and extra command grants do not alter a parsed plan", () => {
  const value = command(), parsed = parseSourceEncounterCommand(value), candidates = sourceEncounterCandidates(parsed);
  value.slots[0] = 777; candidates[0]!.partyId = 888;
  assert.equal(select(parsed, 0).partyId, 63);
  assert.throws(() => parseSourceEncounterCommand({ ...parsed, footCapture: "after-player-sync" } as unknown as SourceEncounterCommand), /command/);
  assert.throws(() => parseSourceEncounterCommand({ ...parsed, skipDefeat: true } as SourceEncounterCommand), /checkpoint/);
});

test("untrusted command, policy and slot accessors never execute while hidden grants remain rejected", () => {
  let invoked = 0;
  const value = command(), hidden = Symbol("skip-source-gates");
  const accessor = structuredClone(value);
  Object.defineProperty(accessor, "effectId", { enumerable: true, get() { invoked++; return 0; } });
  assert.throws(() => parseSourceEncounterCommand(accessor), /checkpoint data/);
  const slotGetter = structuredClone(value);
  Object.defineProperty(slotGetter.slots, "0", { enumerable: true, get() { invoked++; return 999; } });
  assert.throws(() => parseSourceEncounterCommand(slotGetter), /dense party slot data/);
  const policy = { policy: WEB_SOURCE_ENCOUNTER_UNIFORM_SLOTS, drawIndex: 0 };
  Object.defineProperty(policy, "drawIndex", { enumerable: true, get() { invoked++; return 0; } });
  assert.throws(() => selectSourceEncounterSlot(value, policy), /checkpoint data/);
  for (const change of [
    (op: SourceEncounterCommand) => Object.defineProperty(op, hidden, { value: true }),
    (op: SourceEncounterCommand) => Object.defineProperty(op, "effectId", { value: 0, enumerable: false }),
    (op: SourceEncounterCommand) => Object.defineProperty(op.slots, hidden, { value: 999 }),
    (op: SourceEncounterCommand) => Object.defineProperty(op.slots, "drawIndex", { value: 999 }),
    (op: SourceEncounterCommand) => Object.setPrototypeOf(op.slots, { [Symbol.iterator]() { invoked++; return [999, 0, 0, 0][Symbol.iterator](); } }),
    (op: SourceEncounterCommand) => { Reflect.deleteProperty(op.slots, "0"); },
  ]) { const invalid = structuredClone(value); change(invalid); assert.throws(() => parseSourceEncounterCommand(invalid), /checkpoint|slot/); }
  assert.equal(invoked, 0, "Validation may not run untrusted code before the surrounding owner fence");
  assert.deepEqual(select(value, 3), { slotIndex: 3, partyId: 47, effectId: 7,
    continuation: "exact-local-continuation", footCapture: "before-player-sync" });
});
