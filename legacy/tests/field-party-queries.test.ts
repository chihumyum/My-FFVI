import assert from "node:assert/strict";
import test from "node:test";
import { compileFieldPartyQueryInstruction } from "../src/compiler/field-party-queries.js";
import {
  prepareFieldPartyQuery, queryFieldParty,
  type FieldPartyQuery, type FieldPartyQueryInput, type FieldPartyQueryOp,
} from "../src/core/field-party-queries.js";
import type { FieldPuppetRosterRead } from "../src/core/field-puppet-roster.js";
import { emptyPartyState } from "../src/core/party.js";
import type { Operator } from "../src/core/script-integer.js";
import { ownedConditionGameFixture } from "./fixtures/owned-condition.js";

const current: FieldPartyQuery = { kind: "member-count", scope: "current-party" };
const enabled: FieldPartyQuery = { kind: "member-count", scope: "enabled-roster" };
const roster = (): FieldPuppetRosterRead => ({
  owned: [
    { ownedId: 71, sourceId: 5, enabled: false, conditionTypes: [5] },
    { ownedId: 82, sourceId: 9, enabled: true, conditionTypes: [4, 607] },
    { ownedId: 93, sourceId: 9, enabled: true, conditionTypes: [] },
    { ownedId: 104, sourceId: 11, enabled: true, conditionTypes: [] },
    { ownedId: 115, sourceId: 13, enabled: false, conditionTypes: [] },
  ],
  party: [0, 71, 0, 82],
});
const branch = (changes: Partial<FieldPartyQueryOp> = {}): FieldPartyQueryOp => ({
  kind: "field-party-query", query: current, operator: "＝", value: 2, target: 8, ...changes,
});
const context = (changes: Partial<FieldPartyQueryInput> = {}): FieldPartyQueryInput => ({
  nextPc: 3, range: { min: 0, max: 16 }, roster: roster(), ...changes,
});
const instruction = (scope = 0, value = 2, operator = "＝", target = 8) => ({
  type: 1, mnemonic: "BranchByNumOfMember", operands: {
    iValues: [scope, value, target, 0, 0, 0, 0, 0],
    rValues: Array<number>(8).fill(0), sValues: [operator, "", "", "", "", "", "", ""],
  },
});

test("member-count decoder preserves source scope, signed operands and comparison", () => {
  for (const operator of ["＝", "≠", "≦"] as const)
    assert.deepEqual(compileFieldPartyQueryInstruction(instruction(0, 1, operator, 0)),
      branch({ operator, value: 1, target: 0 }));
  for (const scope of [1, -1, 2147483647, -2147483648])
    assert.deepEqual(compileFieldPartyQueryInstruction(instruction(scope, -2147483648, "＞")),
      branch({ query: enabled, operator: "＞", value: -2147483648 }));
});

test("decoder requires the source type and all eight typed operands", () => {
  const wrongType = instruction(); wrongType.type = 2;
  const leader = instruction(); leader.mnemonic = "BranchByLeader";
  const invalid = [wrongType, leader, {}, instruction(0, 1, "=="), instruction(0, 1, "＝", -1),
    instruction(0, 2147483648), instruction(0.5), instruction(0, Number.NaN)];
  for (const bank of ["iValues", "rValues", "sValues"] as const) {
    const short = instruction(); short.operands[bank].pop(); invalid.push(short);
    const long = instruction(); long.operands[bank].push(0 as never); invalid.push(long);
  }
  const nonfinite = instruction(); nonfinite.operands.rValues[0] = Number.POSITIVE_INFINITY;
  invalid.push(nonfinite);
  for (const raw of invalid) assert.throws(() => compileFieldPartyQueryInstruction(raw));
});

test("decoder keeps unknown operand dependencies blocked without mutating input", () => {
  for (let index = 3; index < 8; index++) {
    const raw = instruction(); raw.operands.iValues[index] = 1;
    assert.throws(() => compileFieldPartyQueryInstruction(raw), /reserved/);
  }
  for (let index = 0; index < 8; index++) {
    const raw = instruction(); raw.operands.rValues[index] = 0.25;
    assert.throws(() => compileFieldPartyQueryInstruction(raw), /reserved/);
  }
  for (let index = 1; index < 8; index++) {
    const raw = instruction(); raw.operands.sValues[index] = "unknown";
    assert.throws(() => compileFieldPartyQueryInstruction(raw), /reserved/);
  }
  const raw = instruction(), before = structuredClone(raw);
  const op = compileFieldPartyQueryInstruction(raw); op.query.scope = "enabled-roster";
  assert.deepEqual(raw, before);
});

test("current count keeps disabled and conditioned members and excludes outside owners", () => {
  const read = roster(), before = structuredClone(read);
  assert.equal(queryFieldParty(current, read), 2);
  assert.deepEqual(read, before);
  read.owned[0]!.conditionTypes = []; read.owned[1]!.enabled = false;
  assert.equal(queryFieldParty(current, read), 2);
});

test("enabled count uses full owned roster, retaining distinct owners with the same source ID", () => {
  const read = roster();
  assert.equal(queryFieldParty(enabled, read), 3);
  read.party = [0, 0, 0, 0];
  assert.equal(queryFieldParty(enabled, read), 3);
  read.owned[2]!.enabled = false;
  assert.equal(queryFieldParty(enabled, read), 2);
});

test("known empty owner differs from unavailable or ambiguous roster input", () => {
  for (const query of [current, enabled]) {
    assert.equal(queryFieldParty(query, { owned: [], party: [0, 0, 0, 0] }), 0);
    assert.throws(() => queryFieldParty(query, undefined), /roster provider/);
    const unresolved = roster(); unresolved.party[0] = 999;
    const duplicateOwner = roster(); duplicateOwner.owned.push({ ...duplicateOwner.owned[0]! });
    const duplicateCell = roster(); duplicateCell.party[0] = 71;
    const wrongIdentity = roster(); wrongIdentity.owned[0]!.ownedId = 0;
    for (const read of [unresolved, duplicateOwner, duplicateCell, wrongIdentity]) {
      const before = structuredClone(read);
      assert.throws(() => queryFieldParty(query, read));
      assert.deepEqual(read, before);
    }
  }
});

test("all comparisons use count on the left and branch only for exactly one", () => {
  const cases: [Operator, number, boolean][] = [
    ["＝", 2, true], ["≠", 2, false], ["＞", 1, true], ["≧", 3, false],
    ["＜", 3, true], ["≦", 1, false], ["←", 1, true], ["←", 2, false],
    ["＋", -1, true], ["＋", 1, false], ["－", 1, true], ["－", 3, false],
    ["×", 1, false], ["÷", 2, true], ["÷", 0, false], ["％", 0, false],
    ["＋", 2147483647, false],
  ];
  for (const [operator, value, branched] of cases)
    assert.deepEqual(prepareFieldPartyQuery(branch({ operator, value }), context()),
      { value: 2, branched, pc: branched ? 9 : 3 });
});

test("taken branch skips the source label once, including valid zero", () => {
  assert.deepEqual(prepareFieldPartyQuery(branch({ target: 0 }), context()),
    { value: 2, branched: true, pc: 1 });
  assert.deepEqual(prepareFieldPartyQuery(branch({ value: 3 }), context()),
    { value: 2, branched: false, pc: 3 });
  assert.deepEqual(prepareFieldPartyQuery(branch({ query: enabled, value: 3 }), context()),
    { value: 3, branched: true, pc: 9 });
});

test("range failure is atomic and an untaken branch does not call JumpCommon", () => {
  const input = context(), before = structuredClone(input);
  for (const target of [-1, 16, 17, 2147483647])
    assert.throws(() => prepareFieldPartyQuery(branch({ target }), input));
  assert.deepEqual(input, before);
  assert.deepEqual(prepareFieldPartyQuery(branch({ value: 3, target: 99 }), input),
    { value: 2, branched: false, pc: 3 });
  assert.throws(() => prepareFieldPartyQuery(branch(), context({ range: { min: 4, max: 16 } })), /range/);
  assert.throws(() => prepareFieldPartyQuery(branch(), context({ range: { min: 4, max: 3 } })), /range/);
  assert.throws(() => prepareFieldPartyQuery(branch({ value: 3 }), context({ nextPc: 17 })), /range/);
});

test("unknown queries and malformed runtime plans cannot silently become false", () => {
  assert.throws(() => queryFieldParty({ ...current, scope: "all-corps" } as unknown as FieldPartyQuery, roster()));
  assert.throws(() => queryFieldParty({ ...current, kind: "leader" } as unknown as FieldPartyQuery, roster()));
  assert.throws(() => prepareFieldPartyQuery(branch({ operator: "==" as Operator }), context()));
  assert.throws(() => prepareFieldPartyQuery(branch({ value: 0.5 }), context()));
  assert.throws(() => prepareFieldPartyQuery(branch(), { nextPc: 3, range: { min: 0, max: 16 } }), /roster provider/);
});

test("real shared owner queries only its selected slot and changes with a published candidate", () => {
  const { state } = ownedConditionGameFixture(), saved = state.snapshot();
  saved.party = emptyPartyState();
  saved.party.slots[0][2].id = "a";
  saved.party.slots[1][0].id = "a"; saved.party.slots[1][3].id = "b";
  saved.roster[0]!.enabled = false;
  state.restore(saved);
  const live = state.fieldPuppetRoster, before = state.snapshot();
  assert.equal(queryFieldParty(current, live.current()), 1);
  assert.equal(queryFieldParty(enabled, live.current()), 1);
  const draft = state.prepareFieldState();
  draft.ports.party.prepare({ kind: "select-slot", slot: 1, refreshActors: false }).commit();
  assert.equal(queryFieldParty(current, draft.ports.puppetRoster.current()), 2);
  assert.equal(queryFieldParty(current, live.current()), 1);
  assert.deepEqual(state.snapshot(), before);
  assert.equal(draft.commit(), true);
  assert.equal(queryFieldParty(current, live.current()), 2);
  state.fieldParty.prepare({ kind: "select-slot", slot: 2, refreshActors: false }).commit();
  assert.equal(queryFieldParty(current, draft.ports.puppetRoster.current()), 0,
    "published candidate port follows the current owner instead of retaining a count cache");
});

test("stale candidate and checkpoint restore preserve query ownership", () => {
  const { state, make } = ownedConditionGameFixture();
  const live = state.fieldPuppetRoster, before = state.snapshot();
  const count = queryFieldParty(current, live.current());
  const draft = state.prepareFieldState();
  draft.ports.party.prepare({ kind: "select-slot", slot: 2, refreshActors: false }).commit();
  state.fieldInventory.prepare({ kind: "grant-gil", amount: 1 }).commit();
  const changed = state.snapshot();
  assert.equal(draft.commit(), false);
  assert.equal(queryFieldParty(current, live.current()), count);
  assert.deepEqual(state.snapshot(), changed);
  const restored = make(); restored.restore(JSON.parse(JSON.stringify(before)));
  assert.equal(queryFieldParty(current, restored.fieldPuppetRoster.current()), count);
  restored.fieldParty.prepare({ kind: "select-slot", slot: 2, refreshActors: false }).commit();
  assert.equal(queryFieldParty(current, restored.fieldPuppetRoster.current()), 0);
  assert.equal(queryFieldParty(current, live.current()), count);
});
