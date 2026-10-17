import test from "node:test";
import assert from "node:assert/strict";
import { compileEventContextBranchInstruction } from "../src/compiler/event-context-branch.js";
import {
  prepareEventContextBranch,
  type EventContextBranchInput,
  type EventContextBranchOp,
} from "../src/core/event-context-branch.js";
import type { FieldPuppetRosterRead } from "../src/core/field-puppet-roster.js";

type LeaderOp = Extract<EventContextBranchOp, { kind: "branch-leader" }>;
const raw = (sourceId = 5, target = 6) => ({
  type: 1, mnemonic: "BranchByLeader", operands: {
    iValues: [sourceId, target, 0, 0, 0, 0, 0, 0],
    rValues: Array<number>(8).fill(0), sValues: Array<string>(8).fill(""),
  },
});
const op = (changes: Partial<LeaderOp> = {}): LeaderOp => ({
  kind: "branch-leader", sourceId: 5, target: 6, ...changes,
});
const roster = (): FieldPuppetRosterRead => ({
  owned: [
    { ownedId: 5, sourceId: 1, enabled: true, conditionTypes: [] },
    { ownedId: 101, sourceId: 5, enabled: false, conditionTypes: [] },
    { ownedId: 303, sourceId: 18, enabled: true, conditionTypes: [] },
    { ownedId: 404, sourceId: 5, enabled: true, conditionTypes: [] },
  ],
  party: [5, 0, 101, 303],
});
const input = (changes: Partial<EventContextBranchInput> = {}): EventContextBranchInput => ({
  nextPc: 3, range: { min: 0, max: 16 },
  playableCharacterCorpsId: 2, roster: roster(), ...changes,
});

test("leader decoder preserves source identity and label independently of the shop selector", () => {
  for (const sourceId of [1, 5, 17, 18, 201]) {
    assert.deepEqual(compileEventContextBranchInstruction(raw(sourceId, 6)),
      { kind: "branch-leader", sourceId, target: 6 });
  }
  assert.deepEqual(compileEventContextBranchInstruction(raw(5, 0)), op({ target: 0 }));
});

test("leader decoder rejects every unsupported reserved slot and incomplete operand domain", () => {
  for (let index = 2; index < 8; index++) {
    const instruction = raw(); instruction.operands.iValues[index] = 1;
    assert.throws(() => compileEventContextBranchInstruction(instruction));
  }
  for (let index = 0; index < 8; index++) {
    const real = raw(); real.operands.rValues[index] = .1;
    assert.throws(() => compileEventContextBranchInstruction(real));
    const text = raw(); text.operands.sValues[index] = "unknown";
    assert.throws(() => compileEventContextBranchInstruction(text));
  }
  for (const instruction of [raw(0), raw(-1), raw(1.5), raw(0x80000000), raw(5, -1), raw(5, .5)])
    assert.throws(() => compileEventContextBranchInstruction(instruction));
  const wrongType = raw(); wrongType.type = 2;
  assert.throws(() => compileEventContextBranchInstruction(wrongType));
  const missing = raw(); missing.operands.iValues.pop();
  assert.throws(() => compileEventContextBranchInstruction(missing));
  const nonfinite = raw(); nonfinite.operands.rValues[0] = NaN;
  assert.throws(() => compileEventContextBranchInstruction(nonfinite));
});

test("leader lookup uses the saved Corps position and resolves Owned.Id to characterStatusId", () => {
  assert.deepEqual(prepareEventContextBranch(op(), input()), { pc: 7, branched: true });
  assert.deepEqual(prepareEventContextBranch(op({ sourceId: 101 }), input()), { pc: 3, branched: false });
  assert.deepEqual(prepareEventContextBranch(op(), input({ playableCharacterCorpsId: 0 })),
    { pc: 3, branched: false }, "Owned.Id 5 in the first Corps cell is source character 1");
  assert.deepEqual(prepareEventContextBranch(op({ sourceId: 18 }), input({ playableCharacterCorpsId: 3 })),
    { pc: 7, branched: true });
});

test("the source leader read does not filter disabled members or search other source-ID matches", () => {
  assert.deepEqual(prepareEventContextBranch(op(), input()), { pc: 7, branched: true });
  assert.deepEqual(prepareEventContextBranch(op(), input({ playableCharacterCorpsId: 3 })),
    { pc: 3, branched: false }, "An enabled source 5 outside the party does not replace source 18 at the saved position");
});

test("unavailable or null SaveMapData cannot become a nonmatching or first-cell result", () => {
  const missing = input(); delete missing.playableCharacterCorpsId;
  for (const context of [missing, input({ playableCharacterCorpsId: null })]) {
    assert.throws(() => prepareEventContextBranch(op({ sourceId: 1 }), context),
      /Missing source playable character Corps position/);
  }
});

test("negative, fractional, out-of-range and empty Corps positions never choose a fallback leader", () => {
  for (const playableCharacterCorpsId of [-1, 4, 99, .5, NaN, Infinity])
    assert.throws(() => prepareEventContextBranch(op(), input({ playableCharacterCorpsId })));
  assert.throws(() => prepareEventContextBranch(op(), input({ playableCharacterCorpsId: 1 })),
    /no owned member/);
  assert.throws(() => prepareEventContextBranch(op(), input({
    roster: { owned: [], party: [0, 0, 0, 0] }, playableCharacterCorpsId: 0,
  })), /no owned member/);
});

test("missing, ambiguous or damaged owner mappings fail without changing any supplied state", () => {
  const missingProvider = input(); delete missingProvider.roster;
  assert.throws(() => prepareEventContextBranch(op(), missingProvider), /roster provider/);
  const missing = roster(); missing.party[2] = 999;
  const duplicateOwner = roster(); duplicateOwner.owned.push({ ...duplicateOwner.owned[1]! });
  const duplicateCell = roster(); duplicateCell.party[1] = 101;
  const invalidSource = roster(); invalidSource.owned[1]!.sourceId = 0;
  for (const invalid of [missing, duplicateOwner, duplicateCell, invalidSource]) {
    const before = structuredClone(invalid);
    assert.throws(() => prepareEventContextBranch(op(), input({ roster: invalid })));
    assert.deepEqual(invalid, before);
  }
});

test("matching labels advance once while a nonmatch uses the existing next cursor", () => {
  assert.deepEqual(prepareEventContextBranch(op({ target: 0 }), input()), { pc: 1, branched: true });
  assert.deepEqual(prepareEventContextBranch(op({ sourceId: 1, target: 99 }), input()),
    { pc: 3, branched: false }, "The source does not call JumpCommon for the unselected label");
  const context = input(), before = structuredClone(context);
  for (const target of [-1, 16, 17]) assert.throws(() => prepareEventContextBranch(op({ target }), context));
  assert.deepEqual(context, before);
  assert.throws(() => prepareEventContextBranch(op(), input({ range: { min: 4, max: 16 } })), /range/);
});

test("every preparation rereads the exact saved position and current shared owner snapshot", () => {
  const context = input();
  assert.equal(prepareEventContextBranch(op(), context).pc, 7);
  context.playableCharacterCorpsId = 3;
  assert.equal(prepareEventContextBranch(op(), context).pc, 3);
  context.roster!.owned.find(member => member.ownedId === 303)!.sourceId = 5;
  assert.equal(prepareEventContextBranch(op(), context).pc, 7);
  context.roster!.party[3] = 0;
  assert.throws(() => prepareEventContextBranch(op(), context), /no owned member/);
});
