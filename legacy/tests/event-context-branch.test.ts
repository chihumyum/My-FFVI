import test from "node:test";
import assert from "node:assert/strict";
import { compileEventContextBranchInstruction } from "../src/compiler/event-context-branch.js";
import {
  prepareEventContextBranch,
  type EventContextBranchOp,
  type EventContextBranchInput,
} from "../src/core/event-context-branch.js";
import type { FieldPuppetRosterRead } from "../src/core/field-puppet-roster.js";

const instruction = (mnemonic: string, values: number[] = [], type = 1) => ({
  type, mnemonic, operands: {
    iValues: [...values, ...Array<number>(8 - values.length).fill(0)],
    rValues: Array<number>(8).fill(0), sValues: Array<string>(8).fill(""),
  },
});
const roster = (): FieldPuppetRosterRead => ({
  owned: [
    { ownedId: 101, sourceId: 2, enabled: false, conditionTypes: [] },
    { ownedId: 102, sourceId: 1, enabled: true, conditionTypes: [] },
    { ownedId: 901, sourceId: 3, enabled: false, conditionTypes: [] },
    { ownedId: 777, sourceId: 4, enabled: true, conditionTypes: [] },
  ],
  party: [101, 102, 0, 0],
});
const input = (changes: Partial<EventContextBranchInput> = {}): EventContextBranchInput => ({
  nextPc: 2, range: { min: 0, max: 16 }, roster: roster(), ...changes,
});
const character = (
  changes: Partial<Extract<EventContextBranchOp, { kind: "branch-character" }>> = {},
): Extract<EventContextBranchOp, { kind: "branch-character" }> => ({
  kind: "branch-character", sourceId: 1, presence: "present", scope: "current-party", target: 8, ...changes,
});
const direction: EventContextBranchOp = { kind: "branch-player-direction", targets: [3, 6, 9, 12] };

test("character decoder preserves presence inversion and the two source roster queries", () => {
  for (const presence of [0, 1]) for (const scope of [0, 1]) {
    assert.deepEqual(compileEventContextBranchInstruction(instruction("BranchByCharacter", [17, presence, scope, 8])), {
      kind: "branch-character", sourceId: 17,
      presence: presence === 0 ? "present" : "absent",
      scope: scope === 0 ? "current-party" : "enabled-roster", target: 8,
    });
  }
});

test("direction decoder keeps north/east/south/west labels including zero", () => {
  assert.deepEqual(compileEventContextBranchInstruction(instruction("BranchByPlayerDirection", [0, 2, 4, 6])),
    { kind: "branch-player-direction", targets: [0, 2, 4, 6] });
});

test("strict decoder refuses unknown forms rather than dropping operand dependencies", () => {
  for (const raw of [
    instruction("BranchByCharacter", [0, 0, 0, 3]),
    instruction("BranchByCharacter", [1, 2, 0, 3]),
    instruction("BranchByCharacter", [1, 0, 2, 3]),
    instruction("BranchByCharacter", [1, 0, 0, -1]),
    instruction("BranchByCharacter", [1, 0, 0, 3, 1]),
    instruction("BranchByCharacter", [1, 0, 0, 3], 2),
    instruction("BranchByPlayerDirection", [1, 2, -1, 4]),
    instruction("BranchByPlayerDirection", [1, 2, 3, 2147483648]),
    instruction("BranchByLeader", [1, 0, 0, 3]),
    { mnemonic: "BranchByCharacter", type: 1 },
  ]) assert.throws(() => compileEventContextBranchInstruction(raw));
  const raw = instruction("BranchByCharacter", [1, 0, 0, 3]);
  raw.operands.rValues[0] = 0.1;
  assert.throws(() => compileEventContextBranchInstruction(raw), /reserved/);
  raw.operands.rValues[0] = 0; raw.operands.sValues[3] = "unresolved";
  assert.throws(() => compileEventContextBranchInstruction(raw), /reserved/);
  raw.operands.sValues[3] = ""; raw.operands.iValues.pop();
  assert.throws(() => compileEventContextBranchInstruction(raw));
});

test("current-party branch joins Owned.Id to source identity and does not filter disabled members", () => {
  assert.deepEqual(prepareEventContextBranch(character({ sourceId: 2 }), input()), { pc: 9, branched: true });
  assert.deepEqual(prepareEventContextBranch(character({ sourceId: 101 }), input()), { pc: 2, branched: false });
  assert.deepEqual(prepareEventContextBranch(character({ sourceId: 4 }), input()), { pc: 2, branched: false });
});

test("enabled-roster branch includes active owners outside the party and excludes disabled owners", () => {
  const op = character({ scope: "enabled-roster" });
  assert.deepEqual(prepareEventContextBranch({ ...op, sourceId: 4 }, input()), { pc: 9, branched: true });
  assert.deepEqual(prepareEventContextBranch({ ...op, sourceId: 2 }, input()), { pc: 2, branched: false });
  assert.deepEqual(prepareEventContextBranch({ ...op, sourceId: 3 }, input()), { pc: 2, branched: false });
});

test("present and absent predicates produce opposite routes for each source query", () => {
  for (const scope of ["current-party", "enabled-roster"] as const) {
    assert.equal(prepareEventContextBranch(character({ scope, sourceId: 1, presence: "absent" }), input()).pc, 2);
    assert.equal(prepareEventContextBranch(character({ scope, sourceId: 14, presence: "absent" }), input()).pc, 9);
  }
});

test("distinct owned identities may share a source character; a later enabled duplicate still matches", () => {
  const state = roster();
  state.owned.push({ ownedId: 888, sourceId: 3, enabled: true, conditionTypes: [] });
  assert.equal(prepareEventContextBranch(character({ sourceId: 3, scope: "enabled-roster" }), input({ roster: state })).pc, 9);
  assert.equal(prepareEventContextBranch(character({ sourceId: 3 }), input({ roster: state })).pc, 2);
});

test("missing roster or unresolved current corps cannot become a negative character result", () => {
  assert.throws(() => prepareEventContextBranch(character(), { nextPc: 2, range: { min: 0, max: 16 } }), /roster provider/);
  assert.deepEqual(prepareEventContextBranch(character({ presence: "absent" }), input({ roster: { owned: [], party: [0, 0, 0, 0] } })),
    { pc: 9, branched: true }, "A complete empty owner is distinct from an unavailable provider");
  const missing = roster(); missing.party[2] = 12345;
  const before = structuredClone(missing);
  assert.throws(() => prepareEventContextBranch(character(), input({ roster: missing })), /corps identity/);
  assert.deepEqual(missing, before);
  const duplicate = roster(); duplicate.owned.push({ ...duplicate.owned[0]! });
  assert.throws(() => prepareEventContextBranch(character(), input({ roster: duplicate })), /owned identity/);
  const duplicateSlot = roster(); duplicateSlot.party[2] = 101;
  assert.throws(() => prepareEventContextBranch(character(), input({ roster: duplicateSlot })), /corps identity/);
});

test("actual player direction selects every source label and known zero vector selects south", () => {
  for (const [playerDirection, pc] of [["up", 4], ["right", 7], ["down", 10], ["left", 13], [null, 10]] as const)
    assert.deepEqual(prepareEventContextBranch(direction, input({ playerDirection })), { pc, branched: true });
});

test("unavailable or malformed player direction does not become south", () => {
  assert.throws(() => prepareEventContextBranch(direction, input()), /actual player direction/);
  assert.throws(() => prepareEventContextBranch(direction, input({ playerDirection: "north" as "up" })), /actual player direction/);
});

test("taken branches skip their label once; address zero remains a real jump", () => {
  assert.deepEqual(prepareEventContextBranch(character({ target: 0 }), input()), { pc: 1, branched: true });
  assert.deepEqual(prepareEventContextBranch({ kind: "branch-player-direction", targets: [0, 2, 3, 4] }, input({ playerDirection: "up" })),
    { pc: 1, branched: true });
});

test("selected target and Next must remain in the native task range, with no partial mutation", () => {
  const context = input(); const before = structuredClone(context);
  for (const target of [-1, 16, 17])
    assert.throws(() => prepareEventContextBranch(character({ target }), context));
  assert.deepEqual(context, before);
  assert.throws(() => prepareEventContextBranch(character(), input({ range: { min: 5, max: 16 } })), /range/);
  assert.throws(() => prepareEventContextBranch(character(), input({ range: { min: 5, max: 4 } })), /range/);
  // Native does not call JumpCommon when the condition fails.
  assert.deepEqual(prepareEventContextBranch(character({ sourceId: 14, target: 99 }), input()), { pc: 2, branched: false });
});

test("pure preparation reads each detached context afresh without retaining it", () => {
  const context = input();
  assert.equal(prepareEventContextBranch(character({ sourceId: 4 }), context).pc, 2);
  context.roster!.party[2] = 777;
  assert.equal(prepareEventContextBranch(character({ sourceId: 4 }), context).pc, 9);
  assert.equal(prepareEventContextBranch(direction, input({ playerDirection: "up" })).pc, 4);
  assert.equal(prepareEventContextBranch(direction, input({ playerDirection: "left" })).pc, 13);
});
